import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { GoogleGenAI } from "/Users/mark/hivemind/hivemind-hono/node_modules/@google/genai/dist/node/index.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectDir = dirname(__dirname);

const sceneArg = process.argv.find((arg) => arg.startsWith("--scene="));
const sceneNumber = Number(sceneArg?.split("=")[1] ?? "1");

if (!Number.isInteger(sceneNumber) || sceneNumber < 1 || sceneNumber > 16) {
	throw new Error(`Expected --scene=1..16, got ${sceneArg ?? "(missing)"}`);
}

const sceneId = String(sceneNumber).padStart(2, "0");
const model = "gemini-3.1-flash-image";
const aspectRatio = "9:16";
const imageSize = "1K";
const developerApiImageSize = "1K";
const thinkingLevel = "high";

const referencePath = join(
	projectDir,
	"assets",
	"roman-empire-reference-grid-nb2-4k.jpg",
);
const promptPath = join(
	projectDir,
	"prompts",
	`scene-${sceneId}-image-nb2-1k.txt`,
);
const panelCropPath = join(
	projectDir,
	"assets",
	`scene-${sceneId}-reference-panel-crop.jpg`,
);
const neighborhoodCropPath = join(
	projectDir,
	"assets",
	`scene-${sceneId}-reference-neighborhood-2x2.jpg`,
);
const outputPath = join(projectDir, "assets", `scene-${sceneId}-nb2-1k.jpg`);
const metadataPath = join(
	projectDir,
	"assets",
	`scene-${sceneId}-nb2-1k.json`,
);

const contentTypeByExtension: Record<string, string> = {
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".png": "image/png",
	".webp": "image/webp",
};

const ai = new GoogleGenAI({
	vertexai: false,
	apiKey:
		process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GOOGLE_API_KEY,
});

await mkdir(join(projectDir, "assets"), { recursive: true });

const panelWidth = 768;
const panelHeight = 1376;
const gridColumns = 4;
const gridRows = 4;
const panelIndex = sceneNumber - 1;
const column = panelIndex % gridColumns;
const row = Math.floor(panelIndex / gridColumns);
const panelCrop = Bun.spawnSync([
	"ffmpeg",
	"-y",
	"-i",
	referencePath,
	"-vf",
	`crop=${panelWidth}:${panelHeight}:${column * panelWidth}:${row * panelHeight}`,
	panelCropPath,
]);
if (!panelCrop.success) {
	throw new Error(
		`Failed to crop reference panel: ${panelCrop.stderr.toString().trim()}`,
	);
}

const neighborhoodColumn = Math.min(Math.max(column - 1, 0), gridColumns - 2);
const neighborhoodRow = Math.min(Math.max(row - 1, 0), gridRows - 2);
const neighborhoodCrop = Bun.spawnSync([
	"ffmpeg",
	"-y",
	"-i",
	referencePath,
	"-vf",
	`crop=${panelWidth * 2}:${panelHeight * 2}:${neighborhoodColumn * panelWidth}:${neighborhoodRow * panelHeight}`,
	neighborhoodCropPath,
]);
if (!neighborhoodCrop.success) {
	throw new Error(
		`Failed to crop 2x2 reference neighborhood: ${neighborhoodCrop.stderr.toString().trim()}`,
	);
}

const [prompt, panelCropBuffer, neighborhoodCropBuffer] = await Promise.all([
	readFile(promptPath, "utf8"),
	readFile(panelCropPath),
	readFile(neighborhoodCropPath),
]);

const cropMimeType =
	contentTypeByExtension[extname(panelCropPath).toLowerCase()] ?? "image/jpeg";
const neighborhoodMimeType =
	contentTypeByExtension[extname(neighborhoodCropPath).toLowerCase()] ??
	"image/jpeg";

const startedAt = performance.now();
const response = await ai.models.generateContent({
	model,
	contents: [
		{
			role: "user",
			parts: [
				{
					inlineData: {
						data: panelCropBuffer.toString("base64"),
						mimeType: cropMimeType,
					},
				},
				{
					inlineData: {
						data: neighborhoodCropBuffer.toString("base64"),
						mimeType: neighborhoodMimeType,
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
			imageSize: developerApiImageSize,
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

const buffer = Buffer.from(imageData, "base64");
await writeFile(outputPath, buffer);

await writeFile(
	metadataPath,
	JSON.stringify(
		{
			aspectRatio,
			developerApiImageSize,
			generatedAt: new Date().toISOString(),
			imageSize,
			mimeType,
			neighborhoodCropPath,
			model,
			outputPath,
			panelCropPath,
			promptPath,
			referencePath,
			sceneNumber,
			thinkingLevel,
			latencyMs,
			latencySeconds: Number((latencyMs / 1000).toFixed(3)),
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
			sceneNumber,
			thinkingLevel,
			latencyMs,
		},
		null,
		2,
	),
);
