import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getStorage } from "firebase-admin/storage";
import pLimit from "p-limit";

const DEFAULT_BASE_DIR = "videos/Demo Feed Elevated/05-md-no-code-manim";
const FINAL_DEMO_VIDEO_ARTIFACTS = [
	{
		artifactDir: "videos/Demo Feed Elevated/05-md-no-code-manim/008 The Fermi Paradox",
		outputName: "001-fermi-paradox-cover.mp4",
	},
	{
		artifactDir: "videos/Demo Videos/1 Generated/4 CRISPR-SplitBrainrot",
		outputName: "002-how-crispr-turned-bacterial-defense-into-a-dna-editor-cover.mp4",
	},
	{
		artifactDir:
			"videos/Demo Videos/0 Demo Videos/Beginner JS CodeHike High Resolution Sources/01 Functions 2x",
		outputName: "03-functions.mp4",
	},
	{
		artifactDir:
			"videos/Demo Feed Elevated/05-md-no-code-manim/001 Rome's Military Anarchy",
		outputName: "004-rome-military-anarchy-cover.mp4",
	},
	{
		artifactDir:
			"videos/Demo Feed Elevated/05-md-no-code-manim/005 Why Human Babies Are So Useless",
		outputName: "005-human-babies-useless-cover.mp4",
	},
	{
		artifactDir:
			"videos/Demo Feed Elevated/05-md-no-code-manim/006 Quantum Entanglement Is Not Telepathy",
		outputName: "006-quantum-entanglement-not-telepathy-cover.mp4",
	},
	{
		artifactDir:
			"videos/Demo Feed Elevated/05-md-no-code-manim/004 The Tragedy of the Commons",
		outputName: "8-tragedy-of-the-commons-cover.mp4",
	},
	{
		artifactDir:
			"videos/Demo Videos/1 Generated/9 RomeIndustrialRevolution-Scenario",
		outputName: "10-rome-industrial-revolution-scenario-compressed-under-30mb.mp4",
	},
];
const DEMO_TARGET_ROOTS = {
	"brainjuice-onboarding": ["videos/Brainjuice Dev Onboarding Rendered Demos"],
	"demo-feed-elevated": ["videos/Demo Feed Elevated"],
	"demo-videos": ["videos/Demo Videos"],
	"final-demo-videos": [],
	"all-demo-videos": [
		"videos/Brainjuice Dev Onboarding Rendered Demos",
		"videos/Demo Feed Elevated",
		"videos/Demo Videos",
	],
};
const DEFAULT_TARGET = "demo-feed-elevated";
const DEV_RENDERER_URL =
	"https://us-central1-brainjuice-dev.cloudfunctions.net/renderVideo";
const DEFAULT_TARGET_WIDTH = 784;
const DEFAULT_RENDER_CONCURRENCY = 3;
const DEFAULT_UPLOAD_CONCURRENCY = 16;

function usage() {
	return `Usage:
  bun --env-file=.env.local --env-file=.env.brainjuice.local scripts/remaster-demo-feed-remote.mjs [options]

Options:
  --base-dir <path>          Folder containing artifact folders. Default: ${DEFAULT_BASE_DIR}
  --target <name>            Preset roots: ${Object.keys(DEMO_TARGET_ROOTS).join(", ")}. Default: ${DEFAULT_TARGET}
  --artifact <path>          Render one artifact folder instead of all folders under --base-dir
  --scale <number>           Scale original composition dimensions. Ignored when --width/--height is set
  --width <px>               Target width. Height is derived from source aspect unless --height is also set. Default: ${DEFAULT_TARGET_WIDTH}
  --height <px>              Target height. Width is derived from source aspect unless --width is also set
  --include-sources          Include folders whose path contains "source" or "sources"
  --include-existing-hd      Render artifacts already at or above target width
  --concurrency <count>      Parallel remote render calls. Default: ${DEFAULT_RENDER_CONCURRENCY}
  --upload-concurrency <n>   Parallel Firebase asset uploads. Default: ${DEFAULT_UPLOAD_CONCURRENCY}
  --quality <value>          Renderer quality: draft, standard, high. Default: standard
  --codec <value>            MP4 video codec: h264 or h265. Default: h264
  --run-id <id>              Storage run id. Default: timestamped
  --output-name <name>       Rendered MP4 filename in storage. Default: render-<width>x<height>.mp4
  --final-output-dir <path>  Optional local folder to download rendered final-demo-videos MP4s into
  --report-dir <path>        Local JSON report directory. Default: videos/rendered for target presets
  --renderer-url <url>       Renderer endpoint. Default: dev renderVideo function
  --allow-non-dev            Allow FIREBASE_CONFIG project_id outside brainjuice-dev
  --dry-run                  Print planned work without uploading or rendering
  --help                     Show this help

Required env:
  FIREBASE_CONFIG                  Service-account JSON or path for brainjuice-dev
  BRAINJUICE_RENDERER_AUTH_TOKEN   Token accepted by the dev renderer
`;
}

