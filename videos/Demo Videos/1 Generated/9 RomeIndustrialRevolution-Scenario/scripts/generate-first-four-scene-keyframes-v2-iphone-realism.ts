import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { GoogleGenAI } from "/Users/mark/hivemind/hivemind-hono/node_modules/@google/genai/dist/node/index.mjs";

type ScenePlan = {
	scenes: Array<{
		educationalPoint: string;
		id: number;
		motionDirection: string;
		timeJump: string;
		visualPrompt: string;
		voiceover: string;
	}>;
};

type SceneSpec = {
	camera: string;
	composition: string;
	id: number;
	keyframePrompt: string;
	negativeDetails: string;
};

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectDir = dirname(__dirname);
const assetsDir = join(projectDir, "assets");
const referencesDir = join(assetsDir, "references");
const promptsDir = join(projectDir, "prompts");
const scenePlanPath = join(promptsDir, "scene-plan-v1.json");
const characterReferencePath = join(
	projectDir,
	"assets",
	"characters",
	"skeleton-engineer-character-sheet-v7-barely-translucent-skin-nb2-2k.jpg",
);
const referenceGridPath = join(
	assetsDir,
	"scene-reference-grid-v3-iphone-realism-borderless-trim32-4k.jpg",
);

const model = "gemini-3.1-flash-image";
const aspectRatio = "9:16";
const imageSize = "1K";
const thinkingLevel = "high";
const panelWidth = 768;
const panelHeight = 1376;
const gridColumns = 4;
const gridRows = 4;

const apiKey =
	process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GOOGLE_API_KEY;

if (!apiKey) {
	throw new Error("Missing GOOGLE_GENERATIVE_AI_API_KEY or GOOGLE_API_KEY");
}

const ai = new GoogleGenAI({
	vertexai: false,
	apiKey,
});

const sceneId = (id: number) => String(id).padStart(2, "0");

const sceneSpecs: Record<number, SceneSpec> = {
	1: {
		id: 1,
		composition:
			"Full-body candid phone shot in a Roman Forum street. The Engineer stands among real pedestrians, centered but not perfectly posed, with the cap, normal-length green overshirt, tan knee-length shorts, satchel, exposed bone legs, and green Crocs visible.",
		camera:
			"Shot as if on an iPhone 11 rear wide camera, 26mm-equivalent lens, natural morning Smart HDR, deep-ish focus, ordinary phone contrast, slight wide-angle perspective.",
		keyframePrompt:
			"Create the opening hook as believable phone footage from a historical reenactment with one absurd practical-effects skeleton engineer. The image should feel captured quickly in real morning light, not staged in a studio and not polished like fantasy concept art.",
		negativeDetails:
			"Do not make him glossy, heroic, threatening, magical, or poster-like. Do not put him in long pants. Do not crop out the Crocs.",
	},
	2: {
		id: 2,
		composition:
			"Low street-level phone shot on uneven Roman paving stones. The Engineer sits or half-kneels after waking up, satchel open beside him with a blank notebook and calipers, green Crocs prominent beside Roman sandals.",
		camera:
			"Shot as if on an iPhone 11 rear wide camera placed close to the pavement, 26mm-equivalent lens, natural daylight, realistic hard and soft shadows, deep-ish focus.",
		keyframePrompt:
			"Make this a grounded Day One image. The humor is the suspicious modern Crocs and the skeleton in a real Roman street, but the lighting, stone, sandals, props, and body weight must feel physically real.",
		negativeDetails:
			"Do not add logos, brand text, meme framing, readable notebook text, cartoon expression, or a studio-gradient background.",
	},
	3: {
		id: 3,
		composition:
			"World-focused vertical phone shot of Roman engineering infrastructure: aqueduct arches, paved road, treadwheel crane, concrete construction, and watermill wheel. The Engineer can be tiny or absent; the infrastructure should dominate.",
		camera:
			"Shot as if on an iPhone 11 rear wide camera from a high walkway or street vantage, 26mm-equivalent lens, Smart HDR daylight, deep focus, realistic scale.",
		keyframePrompt:
			"Make this the educational 'Rome is already an engineering machine' frame. It should feel like real infrastructure photographed on location, not a fantasy city matte painting. The viewer should see practical Roman systems.",
		negativeDetails:
			"Do not show modern asphalt, modern vehicles, steel bridges, electric lights, fantasy megastructures, readable signage, or impossible aqueduct geometry.",
	},
	4: {
		id: 4,
		composition:
			"Phone-shot interior of a Roman metal workshop. Charcoal forge glowing, bronze tools and rough hand tools on benches, dusty light from high windows, smiths working, The Engineer entering with a rolled blueprint.",
		camera:
			"Shot as if on an iPhone 11 rear wide camera, 26mm-equivalent lens, available forge light plus dusty daylight, realistic exposure clipping near the fire, deep-ish focus.",
		keyframePrompt:
			"Make this the moment he skips sightseeing and finds a real workshop. It should feel like practical behind-the-scenes phone footage from a historical film set: smoky, tactile, imperfect, believable.",
		negativeDetails:
			"Do not add modern machines, welding gear, goggles, electric light fixtures, readable wall marks, fantasy armor, or a cartoon blacksmith-shop look.",
	},
};

