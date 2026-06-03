import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { GoogleGenAI } from "/Users/mark/hivemind/hivemind-hono/node_modules/@google/genai/dist/node/index.mjs";

type ScenePlan = {
	globalVisualRules: string[];
	scenes: Array<{
		captionChunks: string[];
		educationalPoint: string;
		id: number;
		motionDirection: string;
		timeJump: string;
		visualPrompt: string;
		voiceover: string;
	}>;
	thesis: string;
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
	"scene-reference-grid-v1-borderless-reassembled-trim32-4k.jpg",
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
			"Full-body hero shot in a Roman Forum street at dawn. The Engineer stands centered but slightly low in frame so the green Crocs and tan knee-length shorts are visible; Roman temples and pedestrians create real depth behind him.",
		camera:
			"Large-format cinema camera, 40mm lens, eye-level to slightly low angle, natural dawn backlight, shallow but not extreme depth of field.",
		keyframePrompt:
			"Make this the opening hook image: the absurd skeleton engineer has just arrived in ancient Rome, standing still while the city moves around him. His body acting is confused but determined, not silly. The Rome environment should feel like a real movie set with dusty stone, linen clothing, worn marble, and soft sunrise haze.",
		negativeDetails:
			"Do not make him threatening, magical, heroic-fantasy, or cartoonish. Do not put him in long pants. Do not crop out the Crocs.",
	},
	2: {
		id: 2,
		composition:
			"Low-angle street-level shot on uneven Roman paving stones. The Engineer sits or half-kneels after waking up, satchel open beside him with a blank notebook and calipers. The green Crocs are prominent in the foreground beside Roman sandals.",
		camera:
			"Large-format cinema camera, 28mm lens close to the pavement, foreground Crocs in sharp focus with Forum architecture receding behind.",
		keyframePrompt:
			"Make this the comedic but photoreal Day One image: the joke is the suspicious modern Crocs and skeleton body in a serious Roman street. Keep it grounded, like a live-action historical film with one absurd protagonist.",
		negativeDetails:
			"Do not make the Crocs branded or add logos. Do not turn the shot into a meme, cartoon, or posed studio portrait. Do not add text on the notebook.",
	},
	3: {
		id: 3,
		composition:
			"World-focused wide vertical shot of Roman engineering: aqueduct arches dominate the upper frame, a paved road leads the eye inward, a treadwheel crane and watermill wheel show mechanical sophistication. The Engineer can be tiny or absent; the infrastructure is the subject.",
		camera:
			"Large-format cinema camera, 35mm lens, high vantage or crane-like view, crisp daylight, realistic scale and atmospheric depth.",
		keyframePrompt:
			"Make this the educational 'Rome is already an engineering machine' image. It should show competence and infrastructure, not ruins. The viewer should immediately see aqueducts, roads, cranes, and water power as practical systems.",
		negativeDetails:
			"Do not show modern asphalt, modern vehicles, modern buildings, anachronistic steel bridges, fantasy megastructures, or readable signage.",
	},
	4: {
		id: 4,
		composition:
			"Interior Roman metal workshop with a charcoal forge glowing on one side, bronze tools and rough hand tools on benches, dust beams from a roof opening, and The Engineer entering with a rolled blueprint while Roman smiths look up.",
		camera:
			"Large-format cinema camera, 35mm lens, warm firelight mixed with dusty sunlight, medium-wide vertical frame with strong foreground workshop detail.",
		keyframePrompt:
			"Make this the transition from sightseeing to experimentation. The Engineer should look purposeful and slightly chaotic, but the smiths and workshop must feel serious and historically grounded. The scene should smell like charcoal, bronze, sweat, and stone.",
		negativeDetails:
			"Do not include modern machinery, electric lights, welding gear, goggles, text labels, fantasy armor, or a cartoon blacksmith shop.",
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
		`scene-${sceneId(sceneNumber)}-context-current-panel-highlight.jpg`,
	);
	const x = neighborhoodColumn * panelWidth;
	const y = neighborhoodRow * panelHeight;
	const borderX0 = targetColumnInCrop * panelWidth + 10;
	const borderY0 = targetRowInCrop * panelHeight + 10;
	const borderX1 = (targetColumnInCrop + 1) * panelWidth - 10;
	const borderY1 = (targetRowInCrop + 1) * panelHeight - 10;

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

	return `You are generating a final standalone keyframe for a vertical photorealistic video.

Reference images provided:
1. The first image is the canonical character sheet for The Engineer. Preserve the character identity, outfit, proportions, and photorealistic practical-effects look.
2. The second image is a 2x2 crop from the 4x4 scene reference grid. The bright green border marks the current target scene. Use the bordered tile as local composition/style context, and use the three adjacent tiles only to understand continuity with neighboring scenes. The green border is a reference marker only; do not include any border in the final image.

Scene ${sceneId(sceneNumber)} / ${planScene.timeJump}
Voiceover line: "${planScene.voiceover}"
Educational point: ${planScene.educationalPoint}

Final image goal:
${spec.keyframePrompt}

Composition:
${spec.composition}

Camera and lighting:
${spec.camera}

Scene content from storyboard:
${planScene.visualPrompt}

Motion planning for later image-to-video:
${planScene.motionDirection}

Character rules when The Engineer appears:
- He is a photorealistic skeleton mascot, not a cartoon and not a horror character.
- Clean ivory skull, expressive dark eye sockets, non-horror grin, slim bony build.
- Bright green cap with a white front panel and no logo.
- Normal-length opaque bright green short-sleeve utility overshirt over a white T-shirt.
- Tan knee-length work shorts, brown belt, compact brown crossbody tool satchel.
- Bright green unbranded Crocs-style clogs with ventilation holes.
- Mostly exposed arm and leg bones with only a barely visible clear translucent sheen; bones remain dominant.
- Keep cap, shirt length, shorts, satchel, and Crocs consistent with the character sheet.

Photorealism rules:
- Make the image look like a real frame from an expensive live-action historical film.
- Use physically plausible Roman stone, linen, bronze, wood, charcoal smoke, dust, lamplight, sunlight, and human extras.
- Keep the visual tone serious and educational, with only slight humor from The Engineer's body acting and modern outfit.
- No painterly look, no illustration, no anime, no toy render, no fantasy styling, no flat AI gloss.

Reference handling:
- Do not copy the 2x2 grid layout.
- Do not include the green highlight border.
- Do not include panel seams, gutters, captions, labels, subtitles, title text, watermarks, UI, or readable text.
- Create one clean full-bleed 9:16 movie keyframe for scene ${sceneId(sceneNumber)} only.

Additional scene-specific avoid rules:
${spec.negativeDetails}

Global avoid rules:
No logos, brand names, modern vehicles, modern buildings, modern signage, readable patches, gore, horror, blood, rotten tissue, organs, armor, fantasy weapons, sunglasses, duplicate skeletons, duplicate heads, distorted hands, missing limbs, long pants on The Engineer, cropped tiny shirt, strong translucent skin, border, frame, or letterbox.

Output:
Portrait 9:16 aspect ratio, 1K image size, high-thinking photorealistic cinematic keyframe.`;
}

async function generateScene(sceneNumber: number) {
	const prompt = buildPrompt(sceneNumber);
	const contextReferencePath = cropContextReference(sceneNumber);
	const outputPath = join(
		assetsDir,
		"keyframes",
		`scene-${sceneId(sceneNumber)}-keyframe-nb2-1k.jpg`,
	);
	const metadataPath = join(
		assetsDir,
		"keyframes",
		`scene-${sceneId(sceneNumber)}-keyframe-nb2-1k.json`,
	);
	const promptPath = join(
		promptsDir,
		"scene-keyframes",
		`scene-${sceneId(sceneNumber)}-keyframe-prompt.txt`,
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

const scenesToGenerate = [1, 2, 3, 4];
const results = await Promise.all(scenesToGenerate.map(generateScene));
console.log(JSON.stringify({ results }, null, 2));
