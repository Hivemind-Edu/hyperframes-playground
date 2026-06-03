import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

type Alignment = {
	characters: string[];
	character_start_times_seconds?: number[];
	character_end_times_seconds?: number[];
	characterStartTimesSeconds?: number[];
	characterEndTimesSeconds?: number[];
};

type ElevenLabsTimestampResponse = {
	audio_base64: string;
	alignment?: Alignment;
	normalized_alignment?: Alignment;
};

type WordCaption = {
	confidence: null;
	endMs: number;
	startMs: number;
	text: string;
	timestampMs: number;
};

type ScenePlan = {
	scenes: Array<{
		id: number;
		voiceover: string;
	}>;
};

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectDir = dirname(__dirname);
const assetsDir = join(projectDir, "assets");
const promptsDir = join(projectDir, "prompts");

const scriptPath = join(promptsDir, "voiceover-script-draft-v1.txt");
const scenePlanPath = join(promptsDir, "scene-plan-v1.json");
const outputAudioPath = join(assetsDir, "voiceover-eleven-v3-adam.mp3");
const outputMetadataPath = join(assetsDir, "voiceover-eleven-v3-adam.json");
const outputRawPath = join(assetsDir, "voiceover-eleven-v3-adam.raw.json");

const provider = "elevenlabs";
const modelId = "eleven_v3";
const outputFormat = "mp3_44100_128";
const voiceKey = "el-adam";
const voiceId = "pNInz6obpgDQGcFmaJgB";

const apiKey = process.env.ELEVENLABS_API_KEY;
if (!apiKey) {
	throw new Error("Missing ELEVENLABS_API_KEY");
}

const normalizeText = (value: string) =>
	value
		.replace(/[“”]/g, '"')
		.replace(/[‘’]/g, "'")
		.replace(/\s+/g, " ")
		.trim();

const wordKey = (value: string) =>
	value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "");

const script = await readFile(scriptPath, "utf8");
const scenePlan = JSON.parse(await readFile(scenePlanPath, "utf8")) as ScenePlan;
await mkdir(assetsDir, { recursive: true });

const response = await fetch(
	`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/with-timestamps?output_format=${outputFormat}`,
	{
		method: "POST",
		headers: {
			Accept: "application/json",
			"Content-Type": "application/json",
			"xi-api-key": apiKey,
		},
		body: JSON.stringify({
			text: script.trim(),
			model_id: modelId,
			voice_settings: {
				stability: 0.42,
				similarity_boost: 0.82,
				style: 0.38,
				use_speaker_boost: true,
				speed: 0.96,
			},
		}),
	},
);

if (!response.ok) {
	throw new Error(
		`ElevenLabs request failed: ${response.status} ${await response.text()}`,
	);
}

const raw = (await response.json()) as ElevenLabsTimestampResponse;
const alignment = raw.alignment ?? raw.normalized_alignment;
if (!alignment) {
	throw new Error("ElevenLabs response did not include alignment data.");
}

const starts =
	alignment.character_start_times_seconds ??
	alignment.characterStartTimesSeconds ??
	[];
const ends =
	alignment.character_end_times_seconds ??
	alignment.characterEndTimesSeconds ??
	[];

if (
	alignment.characters.length !== starts.length ||
	alignment.characters.length !== ends.length
) {
	throw new Error("Invalid ElevenLabs character alignment lengths.");
}

await writeFile(outputAudioPath, Buffer.from(raw.audio_base64, "base64"));
await writeFile(
	outputRawPath,
	JSON.stringify(
		{
			...raw,
			audio_base64: `[base64 omitted: ${raw.audio_base64.length} chars]`,
		},
		null,
		2,
	),
);

const words: WordCaption[] = [];
let pendingWhitespace = "";
let currentText = "";
let currentStartMs: number | null = null;
let currentEndMs: number | null = null;

const flushWord = () => {
	if (!currentText || currentStartMs === null || currentEndMs === null) {
		return;
	}

	words.push({
		confidence: null,
		endMs: currentEndMs,
		startMs: currentStartMs,
		text: `${words.length === 0 ? "" : pendingWhitespace}${currentText}`,
		timestampMs: currentStartMs,
	});

	pendingWhitespace = "";
	currentText = "";
	currentStartMs = null;
	currentEndMs = null;
};

