import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { GoogleGenAI } from "/Users/mark/hivemind/hivemind-hono/node_modules/@google/genai/dist/node/index.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectDir = dirname(__dirname);
const promptPath = join(projectDir, "prompts", "scene-reference-grid-v2-borderless-nb2-4k.txt");
const characterReferencePath = join(
	projectDir,
	"assets",
	"characters",
	"skeleton-engineer-character-sheet-v7-barely-translucent-skin-nb2-2k.jpg",
);
const outputPath = join(projectDir, "assets", "scene-reference-grid-v2-borderless-nb2-4k.jpg");
const metadataPath = join(projectDir, "assets", "scene-reference-grid-v2-borderless-nb2-4k.json");

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
	vertexai: false,
	apiKey,
});

const prompt = await readFile(promptPath, "utf8");
const characterReference = (await readFile(characterReferencePath)).toString("base64");
await mkdir(join(projectDir, "assets"), { recursive: true });

const startedAt = performance.now();
const response = await ai.models.generateContent({
	model,
	contents: [
		{
			role: "user",
			parts: [
				{
					inlineData: {
						data: characterReference,
						mimeType: "image/jpeg",
					},
				},
				{ text: prompt },
			],
		},
	],
	config: {
		thinkingConfig: { thinkingLevel },
		imageConfig: {
			aspectRatio,
			imageSize,
		},
		responseModalities: ["Image"],
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
			characterReferencePath,
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
			model,
			outputPath,
			metadataPath,
			characterReferencePath,
			thinkingLevel,
			latencySeconds: Number((latencyMs / 1000).toFixed(3)),
		},
		null,
		2,
	),
);
