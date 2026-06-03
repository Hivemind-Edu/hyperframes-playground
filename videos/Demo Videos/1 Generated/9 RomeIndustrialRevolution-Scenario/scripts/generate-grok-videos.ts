import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fal } from "@fal-ai/client";

type PromptManifest = {
	globalPromptPrefix: string;
	model: string;
	resolution: "720p";
	scenes: {
		id: number;
		videoPrompt: string;
	}[];
};

type ScenePlan = {
	scenes: Array<{
		id: number;
		voiceover: string;
	}>;
};

type WordCaption = {
	endMs: number;
	startMs: number;
	text: string;
};

type DeepgramCaptionMetadata = {
	audioDurationSeconds?: number;
	wordCaptions: WordCaption[];
};

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectDir = dirname(__dirname);
const assetsDir = join(projectDir, "assets");
const promptsDir = join(projectDir, "prompts");
const videosDir = join(assetsDir, "videos");
const manifestPath = join(promptsDir, "grok-imagine-video-prompts.json");
const scenePlanPath = join(promptsDir, "scene-plan-v1.json");
const deepgramCaptionsPath = join(
	assetsDir,
	"voiceover-deepgram-word-captions.json",
);
const force = process.argv.includes("--force") || process.env.FORCE === "1";
const selectedSceneArg = process.argv.find((arg) => arg.startsWith("--scene="));
const selectedScene = selectedSceneArg
	? Number(selectedSceneArg.split("=")[1])
	: undefined;
const concurrency = Math.max(
	1,
	Number(process.env.GROK_VIDEO_CONCURRENCY ?? process.env.GEN_CONCURRENCY ?? 4),
);

const sceneImagePaths: Record<number, string> = {
	1: "assets/keyframes/scene-01-keyframe-v2-iphone-nb2-1k.jpg",
	2: "assets/keyframes/scene-02-keyframe-v3-iphone-nb2-1k.jpg",
	3: "assets/keyframes/scene-03-keyframe-v2-iphone-nb2-1k.jpg",
	4: "assets/keyframes/scene-04-keyframe-v2-iphone-nb2-1k.jpg",
	5: "assets/keyframes/scene-05-keyframe-v3-iphone-nb2-1k.jpg",
	6: "assets/keyframes/scene-06-keyframe-v3-iphone-nb2-1k.jpg",
	7: "assets/keyframes/scene-07-keyframe-v3-iphone-nb2-1k.jpg",
	8: "assets/keyframes/scene-08-keyframe-v3-iphone-nb2-1k.jpg",
	9: "assets/keyframes/scene-09-keyframe-v3-iphone-nb2-1k.jpg",
	10: "assets/keyframes/scene-10-keyframe-v3-iphone-nb2-1k.jpg",
	11: "assets/keyframes/scene-11-keyframe-v3-iphone-nb2-1k.jpg",
	12: "assets/keyframes/scene-12-keyframe-v3-iphone-nb2-1k.jpg",
	13: "assets/keyframes/scene-13-keyframe-v3-iphone-nb2-1k.jpg",
	14: "assets/keyframes/scene-14-keyframe-v3-iphone-nb2-1k.jpg",
	15: "assets/keyframes/scene-15-keyframe-v3-iphone-nb2-1k.jpg",
	16: "assets/keyframes/scene-16-keyframe-v3-iphone-nb2-1k.jpg",
};

const mimeTypeByExtension: Record<string, string> = {
	".jpeg": "image/jpeg",
	".jpg": "image/jpeg",
	".png": "image/png",
	".webp": "image/webp",
};

const falKey = process.env.FAL_KEY ?? process.env.FAL_API_KEY;
if (!falKey) {
	throw new Error(
		"FAL_KEY or FAL_API_KEY must be set. Run with hivemind-hono .env.local and .env.brainjuice.local.",
	);
}
fal.config({ credentials: falKey });

if (
	selectedScene !== undefined &&
	(!Number.isInteger(selectedScene) || selectedScene < 1 || selectedScene > 16)
) {
	throw new Error(`Invalid --scene value: ${selectedSceneArg}`);
}

