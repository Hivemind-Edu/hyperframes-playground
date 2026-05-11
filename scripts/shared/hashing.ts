/**
 * Source-hash utilities for skipping unchanged leaves on rebuild.
 *
 * The hash covers the leaf's source HTML + every file under `assets/` and
 * `compositions/`. If any byte changes, the hash changes.
 */

import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ALLOWED_HASH_DIRS = ["assets", "compositions"];

export function hashLeafSource(leafPath: string): string {
  const hash = createHash("sha256");
  const indexPath = join(leafPath, "index.html");
  hash.update("index.html\0");
  hash.update(readFileSync(indexPath));

  for (const subdir of ALLOWED_HASH_DIRS) {
    const dirPath = join(leafPath, subdir);
    try {
      collectFilesIntoHash(dirPath, subdir, hash);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  return hash.digest("hex");
}

function collectFilesIntoHash(
  absPath: string,
  relPath: string,
  hash: ReturnType<typeof createHash>,
): void {
  const entries = readdirSync(absPath).sort();
  for (const name of entries) {
    const childAbs = join(absPath, name);
    const childRel = `${relPath}/${name}`;
    const stat = statSync(childAbs);
    if (stat.isDirectory()) {
      collectFilesIntoHash(childAbs, childRel, hash);
    } else if (stat.isFile()) {
      hash.update(`${childRel}\0`);
      hash.update(readFileSync(childAbs));
    }
  }
}

export function hashFeedInputs(args: {
  feedName: string;
  postSummaries: string[];
}): string {
  const hash = createHash("sha256");
  hash.update(`feedName:${args.feedName}\0`);
  for (const summary of args.postSummaries) {
    hash.update(`post:${summary}\0`);
  }
  return hash.digest("hex");
}
