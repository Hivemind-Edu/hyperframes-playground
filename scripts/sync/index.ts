/**
 * Sync entry point — env-specific.
 *
 * Reads build/manifest.json, uploads every artifact to Firebase Storage,
 * UPSERTs feed/chapter/profile/post/feedtag/comment rows in Postgres.
 *
 * Env config from .env.<env> at the playground root. Prod runs require an
 * extra confirmation step.
 */

import * as p from "@clack/prompts";
import pLimit from "p-limit";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  HYPERFRAMES_PLAYER_BUNDLE_STORAGE_PATH,
  loadEnv,
  type SyncEnvName,
} from "./env";
import { getFirebaseStorageMediaUrl, initFirebase, uploadFileToStorage } from "./firebase";
import {
  createDb,
  jsonValue,
  setFeedFirstPost,
  syncFeedtags,
  upsertChapter,
  upsertFeed,
  upsertPost,
  upsertProfile,
} from "./db";
import { uploadPostArtifact, type UploadPostResult } from "./uploadPost";
import {
  type BuildManifest,
  type ChapterManifestEntry,
  type Comment,
  type FeedManifestEntry,
  type PostManifestEntry,
  readManifest,
} from "../shared/manifest";
import { ONBOARDING_FEED_SLUG } from "../shared/slugify";

const playgroundRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const manifestPath = join(playgroundRoot, "build", "manifest.json");

const DEMO_USER_ID = "DEMO";

type CliOptions = {
  envName: SyncEnvName;
  only: string | null;
  dryRun: boolean;
  concurrency: number;
};

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    envName: "dev",
    only: null,
    dryRun: false,
    concurrency: 8,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--env") {
      const value = argv[++i];
      if (!value || !["dev", "staging", "prod"].includes(value)) {
        throw new Error(`--env must be dev | staging | prod, got: ${value}`);
      }
      options.envName = value as SyncEnvName;
    } else if (arg === "--only") {
      options.only = argv[++i] ?? null;
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--concurrency") {
      options.concurrency = Math.max(1, Number(argv[++i] ?? "8"));
    }
  }
  return options;
}

