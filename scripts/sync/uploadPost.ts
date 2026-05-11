/**
 * Uploads a single compiled post's artifact bundle to Firebase Storage in
 * the layout expected by the brainjuice runtime:
 *
 *   brainjuice-generated/${postId}/<rel-path>            (assets, compositions)
 *   brainjuice-generated/${postId}/artifact/index.html   (rewritten paths, no-text-selection css)
 *   brainjuice-generated/${postId}/artifact/player.html  (env-specific player shell)
 *   brainjuice-generated/${postId}/artifact/poster.png
 */

import {
  ensureBrainjuiceNoTextSelectionCss,
  getFirebaseStorageMediaUrl,
  renderPlayerShellHtml,
  uploadBufferToStorage,
  uploadFileToStorage,
} from "./firebase";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { PostManifestEntry } from "../shared/manifest";

export type UploadPostResult = {
  postId: string;
  artifactUrl: string;
  playerUrl: string;
  posterUrl: string | null;
  uploadedFileCount: number;
};

export async function uploadPostArtifact(args: {
  playgroundRoot: string;
  post: PostManifestEntry;
  hyperframesPlayerStoragePath: string;
}): Promise<UploadPostResult> {
  const { post } = args;
  const buildAbsPath = join(args.playgroundRoot, post.buildPath);
  if (!existsSync(buildAbsPath)) {
    throw new Error(`Build folder missing for ${post.id}: ${buildAbsPath}`);
  }

  const storagePrefix = `brainjuice-generated/${post.id}`;

  // 1) Upload every file under assets/ and compositions/ — keep relative
  //    paths intact under the post's storage prefix.
  const sidecarRelPaths: string[] = [];
  for (const subdir of ["assets", "compositions"]) {
    const abs = join(buildAbsPath, subdir);
    if (!existsSync(abs)) continue;
    walkFiles(abs, subdir, sidecarRelPaths);
  }

  let uploaded = 0;
  for (const rel of sidecarRelPaths) {
    await uploadFileToStorage({
      storagePath: `${storagePrefix}/${rel}`,
      localPath: join(buildAbsPath, rel),
    });
    uploaded += 1;
  }

  // 2) Read compiled index.html, rewrite relative paths to Firebase URLs,
  //    inject brainjuice no-text-selection CSS, upload.
  let indexHtml = readFileSync(join(buildAbsPath, "index.html"), "utf8");
  for (const rel of sidecarRelPaths) {
    const url = getFirebaseStorageMediaUrl(`${storagePrefix}/${rel}`);
    indexHtml = replaceAllRelativeReferences(indexHtml, rel, url);
  }
  indexHtml = ensureBrainjuiceNoTextSelectionCss(indexHtml);
  const indexStoragePath = `${storagePrefix}/artifact/index.html`;
  await uploadBufferToStorage({
    storagePath: indexStoragePath,
    data: indexHtml,
    contentType: "text/html; charset=utf-8",
  });
  uploaded += 1;

  // 3) Render and upload the player shell. compositionSrc is the firebase
  //    URL of the artifact index.html.
  const artifactUrl = getFirebaseStorageMediaUrl(indexStoragePath);
  const playerScriptSrc = getFirebaseStorageMediaUrl(args.hyperframesPlayerStoragePath);
  const playerHtml = renderPlayerShellHtml({
    compositionSrc: artifactUrl,
    playerScriptSrc,
    debugLogsEnabled: false,
  });
  const playerStoragePath = `${storagePrefix}/artifact/player.html`;
  await uploadBufferToStorage({
    storagePath: playerStoragePath,
    data: playerHtml,
    contentType: "text/html; charset=utf-8",
  });
  uploaded += 1;

  // 4) Poster (optional).
  let posterUrl: string | null = null;
  if (post.posterFilename) {
    const posterAbs = join(buildAbsPath, post.posterFilename);
    if (existsSync(posterAbs) && statSync(posterAbs).isFile()) {
      const posterStoragePath = `${storagePrefix}/artifact/poster.png`;
      await uploadFileToStorage({
        storagePath: posterStoragePath,
        localPath: posterAbs,
        contentType: "image/png",
      });
      posterUrl = getFirebaseStorageMediaUrl(posterStoragePath);
      uploaded += 1;
    }
  }

  return {
    postId: post.id,
    artifactUrl,
    playerUrl: getFirebaseStorageMediaUrl(playerStoragePath),
    posterUrl,
    uploadedFileCount: uploaded,
  };
}

function walkFiles(absDir: string, relPrefix: string, out: string[]): void {
  const fs = require("node:fs") as typeof import("node:fs");
  for (const name of fs.readdirSync(absDir).sort()) {
    const abs = join(absDir, name);
    const stat = fs.statSync(abs);
    const rel = `${relPrefix}/${name}`;
    if (stat.isDirectory()) walkFiles(abs, rel, out);
    else if (stat.isFile()) out.push(rel);
  }
}

function replaceAllRelativeReferences(
  html: string,
  relativePath: string,
  url: string,
): string {
  // Replace bare relative refs in src/href/data-composition-src and inline
  // url() in style attributes. Conservative — only the exact path string.
  const escaped = relativePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return html.replace(new RegExp(escaped, "g"), url);
}
