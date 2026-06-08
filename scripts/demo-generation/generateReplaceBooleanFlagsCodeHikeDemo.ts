import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import type { AudioWithTimestampsResponse } from "@elevenlabs/elevenlabs-js/api";
import { mkdir, writeFile, copyFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { alignSourceTextToCaptions } from "../../../hivemind-hono/src/brainjuice/utils/captions/alignSourceTextToCaptions";
import { createSentenceAwareTikTokCaptions } from "../../../hivemind-hono/src/brainjuice/utils/captions/createSentenceAwareTikTokCaptions";
import { restorePunctuationFromSourceText } from "../../../hivemind-hono/src/brainjuice/utils/captions/restorePunctuationFromSourceText";
import { elevenlabsToTimedCaptions } from "../../../hivemind-hono/src/brainjuice/utils/narration/elevenlabsToTimedCaptions";
import { analyzeMediaBufferWithFfprobe } from "../../../hivemind-hono/src/brainjuice/templateAssets/ffmpegMediaProcessor";
import { compileCodeHikeTemplateToHyperframesHtml } from "../../../hivemind-hono/src/brainjuice/templates/CodeHikeTemplate/compileArtifact";
import {
	buildSlidesWithTimestamps,
	type CodeHikePipeline,
} from "../../../hivemind-hono/src/brainjuice/templates/CodeHikeTemplate/pipeline";
import { resolveCodeLayout } from "../../../hivemind-hono/src/brainjuice/templates/CodeHikeTemplate/codeLayout";
import { createCodeRenderModel } from "../../../hivemind-hono/src/brainjuice/templates/CodeHikeTemplate/codeRenderModel";
import { stripFocusAnnotationLines } from "../../../hivemind-hono/src/brainjuice/templates/CodeHikeTemplate/codeAnnotationUtils";
import { processSnippet } from "../../../hivemind-hono/src/brainjuice/templates/CodeHikeTemplate/processSnippet";
import type { Theme } from "../../../hivemind-hono/src/brainjuice/templates/CodeHikeTemplate/theme";

const REPO_ROOT = resolve(import.meta.dir, "../../..");
const HONO_ROOT = join(REPO_ROOT, "hivemind-hono");
const PLAYGROUND_ROOT = join(REPO_ROOT, "hyperframes-playground");
const OUTPUT_ROOT = join(
	PLAYGROUND_ROOT,
	"videos",
	"Demo Videos",
	"0 Demo Videos",
	"6 Replace Boolean Flags CodeHike",
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
	"The bug is not inside this function.",
	"It is hiding at the call site.",
	"Render invoice, true, false.",
	"What does true mean?",
	"What does false mean?",
	"You cannot know without jumping away from the code you were reading.",
	"So you open the function.",
	"The first boolean means show prices.",
	"The second boolean means send the invoice by email.",
	"Now your brain has to carry a tiny translation table.",
	"True means visible.",
	"False means preview.",
	"That is the smell.",
	"A boolean flag is asking the reader to remember a secret.",
	"The first fix is simple.",
	"Give the flags names at the boundary.",
	"Now the call says price display visible, delivery preview.",
	"No guessing.",
	"No jumping.",
	"But there is one more step.",
	"When a flag chooses a different workflow, do not keep the flag.",
	"Name the workflows.",
	"Preview an invoice.",
	"Email an invoice.",
	"Now the caller chooses the behavior directly.",
	"The function name carries the intent.",
	"The options only describe details.",
	"Replace boolean flags when the meaning is not obvious from the call.",
	"The goal is not fewer booleans.",
	"The goal is code you can read without leaving the line.",
].join(" ");

const confusingCall = `render(invoice, true, false);
`;

const hiddenMeaning = `function renderInvoice(
  invoice,
  showPrices,
  sendEmail,
) {
  const html = buildInvoiceHtml(
    invoice,
    showPrices,
  );

  if (sendEmail) {
    return sendInvoiceEmail(html);
  }

  return showPreview(html);
}
`;

const namedOptionsCall = `renderInvoice(invoice, {
  priceDisplay: "visible",
  delivery: "preview",
});
`;

const namedOptionsFunction = `type RenderOptions = {
  priceDisplay: "visible" | "hidden";
  delivery: "preview" | "email";
};

function renderInvoice(
  invoice,
  options: RenderOptions,
) {
  if (options.delivery === "email") {
    return emailInvoice(invoice, options);
  }

  return previewInvoice(invoice, options);
}
`;

const namedWorkflows = `previewInvoice(invoice, {
  priceDisplay: "visible",
});

emailInvoice(invoice, {
  priceDisplay: "hidden",
});
`;

const splitWorkflows = `function previewInvoice(
  invoice,
  options,
) {
  return showPreview(invoice, options);
}

function emailInvoice(
  invoice,
  options,
) {
  return sendInvoiceEmail(invoice, options);
}
`;

const finalRule = `// Boolean flags hide intent
render(invoice, true, false);

// Named options reveal intent
renderInvoice(invoice, {
  priceDisplay: "visible",
  delivery: "preview",
});

// Named workflows reveal behavior
previewInvoice(invoice, {
  priceDisplay: "visible",
});
`;

const pipeline: CodeHikePipeline = {
	language: "typescript",
	voiceover,
	slides: [
		{ enterOn: "The bug is not", emphasis: true },
		{ enterOn: "It is hiding", code: confusingCall },
		{ enterOn: "Render invoice", code: confusingCall },
		{
			enterOn: "What does true",
			code: `// !focus(1,"true")
${confusingCall}`,
		},
		{
			enterOn: "What does false",
			code: `// !focus(1,"false")
${confusingCall}`,
		},
		{ enterOn: "without jumping", emphasis: true },
		{ enterOn: "So you open", code: hiddenMeaning },
		{
			enterOn: "first boolean",
			code: `// !focus(3)
${hiddenMeaning}`,
			startOffsetMs: -120,
		},
		{
			enterOn: "show prices",
			code: `// !focus(7:10)
${hiddenMeaning}`,
			startOffsetMs: 280,
		},
		{
			enterOn: "second boolean",
			code: `// !focus(4)
${hiddenMeaning}`,
			startOffsetMs: -120,
		},
		{
			enterOn: "send the invoice",
			code: `// !focus(12:14)
${hiddenMeaning}`,
			startOffsetMs: 220,
		},
		{ enterOn: "tiny translation", emphasis: true },
		{ enterOn: "True means", code: confusingCall },
		{ enterOn: "False means", code: confusingCall },
		{ enterOn: "That is the smell", emphasis: true },
		{ enterOn: "asking the reader", emphasis: true },
		{ enterOn: "The first fix", code: confusingCall },
		{ enterOn: "Give the flags", code: namedOptionsCall },
		{
			enterOn: "price display",
			code: `// !focus(2)
${namedOptionsCall}`,
		},
		{
			enterOn: "delivery preview",
			code: `// !focus(3)
${namedOptionsCall}`,
		},
		{ enterOn: "No guessing", emphasis: true },
		{ enterOn: "But there is", code: namedOptionsFunction },
		{
			enterOn: "different workflow",
			code: `// !focus(10:14)
${namedOptionsFunction}`,
			startOffsetMs: -160,
		},
		{ enterOn: "do not keep", emphasis: true },
		{ enterOn: "Name the workflows", code: namedWorkflows },
		{
			enterOn: "Preview an invoice",
			code: `// !focus(1)
${namedWorkflows}`,
		},
		{
			enterOn: "Email an invoice",
			code: `// !focus(5)
${namedWorkflows}`,
		},
		{ enterOn: "caller chooses", code: splitWorkflows },
		{
			enterOn: "function name carries",
			code: `// !focus(1,10)
${splitWorkflows}`,
		},
		{
			enterOn: "options only describe",
			code: `// !focus(3,12)
${splitWorkflows}`,
		},
		{ enterOn: "Replace boolean flags", code: finalRule },
		{ enterOn: "not obvious", code: finalRule },
		{ enterOn: "The goal is not", emphasis: true },
		{ enterOn: "without leaving", code: finalRule },
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
	let previousModel:
		| ReturnType<typeof createCodeRenderModel>
		| undefined;
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
	await mkdir(
		join(OUTPUT_ROOT, "brainjuice", "runtime", "gsap", "3.14.2"),
		{ recursive: true },
	);
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
		join(STATIC_ASSETS_ROOT, "music", "backgroundMusic", "kalimba-thumb-piano.m4a"),
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
		{ videoSeed: "replace-boolean-flags-onboarding" },
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
	console.info("[replace-boolean-flags-codehike] generated", {
		audioDurationMs,
		compiledDurationSeconds: compiled.durationSeconds,
		outputRoot: OUTPUT_ROOT,
		slideCount: renderedSlides.length,
	});
}

await main();