async function main() {
  const options = parseArgs(Bun.argv.slice(2));
  p.intro(`Brainjuice playground sync (${options.envName})`);

  if (!existsSync(manifestPath)) {
    p.cancel("build/manifest.json not found. Run `bun run build` first.");
    process.exit(1);
  }

  const env = loadEnv(options.envName);

  if (options.envName === "prod") {
    const confirm = await p.confirm({
      message: `You are about to write to PRODUCTION (${env.firebaseStorageBucket}). Continue?`,
      initialValue: false,
    });
    if (p.isCancel(confirm) || !confirm) {
      p.cancel("Aborted.");
      process.exit(1);
    }
  }

  initFirebase({
    firebaseConfigPath: env.firebaseConfigPath,
    firebaseStorageBucket: env.firebaseStorageBucket,
  });

  const db = createDb(env.databaseUrl);
  const manifest = readManifest(manifestPath);
  p.log.info(
    `Manifest: ${manifest.feeds.length} feeds, ${manifest.chapters.length} chapters, ${manifest.posts.length} posts.`,
  );

  const filteredPosts = options.only
    ? manifest.posts.filter((post) => post.id === options.only)
    : manifest.posts;
  if (filteredPosts.length === 0) {
    p.cancel(`No posts matched --only ${options.only}.`);
    process.exit(1);
  }

  if (options.dryRun) {
    p.log.warn("Dry run: nothing will be uploaded or written.");
    p.outro(`Would sync ${filteredPosts.length} posts to ${options.envName}.`);
    await db.destroy();
    return;
  }

  const involvedFeedIds = new Set(filteredPosts.map((post) => post.feedId));
  const involvedChapterIds = new Set(filteredPosts.map((post) => post.chapterId));
  const feeds = manifest.feeds.filter((feed) => involvedFeedIds.has(feed.id));
  const chapters = manifest.chapters.filter((chap) => involvedChapterIds.has(chap.id));

  // ── Upload feed pictures ────────────────────────────────────────────────
  const feedPicSpinner = p.spinner();
  feedPicSpinner.start("Uploading feed pictures");
  for (const feed of feeds) {
    if (!feed.picturePath) continue;
    const abs = join(playgroundRoot, feed.picturePath);
    if (!existsSync(abs) || !statSync(abs).isFile()) continue;
    await uploadFileToStorage({
      storagePath: `feed_picture/${feed.id}`,
      localPath: abs,
      contentType: "image/webp",
    });
  }
  feedPicSpinner.stop(`Uploaded ${feeds.filter((f) => f.picturePath).length} feed pictures`);

  // ── Upload post artifacts ──────────────────────────────────────────────
  const postsSpinner = p.spinner();
  postsSpinner.start("Uploading post artifacts");
  const limit = pLimit(options.concurrency);
  let uploadDone = 0;
  const uploadResults = await Promise.all(
    filteredPosts.map((post) =>
      limit(async () => {
        const result = await uploadPostArtifact({
          playgroundRoot,
          post,
          hyperframesPlayerStoragePath: HYPERFRAMES_PLAYER_BUNDLE_STORAGE_PATH,
        });
        uploadDone += 1;
        postsSpinner.message(
          `Uploading post artifacts (${uploadDone}/${filteredPosts.length})`,
        );
        return result;
      }),
    ),
  );
  postsSpinner.stop(`Uploaded ${uploadResults.length} post artifacts`);

  // ── DB UPSERTs (single transaction) ─────────────────────────────────────
  const dbSpinner = p.spinner();
  dbSpinner.start("Writing DB rows");

  await db.transaction().execute(async (trx) => {
    // Feeds first — profile.feed_id and post.chapter_id depend on this.
    for (const feed of feeds) {
      const isOnboarding = feed.slug === ONBOARDING_FEED_SLUG;
      await upsertFeed(trx, {
        id: feed.id,
        name: feed.name,
        // Onboarding feed deliberately not LLM so it stays out of discover.
        origin_type: isOnboarding ? "USER" : "LLM",
        origin_info: jsonValue({ source: "hyperframes-playground" }),
        gen_state: "COMPLETE",
        gen_info: jsonValue({}),
        gen_history: jsonValue([]),
        user_id: DEMO_USER_ID,
        picture_path: feed.picturePath ? `feed_picture/${feed.id}` : null,
        short_desc: null,
        contents: null,
        language: "en",
        first_post_id: null,
        gen_duration_ms: null,
        observation_id: null,
        picture: null,
        source_podcast_episode_id: null,
        userfile_id: null,
      });
    }

    // Profiles (feed_id FK now satisfied).
    const profilesById = new Map<string, FeedManifestEntry>();
    for (const feed of feeds) profilesById.set(feed.profile.id, feed);
    for (const feed of profilesById.values()) {
      await upsertProfile(trx, {
        id: feed.profile.id,
        name: feed.profile.name,
        type: "SYNTHETIC",
        feed_id: feed.id,
        chapter_id: null,
        owner_user_id: null,
        synthuser_id: null,
        user_id: null,
      });
    }

    // Chapters
    for (const chapter of chapters) {
      await upsertChapter(trx, {
        id: chapter.id,
        feed_id: chapter.feedId,
        name: chapter.name,
        desc: chapter.name,
        sort_order: chapter.sortOrder,
        gen_state: "COMPLETE",
        gen_info: jsonValue({}),
        gen_history: jsonValue([]),
        origin_info: jsonValue({ source: "hyperframes-playground" }),
        origin_type: "USER",
        contents: jsonValue({}),
        gen_duration_ms: null,
        learning_topic_id: null,
        observation_id: null,
        suggested_by: null,
      });
    }

    // Posts (root) + comments
    const feedById = new Map(feeds.map((feed) => [feed.id, feed]));
    const firstPostByFeed = new Map<string, { postId: string; sortOrder: number }>();
    for (const post of filteredPosts) {
      const feed = feedById.get(post.feedId);
      if (!feed) {
        throw new Error(`Manifest is missing feed ${post.feedId} for post ${post.id}`);
      }
      const upload = uploadResults.find((u) => u.postId === post.id)!;
      const videoData = {
        templateId: "DemoHyperFramesArtifact",
        props: {},
        durationSeconds: post.durationSeconds,
        renderer: "hyperframes" as const,
        posterImageUrl: upload.posterUrl ?? undefined,
        recompiledAt: new Date().toISOString(),
      };
      await upsertPost(trx, {
        id: post.id,
        chapter_id: post.chapterId,
        contents: jsonValue({ videoData }),
        display_style: "BASIC",
        gen_state: "COMPLETE",
        gen_info: jsonValue({}),
        gen_history: jsonValue([]),
        origin_info: jsonValue({ source: "hyperframes-playground" }),
        origin_type: "USER",
        parent_post_id: null,
        poster_profile_id: feed.profile.id,
        sort_order: post.sortOrder,
        text: post.text,
        attachment: null,
        gen_duration_ms: null,
        observation_id: null,
        quiz_data: null,
        user_interactions: null,
      });

      // Track first post per feed (lowest sort_order).
      const firstSoFar = firstPostByFeed.get(feed.id);
      if (!firstSoFar || post.sortOrder < firstSoFar.sortOrder) {
        firstPostByFeed.set(feed.id, { postId: post.id, sortOrder: post.sortOrder });
      }

      // Comments
      const commentsPath = join(playgroundRoot, post.buildPath, "comments.json");
      if (existsSync(commentsPath)) {
        try {
          const comments = JSON.parse(readFileSync(commentsPath, "utf8")) as Comment[];
          let commentIndex = 0;
          for (const comment of comments) {
            await upsertPost(trx, {
              id: `${post.id}_c${commentIndex}`,
              chapter_id: post.chapterId,
              contents: null,
              display_style: "COMMENT",
              gen_state: "COMPLETE",
              gen_info: jsonValue({ probability: comment.probability }),
              gen_history: jsonValue([]),
              origin_info: jsonValue({ source: "hyperframes-playground" }),
              origin_type: "LLM",
              parent_post_id: post.id,
              poster_profile_id: feed.profile.id,
              sort_order: comment.sortOrder ?? commentIndex,
              text: comment.text,
              attachment: null,
              gen_duration_ms: null,
              observation_id: null,
              quiz_data: null,
              user_interactions: null,
            });
            commentIndex += 1;
          }
        } catch (error) {
          console.warn(`Failed to load/insert comments for ${post.id}:`, error);
        }
      }
    }

    // Feedtags (only seed feeds)
    for (const feed of feeds) {
      if (feed.slug === ONBOARDING_FEED_SLUG) continue;
      await syncFeedtags({ db: trx, feedId: feed.id, tagIds: feed.tags });
    }

    // first_post_id per feed
    for (const [feedId, first] of firstPostByFeed.entries()) {
      await setFeedFirstPost({ db: trx, feedId, firstPostId: first.postId });
    }
  });

  dbSpinner.stop(`Wrote ${filteredPosts.length} posts to ${options.envName}`);
  await db.destroy();

  // Summary
  p.note(
    [
      `env:    ${options.envName}`,
      `bucket: ${env.firebaseStorageBucket}`,
      `feeds:  ${feeds.length}`,
      `posts:  ${filteredPosts.length}`,
      `pics:   ${feeds.filter((f) => f.picturePath).length}`,
      `sample: ${getFirebaseStorageMediaUrl(`brainjuice-generated/${filteredPosts[0]!.id}/artifact/index.html`)}`,
    ].join("\n"),
    "Sync complete",
  );

  p.outro("Done.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
