import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { GoogleGenAI } from "/Users/mark/hivemind/hivemind-hono/node_modules/@google/genai/dist/node/index.mjs";

type SlidePlan = {
	model: {
		aspectRatio: "9:16";
		image: string;
		thinkingLevel: "high" | "low" | "medium";
	};
	slides: Array<{
		imagePrompt: string;
		index: number;
		text: string;
	}>;
	stylePrompt: string;
};

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectDir = dirname(__dirname);
const assetsDir = join(projectDir, "assets");
const slidesDir = join(assetsDir, "slides");
const planPath = join(projectDir, "prompts", "slide-plan.json");

const slideArg = process.argv.find((arg) => arg.startsWith("--slide="));
const slideNumber = slideArg ? Number(slideArg.split("=")[1]) : 7;

if (!Number.isInteger(slideNumber) || slideNumber < 1 || slideNumber > 9) {
	throw new Error(`Expected --slide=1..9, got ${slideArg ?? "(none)"}`);
}

const apiKey =
	process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GOOGLE_API_KEY;

if (!apiKey) {
	throw new Error("Missing GOOGLE_GENERATIVE_AI_API_KEY or GOOGLE_API_KEY");
}

const plan = JSON.parse(await readFile(planPath, "utf8")) as SlidePlan;
const slide = plan.slides.find((candidate) => candidate.index === slideNumber - 1);

if (!slide) {
	throw new Error(`Missing slide ${slideNumber} in ${planPath}`);
}

const prompt = `${slide.imagePrompt}

Regenerate this as a clean standalone slide image for a POV slideshow.

Important composition requirements:
- Full-bleed 9:16 portrait image.
- Photorealistic iPhone photo, as if shot with an iPhone rear camera.
- Preserve the documentary Roman siege-of-Alesia setting from the surrounding slideshow.
- No border, no panel divider, no gutter, no margin, no letterboxing.
- No text, no labels, no captions inside the image.
- No gore, no fantasy armor, no modern objects.

Global style:
${plan.stylePrompt}`;

const model = plan.model.image;
const aspectRatio = plan.model.aspectRatio;
const imageSize = "1K";
const thinkingLevel = plan.model.thinkingLevel;
const outputPath = join(
	slidesDir,
	`slide-${String(slideNumber).padStart(2, "0")}.jpg`,
);
const metadataPath = join(
	slidesDir,
	`slide-${String(slideNumber).padStart(2, "0")}-nb2-1k.json`,
);

await mkdir(slidesDir, { recursive: true });

const ai = new GoogleGenAI({
	apiKey,
	vertexai: false,
});

const startedAt = performance.now();
const response = await ai.models.generateContent({
	model,
	contents: [
		{
			parts: [{ text: prompt }],
			role: "user",
		},
	],
	config: {
		imageConfig: {
			aspectRatio,
			imageSize,
		},
		responseModalities: ["Image"],
		thinkingConfig: { thinkingLevel },
	},
});
const latencyMs = Math.round(performance.now() - startedAt);

let imageData: string | undefined;
let mimeType = "image/jpeg";
for (const part of response.candidates?.[0]?.content?.parts ?? []) {
	if (part.inlineData?.data) {
		imageData = part.inlineData.data;
		mimeType = part.inlineData.mimeType ?? mimeType;
	}
}

if (!imageData) {
	throw new Error(
		`No image data returned from ${model}: ${JSON.stringify(response).slice(0, 1200)}`,
	);
}

await writeFile(outputPath, Buffer.from(imageData, "base64"));
await writeFile(
	metadataPath,
	JSON.stringify(
		{
			aspectRatio,
			generatedAt: new Date().toISOString(),
			imageSize,
			latencyMs,
			latencySeconds: Number((latencyMs / 1000).toFixed(3)),
			mimeType,
			model,
			outputPath,
			prompt,
			slideNumber,
			thinkingLevel,
			usageMetadata: response.usageMetadata ?? null,
		},
		null,
		2,
	),
);

console.log(
	JSON.stringify(
		{
			latencySeconds: Number((latencyMs / 1000).toFixed(3)),
			metadataPath,
			outputPath,
			slideNumber,
		},
		null,
		2,
	),
);
