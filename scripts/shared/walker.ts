/**
 * Walks `videos/` and yields publishable leaves with role + identity.
 *
 * Two folder shapes are supported:
 *   1. `videos/Demo Videos/<chapter>/<leaf>`         → role: "onboarding"
 *   2. `videos/<Feed>/<Chapter>/<leaf>`              → role: "seed"
 *
 * A leaf is any folder containing `index.html`. Folders without it are ignored.
 *
 * Identity is fully derived from the folder path — no per-leaf metadata file.
 *
 * For onboarding (Demo Videos):
 *   - All posts collapse to a single feed `f_demo_brainjuice`, single chapter
 *     `c_demo_brainjuice_main`. The intermediate folder (`0 Demo Videos`) is
 *     used only for organizing on disk.
 *   - postId = `p_demo_brainjuice_<post-slug>`.
 */

import { existsSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import {
  deriveChapterId,
  deriveFeedId,
  derivePostId,
  deriveProfileId,
  ONBOARDING_CHAPTER_SLUG,
  ONBOARDING_FEED_FOLDER,
  ONBOARDING_FEED_SLUG,
  parseFolderName,
  slugify,
} from "./slugify";

export type LeafRole = "onboarding" | "seed";

export type LeafEntry = {
  role: LeafRole;
  /** Absolute filesystem path to the leaf folder. */
  absolutePath: string;
  /** Path relative to `videos/`, used for logging and source-hash keys. */
  sourcePath: string;
  feedId: string;
  feedSlug: string;
  feedName: string;
  chapterId: string;
  chapterSlug: string;
  chapterName: string;
  chapterSortOrder: number;
  postId: string;
  postSlug: string;
  postName: string;
  postSortOrder: number;
  profileId: string;
};

const listDirectories = (dir: string) =>
  readdirSync(dir)
    .map((name) => ({ name, path: join(dir, name) }))
    .filter((entry) => {
      try {
        return statSync(entry.path).isDirectory();
      } catch {
        return false;
      }
    });

const isLeaf = (dir: string) => existsSync(join(dir, "index.html"));

export function walkVideos(videosRoot: string): LeafEntry[] {
  if (!existsSync(videosRoot)) {
    throw new Error(`videos root does not exist: ${videosRoot}`);
  }

  const leaves: LeafEntry[] = [];

  for (const topLevel of listDirectories(videosRoot)) {
    if (topLevel.name === ONBOARDING_FEED_FOLDER) {
      collectOnboardingLeaves(topLevel.path, videosRoot, leaves);
    } else {
      collectSeedLeaves(topLevel, videosRoot, leaves);
    }
  }

  leaves.sort((a, b) => {
    if (a.feedId !== b.feedId) return a.feedId.localeCompare(b.feedId);
    if (a.chapterSortOrder !== b.chapterSortOrder)
      return a.chapterSortOrder - b.chapterSortOrder;
    if (a.chapterId !== b.chapterId) return a.chapterId.localeCompare(b.chapterId);
    if (a.postSortOrder !== b.postSortOrder)
      return a.postSortOrder - b.postSortOrder;
    return a.postId.localeCompare(b.postId);
  });

  return leaves;
}

function collectOnboardingLeaves(
  feedFolderPath: string,
  videosRoot: string,
  out: LeafEntry[],
): void {
  const feedSlug = ONBOARDING_FEED_SLUG;
  const feedName = "Brainjuice Demos";
  const feedId = deriveFeedId(feedSlug);
  const chapterSlug = ONBOARDING_CHAPTER_SLUG;
  const chapterId = deriveChapterId(feedSlug, chapterSlug);
  const chapterName = "Sampler";
  const profileId = deriveProfileId(feedSlug);

  // Walk one level deeper (the "0 Demo Videos" container) and treat its
  // children as leaves directly.
  for (const subContainer of listDirectories(feedFolderPath)) {
    for (const leafCandidate of listDirectories(subContainer.path)) {
      if (!isLeaf(leafCandidate.path)) continue;
      const parsed = parseFolderName(leafCandidate.name);
      out.push({
        role: "onboarding",
        absolutePath: leafCandidate.path,
        sourcePath: relative(videosRoot, leafCandidate.path),
        feedId,
        feedSlug,
        feedName,
        chapterId,
        chapterSlug,
        chapterName,
        chapterSortOrder: 0,
        postId: `p_demo_${feedSlug}_${parsed.slug}`,
        postSlug: parsed.slug,
        postName: parsed.name,
        postSortOrder: parsed.sortOrder,
        profileId,
      });
    }
  }
}

function collectSeedLeaves(
  topLevel: { name: string; path: string },
  videosRoot: string,
  out: LeafEntry[],
): void {
  const parsedFeed = parseFolderName(topLevel.name);
  const feedSlug = parsedFeed.slug || slugify(topLevel.name);
  const feedId = deriveFeedId(feedSlug);
  const feedName = parsedFeed.name;
  const profileId = deriveProfileId(feedSlug);

  for (const chapterDir of listDirectories(topLevel.path)) {
    const parsedChapter = parseFolderName(chapterDir.name);
    const chapterSlug = parsedChapter.slug || slugify(chapterDir.name);
    const chapterId = deriveChapterId(feedSlug, chapterSlug);
    const chapterName = parsedChapter.name;

    for (const leafCandidate of listDirectories(chapterDir.path)) {
      if (!isLeaf(leafCandidate.path)) continue;
      const parsedPost = parseFolderName(leafCandidate.name);
      const postSlug = parsedPost.slug || slugify(leafCandidate.name);
      out.push({
        role: "seed",
        absolutePath: leafCandidate.path,
        sourcePath: relative(videosRoot, leafCandidate.path),
        feedId,
        feedSlug,
        feedName,
        chapterId,
        chapterSlug,
        chapterName,
        chapterSortOrder: parsedChapter.sortOrder,
        postId: derivePostId(feedSlug, chapterSlug, postSlug),
        postSlug,
        postName: parsedPost.name,
        postSortOrder: parsedPost.sortOrder,
        profileId,
      });
    }
  }
}
