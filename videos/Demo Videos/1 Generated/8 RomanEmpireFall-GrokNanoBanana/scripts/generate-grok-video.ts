import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fal } from "@fal-ai/client";
import {
	assetsDir,
	mimeTypeForPath,
	projectDir,
	promptsDir,
	sceneId,
} from "./generation-utils";

type VideoPrompt = {
	id: number;
	imagePrompt: string;
	videoPrompt: string;
};

type VideoPromptManifest = {
	model: string;
	resolution: "720p";
	scenes: VideoPrompt[];
};

type VoiceoverMetadata = {
	honoTimelineScenes?: {
		scene: number;
		durationSeconds: number;
		startSeconds: number;
		endSeconds: number;
		text: string;
	}[];
	scenes?: {
		scene: number;
		durationSeconds: number;
		startSeconds: number;
		endSeconds: number;
		text: string;
	}[];
};

const promptManifestPath = join(promptsDir, "grok-imagine-video-prompts.json");
const voiceoverMetadataPath = join(assetsDir, "voiceover-eleven-v3-adam.json");
const videosDir = join(assetsDir, "videos");

const falKey = process.env.FAL_KEY ?? process.env.FAL_API_KEY;
if (!falKey) {
	throw new Error("FAL_KEY must be set to use fal.ai video generation");
}
fal.config({ credentials: falKey });

function parseSceneArg(): number {
	const sceneArg = process.argv.find((arg) => arg.startsWith("--scene="));
	const value = sceneArg?.split("=")[1] ?? "1";
	const scene = Number(value);
	if (!Number.isInteger(scene) || scene < 1 || scene > 16) {
		throw new Error(`Invalid --scene value: ${value}`);
	}
	return scene;
}

async function uploadFalImage(path: string): Promise<string> {
	const imageBytes = await readFile(path);
	const mimeType = mimeTypeForPath(path);
	const blob = new Blob([new Uint8Array(imageBytes)], { type: mimeType });
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

async function main() {
	await mkdir(videosDir, { recursive: true });

	const sceneNumber = parseSceneArg();
	const manifest = JSON.parse(
		await readFile(promptManifestPath, "utf8"),
	) as VideoPromptManifest;
	const voiceover = JSON.parse(
		await readFile(voiceoverMetadataPath, "utf8"),
	) as VoiceoverMetadata;

	const prompt = manifest.scenes.find((scene) => scene.id === sceneNumber);
	if (!prompt) {
		throw new Error(`No video prompt found for scene ${sceneNumber}`);
	}

	const timeline =
		voiceover.honoTimelineScenes?.find((scene) => scene.scene === sceneNumber) ??
		voiceover.scenes?.find((scene) => scene.scene === sceneNumber);
	if (!timeline) {
		throw new Error(`No voiceover timing found for scene ${sceneNumber}`);
	}

	const durationSeconds = Math.ceil(timeline.durationSeconds);
	const id = sceneId(sceneNumber);
	const inputImagePath = join(assetsDir, `scene-${id}-nb2-1k.jpg`);
	const outputPath = join(videosDir, `scene-${id}-grok-imagine-1.5-720p.mp4`);
	const metadataPath = join(
		videosDir,
		`scene-${id}-grok-imagine-1.5-720p.json`,
	);

	console.info(
		JSON.stringify(
			{
				scene: sceneNumber,
				inputImagePath,
				outputPath,
				model: manifest.model,
				resolution: manifest.resolution,
				voiceoverDurationSeconds: timeline.durationSeconds,
				requestedDurationSeconds: durationSeconds,
				videoPrompt: prompt.videoPrompt,
			},
			null,
			2,
		),
	);

	const uploadStartedAt = performance.now();
	const imageUrl = await uploadFalImage(inputImagePath);
	const uploadLatencyMs = Math.round(performance.now() - uploadStartedAt);

	const generationStartedAt = performance.now();
	const result = await fal.subscribe(manifest.model, {
		input: {
			image_url: imageUrl,
			prompt: prompt.videoPrompt,
			duration: durationSeconds,
			resolution: manifest.resolution,
		},
		logs: true,
		onQueueUpdate(update) {
			if (update.status === "IN_QUEUE") {
				console.info(
					`[fal-grok-v1.5] in queue: position ${update.queue_position ?? "?"}`,
				);
			} else if (update.status === "IN_PROGRESS") {
				console.info("[fal-grok-v1.5] generating...");
			}
		},
	});
	const generationLatencyMs = Math.round(
		performance.now() - generationStartedAt,
	);

	const videoUrl = (result.data as { video?: { url?: string } })?.video?.url;
	if (!videoUrl) {
		throw new Error(
			`No video URL in fal result: ${JSON.stringify(result.data).slice(0, 1000)}`,
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
				scene: sceneNumber,
				model: manifest.model,
				resolution: manifest.resolution,
				durationSeconds,
				voiceoverDurationSeconds: timeline.durationSeconds,
				voiceoverStartSeconds: timeline.startSeconds,
				voiceoverEndSeconds: timeline.endSeconds,
				voiceoverText: timeline.text,
				imagePrompt: prompt.imagePrompt,
				videoPrompt: prompt.videoPrompt,
				inputImagePath,
				outputPath,
				videoUrl,
				requestId: result.requestId ?? null,
				generatedAt: new Date().toISOString(),
				latencyMs: {
					upload: uploadLatencyMs,
					generation: generationLatencyMs,
					download: downloadLatencyMs,
					total: uploadLatencyMs + generationLatencyMs + downloadLatencyMs,
				},
				projectDir,
				rawFalData: result.data,
			},
			null,
			2,
		),
	);

	console.info(
		JSON.stringify(
			{
				done: true,
				scene: sceneNumber,
				outputPath,
				metadataPath,
				bytes: videoBytes.byteLength,
				latencySeconds: {
					upload: Number((uploadLatencyMs / 1000).toFixed(3)),
					generation: Number((generationLatencyMs / 1000).toFixed(3)),
					download: Number((downloadLatencyMs / 1000).toFixed(3)),
					total: Number(
						(
							(uploadLatencyMs + generationLatencyMs + downloadLatencyMs) /
							1000
						).toFixed(3),
					),
				},
			},
			null,
			2,
		),
	);
}

await main();
