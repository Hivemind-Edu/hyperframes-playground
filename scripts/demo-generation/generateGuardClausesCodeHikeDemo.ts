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
	"5 Guard Clauses CodeHike",
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
	"This function works.",
	"And that is why it is easy to miss the problem.",
	"Every check pushes the real work one level deeper.",
	"First the cart has to be valid.",
	"Then the user has to be logged in.",
	"Then the payment method has to exist.",
	"By the time we finally charge the card, your brain is holding three unfinished if statements at once.",
	"That shape is called the pyramid of doom.",
	"The fix is not clever.",
	"It is just honest.",
	"Handle the boring failure cases immediately.",
	"If the cart is empty, leave.",
	"Now that case is done.",
	"If the user is not logged in, leave.",
	"Another branch disappears.",
	"If there is no payment method, leave.",
	"Now look at the bottom.",
	"The happy path is flat.",
	"Notice what did not change.",
	"The behavior is the same.",
	"The order is easier to read.",
	"No else blocks.",
	"No mental stack.",
	"Just the real work.",
	"Guard clauses are not about fewer lines.",
	"They are about fewer things in your head.",
].join(" ");

const nestedCheckout = `function checkout(cart, user) {
  if (cart.items.length > 0) {
    if (user.isLoggedIn) {
      if (user.hasPaymentMethod) {
        return charge(cart, user);
      } else {
        return "Add payment method";
      }
    } else {
      return "Log in first";
    }
  } else {
    return "Cart is empty";
  }
}
`;

const firstGuard = `function checkout(cart, user) {
  if (cart.items.length === 0) {
    return "Cart is empty";
  }

  if (user.isLoggedIn) {
    if (user.hasPaymentMethod) {
      return charge(cart, user);
    } else {
      return "Add payment method";
    }
  } else {
    return "Log in first";
  }
}
`;

const secondGuard = `function checkout(cart, user) {
  if (cart.items.length === 0) {
    return "Cart is empty";
  }

  if (!user.isLoggedIn) {
    return "Log in first";
  }

  if (user.hasPaymentMethod) {
    return charge(cart, user);
  } else {
    return "Add payment method";
  }
}
`;

const finalGuard = `function checkout(cart, user) {
  if (cart.items.length === 0) {
    return "Cart is empty";
  }

  if (!user.isLoggedIn) {
    return "Log in first";
  }

  if (!user.hasPaymentMethod) {
    return "Add payment method";
  }

  return charge(cart, user);
}
`;

const pipeline: CodeHikePipeline = {
	language: "typescript",
	voiceover,
	slides: [
		{ enterOn: "This function works", emphasis: true },
		{ enterOn: "And that is why", code: nestedCheckout },
		{
			enterOn: "Every check pushes",
			code: `// !focus(2,3,4)
${nestedCheckout}`,
			startOffsetMs: -120,
		},
		{ enterOn: "First the cart", code: nestedCheckout },
		{
			enterOn: "First the cart",
			code: `// !focus(2,"cart.items.length > 0")
${nestedCheckout}`,
			startOffsetMs: 430,
		},
		{ enterOn: "Then the user", code: nestedCheckout },
		{
			enterOn: "Then the user",
			code: `// !focus(3,"user.isLoggedIn")
${nestedCheckout}`,
			startOffsetMs: 360,
		},
		{ enterOn: "Then the payment", code: nestedCheckout },
		{
			enterOn: "Then the payment",
			code: `// !focus(4,"user.hasPaymentMethod")
${nestedCheckout}`,
			startOffsetMs: 360,
		},
		{ enterOn: "By the time", code: nestedCheckout },
		{
			enterOn: "charge the card",
			code: `// !focus(5)
${nestedCheckout}`,
			startOffsetMs: -140,
		},
		{ enterOn: "three unfinished if", emphasis: true },
		{ enterOn: "pyramid of doom", emphasis: true },
		{ enterOn: "The fix", code: nestedCheckout },
		{ enterOn: "Handle the boring", emphasis: true },
		{ enterOn: "If the cart is empty", code: firstGuard },
		{
			enterOn: "If the cart is empty",
			code: `// !focus(2:4)
${firstGuard}`,
			startOffsetMs: 720,
		},
		{ enterOn: "Now that case", code: firstGuard },
		{ enterOn: "If the user is not", code: secondGuard },
		{
			enterOn: "If the user is not",
			code: `// !focus(6:8)
${secondGuard}`,
			startOffsetMs: 820,
		},
		{ enterOn: "Another branch", code: secondGuard },
		{ enterOn: "If there is no payment", code: finalGuard },
		{
			enterOn: "If there is no payment",
			code: `// !focus(10:12)
${finalGuard}`,
			startOffsetMs: 760,
		},
		{ enterOn: "Now look at", code: finalGuard },
		{
			enterOn: "The happy path",
			code: `// !focus(14)
${finalGuard}`,
			startOffsetMs: -120,
		},
		{ enterOn: "Notice what did not", code: finalGuard },
		{
			enterOn: "The behavior",
			code: `// !focus(2:4,6:8,10:12,14)
${finalGuard}`,
			startOffsetMs: -80,
		},
		{ enterOn: "The order", code: finalGuard },
		{ enterOn: "No else", emphasis: true },
		{ enterOn: "Just the real", code: finalGuard },
		{ enterOn: "Guard clauses are not", emphasis: true },
		{ enterOn: "They are about", code: finalGuard },
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
		{ videoSeed: "guard-clauses-onboarding" },
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
	console.info("[guard-clauses-codehike] generated", {
		audioDurationMs,
		compiledDurationSeconds: compiled.durationSeconds,
		outputRoot: OUTPUT_ROOT,
		slideCount: renderedSlides.length,
	});
}

await main();
