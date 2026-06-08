import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import type { AudioWithTimestampsResponse } from "@elevenlabs/elevenlabs-js/api";
import { analyzeMediaBufferWithFfprobe } from "../../../hivemind-hono/src/brainjuice/templateAssets/ffmpegMediaProcessor";
import { stripFocusAnnotationLines } from "../../../hivemind-hono/src/brainjuice/templates/CodeHikeTemplate/codeAnnotationUtils";
import { resolveCodeLayout } from "../../../hivemind-hono/src/brainjuice/templates/CodeHikeTemplate/codeLayout";
import { createCodeRenderModel } from "../../../hivemind-hono/src/brainjuice/templates/CodeHikeTemplate/codeRenderModel";
import { compileCodeHikeTemplateToHyperframesHtml } from "../../../hivemind-hono/src/brainjuice/templates/CodeHikeTemplate/compileArtifact";
import {
	buildSlidesWithTimestamps,
	type CodeHikePipeline,
} from "../../../hivemind-hono/src/brainjuice/templates/CodeHikeTemplate/pipeline";
import { processSnippet } from "../../../hivemind-hono/src/brainjuice/templates/CodeHikeTemplate/processSnippet";
import type { Theme } from "../../../hivemind-hono/src/brainjuice/templates/CodeHikeTemplate/theme";
import { alignSourceTextToCaptions } from "../../../hivemind-hono/src/brainjuice/utils/captions/alignSourceTextToCaptions";
import { createSentenceAwareTikTokCaptions } from "../../../hivemind-hono/src/brainjuice/utils/captions/createSentenceAwareTikTokCaptions";
import { restorePunctuationFromSourceText } from "../../../hivemind-hono/src/brainjuice/utils/captions/restorePunctuationFromSourceText";
import { elevenlabsToTimedCaptions } from "../../../hivemind-hono/src/brainjuice/utils/narration/elevenlabsToTimedCaptions";

const REPO_ROOT = resolve(import.meta.dir, "../../..");
const HONO_ROOT = join(REPO_ROOT, "hivemind-hono");
const PLAYGROUND_ROOT = join(REPO_ROOT, "hyperframes-playground");
const OUTPUT_ROOT = join(
	PLAYGROUND_ROOT,
	"videos",
	"Demo Videos",
	"0 Demo Videos",
	"8 Beginner JS Arrays CodeHike",
);
const ASSETS_DIR = join(OUTPUT_ROOT, "assets");

const VOICE_ID = "IRHApOXLvnW57QJPQH2P";
const MODEL_ID = "eleven_v3";
const AUDIO_FILE_NAME = "assets/voiceover-adam-eleven-v3.mp3";
const THEME: Theme = "github-dark";

const STATIC_ASSETS_ROOT = join(
	REPO_ROOT,
	"hivemind-expo",
	"apps",
	"brainjuice",
	"assets",
	"brainjuice",
	"staticVideoAssets",
);
const FONT_ASSETS_ROOT = join(
	HONO_ROOT,
	"tmp",
	"codehike-emoji-test",
	"staticVideoAssets",
	"fonts",
);

const voiceover = [
	"Imagine you are tracking three favorite snacks.",
	"At first, separate variables feel fine.",
	"Snack one is apples.",
	"Snack two is pretzels.",
	"Snack three is yogurt.",
	"But the code is already telling you something.",
	"These values belong together.",
	"When several related values travel together, use an array.",
	"An array is one variable that holds a list.",
	"The square brackets mean, make a list.",
	"Each item goes inside, separated by commas.",
	"Now the name snacks points to the whole list.",
	"To get one item back, use its position.",
	"JavaScript starts counting at zero.",
	"So snacks zero is the first snack.",
	"Snacks one is the second snack.",
	"That feels strange for a minute, then it becomes normal.",
	"The important rule is this.",
	"The index is the item's address inside the array.",
	"Once the values are in one list, the payoff starts.",
	"We can ask how many snacks we have with snacks dot length.",
	"We can also do the same work for every snack.",
	"Map means, make a new array by transforming each item.",
	"Here every snack becomes a label.",
	"The code does not need snack one, snack two, and snack three anymore.",
	"It has one name for the collection, and tools for working with the collection.",
	"Use arrays when the question changes from, what is this one value, to, what are all these related values.",
].join(" ");

