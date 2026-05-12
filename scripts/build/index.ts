/**
 * Build entry point — env-agnostic.
 *
 * Walks videos/, compiles each leaf, runs Gemini for copy + comments + tags
 * + profile name, runs Flux Schnell for feed pictures, writes the result
 * tree under `build/` and a top-level `build/manifest.json`.
 *
 * Source-hash invalidation per leaf. Per-aspect `--regenerate-*` flags
 * force a re-run even if the hash is unchanged.
 *
 * Run as: `bun run build` from hyperframes-playground/.
 */

import * as p from "@clack/prompts";
import pLimit from "p-limit";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { compileLeaf } from "./compile";
import { extractLeafText } from "./innerText";
import {
  assertLlmConfigured,
  chooseTagsForFeed,
  generateCommentsForPost,
  generatePostCopy,
  generateProfileName,
  isLlmConfigured,
} from "./llm";
import { assertFalConfigured, generateFeedPicture, isFalConfigured } from "./feedPicture";
import { hashFeedInputs, hashLeafSource } from "../shared/hashing";
import {
  type BuildManifest,
  type ChapterManifestEntry,
  type FeedManifestEntry,
  type PostManifestEntry,
  readJsonOrNull,
  writeJson,
  writeManifest,
} from "../shared/manifest";
import { walkVideos, type LeafEntry } from "../shared/walker";
import { ONBOARDING_FEED_SLUG } from "../shared/slugify";

const playgroundRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const videosRoot = join(playgroundRoot, "videos");
const buildRoot = join(playgroundRoot, "build");

type Regenerate = {
  copy: boolean;
  comments: boolean;
  tags: boolean;
  profileName: boolean;
  picture: boolean;
  snapshot: boolean;
  all: boolean;
};

type CliOptions = {
  filter: string | null;
  concurrency: number;
  regenerate: Regenerate;
  /** Skip every LLM call regardless of caching. */
  noLlm: boolean;
};

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    filter: null,
    concurrency: 8,
    regenerate: {
      copy: false,
      comments: false,
      tags: false,
      profileName: false,
      picture: false,
      snapshot: false,
      all: false,
    },
    noLlm: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--filter") {
      options.filter = argv[++i] ?? null;
    } else if (arg === "--concurrency") {
      options.concurrency = Math.max(1, Number(argv[++i] ?? "8"));
    } else if (arg === "--regenerate-copy") options.regenerate.copy = true;
    else if (arg === "--regenerate-comments") options.regenerate.comments = true;
    else if (arg === "--regenerate-tags") options.regenerate.tags = true;
    else if (arg === "--regenerate-profile-name") options.regenerate.profileName = true;
    else if (arg === "--regenerate-picture") options.regenerate.picture = true;
    else if (arg === "--regenerate-snapshot") options.regenerate.snapshot = true;
    else if (arg === "--regenerate-all") options.regenerate.all = true;
    else if (arg === "--no-llm") options.noLlm = true;
    else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
  }
  if (options.regenerate.all) {
    options.regenerate = {
      copy: true,
      comments: true,
      tags: true,
      profileName: true,
      picture: true,
      snapshot: true,
      all: true,
    };
  }
  return options;
}

function printHelp() {
  console.log(`Usage: bun run build [options]

Options:
  --filter <substring>           Only process leaves whose sourcePath contains <substring>
  --concurrency <N>              Parallel leaf processing (default 8)
  --regenerate-copy              Re-run Gemini copy generation even if cached
  --regenerate-comments          Re-run comment thread generation
  --regenerate-tags              Re-run feed tag selection
  --regenerate-profile-name      Re-run feed author name generation
  --regenerate-picture           Re-run feed picture generation (Flux Schnell)
  --regenerate-snapshot          Re-run hyperframes snapshot
  --regenerate-all               Force everything
  --no-llm                       Skip all LLM/image-gen calls (stub copy/comments)
`);
}