function parseArgs(argv) {
	const args = {};
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (!arg.startsWith("--")) continue;
		const key = arg.slice(2);
		if (
			[
				"allow-non-dev",
				"dry-run",
				"help",
				"include-existing-hd",
				"include-sources",
			].includes(key)
		) {
			args[key] = true;
			continue;
		}
		const value = argv[index + 1];
		if (!value || value.startsWith("--")) {
			throw new Error(`Missing value for --${key}`);
		}
		args[key] = value;
		index += 1;
	}
	return args;
}

function toPositiveNumber(value, label, fallback) {
	if (value == null) return fallback;
	const parsed = Number(value);
	if (!Number.isFinite(parsed) || parsed <= 0) {
		throw new Error(`${label} must be a positive number.`);
	}
	return parsed;
}

function toPositiveInteger(value, label, fallback) {
	if (value == null) return fallback;
	const parsed = Number.parseInt(value, 10);
	if (!Number.isInteger(parsed) || parsed <= 0) {
		throw new Error(`${label} must be a positive integer.`);
	}
	return parsed;
}

function even(value) {
	const rounded = Math.round(value);
	return rounded % 2 === 0 ? rounded : rounded + 1;
}

function safeSegment(value) {
	return value
		.toLowerCase()
		.replace(/[^a-z0-9._-]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 96);
}

function contentTypeForPath(path) {
	switch (extname(path).toLowerCase()) {
		case ".html":
			return "text/html; charset=utf-8";
		case ".js":
			return "application/javascript; charset=utf-8";
		case ".css":
			return "text/css; charset=utf-8";
		case ".json":
			return "application/json";
		case ".png":
			return "image/png";
		case ".jpg":
		case ".jpeg":
			return "image/jpeg";
		case ".webp":
			return "image/webp";
		case ".gif":
			return "image/gif";
		case ".mp3":
			return "audio/mpeg";
		case ".m4a":
			return "audio/mp4";
		case ".wav":
			return "audio/wav";
		case ".mp4":
			return "video/mp4";
		case ".webm":
			return "video/webm";
		default:
			return "application/octet-stream";
	}
}

async function readFirebaseConfig() {
	const raw = process.env.FIREBASE_CONFIG;
	if (!raw) {
		throw new Error("FIREBASE_CONFIG is required.");
	}

	if (raw.trim().startsWith("{")) {
		return JSON.parse(raw);
	}

	return JSON.parse(await readFile(resolve(raw), "utf8"));
}

async function initFirebase({ allowNonDev }) {
	if (getApps().length > 0) return;

	const firebaseConfig = await readFirebaseConfig();
	const projectId = firebaseConfig.project_id ?? firebaseConfig.projectId;
	if (!projectId) {
		throw new Error("FIREBASE_CONFIG must include project_id.");
	}
	if (!allowNonDev && projectId !== "brainjuice-dev") {
		throw new Error(
			`Refusing to upload to project "${projectId}". Use the dev service account or pass --allow-non-dev.`,
		);
	}

	initializeApp({
		credential: cert(firebaseConfig),
		storageBucket: `${projectId}.firebasestorage.app`,
	});
}

function storageUrl(storagePath) {
	const bucketName = getStorage().bucket().name;
	return `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(
		storagePath,
	)}?alt=media`;
}

async function collectArtifactDirs(baseDir) {
	const out = [];
	async function visit(dir) {
		const entries = await readdir(dir, { withFileTypes: true });
		if (entries.some((entry) => entry.isFile() && entry.name === "index.html")) {
			out.push(dir);
			return;
		}
		await Promise.all(
			entries
				.filter((entry) => entry.isDirectory())
				.map((entry) => visit(join(dir, entry.name))),
		);
	}
	await visit(baseDir);
	return out.sort((a, b) => a.localeCompare(b));
}

async function collectArtifactDirsFromRoots(rootDirs) {
	const nested = await Promise.all(rootDirs.map((rootDir) => collectArtifactDirs(rootDir)));
	return [...new Set(nested.flat())].sort((a, b) => a.localeCompare(b));
}

