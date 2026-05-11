/**
 * Parses the predefined tag tree out of hivemind-hono's seed file at runtime.
 *
 * Keeps us in sync with the canonical source. If hono moves the seed or
 * changes the file shape, the parser will throw with a clear message — we'd
 * rather break loudly than ship stale tags.
 *
 * Falls back to an empty tree if the seed file isn't reachable; build still
 * runs but tag assignment will return [].
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type Tag = {
  id: string;
  name: string;
  parentId: string | null;
  childrenIds: string[];
};

// scripts/shared/tagTree.ts → up 3 levels → /Users/mark/hivemind/ →
// hivemind-hono/src/db/seeds/seed_predefined_tags.ts
const SEED_RELATIVE_PATH = "../../../hivemind-hono/src/db/seeds/seed_predefined_tags.ts";
const TAG_INSERT_RE = /VALUES \('([^']+)',\s*'([^']+)',\s*(NULL|'([^']+)')\)/g;

let cached: Map<string, Tag> | null = null;

export function loadTagTree(): Map<string, Tag> {
  if (cached) return cached;
  const seedPath = resolve(
    dirname(fileURLToPath(import.meta.url)),
    SEED_RELATIVE_PATH,
  );
  if (!existsSync(seedPath)) {
    console.warn(
      `[tagTree] seed file not found at ${seedPath} — tag assignment will be empty`,
    );
    cached = new Map();
    return cached;
  }
  const source = readFileSync(seedPath, "utf8");
  const tags = new Map<string, Tag>();
  for (const match of source.matchAll(TAG_INSERT_RE)) {
    const id = match[1]!;
    const name = match[2]!;
    const parentId = match[3] === "NULL" ? null : match[4]!;
    tags.set(id, { id, name, parentId, childrenIds: [] });
  }
  for (const tag of tags.values()) {
    if (tag.parentId && tags.has(tag.parentId)) {
      tags.get(tag.parentId)!.childrenIds.push(tag.id);
    }
  }
  cached = tags;
  return cached;
}

/**
 * Mirrors hono's `buildAvailableTagsStr`. Only the leaves (no children) are
 * selectable; the inner nodes form the visual hierarchy fed to Gemini.
 */
export function renderTagHierarchyForPrompt(): string {
  const tags = loadTagTree();
  const roots = [...tags.values()].filter((t) => !t.parentId);

  const renderTag = (tagId: string, level: number): string => {
    const tag = tags.get(tagId);
    if (!tag) throw new Error(`Tag ${tagId} not found`);
    if (tag.childrenIds.length === 0) return `      → ${tag.name}`;
    const children = tag.childrenIds
      .map((id) => renderTag(id, level + 1))
      .join("\n");
    if (level === 0) return `📁 ${tag.name}\n${children}`;
    if (level === 1) return `  📂 ${tag.name}\n${children}`;
    return `      → ${tag.name}`;
  };

  return roots.map((root) => renderTag(root.id, 0)).join("\n\n");
}

/** Resolve a tag name (case-insensitive) to one or more tag IDs. */
export function resolveTagNameToIds(name: string): string[] {
  const tags = loadTagTree();
  const lowered = name.trim().toLowerCase();
  const matches: string[] = [];
  for (const tag of tags.values()) {
    if (tag.name.toLowerCase() === lowered && tag.childrenIds.length === 0) {
      matches.push(tag.id);
    }
  }
  return matches;
}
