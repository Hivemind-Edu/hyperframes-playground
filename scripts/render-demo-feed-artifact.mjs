import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_BASE_DIR = "videos/Demo Feed Elevated/05-md-no-code-manim";

const COVER_CSS = `
<style id="brainjuice-cover-render-override">
	html,
	body,
	[data-composition-id] {
		background: #000 !important;
		margin: 0 !important;
		overflow: hidden !important;
	}

	.hf-bg-video,
	.hf-bg-video-contain-top,
	.hf-bg-video-contain-center,
	.hf-scene-media,
	.hf-scene-video,
	.hf-scene img,
	.hf-scene video,
	.hf-template-VideoAvatarTemplate .hf-scene .hf-scene-media,
	.hf-template-GameplayQATemplate .hf-bg-video {
		width: 100% !important;
		height: 100% !important;
		max-width: none !important;
		max-height: none !important;
		object-fit: cover !important;
		object-position: center center !important;
	}

	.hf-scene-bg-image {
		background-position: center center !important;
		background-size: cover !important;
	}
</style>`;

function parseArgs(argv) {
	const values = {};
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (!arg.startsWith("--")) continue;
		const key = arg.slice(2);
		if (key === "cover" || key === "help") {
			values[key] = true;
			continue;
		}
		const value = argv[index + 1];
		if (!value || value.startsWith("--")) {
			throw new Error(`Missing value for --${key}`);
		}
		values[key] = value;
		index += 1;
	}
	return values;
}

function usage() {
	return `Usage:
  bun scripts/render-demo-feed-artifact.mjs --artifact "<artifact folder>" --output "<output mp4>" [options]

Options:
  --width 1080             Render width. Default: 392
  --height 1920            Render height. Default: 768
  --fps 30                 Frames per second. Default: 30
  --chunk-size 120         Frames per chunk. Default: 120
  --concurrency 4          Parallel chunk renders. Default: 4
  --entry index.html       Artifact entry file. Default: index.html
  --quality standard       Producer quality. Default: standard
  --cover                  Inject cover-fit CSS into index-cover.html before rendering
  --render-root /tmp/path  Temp render root. Default: /private/tmp/hyperframes-demo-feed-render
`;
}

async function exists(path) {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

async function firstExisting(paths) {
	for (const path of paths) {
		if (await exists(path)) return path;
	}
	return undefined;
}

async function importProducer() {
	try {
		const distributed = await import("@hyperframes/producer/dist/distributed.js");
		const index = await import("@hyperframes/producer/dist/index.js");
		return { ...distributed, resolveConfig: index.resolveConfig };
	} catch {
		// Fall through to local monorepo resolution.
	}

	const cwd = process.cwd();
	const honoDir =
		process.env.HIVEMIND_HONO_DIR ?? resolve(cwd, "..", "hivemind-hono");
	const producerDist = await firstExisting([
		process.env.HYPERFRAMES_PRODUCER_DIST,
		resolve(cwd, "node_modules/@hyperframes/producer/dist"),
		resolve(honoDir, "node_modules/.bun/node_modules/@hyperframes/producer/dist"),
	]);

	if (!producerDist) {
		throw new Error(
			"Could not find @hyperframes/producer. Run bun install here with @hyperframes/producer installed, or set HIVEMIND_HONO_DIR to a hivemind-hono checkout with dependencies installed.",
		);
	}

	const distributed = await import(
		pathToFileURL(join(producerDist, "distributed.js")).href
	);
	const index = await import(pathToFileURL(join(producerDist, "index.js")).href);
	return { ...distributed, resolveConfig: index.resolveConfig };
}

function injectCoverCss(html) {
	const cleaned = html.replace(
		/<style id="brainjuice-cover-render-override">[\s\S]*?<\/style>/g,
		"",
	);
	if (cleaned.includes("</head>")) {
		return cleaned.replace("</head>", `${COVER_CSS}\n</head>`);
	}
	return `${COVER_CSS}\n${cleaned}`;
}

async function runLimited(count, workerCount, task) {
	const results = [];
	let next = 0;
	await Promise.all(
		Array.from({ length: Math.max(1, workerCount) }, async () => {
			while (next < count) {
				const index = next;
				next += 1;
				results[index] = await task(index);
			}
		}),
	);
	return results;
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
	console.info(usage());
	process.exit(0);
}

if (!args.artifact || !args.output) {
	console.error(usage());
	process.exit(1);
}

const artifactDir = resolve(args.artifact);
const output = resolve(args.output);
const width = Number(args.width ?? "392");
const height = Number(args.height ?? "768");
const fps = Number(args.fps ?? "30");
const chunkSize = Number(args["chunk-size"] ?? "120");
const concurrency = Number(args.concurrency ?? "4");
const quality = args.quality ?? "standard";
let entryFile = args.entry ?? "index.html";
const renderRoot = resolve(
	args["render-root"] ?? "/private/tmp/hyperframes-demo-feed-render",
);

if (args.cover) {
	const originalHtml = await readFile(join(artifactDir, entryFile), "utf8");
	entryFile = "index-cover.html";
	await writeFile(join(artifactDir, entryFile), injectCoverCss(originalHtml));
}

const { assemble, plan, renderChunk, resolveConfig } = await importProducer();

await mkdir(dirname(output), { recursive: true });
const planDir = join(renderRoot, "plan");
const chunksDir = join(renderRoot, "chunks");
await mkdir(planDir, { recursive: true });
await mkdir(chunksDir, { recursive: true });

console.info(`[plan] ${artifactDir}`);
const planResult = await plan(
	artifactDir,
	{
		chunkSize,
		entryFile,
		failClosedFontFetch: false,
		format: "mp4",
		fps,
		height,
		hdrMode: "force-sdr",
		maxParallelChunks: Number.MAX_SAFE_INTEGER,
		producerConfig: resolveConfig({ browserGpuMode: "software" }),
		quality,
		rejectOnSystemFonts: false,
		runtimeCap: "none",
		width,
	},
	planDir,
);

console.info(
	`[chunks] ${planResult.chunkCount} chunks, ${planResult.totalFrames} frames`,
);
const chunks = await runLimited(
	planResult.chunkCount,
	concurrency,
	async (chunkIndex) => {
		const chunkPath = join(
			chunksDir,
			`chunk-${String(chunkIndex).padStart(5, "0")}.mp4`,
		);
		const started = Date.now();
		const result = await renderChunk(planDir, chunkIndex, chunkPath);
		console.info(
			`[chunk] ${chunkIndex + 1}/${planResult.chunkCount} in ${(
				(Date.now() - started) /
				1000
			).toFixed(1)}s`,
		);
		return result.outputPath;
	},
);

console.info(`[assemble] ${output}`);
await assemble(planDir, chunks, join(planDir, "audio.aac"), output);
console.info(`[done] ${output}`);