function collectFinalDemoArtifacts() {
	return FINAL_DEMO_VIDEO_ARTIFACTS.map((entry) => ({
		...entry,
		artifactDir: resolve(entry.artifactDir),
	}));
}

function firstInt(html, attr) {
	const match = html.match(new RegExp(`${attr}=["'](\\d+)["']`));
	return match ? Number(match[1]) : undefined;
}

function getTargetDimensions({ height, scale, sourceHeight, sourceWidth, width }) {
	if (width && height) {
		return { height: even(height), width: even(width) };
	}
	if (width) {
		return { height: even((width * sourceHeight) / sourceWidth), width: even(width) };
	}
	if (height) {
		return { height: even(height), width: even((height * sourceWidth) / sourceHeight) };
	}
	return {
		height: even(sourceHeight * scale),
		width: even(sourceWidth * scale),
	};
}

function isRemoteRef(value) {
	return /^(https?:|data:|blob:|about:|#|mailto:|javascript:)/i.test(value);
}

function cleanRelativeRef(value) {
	const withoutHash = value.split("#")[0];
	const withoutQuery = withoutHash.split("?")[0];
	try {
		return decodeURIComponent(withoutQuery);
	} catch {
		return withoutQuery;
	}
}

function extractLocalAssetRefs(html, artifactDir) {
	const refs = new Set();
	const add = (raw) => {
		if (!raw || isRemoteRef(raw)) return;
		const ref = cleanRelativeRef(raw);
		if (!ref || ref.startsWith("/") || ref.startsWith("brainjuice/runtime/")) {
			return;
		}
		if (ref.includes("..")) return;
		if (existsSync(join(artifactDir, ref))) refs.add(ref);
	};

	for (const match of html.matchAll(/\b(?:src|href)=["']([^"']+)["']/g)) {
		add(match[1]);
	}
	for (const match of html.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)) {
		add(match[1]);
	}

	return [...refs].sort((a, b) => a.localeCompare(b));
}

function replaceBrainjuiceRuntimePaths(html) {
	return html.replace(
		/brainjuice\/runtime\/[A-Za-z0-9._/-]+/g,
		(match) => storageUrl(match),
	);
}

function rewriteAssetRefs(html, assetUrlByRef) {
	let rewritten = html;
	for (const [ref, url] of assetUrlByRef) {
		rewritten = rewritten.replaceAll(ref, url);
		rewritten = rewritten.replaceAll(encodeURI(ref), url);
	}
	return rewritten;
}

function setFirstAttr(html, attr, value) {
	return html.replace(
		new RegExp(`(${attr}=["'])\\d+(["'])`),
		`$1${value}$2`,
	);
}