const scenePlan = JSON.parse(await readFile(scenePlanPath, "utf8")) as ScenePlan;

await Promise.all([
	mkdir(assetsDir, { recursive: true }),
	mkdir(referencesDir, { recursive: true }),
	mkdir(join(assetsDir, "keyframes"), { recursive: true }),
	mkdir(join(promptsDir, "scene-keyframes"), { recursive: true }),
]);

function cropContextReference(sceneNumber: number): string {
	const panelIndex = sceneNumber - 1;
	const column = panelIndex % gridColumns;
	const row = Math.floor(panelIndex / gridColumns);
	const neighborhoodColumn = Math.min(Math.max(column - 1, 0), gridColumns - 2);
	const neighborhoodRow = Math.min(Math.max(row - 1, 0), gridRows - 2);
	const targetColumnInCrop = column - neighborhoodColumn;
	const targetRowInCrop = row - neighborhoodRow;
	const outPath = join(
		referencesDir,
		`scene-${sceneId(sceneNumber)}-v2-iphone-context-current-panel-highlight.jpg`,
	);
	const x = neighborhoodColumn * panelWidth;
	const y = neighborhoodRow * panelHeight;
	const borderX0 = targetColumnInCrop * panelWidth + 12;
	const borderY0 = targetRowInCrop * panelHeight + 12;
	const borderX1 = (targetColumnInCrop + 1) * panelWidth - 12;
	const borderY1 = (targetRowInCrop + 1) * panelHeight - 12;

	const crop = spawnSync(
		"magick",
		[
			referenceGridPath,
			"-crop",
			`${panelWidth * 2}x${panelHeight * 2}+${x}+${y}`,
			"+repage",
			"-fill",
			"none",
			"-stroke",
			"#00ff66",
			"-strokewidth",
			"14",
			"-draw",
			`rectangle ${borderX0},${borderY0} ${borderX1},${borderY1}`,
			outPath,
		],
		{ encoding: "utf8" },
	);

	if (crop.status !== 0) {
		throw new Error(
			`Failed to crop context reference for scene ${sceneNumber}: ${crop.stderr}`,
		);
	}

	return outPath;
}

