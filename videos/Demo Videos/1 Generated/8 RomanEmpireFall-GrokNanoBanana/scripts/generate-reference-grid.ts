import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { GoogleGenAI } from "/Users/mark/hivemind/hivemind-hono/node_modules/@google/genai/dist/node/index.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectDir = dirname(__dirname);
const promptPath = join(projectDir, "prompts", "nano-banana-4k-reference-grid.txt");
const outputPath = join(projectDir, "assets", "roman-empire-reference-grid-nb2-4k.jpg");
const metadataPath = join(projectDir, "assets", "roman-empire-reference-grid-nb2-4k.json");

const model = "gemini-3.1-flash-image";
const aspectRatio = "9:16";
const imageSize = "4K";
const thinkingLevel = "high";

const ai = new GoogleGenAI({
	vertexai: false,
	apiKey:
		process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GOOGLE_API_KEY,
});

const prompt = await readFile(promptPath, "utf8");
await mkdir(join(projectDir, "assets"), { recursive: true });

const response = await ai.models.generateContent({
	model,
	contents: prompt,
	config: {
		thinkingConfig: { thinkingLevel },
		imageConfig: {
			aspectRatio,
			imageSize,
		},
		responseModalities: ["Image"],
	},
});

let imageData: string | undefined;
for (const part of response.candidates?.[0]?.content?.parts ?? []) {
	imageData = part.inlineData?.data;
}

if (!imageData) {
	throw new Error(
		`No image data returned from ${model}: ${JSON.stringify(response).slice(0, 1200)}`,
	);
}

const buffer = Buffer.from(imageData, "base64");
await writeFile(outputPath, buffer);

await writeFile(
	metadataPath,
	JSON.stringify(
		{
			aspectRatio,
			generatedAt: new Date().toISOString(),
			imageSize,
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
			thinkingLevel,
		},
		null,
		2,
	),
);