const separateVariables = `const snack1 = "apples";
const snack2 = "pretzels";
const snack3 = "yogurt";

console.log(snack1);
console.log(snack2);
console.log(snack3);
`;

const arrayLiteral = `const snacks = [
  "apples",
  "pretzels",
  "yogurt",
];
`;

const arrayWithMeaning = `// One name for the whole group
const snacks = [
  "apples",
  "pretzels",
  "yogurt",
];
`;

const indexAccess = `const snacks = [
  "apples",
  "pretzels",
  "yogurt",
];

const firstSnack = snacks[0];
const secondSnack = snacks[1];
`;

const indexAddress = `// index:     0          1           2
const snacks = ["apples", "pretzels", "yogurt"];

const firstSnack = snacks[0];
`;

const lengthPayoff = `const snacks = [
  "apples",
  "pretzels",
  "yogurt",
];

const snackCount = snacks.length;
// 3
`;

const mapPayoff = `const snacks = [
  "apples",
  "pretzels",
  "yogurt",
];

const labels = snacks.map((snack) => {
  return "Snack: " + snack;
});
`;

const finalRule = `const snacks = ["apples", "pretzels", "yogurt"];

const firstSnack = snacks[0];
const snackCount = snacks.length;

const labels = snacks.map((snack) => {
  return "Snack: " + snack;
});
`;

const pipeline: CodeHikePipeline = {
	language: "javascript",
	voiceover,
	slides: [
		{ enterOn: "Imagine you are tracking", emphasis: true },
		{ enterOn: "At first", code: separateVariables },
		{
			enterOn: "Snack one",
			code: `// !focus(1)
${separateVariables}`,
		},
		{
			enterOn: "Snack two",
			code: `// !focus(2)
${separateVariables}`,
		},
		{
			enterOn: "Snack three",
			code: `// !focus(3)
${separateVariables}`,
		},
		{ enterOn: "But the code", code: separateVariables },
		{ enterOn: "These values belong", emphasis: true },
		{ enterOn: "When several related", code: arrayLiteral },
		{ enterOn: "An array is", code: arrayWithMeaning },
		{
			enterOn: "square brackets",
			code: `// !focus(2,6)
${arrayWithMeaning}`,
			startOffsetMs: -120,
		},
		{
			enterOn: "Each item",
			code: `// !focus(3:5)
${arrayWithMeaning}`,
			startOffsetMs: -80,
		},
		{
			enterOn: "name snacks",
			code: `// !focus(2,"snacks")
${arrayWithMeaning}`,
		},
		{ enterOn: "To get one", code: indexAccess },
		{ enterOn: "JavaScript starts", emphasis: true },
		{
			enterOn: "snacks zero",
			code: `// !focus(7)
${indexAccess}`,
			startOffsetMs: -120,
		},
		{
			enterOn: "Snacks one",
			code: `// !focus(8)
${indexAccess}`,
			startOffsetMs: -120,
		},
		{ enterOn: "feels strange", emphasis: true },
		{ enterOn: "important rule", code: indexAddress },
		{
			enterOn: "index is",
			code: `// !focus(1,4)
${indexAddress}`,
			startOffsetMs: -120,
		},
		{ enterOn: "payoff starts", code: lengthPayoff },
		{
			enterOn: "snacks dot length",
			code: `// !focus(7:8)
${lengthPayoff}`,
			startOffsetMs: -140,
		},
		{ enterOn: "same work", code: mapPayoff },
		{
			enterOn: "Map means",
			code: `// !focus(7:9)
${mapPayoff}`,
			startOffsetMs: -120,
		},
		{
			enterOn: "every snack becomes",
			code: `// !focus(8)
${mapPayoff}`,
			startOffsetMs: -100,
		},
		{ enterOn: "does not need", code: finalRule },
		{ enterOn: "one name for the collection", code: finalRule },
		{ enterOn: "Use arrays", emphasis: true },
		{ enterOn: "all these related", code: finalRule },
	],
};

