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
	"10 Beginner JS Loops CodeHike",
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
	"Loops are for doing the same action more than once.",
	"That sounds small.",
	"But it changes how beginners read code.",
	"Without a loop, three plants means three statements.",
	"Water plant one.",
	"Water plant two.",
	"Water plant three.",
	"This works, but the pattern is doing the thinking for us.",
	"If the list becomes twenty plants, copying lines becomes the bug.",
	"So we give the computer a small plan.",
	"Start with a number.",
	"Keep going while the number is still small enough.",
	"After each turn, move to the next number.",
	"That number is the loop variable.",
	"The condition decides whether the loop keeps running.",
	"The update changes the variable so the loop can eventually stop.",
	"Now the repeated action lives in one place.",
	"Print the current plant number.",
	"Then update the number.",
	"A for loop puts the three loop parts on one line.",
	"Start at one.",
	"Stop at three.",
	"Add one after every turn.",
	"That is the classic loop shape.",
	"But beginners do not always need the classic shape.",
	"When you already have a list, use the list directly.",
	"Here the array names the things we care about.",
	"For each plant in the array, run the same action.",
	"No counter math.",
	"No less-than-or-equal detail.",
	"Just one item at a time.",
	"Loops are not magic.",
	"They are instructions for repeating a small, clear step.",
].join(" ");

const repeatedStatements = `console.log("Water plant 1");
console.log("Water plant 2");
console.log("Water plant 3");
`;

const loopParts = `let plant = 1;

while (plant <= 3) {
  console.log("Water plant " + plant);
  plant = plant + 1;
}
`;

const forLoop = `for (let n = 1; n <= 3; n++) {
  console.log("Water plant " + n);
}
`;

const plantsArray = `const plants = ["basil", "mint", "thyme"];

for (const plant of plants) {
  console.log("Water " + plant);
}
`;

const finalRule = `const plants = ["basil", "mint", "thyme"];

// Repeat a step with a loop
for (const plant of plants) {
  console.log("Water " + plant);
}
`;

const pipeline: CodeHikePipeline = {
	language: "typescript",
	voiceover,
	slides: [
		{ enterOn: "Loops are for", emphasis: true },
		{ enterOn: "But it changes", emphasis: true },
		{ enterOn: "Without a loop", code: repeatedStatements },
		{
			enterOn: "Water plant one",
			code: `// !focus(1)
${repeatedStatements}`,
		},
		{
			enterOn: "Water plant two",
			code: `// !focus(2)
${repeatedStatements}`,
		},
		{
			enterOn: "Water plant three",
			code: `// !focus(3)
${repeatedStatements}`,
		},
		{ enterOn: "This works", code: repeatedStatements },
		{ enterOn: "copying lines", emphasis: true },
		{ enterOn: "So we give", code: loopParts },
		{
			enterOn: "Start with a number",
			code: `// !focus(1)
${loopParts}`,
		},
		{
			enterOn: "Keep going",
			code: `// !focus(3)
${loopParts}`,
			startOffsetMs: -120,
		},
		{
			enterOn: "After each turn",
			code: `// !focus(5)
${loopParts}`,
			startOffsetMs: -120,
		},
		{
			enterOn: "That number is",
			code: `// !focus(1,"plant")
${loopParts}`,
		},
		{
			enterOn: "The condition",
			code: `// !focus(3,"plant <= 3")
${loopParts}`,
		},
		{
			enterOn: "The update",
			code: `// !focus(5)
${loopParts}`,
		},
		{ enterOn: "Now the repeated", code: loopParts },
		{
			enterOn: "Print the current",
			code: `// !focus(4)
${loopParts}`,
		},
		{
			enterOn: "Then update",
			code: `// !focus(5)
${loopParts}`,
		},
		{ enterOn: "A for loop", code: forLoop },
		{
			enterOn: "Start at one",
			code: `// !focus(1,"let n = 1")
${forLoop}`,
		},
		{
			enterOn: "Stop at three",
			code: `// !focus(1,"n <= 3")
${forLoop}`,
		},
		{
			enterOn: "Add one",
			code: `// !focus(1,"n++")
${forLoop}`,
		},
		{ enterOn: "classic loop shape", emphasis: true },
		{ enterOn: "But beginners", emphasis: true },
		{ enterOn: "When you already", code: plantsArray },
		{
			enterOn: "Here the array",
			code: `// !focus(1)
${plantsArray}`,
		},
		{
			enterOn: "For each plant",
			code: `// !focus(3)
${plantsArray}`,
		},
		{ enterOn: "No counter math", emphasis: true },
		{ enterOn: "No less-than-or-equal", emphasis: true },
		{
			enterOn: "Just one item",
			code: `// !focus(3,"plant")
${plantsArray}`,
		},
		{ enterOn: "Loops are not", emphasis: true },
		{ enterOn: "clear step", code: finalRule },
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
		{ videoSeed: "beginner-js-loops-codehike" },
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
	console.info("[beginner-loops-codehike] generated", {
		audioDurationMs,
		compiledDurationSeconds: compiled.durationSeconds,
		outputRoot: OUTPUT_ROOT,
		slideCount: renderedSlides.length,
	});
}

await main();