async function main() {
  const options = parseArgs(Bun.argv.slice(2));

  p.intro("Brainjuice playground build");

  if (!options.noLlm) {
    assertLlmConfigured();
    assertFalConfigured();
  }

  if (!existsSync(buildRoot)) mkdirSync(buildRoot, { recursive: true });

  const leaves = walkVideos(videosRoot).filter((leaf) =>
    options.filter ? leaf.sourcePath.includes(options.filter) : true,
  );
  if (leaves.length === 0) {
    p.outro("No leaves matched. Nothing to build.");
    return;
  }

  const llmConfigured = !options.noLlm && isLlmConfigured();
  const falConfigured = !options.noLlm && isFalConfigured();
  p.log.info(
    `Found ${leaves.length} leaves. Gemini: ${llmConfigured ? "enabled" : "disabled"}; fal.ai: ${falConfigured ? "enabled" : "disabled"}.`,
  );

  // ── Compile leaves in parallel ──────────────────────────────────────────
  const leafSpinner = p.spinner();
  leafSpinner.start("Compiling leaves");
  const limit = pLimit(options.concurrency);
  let done = 0;
  const posts = await Promise.all(
    leaves.map((leaf) =>
      limit(async () => {
        const result = await processLeaf(leaf, options, llmConfigured);
        done += 1;
        leafSpinner.message(`Compiling leaves (${done}/${leaves.length})`);
        return result;
      }),
    ),
  );
  leafSpinner.stop(`Compiled ${posts.length} leaves`);

  // ── Group into feeds + chapters ─────────────────────────────────────────
  const feedsBuckets = new Map<string, { leaf: LeafEntry; post: PostManifestEntry }[]>();
  const chaptersByKey = new Map<string, ChapterManifestEntry>();
  for (let i = 0; i < leaves.length; i += 1) {
    const leaf = leaves[i]!;
    const post = posts[i]!;
    const arr = feedsBuckets.get(leaf.feedId);
    if (arr) arr.push({ leaf, post });
    else feedsBuckets.set(leaf.feedId, [{ leaf, post }]);
    const chapterKey = leaf.chapterId;
    if (!chaptersByKey.has(chapterKey)) {
      chaptersByKey.set(chapterKey, {
        id: leaf.chapterId,
        feedId: leaf.feedId,
        name: leaf.chapterName,
        slug: leaf.chapterSlug,
        sortOrder: leaf.chapterSortOrder,
      });
    }
  }

  // ── Feed-level work ─────────────────────────────────────────────────────
  const feeds: FeedManifestEntry[] = [];
  const feedSpinner = p.spinner();
  feedSpinner.start("Building feeds");
  let feedDone = 0;
  await Promise.all(
    Array.from(feedsBuckets.entries()).map(([feedId, entries]) =>
      limit(async () => {
        const feedEntry = await processFeed({
          feedId,
          entries,
          options,
          llmConfigured,
          falConfigured,
        });
        feeds.push(feedEntry);
        feedDone += 1;
        feedSpinner.message(`Building feeds (${feedDone}/${feedsBuckets.size})`);
      }),
    ),
  );
  feedSpinner.stop(`Built ${feeds.length} feeds`);

  // ── Manifest write ──────────────────────────────────────────────────────
  feeds.sort((a, b) => a.id.localeCompare(b.id));
  const chapters = Array.from(chaptersByKey.values()).sort((a, b) => {
    if (a.feedId !== b.feedId) return a.feedId.localeCompare(b.feedId);
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    return a.id.localeCompare(b.id);
  });
  posts.sort((a, b) => {
    if (a.feedId !== b.feedId) return a.feedId.localeCompare(b.feedId);
    if (a.chapterId !== b.chapterId) return a.chapterId.localeCompare(b.chapterId);
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    return a.id.localeCompare(b.id);
  });

  const manifest: BuildManifest = {
    version: 1,
    generatedAt: new Date().toISOString(),
    feeds,
    chapters,
    posts,
  };
  writeManifest(join(buildRoot, "manifest.json"), manifest);

  p.outro(
    `Wrote build/manifest.json — ${feeds.length} feeds, ${chapters.length} chapters, ${posts.length} posts.`,
  );
}

async function processLeaf(
  leaf: LeafEntry,
  options: CliOptions,
  llmConfigured: boolean,
): Promise<PostManifestEntry> {
  const sourceHash = hashLeafSource(leaf.absolutePath);
  const buildPath = buildPathForLeaf(leaf);
  const absBuildPath = join(playgroundRoot, buildPath);
  const previous = readJsonOrNull<PostManifestEntry>(join(absBuildPath, "post.json"));

  const sourceChanged = !previous || previous.sourceHash !== sourceHash;
  const needsCompile = sourceChanged || options.regenerate.snapshot;

  let compile;
  if (needsCompile) {
    compile = await compileLeaf(leaf, absBuildPath);
  } else {
    compile = {
      durationSeconds: previous!.durationSeconds,
      posterRelativePath: previous!.posterFilename,
      posterError: previous!.hyperframesSnapshotError,
      compositionRelativePaths: [],
      assetRelativePaths: [],
    };
  }

  // ── Copy (shortTitle + videoDescription) ───────────────────────────────
  let copyText = previous?.text ?? leaf.postName;
  let copyDescription = previous?.description ?? "";
  let copyError: string | undefined = previous?.copyError;
  const needsCopy =
    llmConfigured && (sourceChanged || options.regenerate.copy || !previous?.description);
  if (needsCopy) {
    try {
      const extracted = extractLeafText(leaf.absolutePath);
      const { shortTitle, videoDescription } = await generatePostCopy(extracted);
      copyText = shortTitle;
      copyDescription = videoDescription;
      copyError = undefined;
    } catch (error) {
      copyError = error instanceof Error ? error.message : String(error);
    }
  }
  if (!llmConfigured) {
    copyText = previous?.text ?? leaf.postName;
    copyDescription = previous?.description ?? "";
  }

  // ── Comments ───────────────────────────────────────────────────────────
  let commentsError: string | undefined = previous?.commentsError;
  const commentsPath = join(absBuildPath, "comments.json");
  const hasComments = existsSync(commentsPath);
  const needsComments =
    llmConfigured && (sourceChanged || options.regenerate.comments || !hasComments);
  if (needsComments) {
    try {
      const comments = await generateCommentsForPost({
        shortTitle: copyText,
        videoDescription: copyDescription,
      });
      writeJson(commentsPath, comments);
      commentsError = undefined;
    } catch (error) {
      commentsError = error instanceof Error ? error.message : String(error);
    }
  }

  const post: PostManifestEntry = {
    id: leaf.postId,
    feedId: leaf.feedId,
    chapterId: leaf.chapterId,
    role: leaf.role,
    sortOrder: leaf.postSortOrder,
    text: copyText,
    description: copyDescription,
    durationSeconds: compile.durationSeconds,
    posterFilename: compile.posterRelativePath ?? "",
    buildPath,
    sourceHash,
    hyperframesSnapshotError: compile.posterError,
    copyError,
    commentsError,
  };
  writeJson(join(absBuildPath, "post.json"), post);
  return post;
}