const getTransitionKind = (previousCode: string | undefined, code: string) => {
	if (!previousCode) return "none";
	return stripFocusAnnotationLines(previousCode) ===
		stripFocusAnnotationLines(code)
		? "focus"
		: "code";
};

type TimedSlide = ReturnType<typeof buildSlidesWithTimestamps>[number];

async function buildSlidesWithRenderModels(slides: TimedSlide[]) {
	let previousModel: ReturnType<typeof createCodeRenderModel> | undefined;
	let previousCode: string | undefined;

	const renderedSlides = [];
	for (const slide of slides) {
		if (!slide.code) {
			renderedSlides.push(slide);
			continue;
		}

		const highlighted = await processSnippet({
			code: slide.code,
			language: pipeline.language,
			theme: THEME,
		});
		const codeRenderModel = createCodeRenderModel({
			code: highlighted,
			layout: resolveCodeLayout(slide.code),
			previousModel,
			transitionKind: getTransitionKind(previousCode, slide.code),
		});
		renderedSlides.push({ ...slide, codeRenderModel });
		previousModel = codeRenderModel;
		previousCode = slide.code;
	}

	return renderedSlides;
}

function requireEnv(name: string) {
	const value = process.env[name]?.trim();
	if (!value) throw new Error(`Missing ${name}.`);
	return value;
}

async function generateElevenLabsAudio() {
	const client = new ElevenLabsClient({
		apiKey: requireEnv("ELEVENLABS_API_KEY"),
	});
	const response = await client.textToSpeech.convertWithTimestamps(VOICE_ID, {
		modelId: MODEL_ID,
		outputFormat: "mp3_44100_128",
		text: voiceover,
		voiceSettings: {
			similarityBoost: 0.82,
			speed: 0.92,
			stability: 0.42,
			style: 0.38,
			useSpeakerBoost: true,
		},
	});
	const audioBuffer = Buffer.from(response.audioBase64, "base64");
	const rawWordCaptions = elevenlabsToTimedCaptions(
		response as AudioWithTimestampsResponse,
	);
	const wordCaptions = alignSourceTextToCaptions(
		restorePunctuationFromSourceText(rawWordCaptions, voiceover),
		voiceover,
	);
	return { audioBuffer, wordCaptions };
}

async function copyStaticAssets() {
	await mkdir(join(OUTPUT_ROOT, "staticVideoAssets", "fonts"), {
		recursive: true,
	});
	await mkdir(join(OUTPUT_ROOT, "staticVideoAssets", "sfx"), {
		recursive: true,
	});
	await mkdir(join(OUTPUT_ROOT, "brainjuice", "runtime", "gsap", "3.14.2"), {
		recursive: true,
	});
	await mkdir(
		join(
			OUTPUT_ROOT,
			"brainjuice",
			"runtime",
			"hyperframes",
			"brainjuice-hf-0.6.29-9",
			"runtime",
		),
		{ recursive: true },
	);
	await mkdir(ASSETS_DIR, { recursive: true });
	for (const fontFile of [
		"anton-400.woff2",
		"inter-400.woff2",
		"inter-700.woff2",
		"inter-900.woff2",
		"jetbrains-mono-400.woff2",
		"jetbrains-mono-500.woff2",
	]) {
		await copyFile(
			join(FONT_ASSETS_ROOT, fontFile),
			join(OUTPUT_ROOT, "staticVideoAssets", "fonts", fontFile),
		);
	}
	await copyFile(
		join(STATIC_ASSETS_ROOT, "sfx", "remotion-mouse-click.m4a"),
		join(OUTPUT_ROOT, "staticVideoAssets", "sfx", "remotion-mouse-click.m4a"),
	);
	await copyFile(
		join(STATIC_ASSETS_ROOT, "sfx", "code-keyboard-transition-sfx.m4a"),
		join(
			OUTPUT_ROOT,
			"staticVideoAssets",
			"sfx",
			"code-keyboard-transition-sfx.m4a",
		),
	);
	await copyFile(
		join(
			STATIC_ASSETS_ROOT,
			"music",
			"backgroundMusic",
			"kalimba-thumb-piano.m4a",
		),
		join(ASSETS_DIR, "kalimba-thumb-piano.m4a"),
	);
	await copyFile(
		join(HONO_ROOT, "node_modules", "gsap", "dist", "gsap.min.js"),
		join(
			OUTPUT_ROOT,
			"brainjuice",
			"runtime",
			"gsap",
			"3.14.2",
			"gsap-3.14.2.min.js",
		),
	);
	await copyFile(
		join(
			HONO_ROOT,
			"packages",
			"brainjuice-hyperframes",
			"core",
			"dist",
			"hyperframe.runtime.iife.js",
		),
		join(
			OUTPUT_ROOT,
			"brainjuice",
			"runtime",
			"hyperframes",
			"brainjuice-hf-0.6.29-9",
			"runtime",
			"hyperframe.runtime.brainjuice-hf-0.6.29-9.iife.js",
		),
	);
}

