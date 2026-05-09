---
description: Use Bun instead of Node.js, npm, pnpm, or vite.
globs: "*.ts, *.tsx, *.html, *.css, *.js, *.jsx, package.json"
alwaysApply: true
---

Default to using Bun instead of Node.js.

- Use `bun <file>` instead of `node <file>` or `ts-node <file>`
- Use `bun test` instead of `jest` or `vitest`
- Use `bun build <file.html|file.ts|file.css>` instead of `webpack` or `esbuild`
- Use `bun install` instead of `npm install` or `yarn install` or `pnpm install`
- Use `bun run <script>` instead of `npm run <script>` or `yarn run <script>` or `pnpm run <script>`
- Use `bunx <package> <command>` instead of `npx <package> <command>`
- Bun automatically loads .env, so don't use dotenv.


Preview workflow:

- Run `bun run preview:all` from the repo root to start a HyperFrames preview for every `videos/**/hyperframes.json` project.
- The preview supervisor starts at port `5000`, skips occupied ports, and records live URLs in `.preview-logs/previews.tsv`.
- Existing registered/HyperFrames preview processes are killed by default before starting; use `bun run preview:all --no-kill` to keep them.
- Use `bun run preview:all --filter React` to start only videos whose path contains a search string.
- Use `bun run preview:open` to open all running previews, or `bun run preview:open 5008` / `bun run preview:open react advanced video1` to open one match.
- Keep the `preview:all` command running; stopping it stops the previews.

Repo structure:
Feed -> Chapter -> Video

We are currently using HyperFrames v0.6.0-alpha.2.
You can use Tailwind for styling.
Shared assets and reusable compositions live in `shared/assets` and `shared/compositions`; link them into a video's local `assets/` or `compositions/` folder with symlinks.