async function processFeed(args: {
  feedId: string;
  entries: { leaf: LeafEntry; post: PostManifestEntry }[];
  options: CliOptions;
  llmConfigured: boolean;
  falConfigured: boolean;
}): Promise<FeedManifestEntry> {
  const { feedId, entries, options, llmConfigured, falConfigured } = args;
  const first = entries[0]!.leaf;
  const buildPath = `build/${dirSlug(first.feedSlug)}`;
  const absBuildPath = join(playgroundRoot, buildPath);
  mkdirSync(absBuildPath, { recursive: true });
  const previous = readJsonOrNull<FeedManifestEntry>(join(absBuildPath, "feed.json"));

  const postSummaries = entries
    .sort((a, b) => a.post.sortOrder - b.post.sortOrder)
    .map((e) => `${e.post.text} — ${e.post.description}`.trim());
  const feedHash = hashFeedInputs({ feedName: first.feedName, postSummaries });
  const feedChanged = !previous || previous.feedHash !== feedHash;

  // Onboarding feed never gets tags (we exclude it from discover).
  const skipTags = first.feedSlug === ONBOARDING_FEED_SLUG;
  let tags: string[] = previous?.tags ?? [];
  let tagsError: string | undefined = previous?.tagsError;
  const needsTags =
    !skipTags &&
    llmConfigured &&
    (feedChanged || options.regenerate.tags || (previous && previous.tags.length === 0));
  if (needsTags) {
    try {
      const blueprint = postSummaries.join("\n\n");
      tags = await chooseTagsForFeed({ feedName: first.feedName, blueprint });
      tagsError = undefined;
    } catch (error) {
      tagsError = error instanceof Error ? error.message : String(error);
    }
  }
  if (skipTags) tags = [];

  // Profile name
  let profileName = previous?.profile?.name ?? `${first.feedName} Demos`;
  let profileNameError: string | undefined = previous?.profileNameError;
  const needsProfileName =
    llmConfigured &&
    (feedChanged ||
      options.regenerate.profileName ||
      !previous?.profile?.name);
  if (needsProfileName) {
    try {
      profileName = await generateProfileName({ feedName: first.feedName });
      profileNameError = undefined;
    } catch (error) {
      profileNameError = error instanceof Error ? error.message : String(error);
    }
  }

  // Feed picture (Flux Schnell)
  const picturePath = `${buildPath}/picture.webp`;
  const absPicturePath = join(playgroundRoot, picturePath);
  let pictureRel: string | undefined = previous?.picturePath;
  let pictureError: string | undefined = previous?.pictureError;
  const pictureExists = existsSync(absPicturePath);
  const needsPicture =
    falConfigured &&
    (feedChanged ||
      options.regenerate.picture ||
      !pictureExists ||
      !previous?.picturePath);
  if (needsPicture) {
    try {
      await generateFeedPicture({
        topic: first.feedName,
        outputPath: absPicturePath,
      });
      pictureRel = picturePath;
      pictureError = undefined;
    } catch (error) {
      pictureError = error instanceof Error ? error.message : String(error);
    }
  } else if (pictureExists) {
    pictureRel = picturePath;
  }

  const feedEntry: FeedManifestEntry = {
    id: feedId,
    name: first.feedName,
    role: first.role,
    slug: first.feedSlug,
    tags,
    profile: { id: first.profileId, name: profileName },
    picturePath: pictureRel,
    buildPath,
    feedHash,
    tagsError,
    profileNameError,
    pictureError,
  };
  writeJson(join(absBuildPath, "feed.json"), feedEntry);
  return feedEntry;
}

function buildPathForLeaf(leaf: LeafEntry): string {
  const feedDir = dirSlug(leaf.feedSlug);
  const chapterDir = dirSlug(leaf.chapterSlug);
  const postDir = dirSlug(leaf.postSlug);
  return `build/${feedDir}/${chapterDir}/${postDir}`;
}

function dirSlug(slug: string): string {
  return slug.replace(/[^a-z0-9_-]+/g, "_") || "_";
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
