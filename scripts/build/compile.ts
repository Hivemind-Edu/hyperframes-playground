/**
 * Compile a single leaf to a brainjuice-ready artifact bundle.
 *
 * Steps:
 *   1. Strip the @tailwindcss/browser CDN script + the readiness-detector
 *      block + any `<style type="text/tailwindcss"> @theme {...} </style>`
 *      block (we ship default Tailwind, no custom theme).
 *   2. Run `@tailwindcss/cli` against a generated input.css that points at
 *      this leaf's HTML files via `@source`. Capture the generated CSS.
 *   3. Inline that CSS into the <head> of index.html AND each composition,
 *      because compositions render as separate documents at runtime.
 *   4. Capture `data-duration` on the root composition for durationSeconds.
 *   5. Run `bunx hyperframes snapshot --at 0.5 --frames 1` to grab
 *      poster.png from a tmp output dir.
 *   6. Write the result tree to `build/.../<post>/`:
 *        index.html (compiled)
 *        compositions/*.html (compiled)
 *        assets/* (copied verbatim)
 *        poster.png
 */

import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { load, type CheerioAPI } from "cheerio";
import type { LeafEntry } from "../shared/walker";

export type CompileResult = {
  durationSeconds: number;
  posterRelativePath: string | undefined;
  posterError: string | undefined;
  compositionRelativePaths: string[];
  assetRelativePaths: string[];
};

export async function compileLeaf(
  leaf: LeafEntry,
  outDir: string,
): Promise<CompileResult> {
  cleanDir(outDir);
  mkdirSync(outDir, { recursive: true });

  const indexHtmlSource = readFileSync(join(leaf.absolutePath, "index.html"), "utf8");
  const compositionNames = listHtmlFiles(join(leaf.absolutePath, "compositions"));
  const compositionSources = compositionNames.map((name) => ({
    name,
    html: readFileSync(join(leaf.absolutePath, "compositions", name), "utf8"),
  }));

  const tailwindCss = await runTailwind(leaf.absolutePath);

  const compiledIndex = transformHtml(indexHtmlSource, tailwindCss);
  const compiledCompositions = compositionSources.map(({ name, html }) => ({
    name,
    html: transformHtml(html, tailwindCss).html,
  }));

  writeFileSync(join(outDir, "index.html"), compiledIndex.html);

  if (compiledCompositions.length > 0) {
    mkdirSync(join(outDir, "compositions"), { recursive: true });
    for (const composition of compiledCompositions) {
      writeFileSync(
        join(outDir, "compositions", composition.name),
        composition.html,
      );
    }
  }

  const assetRelativePaths: string[] = [];
  const sourceAssetsDir = join(leaf.absolutePath, "assets");
  if (existsSync(sourceAssetsDir)) {
    cpSync(sourceAssetsDir, join(outDir, "assets"), { recursive: true, dereference: true });
    for (const name of listFilesRecursive(sourceAssetsDir)) {
      assetRelativePaths.push(`assets/${name}`);
    }
  }

  let posterRelativePath: string | undefined;
  let posterError: string | undefined;
  try {
    await captureSnapshot(leaf.absolutePath, join(outDir, "poster.png"));
    posterRelativePath = "poster.png";
  } catch (error) {
    posterError = error instanceof Error ? error.message : String(error);
  }

  return {
    durationSeconds: compiledIndex.durationSeconds,
    posterRelativePath,
    posterError,
    compositionRelativePaths: compiledCompositions.map((c) => `compositions/${c.name}`),
    assetRelativePaths,
  };
}

function listHtmlFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith(".html"))
    .sort();
}

function listFilesRecursive(dir: string, prefix = ""): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const abs = join(dir, name);
    const stat = statSync(abs);
    const rel = prefix ? `${prefix}/${name}` : name;
    if (stat.isDirectory()) {
      out.push(...listFilesRecursive(abs, rel));
    } else if (stat.isFile()) {
      out.push(rel);
    }
  }
  return out;
}

function cleanDir(dir: string): void {
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
}

// Resolve once. Walking up to find node_modules with tailwindcss installed.
import { dirname as pathDirname } from "node:path";
import { fileURLToPath } from "node:url";

const playgroundRoot = pathDirname(
  pathDirname(pathDirname(fileURLToPath(import.meta.url))),
);