async function main() {
	await copyStaticAssets();
	const { audioBuffer, wordCaptions } = await generateElevenLabsAudio();
	await writeFile(join(OUTPUT_ROOT, AUDIO_FILE_NAME), audioBuffer);
	const media = await analyzeMediaBufferWithFfprobe({
		data: audioBuffer,
		storagePath: "audio.mp3",
	});
	const audioDurationMs = Math.round((media.durationSeconds ?? 0) * 1000);
	const captions = createSentenceAwareTikTokCaptions({
		captions: wordCaptions,
		combineTokensWithinMilliseconds: 700,
	});
	const timedSlides = buildSlidesWithTimestamps({
		captions: wordCaptions,
		slides: pipeline.slides,
	});
	const renderedSlides = await buildSlidesWithRenderModels(timedSlides);
	const compiled = compileCodeHikeTemplateToHyperframesHtml(
		{
			audioDurationMs,
			audioFilePath: AUDIO_FILE_NAME,
			backgroundMusicFilePath: "assets/kalimba-thumb-piano.m4a",
			backgroundMusicVolume: 0.055,
			captions,
			codeTransitionSfxFilePath:
				"staticVideoAssets/sfx/code-keyboard-transition-sfx.m4a",
			language: pipeline.language,
			slides: renderedSlides,
			theme: THEME,
			transitionSfxFilePath: "staticVideoAssets/sfx/remotion-mouse-click.m4a",
			voiceover,
		},
		{ videoSeed: "beginner-js-arrays-codehike" },
	);
	const html = compiled.html
		.replaceAll(
			`"Roboto Mono", "JetBrains Mono", "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", monospace`,
			`"JetBrains Mono", monospace`,
		)
		.replaceAll(
			`Anton, Impact, "Arial Black", sans-serif`,
			`"Anton", sans-serif`,
		)
		.replace(
			"<style>",
			"<style>@font-face{font-family:'Anton';font-style:normal;font-weight:400;font-display:swap;src:url('staticVideoAssets/fonts/anton-400.woff2') format('woff2');}",
		);
	await writeFile(join(OUTPUT_ROOT, "index.html"), html);
	await writeFile(
		join(OUTPUT_ROOT, "hyperframes.json"),
		`${JSON.stringify(
			{
				$schema: "https://hyperframes.heygen.com/schema/hyperframes.json",
				registry:
					"https://raw.githubusercontent.com/heygen-com/hyperframes/main/registry",
				paths: {
					assets: "assets",
					blocks: "compositions",
					components: "compositions/components",
				},
			},
			null,
			2,
		)}\n`,
	);
	await writeFile(
		join(OUTPUT_ROOT, "assets", "pipeline.json"),
		`${JSON.stringify(pipeline, null, 2)}\n`,
	);
	await writeFile(
		join(OUTPUT_ROOT, "assets", "timing.json"),
		`${JSON.stringify(
			{
				audioDurationMs,
				compiledDurationSeconds: compiled.durationSeconds,
				modelId: MODEL_ID,
				slideCount: renderedSlides.length,
				voiceId: VOICE_ID,
				wordCount: voiceover.split(/\s+/).length,
			},
			null,
			2,
		)}\n`,
	);
	console.info("[beginner-arrays-codehike] generated", {
		audioDurationMs,
		compiledDurationSeconds: compiled.durationSeconds,
		outputRoot: OUTPUT_ROOT,
		slideCount: renderedSlides.length,
	});
}

await main();