function sceneId(sceneNumber: number): string {
	return String(sceneNumber).padStart(2, "0");
}

function mimeTypeForPath(path: string): string {
	return mimeTypeByExtension[extname(path).toLowerCase()] ?? "image/jpeg";
}

function sceneWordTokens(text: string): string[] {
	return (
		text
			.replace(/\bwatermills\b/gi, "water mills")
			.match(/[a-z0-9]+/gi) ?? []
	);
}

function buildDeepgramSceneTimeline(
	scenePlan: ScenePlan,
	wordCaptions: WordCaption[],
	totalDuration: number,
) {
	let wordCursor = 0;
	return scenePlan.scenes.map((scene, sceneIndex) => {
		const wordCount = sceneWordTokens(scene.voiceover).length;
		const sceneWords = wordCaptions.slice(wordCursor, wordCursor + wordCount);
		wordCursor += wordCount;

		if (sceneWords.length === 0) {
			throw new Error(`No Deepgram words allocated to scene ${scene.id}`);
		}

		const nextWord = wordCaptions[wordCursor];
		const startSeconds =
			sceneIndex === 0
				? 0
				: Number((sceneWords[0]!.startMs / 1000).toFixed(3));
		const endSeconds =
			sceneIndex === scenePlan.scenes.length - 1 || !nextWord
				? totalDuration
				: Number((nextWord.startMs / 1000).toFixed(3));

		return {
			durationSeconds: Number((endSeconds - startSeconds).toFixed(3)),
			endSeconds,
			scene: scene.id,
			startSeconds,
			text: scene.voiceover,
		};
	});
}

async function uploadFalImage(path: string): Promise<string> {
	const imageBytes = await readFile(path);
	const blob = new Blob([new Uint8Array(imageBytes)], {
		type: mimeTypeForPath(path),
	});
	return await fal.storage.upload(blob);
}

async function downloadVideo(url: string): Promise<Buffer> {
	const response = await fetch(url);
	if (!response.ok) {
		throw new Error(
			`Failed to download generated video: ${response.status} ${response.statusText}`,
		);
	}
	return Buffer.from(await response.arrayBuffer());
}