async function runTailwind(leafPath: string): Promise<string> {
  // input.css lives in the leaf folder so `@source` relative paths resolve
  // against it. The CLI runs from the playground root so it can resolve the
  // `tailwindcss` package from our node_modules.
  const inputPath = join(leafPath, ".tailwind-input.css");
  const tmpDir = join(
    tmpdir(),
    `hf-playground-tw-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
  mkdirSync(tmpDir, { recursive: true });
  const outputPath = join(tmpDir, "output.css");
  const inputCss = [
    `@import "tailwindcss";`,
    `@source "./index.html";`,
    `@source "./compositions/**/*.html";`,
    "",
  ].join("\n");
  writeFileSync(inputPath, inputCss);

  try {
    const proc = Bun.spawnSync({
      cmd: [
        "bunx",
        "@tailwindcss/cli",
        "-i",
        inputPath,
        "-o",
        outputPath,
        "--minify",
      ],
      cwd: playgroundRoot,
      stderr: "pipe",
      stdout: "pipe",
    });
    if (proc.exitCode !== 0) {
      const err = proc.stderr.toString() || proc.stdout.toString();
      throw new Error(`tailwindcss build failed: ${err}`);
    }
    return readFileSync(outputPath, "utf8");
  } finally {
    try {
      rmSync(inputPath, { force: true });
    } catch {}
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

type TransformedHtml = { html: string; durationSeconds: number };

function transformHtml(html: string, tailwindCss: string): TransformedHtml {
  const $ = load(html, { decodeEntities: false });
  stripTailwindBrowserRuntime($);
  stripTailwindThemeBlocks($);
  stripReadinessDetector($);
  injectCompiledTailwind($, tailwindCss);
  const durationSeconds = readRootDuration($);
  return { html: $.html(), durationSeconds };
}

function stripTailwindBrowserRuntime($: CheerioAPI): void {
  $('script[src*="@tailwindcss/browser"]').remove();
}

function stripTailwindThemeBlocks($: CheerioAPI): void {
  $('style[type="text/tailwindcss"]').remove();
}

function stripReadinessDetector($: CheerioAPI): void {
  $("script").each((_, el) => {
    const code = $(el).html() ?? "";
    if (code.includes("__tailwindReady") || code.includes("tailwindcss v")) {
      $(el).remove();
    }
  });
}

function injectCompiledTailwind($: CheerioAPI, tailwindCss: string): void {
  if (!tailwindCss.trim()) return;
  const styleTag = `<style data-source="tailwind-precompiled">\n${tailwindCss}\n</style>`;
  if ($("head").length > 0) {
    $("head").append(styleTag);
  } else {
    $.root().prepend(styleTag);
  }
}

function readRootDuration($: CheerioAPI): number {
  const root = $("[data-composition-id]").first();
  const attr = root.attr("data-duration");
  if (!attr) return 0;
  const value = Number.parseFloat(attr);
  return Number.isFinite(value) ? value : 0;
}

async function captureSnapshot(leafPath: string, outputPath: string): Promise<void> {
  const snapshotsDir = join(leafPath, "snapshots");
  try {
    const proc = Bun.spawnSync({
      cmd: [
        "bunx",
        "hyperframes",
        "snapshot",
        leafPath,
        "--at",
        "0.5",
      ],
      cwd: leafPath,
      stderr: "pipe",
      stdout: "pipe",
    });
    if (proc.exitCode !== 0) {
      const err = proc.stderr.toString() || proc.stdout.toString();
      throw new Error(`hyperframes snapshot failed: ${err.trim()}`);
    }
    const generated = findGeneratedSnapshot(leafPath);
    if (!generated) {
      throw new Error("hyperframes snapshot produced no PNG output");
    }
    cpSync(generated, outputPath);
  } finally {
    // hyperframes snapshot writes into `snapshots/` inside the leaf —
    // clean it up so source folders stay tidy.
    rmSync(snapshotsDir, { recursive: true, force: true });
  }
}

/**
 * `hyperframes snapshot` writes into a `snapshots/` folder in the leaf by
 * default. We pick the most recent PNG produced under the leaf to avoid
 * coupling to its naming scheme.
 */
function findGeneratedSnapshot(leafPath: string): string | null {
  const candidates = [
    join(leafPath, "snapshots"),
    join(leafPath, ".snapshots"),
    leafPath,
  ];
  let best: { path: string; mtimeMs: number } | null = null;
  for (const dir of candidates) {
    if (!existsSync(dir)) continue;
    walkPngs(dir, (path) => {
      const stat = statSync(path);
      if (!best || stat.mtimeMs > best.mtimeMs) {
        best = { path, mtimeMs: stat.mtimeMs };
      }
    });
  }
  return best ? (best as { path: string }).path : null;
}

function walkPngs(dir: string, visit: (path: string) => void): void {
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name);
    const stat = statSync(abs);
    if (stat.isDirectory()) {
      walkPngs(abs, visit);
    } else if (stat.isFile() && name.toLowerCase().endsWith(".png")) {
      visit(abs);
    }
  }
}
