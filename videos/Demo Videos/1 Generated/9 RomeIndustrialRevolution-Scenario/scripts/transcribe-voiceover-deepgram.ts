import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

type DeepgramWord = {
	confidence?: number;
	end?: number;
	punctuated_word?: string;
	start?: number;
	word?: string;
};

type DeepgramListenResponse = {
	metadata?: {
		duration?: number;
	};
	results?: {
		channels?: Array<{
			alternatives?: Array<{
				transcript?: string;
				words?: DeepgramWord[];
			}>;
		}>;
		utterances?: Array<{
			words?: DeepgramWord[];
		}>;
	};
};

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectDir = dirname(__dirname);
const assetsDir = join(projectDir, "assets");
const audioPath = join(assetsDir, "voiceover-eleven-v3-adam.mp3");
const rawOutputPath = join(assetsDir, "voiceover-deepgram-nova2.raw.json");
const wordOutputPath = join(assetsDir, "voiceover-deepgram-word-captions.json");

const apiKey = process.env.DEEPGRAM_API_KEY;
if (!apiKey) {
	throw new Error("Missing DEEPGRAM_API_KEY");
}

const getWords = (response: DeepgramListenResponse): DeepgramWord[] => {
	const utteranceWords =
		response.results?.utterances?.flatMap((utterance) => utterance.words ?? []) ??
		[];
	if (utteranceWords.length > 0) return utteranceWords;

	return response.results?.channels?.[0]?.alternatives?.[0]?.words ?? [];
};

const audioBuffer = await readFile(audioPath);
const query = new URLSearchParams({
	model: "nova-2",
	punctuate: "true",
	smart_format: "true",
});

const response = await fetch(`https://api.deepgram.com/v1/listen?${query}`, {
	body: Uint8Array.from(audioBuffer),
	headers: {
		Authorization: `Token ${apiKey}`,
		"Content-Type": "audio/mpeg",
	},
	method: "POST",
});

const bodyText = await response.text();
if (!response.ok) {
	throw new Error(
		`Deepgram transcription failed (${response.status}): ${bodyText || "unknown error"}`,
	);
}

const raw = JSON.parse(bodyText) as DeepgramListenResponse;
const words = getWords(raw)
	.map((word, index) => {
		const text = word.punctuated_word?.trim() || word.word?.trim() || "";
		if (
			!text ||
			typeof word.start !== "number" ||
			typeof word.end !== "number" ||
			!Number.isFinite(word.start) ||
			!Number.isFinite(word.end) ||
			word.end <= word.start
		) {
			return null;
		}

		const startMs = Math.round(word.start * 1000);
		const endMs = Math.round(word.end * 1000);
		return {
			confidence:
				typeof word.confidence === "number" && Number.isFinite(word.confidence)
					? word.confidence
					: null,
			endMs,
			startMs,
			text: index === 0 ? text : ` ${text}`,
			timestampMs: startMs,
		};
	})
	.filter((word): word is NonNullable<typeof word> => word !== null)
	.sort((left, right) => left.startMs - right.startMs || left.endMs - right.endMs);

if (words.length === 0) {
	throw new Error("Deepgram response did not include usable word timings.");
}

await writeFile(rawOutputPath, `${JSON.stringify(raw, null, 2)}\n`);
await writeFile(
	wordOutputPath,
	`${JSON.stringify(
		{
			audioDurationSeconds:
				typeof raw.metadata?.duration === "number"
					? Number(raw.metadata.duration.toFixed(3))
					: undefined,
			provider: "deepgram",
			modelId: "nova-2",
			transcript:
				raw.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? undefined,
			wordCaptions: words,
			wordCount: words.length,
		},
		null,
		2,
	)}\n`,
);

console.info(
	JSON.stringify(
		{
			done: true,
			rawOutputPath,
			wordOutputPath,
			wordCount: words.length,
			firstWord: words[0],
			lastWord: words[words.length - 1],
		},
		null,
		2,
	),
);
