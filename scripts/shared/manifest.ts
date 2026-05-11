/**
 * Schema for `build/manifest.json` and per-post / per-feed JSON files.
 *
 * The build script writes these. The sync script reads them. The build
 * folder is git-committed, so these shapes are part of the review surface.
 */

import { readFileSync, writeFileSync } from "node:fs";
import type { LeafRole } from "./walker";

export type Comment = {
  text: string;
  sortOrder: number;
  probability?: number;
};

export type PostManifestEntry = {
  id: string;
  feedId: string;
  chapterId: string;
  role: LeafRole;
  sortOrder: number;
  /** Title shown above the video. */
  text: string;
  /** Long description used for downstream search/embeddings later. */
  description: string;
  durationSeconds: number;
  posterFilename: string;
  buildPath: string;
  sourceHash: string;
  /** Bytes/strings missing → field undefined; sync skips that piece. */
  hyperframesSnapshotError?: string;
  copyError?: string;
  commentsError?: string;
};

export type FeedManifestEntry = {
  id: string;
  name: string;
  role: LeafRole;
  /** Snake-case-ish slug used in IDs. */
  slug: string;
  /** Tag IDs (skipped for the onboarding feed). */
  tags: string[];
  profile: {
    id: string;
    name: string;
  };
  picturePath?: string;
  buildPath: string;
  /** Source hash of feed-level inputs (name + post descriptions). */
  feedHash: string;
  tagsError?: string;
  profileNameError?: string;
  pictureError?: string;
};

export type ChapterManifestEntry = {
  id: string;
  feedId: string;
  name: string;
  slug: string;
  sortOrder: number;
};

export type BuildManifest = {
  version: 1;
  generatedAt: string;
  feeds: FeedManifestEntry[];
  chapters: ChapterManifestEntry[];
  posts: PostManifestEntry[];
};

export function readManifest(path: string): BuildManifest {
  const raw = readFileSync(path, "utf8");
  return JSON.parse(raw) as BuildManifest;
}

export function writeManifest(path: string, manifest: BuildManifest): void {
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
}

export function readJsonOrNull<T>(path: string): T | null {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}
