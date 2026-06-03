import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	generateImageNanoBanana,
	NANO_BANANA_2_MODEL,
} from "/Users/mark/hivemind/hivemind-hono/src/pipelines/shared/assets/aiImages/generateImage";
import { imageToVideoFalGrokV15 } from "/Users/mark/hivemind/hivemind-hono/src/pipelines/shared/assets/aiVideos/imageToVideo";
import { synthesizeGeminiTtsAudio } from "/Users/mark/hivemind/hivemind-hono/src/brainjuice/utils/narration/geminiTts";
import { GEMINI_TTS_MODEL_ID } from "/Users/mark/hivemind/hivemind-hono/src/brainjuice/utils/narration/voiceCatalog";

type ScenePlan = {
	models: {
		image: { aspectRatio: "9:16"; imageSize: string; modelId: string };
		video: { durationSeconds: 6; resolution: "720p"; aspectRatio: "9:16" };
		tts: { modelId: string; voice: string; languageCode: string };
	};
	scenes: Array<{
		id: number;
		imagePrompt: string;
		videoPrompt: string;
	}>;
	title: string;
};

const scriptDir = dirname(fileURLToPath(import.meta.url));
const demoRoot = join(scriptDir, "..");
const assetsDir = join(demoRoot, "assets");
const promptsDir = join(demoRoot, "prompts");
const force = process.argv.includes("--force") || process.env.FORCE === "1";
const forceAudio = force || process.argv.includes("--force-audio");
const audioOnly = process.argv.includes("--audio-only");

const requiredEnv = [
	["GOOGLE_GENERATIVE_AI_API_KEY or GOOGLE_API_KEY", Boolean(process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GOOGLE_API_KEY)],
	["FAL_KEY or FAL_API_KEY", Boolean(process.env.FAL_KEY || process.env.FAL_API_KEY)],
];

for (const [label, ok] of requiredEnv) {
	if (!ok) {
		throw new Error(`Missing ${label}. Run this from hivemind-hono with .env.local and .env.brainjuice.local loaded.`);
	}
}

async function readJson<T>(path: string): Promise<T> {
	return JSON.parse(await readFile(path, "utf8")) as T;
}

async function writeText(path: string, text: string) {
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, text);
}

async function writeBinary(path: string, data: Buffer) {
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, data);
}

function ffprobeDurationSeconds(path: string): number | null {
	const result = Bun.spawnSync({
		cmd: [
			"ffprobe",
			"-v",
			"error",
			"-show_entries",
			"format=duration",
			"-of",
			"default=noprint_wrappers=1:nokey=1",
			path,
		],
		stdout: "pipe",
		stderr: "pipe",
	});
	if (result.exitCode !== 0) return null;
	const parsed = Number(result.stdout.toString().trim());
	return Number.isFinite(parsed) ? parsed : null;
}

async function generateAudio() {
	const outPath = join(assetsDir, "audio.mp3");
	if (!forceAudio && existsSync(outPath)) {
		console.info("[audio] keeping existing assets/audio.mp3");
		return { durationSeconds: ffprobeDurationSeconds(outPath), path: outPath };
	}

	const text = await readFile(join(promptsDir, "narration-script.txt"), "utf8");
	await writeText(join(promptsDir, "gemini-tts-input.txt"), text.trim());
	console.info("[audio] Gemini TTS: gemini-3.1-flash-tts-preview / Kore");

	const { audioBuffer, ttsInputText } = await synthesizeGeminiTtsAudio({
		language: "en",
		text,
		voice: {
			key: "gemini-kore",
			modelId: GEMINI_TTS_MODEL_ID,
			provider: "gemini",
			speed: 1.1,
			voiceId: "Kore",
		},
		voiceId: "Kore",
	});
	await writeBinary(outPath, audioBuffer);
	await writeText(join(promptsDir, "gemini-tts-rendered-input.txt"), ttsInputText);
	return { durationSeconds: ffprobeDurationSeconds(outPath), path: outPath };
}

async function generateScene(scene: ScenePlan["scenes"][number]) {
	const sceneLabel = `scene ${scene.id}`;
	const imagePath = join(assetsDir, `panel-bg-${scene.id}.png`);
	const videoPath = join(assetsDir, `panel-${scene.id}.mp4`);

	await writeText(join(promptsDir, `scene-${scene.id}-image-nano-banana-2.txt`), scene.imagePrompt);
	await writeText(join(promptsDir, `scene-${scene.id}-video-grok-imagine-v15.txt`), scene.videoPrompt);

	let imageBuffer: Buffer;
	if (!force && existsSync(imagePath)) {
		console.info(`[${sceneLabel}] keeping existing image`);
		imageBuffer = Buffer.from(await readFile(imagePath));
	} else {
		console.info(`[${sceneLabel}] Nano Banana 2 image`);
		imageBuffer = await generateImageNanoBanana(
			scene.imagePrompt,
			NANO_BANANA_2_MODEL,
			"9:16",
			"1K",
			{ width: 1024, height: 1792 },
		);
		await writeBinary(imagePath, imageBuffer);
	}

	if (!force && existsSync(videoPath)) {
		console.info(`[${sceneLabel}] keeping existing Grok video`);
		return;
	}

	console.info(`[${sceneLabel}] Grok Imagine Video 1.5 image-to-video`);
	const videoBuffer = await imageToVideoFalGrokV15(imageBuffer, scene.videoPrompt, {
		aspectRatio: "9:16",
		durationSeconds: 6,
		resolution: "720p",
	});
	await writeBinary(videoPath, videoBuffer);
}

async function main() {
	const plan = await readJson<ScenePlan>(join(promptsDir, "scene-plan.json"));
	await mkdir(assetsDir, { recursive: true });

	await writeText(
		join(assetsDir, "model-routing.json"),
		JSON.stringify(
			{
				imageModel: plan.models.image,
				note: "Direct scene-by-scene generation. No panel batching or composed image grid is used.",
				ttsModel: plan.models.tts,
				videoModel: plan.models.video,
			},
			null,
			2,
		),
	);

	const audio = await generateAudio();
	if (audioOnly) {
		await writeText(
			join(assetsDir, "generation-result.json"),
			JSON.stringify(
				{
					audioDurationSeconds: audio.durationSeconds,
					generatedAt: new Date().toISOString(),
					sceneCount: plan.scenes.length,
					title: plan.title,
				},
				null,
				2,
			),
		);
		console.info("[done] generated audio into", audio.path);
		console.info("[done] audio duration", audio.durationSeconds ?? "unknown");
		return;
	}

	for (const scene of plan.scenes) {
		await generateScene(scene);
	}

	await writeText(
		join(assetsDir, "generation-result.json"),
		JSON.stringify(
			{
				audioDurationSeconds: audio.durationSeconds,
				generatedAt: new Date().toISOString(),
				sceneCount: plan.scenes.length,
				title: plan.title,
			},
			null,
			2,
		),
	);

	console.info("[done] generated assets into", assetsDir);
	console.info("[done] audio duration", audio.durationSeconds ?? "unknown");
}

await main();
