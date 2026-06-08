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
	"9 Beginner JS Conditionals CodeHike",
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
	"Code often needs to make a decision.",
	"Should we show one message, or a different message?",
	"That is what an if else statement is for.",
	"Start with one input value.",
	"Here the input is age.",
	"Now ask a yes or no question about that value.",
	"Is age greater than or equal to eighteen?",
	"The comparison operator is this part.",
	"It compares left with right.",
	"If the question is true, JavaScript runs the first block.",
	"In this case, the result becomes access granted.",
	"If the question is false, JavaScript skips that block.",
	"Then it runs the else block instead.",
	"Now the result becomes ask an adult.",
	"The braces group the lines that belong to each path.",
	"Only one path runs.",
	"When age is sixteen, the question is false.",
	"So JavaScript chooses else.",
	"When age is twenty one, the question is true.",
	"So JavaScript chooses if.",
	"The mental model is simple.",
	"An if statement asks a question.",
	"The if block is the yes path.",
	"The else block is the no path.",
	"Conditionals are how code makes decisions.",
].join(" ");

const emptyDecision = `let age = 16;
let message;
`;

const questionOnly = `let age = 16;
let message;

age >= 18
`;

const ifShell = `let age = 16;
let message;

if (age >= 18) {
  message = "Access granted";
}
`;

const ifElseDecision = `let age = 16;
let message;

if (age >= 18) {
  message = "Access granted";
}
else {
  message = "Ask an adult";
}
`;

const falsePath = `let age = 16;
let message;

if (age >= 18) {
  message = "Access granted";
}
else {
  message = "Ask an adult";
}
`;

const truePath = `let age = 21;
let message;

if (age >= 18) {
  message = "Access granted";
}
`;

const mentalModel = `if (question) {
  // yes path
} else {
  // no path
}
`;

const pipeline: CodeHikePipeline = {
	language: "javascript",
	voiceover,
	slides: [
		{ enterOn: "Code often needs", emphasis: true },
		{ enterOn: "one message", emphasis: true },
		{ enterOn: "if else statement", code: mentalModel },
		{ enterOn: "Start with one input value", emphasis: true },
		{ enterOn: "Here the input is age", code: emptyDecision },
		{
			enterOn: "the input is age",
			code: `// !focus(1,"age")
${emptyDecision}`,
		},
		{ enterOn: "yes or no question", code: questionOnly },
		{
			enterOn: "greater than or equal",
			code: `// !focus(4,"age >= 18")
${questionOnly}`,
		},
		{
			enterOn: "comparison operator",
			code: `// !focus(4,">=")
${questionOnly}`,
			startOffsetMs: -120,
		},
		{
			enterOn: "left with right",
			code: `// !focus(4,"age >= 18")
${questionOnly}`,
		},
		{ enterOn: "If the question is true", code: ifShell },
		{
			enterOn: "first block",
			code: `// !focus(4:6)
${ifShell}`,
			startOffsetMs: -100,
		},
		{
			enterOn: "access granted",
			code: `// !focus(5)
${ifShell}`,
		},
		{ enterOn: "If the question is false", code: ifElseDecision },
		{
			enterOn: "skips that block",
			code: `// !focus(4:6)
${ifElseDecision}`,
		},
		{
			enterOn: "else block",
			code: `// !focus(7:9)
${ifElseDecision}`,
			startOffsetMs: -120,
		},
		{
			enterOn: "Ask an adult",
			code: `// !focus(8)
${ifElseDecision}`,
		},
		{
			enterOn: "The braces group",
			code: `// !focus(4,6,7,9)
${ifElseDecision}`,
		},
		{
			enterOn: "group the lines",
			code: `// !focus(4:9)
${ifElseDecision}`,
		},
		{ enterOn: "Only one path", emphasis: true },
		{
			enterOn: "age is sixteen",
			code: `// !focus(1)
${falsePath}`,
		},
		{
			enterOn: "sixteen, the question is false",
			code: `// !focus(4,"age >= 18")
${falsePath}`,
		},
		{
			enterOn: "chooses else",
			code: `// !focus(7:9)
${falsePath}`,
		},
		{ enterOn: "age is twenty one", emphasis: true },
		{
			enterOn: "twenty one, the question is true",
			code: `// !focus(4,"age >= 18")
${truePath}`,
		},
		{
			enterOn: "chooses if",
			code: `// !focus(4:6)
${truePath}`,
		},
		{ enterOn: "mental model", code: mentalModel },
		{
			enterOn: "asks a question",
			code: `// !focus(1,"question")
${mentalModel}`,
		},
		{
			enterOn: "yes path",
			code: `// !focus(2)
${mentalModel}`,
		},
		{
			enterOn: "no path",
			code: `// !focus(4)
${mentalModel}`,
		},
		{ enterOn: "code makes decisions", emphasis: true },
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
		{ videoSeed: "beginner-js-conditionals-codehike" },
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
		.replaceAll("opacity:0.24", "opacity:0.38")
		.replaceAll(`data-from-opacity="0.24"`, `data-from-opacity="0.38"`)
		.replaceAll(`data-to-opacity="0.24"`, `data-to-opacity="0.38"`)
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
	console.info("[beginner-conditionals-codehike] generated", {
		audioDurationMs,
		compiledDurationSeconds: compiled.durationSeconds,
		outputRoot: OUTPUT_ROOT,
		slideCount: renderedSlides.length,
	});
}

await main();