async function generateScene(args: {
	manifest: PromptManifest;
	scene: PromptManifest["scenes"][number];
	timeline: ReturnType<typeof buildDeepgramSceneTimeline>[number];
}) {
	const id = sceneId(args.scene.id);
	const inputImagePath = join(projectDir, sceneImagePaths[args.scene.id]!);
	const outputPath = join(videosDir, `scene-${id}-grok-imagine-1.5-720p.mp4`);
	const metadataPath = join(videosDir, `scene-${id}-grok-imagine-1.5-720p.json`);
	const promptPath = join(promptsDir, `scene-${id}-video-grok-imagine-v15.txt`);
	const fullPrompt = `${args.manifest.globalPromptPrefix}\n\nScene action: ${args.scene.videoPrompt}`;

	await writeFile(promptPath, fullPrompt);

	if (!force && existsSync(outputPath)) {
		console.info(`[scene ${id}] keeping existing video`);
		return { outputPath, skipped: true };
	}

	const durationSeconds = Math.ceil(args.timeline.durationSeconds);
	console.info(
		`[scene ${id}] generating ${durationSeconds}s ${args.manifest.resolution} Grok Imagine 1.5 video`,
	);

	const uploadStartedAt = performance.now();
	const imageUrl = await uploadFalImage(inputImagePath);
	const uploadLatencyMs = Math.round(performance.now() - uploadStartedAt);

	const generationStartedAt = performance.now();
	const result = await fal.subscribe(args.manifest.model, {
		input: {
			duration: durationSeconds,
			image_url: imageUrl,
			prompt: fullPrompt,
			resolution: args.manifest.resolution,
		},
		logs: true,
		onQueueUpdate(update) {
			if (update.status === "IN_QUEUE") {
				console.info(
					`[scene ${id}] in queue: position ${update.queue_position ?? "?"}`,
				);
			} else if (update.status === "IN_PROGRESS") {
				console.info(`[scene ${id}] generating...`);
			}
		},
	});
	const generationLatencyMs = Math.round(
		performance.now() - generationStartedAt,
	);

	const videoUrl = (result.data as { video?: { url?: string } })?.video?.url;
	if (!videoUrl) {
		throw new Error(
			`No video URL in fal result for scene ${id}: ${JSON.stringify(result.data).slice(0, 1000)}`,
		);
	}

	const downloadStartedAt = performance.now();
	const videoBytes = await downloadVideo(videoUrl);
	const downloadLatencyMs = Math.round(performance.now() - downloadStartedAt);
	await writeFile(outputPath, videoBytes);

	await writeFile(
		metadataPath,
		JSON.stringify(
			{
				durationSeconds,
				generatedAt: new Date().toISOString(),
				inputImagePath,
				latencyMs: {
					download: downloadLatencyMs,
					generation: generationLatencyMs,
					total: uploadLatencyMs + generationLatencyMs + downloadLatencyMs,
					upload: uploadLatencyMs,
				},
				model: args.manifest.model,
				outputPath,
				promptPath,
				requestId: result.requestId ?? null,
				resolution: args.manifest.resolution,
				scene: args.scene.id,
				videoPrompt: fullPrompt,
				videoUrl,
				voiceoverDurationSeconds: args.timeline.durationSeconds,
				voiceoverEndSeconds: args.timeline.endSeconds,
				voiceoverStartSeconds: args.timeline.startSeconds,
				voiceoverText: args.timeline.text,
			},
			null,
			2,
		),
	);

	console.info(
		`[scene ${id}] done: ${Math.round(videoBytes.byteLength / 1024 / 1024)}MB in ${Number(((uploadLatencyMs + generationLatencyMs + downloadLatencyMs) / 1000).toFixed(1))}s`,
	);
	return { outputPath, skipped: false };
}

async function runConcurrent<T, R>(
	items: T[],
	limit: number,
	worker: (item: T) => Promise<R>,
): Promise<R[]> {
	const results: R[] = [];
	let cursor = 0;
	const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
		while (cursor < items.length) {
			const index = cursor++;
			results[index] = await worker(items[index]!);
		}
	});
	await Promise.all(workers);
	return results;
}

async function main() {
	await mkdir(videosDir, { recursive: true });
	const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as PromptManifest;
	const scenePlan = JSON.parse(await readFile(scenePlanPath, "utf8")) as ScenePlan;
	const deepgram = JSON.parse(
		await readFile(deepgramCaptionsPath, "utf8"),
	) as DeepgramCaptionMetadata;
	const totalDuration = Number(
		(deepgram.audioDurationSeconds ?? 0).toFixed(3),
	);
	const timeline = buildDeepgramSceneTimeline(
		scenePlan,
		deepgram.wordCaptions,
		totalDuration,
	);

	const jobs = manifest.scenes
		.filter((scene) => selectedScene === undefined || scene.id === selectedScene)
		.map((scene) => {
			const sceneTimeline = timeline.find((item) => item.scene === scene.id);
			if (!sceneTimeline) throw new Error(`Missing timeline for scene ${scene.id}`);
			return { manifest, scene, timeline: sceneTimeline };
		});

	console.info(
		JSON.stringify(
			{
				concurrency,
				force,
				model: manifest.model,
				resolution: manifest.resolution,
				selectedScene: selectedScene ?? null,
				sceneCount: jobs.length,
			},
			null,
			2,
		),
	);

	const results = await runConcurrent(jobs, concurrency, generateScene);
	await writeFile(
		join(videosDir, "generation-result.json"),
		JSON.stringify(
			{
				concurrency,
				force,
				generatedAt: new Date().toISOString(),
				model: manifest.model,
				resolution: manifest.resolution,
				results,
				selectedScene: selectedScene ?? null,
				sceneCount: jobs.length,
			},
			null,
			2,
		),
	);

	console.info("[done] generated Grok videos into", videosDir);
}

await main();
