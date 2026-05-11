/**
 * Folder-name → slug → stable ID derivation.
 *
 * Rules:
 *   - Strip leading numeric prefix: `0 What Is React` → `What Is React`, `01. Intro` → `Intro`.
 *   - Lowercase, strip non-alphanumeric, collapse to `_`.
 *   - Numeric prefix becomes `sortOrder`. Missing prefix → 0.
 *
 * ID prefixes:
 *   - Feeds:    `f_demo_<feed-slug>`     (special case: `f_demo_brainjuice` for Demo Videos)
 *   - Chapters: `c_demo_<feed-slug>_<chapter-slug>`
 *   - Posts:    `p_demo_<feed-slug>_<chapter-slug>_<post-slug>`
 *               or `p_demo_brainjuice_<post-slug>` for the onboarding feed.
 *   - Profiles: `pr_demo_<feed-slug>`
 */

const NUMERIC_PREFIX_RE = /^(\d+)\.?\s+/;

export type ParsedFolderName = {
  /** Numeric prefix or 0 if missing. */
  sortOrder: number;
  /** Original folder name with prefix stripped (kept human-readable). */
  name: string;
  /** kebab/snake_case slug usable inside an identifier. */
  slug: string;
};

export function parseFolderName(folderName: string): ParsedFolderName {
  const match = folderName.match(NUMERIC_PREFIX_RE);
  const sortOrder = match ? Number.parseInt(match[1]!, 10) : 0;
  const name = match ? folderName.slice(match[0].length).trim() : folderName.trim();
  const slug = slugify(name);
  return { sortOrder, name, slug };
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export const ONBOARDING_FEED_SLUG = "brainjuice";
export const ONBOARDING_FEED_FOLDER = "Demo Videos";
export const ONBOARDING_CHAPTER_SLUG = "main";

export const deriveFeedId = (feedSlug: string) => `f_demo_${feedSlug}`;
export const deriveChapterId = (feedSlug: string, chapterSlug: string) =>
  `c_demo_${feedSlug}_${chapterSlug}`;
export const derivePostId = (
  feedSlug: string,
  chapterSlug: string,
  postSlug: string,
) => `p_demo_${feedSlug}_${chapterSlug}_${postSlug}`;
export const deriveProfileId = (feedSlug: string) => `pr_demo_${feedSlug}`;