function buildPrompt(sceneNumber: number): string {
	const planScene = scenePlan.scenes.find((scene) => scene.id === sceneNumber);
	const spec = sceneSpecs[sceneNumber];
	if (!planScene || !spec) {
		throw new Error(`Missing scene plan/spec for scene ${sceneNumber}`);
	}

	return `Generate one standalone full-bleed vertical keyframe for a photorealistic video.

Reference images:
1. The first image is the canonical character sheet for The Engineer. Preserve his identity, outfit, body proportions, and practical-effects skeleton look.
2. The second image is a 2x2 crop from the new iPhone-realism 4x4 reference grid. The bright green border marks the target scene. Use the bordered tile as the composition and realism reference. Use adjacent tiles only for continuity. The green border is a guide only; never include it in the final image.

Scene ${sceneId(sceneNumber)} / ${planScene.timeJump}
Voiceover line: "${planScene.voiceover}"
Educational point: ${planScene.educationalPoint}

Scene goal:
${spec.keyframePrompt}

Composition:
${spec.composition}

Camera and lighting:
${spec.camera}

Storyboard content:
${planScene.visualPrompt}

Later video motion:
${planScene.motionDirection}

Required visual style:
- Real phone-photo realism, as if shot on an iPhone 11 rear wide camera.
- 26mm-equivalent wide lens, candid framing, natural Smart HDR, deep-ish focus, modest phone-camera sharpening, believable shadows.
- Real ancient-Rome historical reenactment sets: dusty stone, linen, bronze, charcoal, wood, smoke, sunlight, practical props.
- The skeleton must feel physically present in the scene lighting, not pasted in.
- Make the final frame more realistic than the reference grid if possible.

The Engineer rules:
- Photorealistic skeleton mascot, clean ivory skull, expressive dark eye sockets, non-horror grin.
- Bright green cap with white front panel, no logo.
- Normal-length opaque bright green short-sleeve utility overshirt over white T-shirt.
- Tan knee-length work shorts, brown belt, compact brown satchel.
- Bright green unbranded Crocs-style clogs.
- Mostly exposed arm and leg bones with only a barely visible clear translucent sheen.
- Bones stay dominant. No long pants. No cropped tiny shirt.

Do not include:
- The green reference border, panel seams, gutters, grid layout, captions, subtitles, title text, UI, watermark, or readable text.
- Logos, brand names, modern vehicles, modern buildings, modern signage, electric lights, fantasy armor, gore, horror, blood, rotten tissue, organs, cartoon style, painterly style, anime, toy-like plastic render, glossy CGI, or exaggerated comedy faces.
- ${spec.negativeDetails}

Output:
One clean portrait 9:16 image, 1K image size, high-thinking, extremely photorealistic iPhone 11-style keyframe.`;
}

async function generateScene(sceneNumber: number) {
	const prompt = buildPrompt(sceneNumber);
	const contextReferencePath = cropContextReference(sceneNumber);
	const outputPath = join(
		assetsDir,
		"keyframes",
		`scene-${sceneId(sceneNumber)}-keyframe-v2-iphone-nb2-1k.jpg`,
	);
	const metadataPath = join(
		assetsDir,
		"keyframes",
		`scene-${sceneId(sceneNumber)}-keyframe-v2-iphone-nb2-1k.json`,
	);
	const promptPath = join(
		promptsDir,
		"scene-keyframes",
		`scene-${sceneId(sceneNumber)}-keyframe-v2-iphone-prompt.txt`,
	);
	await writeFile(promptPath, prompt);

	const references = [
		{ mimeType: "image/jpeg", path: characterReferencePath },
		{ mimeType: "image/jpeg", path: contextReferencePath },
	];
	const referenceBuffers = await Promise.all(
		references.map(async (reference) => ({
			...reference,
			data: (await readFile(reference.path)).toString("base64"),
		})),
	);

	const startedAt = performance.now();
	const response = await ai.models.generateContent({
		model,
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
			`No image data returned for scene ${sceneNumber}: ${JSON.stringify(response).slice(0, 1200)}`,
		);
	}

	await writeFile(outputPath, Buffer.from(imageData, "base64"));
	await writeFile(
		metadataPath,
		JSON.stringify(
			{
				aspectRatio,
				characterReferencePath,
				contextReferencePath,
				generatedAt: new Date().toISOString(),
				imageSize,
				latencyMs,
				latencySeconds: Number((latencyMs / 1000).toFixed(3)),
				mimeType,
				model,
				outputPath,
				promptPath,
				referenceGridPath,
				sceneNumber,
				thinkingLevel,
				usageMetadata: response.usageMetadata ?? null,
			},
			null,
			2,
		),
	);

	return {
		contextReferencePath,
		latencySeconds: Number((latencyMs / 1000).toFixed(3)),
		outputPath,
		promptPath,
		sceneNumber,
	};
}

const results = await Promise.all([1, 2, 3, 4].map(generateScene));
console.log(JSON.stringify({ results }, null, 2));