function injectRemasterCss({
	html,
	sourceHeight,
	sourceWidth,
	targetHeight,
	targetWidth,
}) {
	const scale = Math.min(targetWidth / sourceWidth, targetHeight / sourceHeight);
	const style = `
<style id="brainjuice-remote-remaster-scale">
	html,
	body {
		background: #000 !important;
		height: ${targetHeight}px !important;
		margin: 0 !important;
		overflow: hidden !important;
		width: ${targetWidth}px !important;
	}

	[data-composition-id] {
		height: ${sourceHeight}px !important;
		overflow: hidden !important;
		position: relative !important;
		transform: scale(${scale});
		transform-origin: top left !important;
		width: ${sourceWidth}px !important;
	}
</style>`;

	const withoutOldStyle = html.replace(
		/<style id=["']brainjuice-remote-remaster-scale["'][\s\S]*?<\/style>/g,
		"",
	);
	if (withoutOldStyle.includes("</head>")) {
		return withoutOldStyle.replace("</head>", `${style}\n</head>`);
	}
	return `${style}\n${withoutOldStyle}`;
}

async function uploadAsset({ artifactDir, ref, storagePrefix }) {
	const storagePath = `${storagePrefix}/${ref}`;
	const data = await readFile(join(artifactDir, ref));
	await getStorage().bucket().file(storagePath).save(data, {
		metadata: {
			cacheControl: "public, max-age=31536000, immutable",
			contentType: contentTypeForPath(ref),
		},
	});
	return [ref, storageUrl(storagePath)];
}

async function callRenderer({
	codec,
	html,
	outputPath,
	postId,
	quality,
	rendererUrl,
	targetHeight,
	targetWidth,
}) {
	const token = process.env.BRAINJUICE_RENDERER_AUTH_TOKEN;
	if (!token) {
		throw new Error("BRAINJUICE_RENDERER_AUTH_TOKEN is required.");
	}

	const response = await fetch(rendererUrl, {
		body: JSON.stringify({
			codec,
			format: "mp4",
			fps: 30,
			height: targetHeight,
			html,
			outputPath,
			postId,
			quality,
			width: targetWidth,
		}),
		headers: {
			"content-type": "application/json",
			"x-brainjuice-renderer-token": token,
		},
		method: "POST",
	});
	const body = await response.json().catch(() => null);
	if (!response.ok || !body?.ok) {
		throw new Error(
			body?.error ?? `renderVideo returned HTTP ${response.status}`,
		);
	}
	return body;
}

async function remasterArtifact({
	artifactDir,
	codec,
	dryRun,
	finalOutputDir,
	includeExistingHd,
	outputName,
	quality,
	rendererUrl,
	runId,
	targetHeightArg,
	targetWidthArg,
	scale,
	uploadConcurrency,
}) {
	const htmlPath = join(artifactDir, "index.html");
	const html = await readFile(htmlPath, "utf8");
	const sourceWidth = firstInt(html, "data-width") ?? 392;
	const sourceHeight = firstInt(html, "data-height") ?? 768;
	const { height: targetHeight, width: targetWidth } = getTargetDimensions({
		height: targetHeightArg,
		scale,
		sourceHeight,
		sourceWidth,
		width: targetWidthArg,
	});
	if (!includeExistingHd && sourceWidth >= targetWidth) {
		return {
			artifactDir,
			skipped: true,
			skipReason: `source width ${sourceWidth}px is already >= target width ${targetWidth}px`,
			sourceHeight,
			sourceWidth,
			targetHeight,
			targetWidth,
		};
	}
	const artifactName = basename(artifactDir);
	const postId = `dev-demo-feed-remaster-${safeSegment(artifactName)}-${runId}`;
	const storagePrefix = `brainjuice/generated/${postId}/artifact`;
	const resolvedOutputName =
		outputName ?? `render-${targetWidth}x${targetHeight}.mp4`;
	const outputPath = `${storagePrefix}/${resolvedOutputName}`;
	const refs = extractLocalAssetRefs(html, artifactDir);

	if (dryRun) {
		return {
			artifactDir,
			assetCount: refs.length,
			dryRun: true,
			outputPath,
			postId,
			sourceHeight,
			sourceWidth,
			targetHeight,
			targetWidth,
		};
	}

	const uploadLimit = pLimit(uploadConcurrency);
	const uploaded = await Promise.all(
		refs.map((ref) =>
			uploadLimit(() => uploadAsset({ artifactDir, ref, storagePrefix })),
		),
	);
	const assetUrlByRef = new Map(uploaded);
	let renderHtml = rewriteAssetRefs(html, assetUrlByRef);
	renderHtml = replaceBrainjuiceRuntimePaths(renderHtml);
	renderHtml = setFirstAttr(renderHtml, "data-width", targetWidth);
	renderHtml = setFirstAttr(renderHtml, "data-height", targetHeight);
	renderHtml = injectRemasterCss({
		html: renderHtml,
		sourceHeight,
		sourceWidth,
		targetHeight,
		targetWidth,
	});

	const indexStoragePath = `${storagePrefix}/index-${targetWidth}x${targetHeight}.html`;
	await getStorage().bucket().file(indexStoragePath).save(Buffer.from(renderHtml), {
		metadata: {
			cacheControl: "public, max-age=31536000, immutable",
			contentType: "text/html; charset=utf-8",
		},
	});

	const startedAt = Date.now();
	const result = await callRenderer({
		codec,
		html: renderHtml,
		outputPath,
		postId,
		quality,
		rendererUrl,
		targetHeight,
		targetWidth,
	});

	let downloadedTo;
	if (finalOutputDir && result.outputPath) {
		downloadedTo = join(finalOutputDir, resolvedOutputName);
		await mkdir(dirname(downloadedTo), { recursive: true });
		await getStorage().bucket().file(result.outputPath).download({
			destination: downloadedTo,
		});
	}

	return {
		artifactDir,
		assetCount: refs.length,
		downloadedTo,
		indexUrl: storageUrl(indexStoragePath),
		outputPath: result.outputPath,
		outputUrl: result.outputUrl,
		postId,
		renderSeconds: Math.round((Date.now() - startedAt) / 1000),
		sourceHeight,
		sourceWidth,
		targetHeight,
		targetWidth,
		timings: result.timings,
	};
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	if (args.help) {
		console.log(usage());
		return;
	}

	const target = args.target ?? DEFAULT_TARGET;
	if (args.target && !(target in DEMO_TARGET_ROOTS)) {
		throw new Error(
			`Unknown --target "${target}". Expected one of: ${Object.keys(DEMO_TARGET_ROOTS).join(", ")}.`,
		);
	}
	const baseDir = resolve(args["base-dir"] ?? DEFAULT_BASE_DIR);
	const artifactEntries = args.artifact
		? [resolve(args.artifact)]
		: target === "final-demo-videos"
			? collectFinalDemoArtifacts()
			: args["base-dir"]
				? await collectArtifactDirs(baseDir)
				: await collectArtifactDirsFromRoots(
						DEMO_TARGET_ROOTS[target].map((root) => resolve(root)),
					);
	const filteredArtifactEntries = (args["include-sources"] || target === "final-demo-videos"
		? artifactEntries
		: artifactEntries.filter((entry) => {
				const artifactDir = typeof entry === "string" ? entry : entry.artifactDir;
				return !/\bsources?\b/i.test(artifactDir);
			})
	).map((entry) =>
		typeof entry === "string" ? { artifactDir: entry } : entry,
	);
	const scale = args.scale ? toPositiveNumber(args.scale, "scale") : undefined;
	const targetWidthArg = args.width
		? toPositiveInteger(args.width, "width")
		: args.height || scale
			? undefined
			: DEFAULT_TARGET_WIDTH;
	const targetHeightArg = args.height
		? toPositiveInteger(args.height, "height")
		: undefined;
	const concurrency = toPositiveInteger(
		args.concurrency,
		"concurrency",
		DEFAULT_RENDER_CONCURRENCY,
	);
	const uploadConcurrency = toPositiveInteger(
		args["upload-concurrency"],
		"upload-concurrency",
		DEFAULT_UPLOAD_CONCURRENCY,
	);
	const quality = args.quality ?? "standard";
	if (!["draft", "standard", "high"].includes(quality)) {
		throw new Error("quality must be draft, standard, or high.");
	}
	const codec = args.codec ?? "h264";
	if (!["h264", "h265"].includes(codec)) {
		throw new Error("codec must be h264 or h265.");
	}
	const runId =
		args["run-id"] ?? new Date().toISOString().replace(/[:.]/g, "-");
	const rendererUrl = args["renderer-url"] ?? DEV_RENDERER_URL;
	const dryRun = Boolean(args["dry-run"]);
	const finalOutputDir =
		args["final-output-dir"] == null
			? undefined
			: resolve(args["final-output-dir"]);

	if (!dryRun) {
		await initFirebase({ allowNonDev: Boolean(args["allow-non-dev"]) });
	}

	console.info(
		`Remastering ${filteredArtifactEntries.length} artifact(s) via ${rendererUrl} with concurrency ${concurrency}, codec ${codec}`,
	);

	const renderLimit = pLimit(concurrency);
	const results = await Promise.all(
		filteredArtifactEntries.map((entry) =>
			renderLimit(async () => {
				const artifactDir = entry.artifactDir;
				try {
					const result = await remasterArtifact({
						artifactDir,
						codec,
						dryRun,
						finalOutputDir,
						includeExistingHd:
							target === "final-demo-videos" ||
							Boolean(args["include-existing-hd"]),
						outputName: args["output-name"] ?? entry.outputName,
						quality,
						rendererUrl,
						runId,
						scale,
						targetHeightArg,
						targetWidthArg,
						uploadConcurrency,
					});
					console.info(
						`✓ ${relative(process.cwd(), artifactDir)} ${result.targetWidth}x${result.targetHeight}` +
							(result.skipped ? ` skipped: ${result.skipReason}` : "") +
							(result.outputUrl ? `\n  ${result.outputUrl}` : ""),
					);
					return result;
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					console.error(`✗ ${relative(process.cwd(), artifactDir)}\n  ${message}`);
					return { artifactDir, error: message };
				}
			}),
		),
	);

	const outDir = resolve(
		args["report-dir"] ??
			(args["base-dir"] ? join(baseDir, "rendered") : "videos/rendered"),
	);
	await mkdir(outDir, { recursive: true });
	const reportPath = join(outDir, `remote-remaster-${runId}.json`);
	await writeFile(reportPath, `${JSON.stringify(results, null, 2)}\n`);
	console.info(`Report: ${reportPath}`);

	const failed = results.filter((result) => "error" in result);
	if (failed.length > 0) {
		process.exitCode = 1;
	}
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exit(1);
});