for (let index = 0; index < alignment.characters.length; index += 1) {
	const character = alignment.characters[index]!;
	if (/\s/u.test(character)) {
		flushWord();
		pendingWhitespace += character;
		continue;
	}

	currentStartMs ??= Math.round(starts[index]! * 1000);
	currentText += character;
	currentEndMs = Math.round(ends[index]! * 1000);
}
flushWord();

if (words.length === 0) {
	throw new Error("ElevenLabs alignment did not produce word captions.");
}

const sceneWordCounts = scenePlan.scenes.map((scene) => {
	const count = normalizeText(scene.voiceover)
		.split(/\s+/)
		.filter((word) => wordKey(word).length > 0).length;
	return { scene, count };
});

const totalSceneWords = sceneWordCounts.reduce((sum, item) => sum + item.count, 0);
if (totalSceneWords !== words.length) {
	console.warn(
		`Scene word count (${totalSceneWords}) does not match alignment word count (${words.length}); allocating by scene text order anyway.`,
	);
}

let cursor = 0;
const scenes = sceneWordCounts.map(({ scene, count }, sceneIndex) => {
	const sceneWords = words.slice(cursor, cursor + count);
	cursor += count;
	if (sceneWords.length === 0) {
		throw new Error(`No words allocated to scene ${scene.id}`);
	}

	const startSeconds =
		sceneIndex === 0 ? 0 : Number((sceneWords[0]!.startMs / 1000).toFixed(3));
	const speechEndSeconds = Number(
		(sceneWords[sceneWords.length - 1]!.endMs / 1000).toFixed(3),
	);
	const nextSceneStartMs = words[cursor]?.startMs;
	const endSeconds =
		nextSceneStartMs === undefined
			? speechEndSeconds
			: Number((nextSceneStartMs / 1000).toFixed(3));

	return {
		scene: scene.id,
		words: sceneWords.length,
		startSeconds,
		speechEndSeconds,
		endSeconds,
		durationSeconds: Number((endSeconds - startSeconds).toFixed(3)),
		spokenDurationSeconds: Number(
			(speechEndSeconds - startSeconds).toFixed(3),
		),
		trailingPauseSeconds: Number((endSeconds - speechEndSeconds).toFixed(3)),
		text: scene.voiceover,
	};
});

const ffprobe = spawnSync(
	"ffprobe",
	[
		"-v",
		"error",
		"-show_entries",
		"format=duration",
		"-of",
		"default=noprint_wrappers=1:nokey=1",
		outputAudioPath,
	],
	{ encoding: "utf8" },
);

const audioDurationSeconds =
	ffprobe.status === 0
		? Number(Number(ffprobe.stdout.trim()).toFixed(3))
		: scenes[scenes.length - 1]!.endSeconds;

scenes[scenes.length - 1]!.endSeconds = audioDurationSeconds;
scenes[scenes.length - 1]!.durationSeconds = Number(
	(audioDurationSeconds - scenes[scenes.length - 1]!.startSeconds).toFixed(3),
);
scenes[scenes.length - 1]!.trailingPauseSeconds = Number(
	(audioDurationSeconds - scenes[scenes.length - 1]!.speechEndSeconds).toFixed(3),
);

const captionPages = [];
for (let index = 0; index < words.length; index += 3) {
	const pageWords = words.slice(index, index + 3);
	captionPages.push({
		startMs: pageWords[0]!.startMs,
		endMs: pageWords[pageWords.length - 1]!.endMs,
		text: pageWords.map((word) => word.text.trim()).join(" "),
		words: pageWords,
	});
}

await writeFile(
	outputMetadataPath,
	JSON.stringify(
		{
			provider,
			modelId,
			outputFormat,
			voiceKey,
			voiceId,
			wordCount: words.length,
			wordCaptionCount: words.length,
			captionCount: captionPages.length,
			audioDurationSeconds,
			scriptPath,
			audioFilePath: outputAudioPath,
			scenePlanPath,
			scenes,
			honoTimelineScenes: scenes,
			wordCaptions: words,
			captions: captionPages,
		},
		null,
		2,
	),
);

console.log(
	JSON.stringify(
		{
			audioDurationSeconds,
			audioFilePath: outputAudioPath,
			captionCount: captionPages.length,
			metadataPath: outputMetadataPath,
			modelId,
			scenes: scenes.length,
			voiceKey,
			wordCount: words.length,
		},
		null,
		2,
	),
);
