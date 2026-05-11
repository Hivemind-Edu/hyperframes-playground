/**
 * Pull the readable text out of a compiled HF leaf so the LLM has something
 * meaningful to summarize/comment on.
 *
 * We look at:
 *   - index.html body text
 *   - every compositions/*.html body text
 *
 * `<script>` / `<style>` content is excluded by cheerio's `.text()` by
 * default but only for tags whose children are text — `<style>` content is
 * text, so we strip those tags first.
 */

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { load } from "cheerio";

function extractFromHtml(html: string): string {
  const $ = load(html);
  $("script, style, noscript").remove();
  const text = $("body").text() || $.root().text();
  return collapseWhitespace(text);
}

function collapseWhitespace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

export function extractLeafText(leafPath: string): string {
  const parts: string[] = [];
  const indexPath = join(leafPath, "index.html");
  if (existsSync(indexPath)) {
    parts.push(extractFromHtml(readFileSync(indexPath, "utf8")));
  }
  const compositionsDir = join(leafPath, "compositions");
  if (existsSync(compositionsDir)) {
    for (const name of readdirSync(compositionsDir).sort()) {
      if (!name.endsWith(".html")) continue;
      parts.push(extractFromHtml(readFileSync(join(compositionsDir, name), "utf8")));
    }
  }
  return collapseWhitespace(parts.filter(Boolean).join(" "));
}
