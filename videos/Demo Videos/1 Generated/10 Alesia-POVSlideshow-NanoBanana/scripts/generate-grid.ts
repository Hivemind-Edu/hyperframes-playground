import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { GoogleGenAI } from "/Users/mark/hivemind/hivemind-hono/node_modules/@google/genai/dist/node/index.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectDir = dirname(__dirname);
const assetsDir = join(projectDir, "assets");
const promptPath = join(projectDir, "prompts", "nano-banana-3x3-grid-nb2-4k.txt");
const outputPath = join(assetsDir, "alesia-3x3-grid-nb2-4k.jpg");
const metadataPath = join(assetsDir, "alesia-3x3-grid-nb2-4k.json");

const model = "gemini-3.1-flash-image";
const aspectRatio = "9:16";
const imageSize = "4K";
const thinkingLevel = "high";

const apiKey =
	process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GOOGLE_API_KEY;

if (!apiKey) {
	throw new Error("Missing GOOGLE_GENERATIVE_AI_API_KEY or GOOGLE_API_KEY");
}

const ai = new GoogleGenAI({
	apiKey,
	vertexai: false,
});

await mkdir(assetsDir, { recursive: true });

const prompt = await readFile(promptPath, "utf8");
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
			promptPath,
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
			model,
			outputPath,
		},
		null,
		2,
	),
);
