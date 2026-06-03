import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { GoogleGenAI } from "/Users/mark/hivemind/hivemind-hono/node_modules/@google/genai/dist/node/index.mjs";

export const __dirname = dirname(fileURLToPath(import.meta.url));
export const projectDir = dirname(__dirname);
export const assetsDir = join(projectDir, "assets");
export const promptsDir = join(projectDir, "prompts");
export const referenceGridPath = join(
	assetsDir,
	"roman-empire-reference-grid-nb2-4k.jpg",
);
export const planPath = join(promptsDir, "character-scene-plan.json");

export const panelWidth = 768;
export const panelHeight = 1376;
const panelInnerMarginX = 34;
const panelInnerMarginY = 42;
export const gridColumns = 4;
export const gridRows = 4;

export type CharacterPlan = {
	id: string;
	name: string;
	prompt: string;
	referencePanels: number[];
};

export type ScenePlan = {
	characters: string[];
	id: number;
	prompt: string;
};

export type GenerationPlan = {
	characters: CharacterPlan[];
	model: {
		aspectRatio: "9:16";
		image: string;
		imageSize: "1K";
		thinkingLevel: "high";
	};
	scenes: ScenePlan[];
	stylePrompt: string;
};

export type ImageReference = {
	mimeType: string;
	path: string;
};

const contentTypeByExtension: Record<string, string> = {
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".png": "image/png",
	".webp": "image/webp",
};

export const ai = new GoogleGenAI({
	vertexai: false,
	apiKey:
		process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GOOGLE_API_KEY,
});

export async function readPlan(): Promise<GenerationPlan> {
	return JSON.parse(await readFile(planPath, "utf8")) as GenerationPlan;
}

export function mimeTypeForPath(path: string): string {
	return contentTypeByExtension[extname(path).toLowerCase()] ?? "image/jpeg";
}

export function sceneId(sceneNumber: number): string {
	return String(sceneNumber).padStart(2, "0");
}

export function characterPortraitPath(characterId: string): string {
	return join(assetsDir, "characters", `${characterId}-portrait-nb2-1k.jpg`);
}

export function panelCropPath(sceneNumber: number): string {
	return join(assetsDir, "references", `panel-${sceneId(sceneNumber)}.jpg`);
}

export function neighborhoodCropPath(sceneNumber: number): string {
	return join(
		assetsDir,
		"references",
		`panel-${sceneId(sceneNumber)}-neighborhood-2x2.jpg`,
	);
}

export async function ensureDirs() {
	await Promise.all([
		mkdir(assetsDir, { recursive: true }),
		mkdir(join(assetsDir, "characters"), { recursive: true }),
		mkdir(join(assetsDir, "references"), { recursive: true }),
	]);
}

export function cropPanel(sceneNumber: number): string {
	const panelIndex = sceneNumber - 1;
	const column = panelIndex % gridColumns;
	const row = Math.floor(panelIndex / gridColumns);
	const outPath = panelCropPath(sceneNumber);
	const crop = Bun.spawnSync([
		"ffmpeg",
		"-y",
		"-i",
		referenceGridPath,
		"-vf",
		`crop=${panelWidth - panelInnerMarginX * 2}:${panelHeight - panelInnerMarginY * 2}:${column * panelWidth + panelInnerMarginX}:${row * panelHeight + panelInnerMarginY}`,
		outPath,
	]);
	if (!crop.success) {
		throw new Error(
			`Failed to crop panel ${sceneNumber}: ${crop.stderr.toString().trim()}`,
		);
	}
	return outPath;
}

export function cropNeighborhood(sceneNumber: number): string {
	const panelIndex = sceneNumber - 1;
	const column = panelIndex % gridColumns;
	const row = Math.floor(panelIndex / gridColumns);
	const neighborhoodColumn = Math.min(Math.max(column - 1, 0), gridColumns - 2);
	const neighborhoodRow = Math.min(Math.max(row - 1, 0), gridRows - 2);
	const outPath = neighborhoodCropPath(sceneNumber);
	const crop = Bun.spawnSync([
		"ffmpeg",
		"-y",
		"-i",
		referenceGridPath,
		"-vf",
		`crop=${panelWidth * 2}:${panelHeight * 2}:${neighborhoodColumn * panelWidth}:${neighborhoodRow * panelHeight}`,
		outPath,
	]);
	if (!crop.success) {
		throw new Error(
			`Failed to crop 2x2 neighborhood for panel ${sceneNumber}: ${crop.stderr.toString().trim()}`,
		);
	}
	return outPath;
}

export function unique<T>(items: T[]): T[] {
	return Array.from(new Set(items));
}

export async function generateNb2Image(args: {
	metadataPath: string;
	model: GenerationPlan["model"];
	outputPath: string;
	prompt: string;
	references: ImageReference[];
	extraMetadata?: Record<string, unknown>;
}) {
	const referenceBuffers = await Promise.all(
		args.references.map(async (reference) => ({
			data: (await readFile(reference.path)).toString("base64"),
			mimeType: reference.mimeType,
			path: reference.path,
		})),
	);
	const startedAt = performance.now();
	const response = await ai.models.generateContent({
		model: args.model.image,
		contents: [
			{
				role: "user",
				parts: [
					...referenceBuffers.map((reference) => ({
						inlineData: {
							data: reference.data,
							mimeType: reference.mimeType,
						},
					})),
					{ text: args.prompt },
				],
			},
		],
		config: {
			thinkingConfig: { thinkingLevel: args.model.thinkingLevel },
			imageConfig: {
				aspectRatio: args.model.aspectRatio,
				imageSize: args.model.imageSize,
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
			`No image data returned from ${args.model.image}: ${JSON.stringify(response).slice(0, 1200)}`,
		);
	}

	await writeFile(args.outputPath, Buffer.from(imageData, "base64"));
	await writeFile(
		args.metadataPath,
		JSON.stringify(
			{
				...args.extraMetadata,
				aspectRatio: args.model.aspectRatio,
				generatedAt: new Date().toISOString(),
				imageSize: args.model.imageSize,
				latencyMs,
				latencySeconds: Number((latencyMs / 1000).toFixed(3)),
				mimeType,
				model: args.model.image,
				outputPath: args.outputPath,
				references: args.references.map((reference) => reference.path),
				thinkingLevel: args.model.thinkingLevel,
				usageMetadata: response.usageMetadata ?? null,
			},
			null,
			2,
		),
	);

	return { latencyMs, outputPath: args.outputPath };
}
