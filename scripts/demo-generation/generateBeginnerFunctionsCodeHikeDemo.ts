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
	"7 Beginner JS Functions CodeHike",
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
	"This code is not broken.",
	"That is why beginners often leave it alone.",
	"But it has a hidden cost.",
	"The same two lines are copied three times.",
	"Only the name changes.",
	"When copied code changes later, you have to fix every copy.",
	"Miss one, and the program starts saying two different things.",
	"A function solves that by giving the repeated idea a name.",
	"First, look for the repeated shape.",
	"Each block says hi to someone.",
	"Then it prints the same welcome message.",
	"The changing part is the person's name.",
	"That changing part becomes a parameter.",
	"We write function greet, with name inside the parentheses.",
	"Inside the function, we keep the repeated lines once.",
	"Then we use name where the real name should go.",
	"Now the code has a reusable instruction.",
	"Calling greet with Maya runs the two lines for Maya.",
	"Calling greet with Sam runs the same two lines for Sam.",
	"Calling greet with Ari does it again.",
	"The function is the recipe.",
	"The argument is the ingredient you hand to the recipe.",
	"So the mental model is simple.",
	"Put repeated steps inside a function.",
	"Put changing values in parameters.",
	"Then call the function whenever you need those steps again.",
].join(" ");

const duplicatedGreetings = `const firstName = "Maya";
console.log("Hi, " + firstName + "!");
console.log("Welcome to JavaScript.");

const secondName = "Sam";
console.log("Hi, " + secondName + "!");
console.log("Welcome to JavaScript.");

const thirdName = "Ari";
console.log("Hi, " + thirdName + "!");
console.log("Welcome to JavaScript.");
`;

const repeatedShape = `console.log("Hi, " + firstName + "!");
console.log("Welcome to JavaScript.");

console.log("Hi, " + secondName + "!");
console.log("Welcome to JavaScript.");

console.log("Hi, " + thirdName + "!");
console.log("Welcome to JavaScript.");
`;

const shapeWithBlank = `console.log("Hi, " + name + "!");
console.log("Welcome to JavaScript.");
`;

const extractedFunction = `function greet(name) {
  console.log("Hi, " + name + "!");
  console.log("Welcome to JavaScript.");
}
`;

const firstCall = `function greet(name) {
  console.log("Hi, " + name + "!");
  console.log("Welcome to JavaScript.");
}

greet("Maya");
`;

const multipleCalls = `function greet(name) {
  console.log("Hi, " + name + "!");
  console.log("Welcome to JavaScript.");
}

greet("Maya");
greet("Sam");
greet("Ari");
`;

const finalModel = `// A function is a reusable recipe
function greet(name) {
  console.log("Hi, " + name + "!");
  console.log("Welcome to JavaScript.");
}

// Arguments fill in the changing parts
greet("Maya");
greet("Sam");
greet("Ari");
`;

const pipeline: CodeHikePipeline = {
	language: "typescript",
	voiceover,
	slides: [
		{ enterOn: "This code is not", emphasis: true },
		{ enterOn: "That is why", code: duplicatedGreetings },
		{ enterOn: "hidden cost", emphasis: true },
		{ enterOn: "same two lines", code: duplicatedGreetings },
		{
			enterOn: "same two lines",
			code: `// !focus(2:3,6:7,10:11)
${duplicatedGreetings}`,
			startOffsetMs: 480,
		},
		{
			enterOn: "Only the name",
			code: `// !focus(1,5,9)
${duplicatedGreetings}`,
		},
		{ enterOn: "copied code changes", code: duplicatedGreetings },
		{ enterOn: "Miss one", emphasis: true },
		{ enterOn: "A function solves", emphasis: true },
		{ enterOn: "look for the repeated shape", code: repeatedShape },
		{
			enterOn: "Each block says hi",
			code: `// !focus(1,4,7)
${repeatedShape}`,
		},
		{
			enterOn: "same welcome message",
			code: `// !focus(2,5,8)
${repeatedShape}`,
		},
		{
			enterOn: "changing part",
			code: `// !focus(1,"firstName")
// !focus(4,"secondName")
// !focus(7,"thirdName")
${repeatedShape}`,
		},
		{ enterOn: "becomes a parameter", code: shapeWithBlank },
		{
			enterOn: "function greet",
			code: `// !focus(1)
${extractedFunction}`,
		},
		{
			enterOn: "inside the parentheses",
			code: `// !focus(1,"name")
${extractedFunction}`,
			startOffsetMs: 320,
		},
		{
			enterOn: "repeated lines once",
			code: `// !focus(2:3)
${extractedFunction}`,
		},
		{
			enterOn: "use name",
			code: `// !focus(2,"name")
${extractedFunction}`,
		},
		{ enterOn: "reusable instruction", code: extractedFunction },
		{
			enterOn: "Calling greet with Maya",
			code: `// !focus(6)
${firstCall}`,
		},
		{
			enterOn: "two lines for Maya",
			code: `// !focus(2:3,6)
${firstCall}`,
			startOffsetMs: 160,
		},
		{
			enterOn: "Calling greet with Sam",
			code: `// !focus(7)
${multipleCalls}`,
		},
		{
			enterOn: "Calling greet with Ari",
			code: `// !focus(8)
${multipleCalls}`,
		},
		{ enterOn: "function is the recipe", emphasis: true },
		{ enterOn: "argument is the ingredient", code: multipleCalls },
		{
			enterOn: "argument is the ingredient",
			code: `// !focus(6,"\\"Maya\\"")
// !focus(7,"\\"Sam\\"")
// !focus(8,"\\"Ari\\"")
${multipleCalls}`,
			startOffsetMs: 220,
		},
		{ enterOn: "mental model is simple", emphasis: true },
		{ enterOn: "Put repeated steps", code: finalModel },
		{
			enterOn: "repeated steps",
			code: `// !focus(2:5)
${finalModel}`,
		},
		{
			enterOn: "changing values",
			code: `// !focus(2,"name")
// !focus(8,"\\"Maya\\"")
// !focus(9,"\\"Sam\\"")
// !focus(10,"\\"Ari\\"")
${finalModel}`,
		},
		{ enterOn: "call the function", code: finalModel },
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
		{ videoSeed: "beginner-functions-onboarding" },
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
	console.info("[beginner-functions-codehike] generated", {
		audioDurationMs,
		compiledDurationSeconds: compiled.durationSeconds,
		outputRoot: OUTPUT_ROOT,
		slideCount: renderedSlides.length,
	});
}

await main();
