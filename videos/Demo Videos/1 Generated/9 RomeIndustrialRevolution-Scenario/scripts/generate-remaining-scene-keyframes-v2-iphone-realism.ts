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
	2: {
		composition:
			"Low street-level phone shot on uneven Roman paving stones. The Engineer sits or half-kneels after waking up, satchel open beside him with a blank notebook and calipers. The only green Crocs are the pair worn on his feet. Any other footwear in frame must be brown Roman sandals.",
		camera:
			"Shot as if on an iPhone 11 rear wide camera placed close to the pavement, 26mm-equivalent lens, natural daylight, realistic hard and soft shadows, deep-ish focus.",
		keyframePrompt:
			"Make this a grounded Day One image. The humor is the suspicious modern Crocs on the Engineer's feet and the skeleton in a real Roman street, but the lighting, stone, sandals, props, and body weight must feel physically real.",
		negativeDetails:
			"No extra loose green Crocs, no duplicate pair of green clogs, no brand text, no meme framing, no readable notebook text, no cartoon expression, no studio-gradient background.",
	},
	5: {
		composition:
			"Close phone shot over a rough wooden workshop table. The Engineer's skeletal hand sketches a simple steam piston idea in charcoal on blank parchment while Roman smiths lean in. Bronze ingots, hand tools, and calipers sit nearby.",
		camera:
			"iPhone 11 rear wide camera, close handheld table angle, available forge light mixed with daylight, realistic phone HDR and modest sharpening.",
		keyframePrompt:
			"This is the first serious engineering beat: modern knowledge enters a Roman workshop. The image should feel tactile and practical, with real charcoal marks, bronze, wood grain, and human attention.",
		negativeDetails:
			"No readable text, no clean CAD drawing, no modern paper, no ballpoint pen, no laptop, no blueprint grid, no fantasy glow.",
	},
	6: {
		composition:
			"Roman workshop test bench with a rough bronze cylinder leaking steam at the seams. The piston looks slightly misaligned. The Engineer flinches and shields his face; a blacksmith braces near the test bench.",
		camera:
			"iPhone 11 rear wide camera, handheld at bench height, natural smoky exposure, forge highlights slightly clipped, deep-ish focus.",
		keyframePrompt:
			"Show the first prototype failing in a believable way. The problem is tolerances and seals, not an explosion. Steam should look physical and ordinary, not magical.",
		negativeDetails:
			"No fireball, no gore, no dangerous shrapnel, no modern pressure gauge, no electric workshop tools, no readable labels.",
	},
	7: {
		composition:
			"Object-focused iPhone close-up of calipers measuring an uneven bronze cylinder, surrounded by hand-cut screws of visibly mismatched sizes, leather seals, washers, and inconsistent metal blanks. The Engineer may be partially visible at the edge.",
		camera:
			"iPhone 11 rear wide camera used close to the table, macro-ish but still phone-like, natural workshop light, high tactile detail.",
		keyframePrompt:
			"Make the precision bottleneck visually obvious through objects: almost-right parts that do not quite fit. This should look like real metal and leather on a real bench.",
		negativeDetails:
			"No digital calipers, no stainless modern bolts, no clean product photography, no readable measurements, no glowing diagram.",
	},
	8: {
		composition:
			"Roman artisan carefully finishes a bronze part by hand while The Engineer compares two mismatched parts that should be identical. The setting is a serious workshop with tools and oil-worn surfaces.",
		camera:
			"iPhone 11 rear wide camera, candid medium close shot, available window light and forge bounce, believable skin and bone shadows.",
		keyframePrompt:
			"Show that Roman craftsmen are brilliant, but repeatable factory tooling is missing. The artisan should look skilled and focused, not primitive.",
		negativeDetails:
			"No mocking tone, no cartoon worker, no factory assembly line, no modern machine shop, no readable text.",
	},
	9: {
		composition:
			"Small bronze Hero-of-Alexandria-style aeolipile steam spinner on a stone table, steam jets visible, Roman onlookers gathered around, The Engineer proud but cautious beside it.",
		camera:
			"iPhone 11 rear wide camera, candid demonstration angle, natural courtyard/workshop light, phone HDR catching brass and steam.",
		keyframePrompt:
			"This should feel like a real demonstration that amazes people, but it is still a small device on a table. Keep the steam spinner plausible and physical.",
		negativeDetails:
			"No giant engine, no futuristic turbine, no glowing magical steam, no readable markings, no fantasy lab.",
	},
	10: {
		composition:
			"Wide phone pullback feeling: the tiny steam spinner sits beside heavy millstones, pump parts, and large workshop machinery that remain unmoved. The Engineer looks at the scale mismatch while Romans look confused.",
		camera:
			"iPhone 11 rear wide camera, candid wide interior, deep-ish focus, natural workshop light, practical scale emphasized.",
		keyframePrompt:
			"Make the lesson clear: a clever toy is not an engine room. The frame should contrast the small spinner with heavy machinery that it cannot power.",
		negativeDetails:
			"No oversized fantasy steam engine, no modern factory, no dramatic explosion, no text overlay.",
	},
	11: {
		composition:
			"Roman mine entrance or quarry pump test. A crude bronze-and-wood steam pump lifts water through a pipe into a muddy channel. The Engineer and workers watch with tense excitement.",
		camera:
			"iPhone 11 rear wide camera, handheld outdoor quarry angle, natural daylight, real mud, stone, water, smoke, and wood texture.",
		keyframePrompt:
			"This is the one-afternoon success. Make the pump look crude but functional, and make the workers' excitement restrained and believable.",
		negativeDetails:
			"No modern pump, no steel pipe network, no impossible machinery, no fantasy mine, no clean studio floor.",
	},
	12: {
		composition:
			"Object-focused failure shot: split leather seal, nearly empty charcoal basket, replacement bronze part visibly the wrong size, steam fading, water stopped. The Engineer kneels at the edge with calipers.",
		camera:
			"iPhone 11 rear wide camera close to the ground, available daylight and smoke haze, practical documentary feel.",
		keyframePrompt:
			"Make the failure specific and educational: seals, fuel, and nonmatching parts. The frame should be quiet and frustrating, not catastrophic.",
		negativeDetails:
			"No explosion, no fireball, no dramatic ruin, no readable labels, no modern fuel canister.",
	},
	13: {
		composition:
			"Roman courtyard meeting. A senator in white toga sits beside tablets and coin piles while The Engineer presents a small machine model. In the distant background, ordinary Roman workers move stone and supplies as part of normal city life.",
		camera:
			"iPhone 11 rear wide camera, candid courtyard angle, daylight Smart HDR, realistic faces, stone, linen, coins, and shadows.",
		keyframePrompt:
			"Show the incentive problem seriously: the senator is not stupid; he is deciding whether a risky machine is worth funding in his world.",
		negativeDetails:
			"No goofy senator, no modern office desk, no readable documents, no pile of modern coins, no courtroom fantasy, no violence, no chains, no cruelty.",
	},
	14: {
		composition:
			"Roman administrative courtyard. An army officer gestures toward siege-engine plans, a merchant counts coins, an official holds wax tablets, and The Engineer stands between them holding a steam sketch.",
		camera:
			"iPhone 11 rear wide camera, candid group shot, midday courtyard light, realistic Roman clothing and props.",
		keyframePrompt:
			"Show institutional priorities pulling attention away from industrial experimentation: army, merchants, and officials each want something else.",
		negativeDetails:
			"No readable plans, no modern clipboard, no fantasy armor, no staged corporate meeting, no text.",
	},
	15: {
		composition:
			"Overhead iPhone shot of an oil-lamp table: charcoal, ore, gears, mismatched screws, seals, coins, a road map with no readable labels, watermill model, blank parchment. The Engineer's skeletal hands arrange pieces like a system map.",
		camera:
			"iPhone 11 rear wide camera directly above the table, warm oil-lamp light, realistic phone exposure and shadows.",
		keyframePrompt:
			"This is the ecosystem realization. Make it feel like a real tabletop of constraints, not a graphic infographic. Objects should carry the meaning.",
		negativeDetails:
			"No readable map labels, no arrows, no diagram text, no UI, no glowing lines, no modern sticky notes.",
	},
	16: {
		composition:
			"Twilight rooftop view over ancient Rome. The Engineer sits or stands with a worn notebook, a tiny steam prototype beside him, aqueducts and workshops in the distance. Thoughtful, not defeated.",
		camera:
			"iPhone 11 rear wide camera, realistic dusk phone exposure, slight grain/noise, soft skyline haze, grounded color.",
		keyframePrompt:
			"This is the final thesis frame: Rome had engineers, but lacked the world that makes engineering compound. The mood should be reflective and grounded.",
		negativeDetails:
			"No fantasy sunset, no glowing city, no modern skyline, no text on notebook, no heroic poster pose.",
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
		`scene-${sceneId(sceneNumber)}-v3-iphone-context-current-panel-highlight.jpg`,
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
1. The first image is the canonical character sheet for The Engineer. Preserve identity, outfit, body proportions, and practical-effects skeleton look.
2. The second image is a 2x2 crop from the iPhone-realism 4x4 reference grid. The bright green border marks the target scene. Use the bordered tile as composition and realism context. Use adjacent tiles only for continuity. The green border is a guide only; never include it in the final image.

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
- Extreme photorealism, as if shot on an iPhone 11 rear wide camera.
- 26mm-equivalent wide lens, candid framing, natural Smart HDR, deep-ish focus, modest phone-camera sharpening, believable shadows.
- Real ancient-Rome historical reenactment sets: dusty stone, linen, bronze, charcoal, wood, smoke, sunlight, practical props.
- The skeleton must feel physically present in the scene lighting, not pasted in.
- Practical-effects skeleton realism, not glossy CGI.
- Make the final frame more realistic than the reference grid if possible.

The Engineer rules when he appears:
- Photorealistic skeleton mascot, clean ivory skull, expressive dark eye sockets, non-horror grin.
- Bright green cap with white front panel, no logo.
- Normal-length opaque bright green short-sleeve utility overshirt over white T-shirt.
- Tan knee-length work shorts, brown belt, compact brown satchel.
- Bright green unbranded Crocs-style clogs worn on his feet.
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
		`scene-${sceneId(sceneNumber)}-keyframe-v3-iphone-nb2-1k.jpg`,
	);
	const metadataPath = join(
		assetsDir,
		"keyframes",
		`scene-${sceneId(sceneNumber)}-keyframe-v3-iphone-nb2-1k.json`,
	);
	const promptPath = join(
		promptsDir,
		"scene-keyframes",
		`scene-${sceneId(sceneNumber)}-keyframe-v3-iphone-prompt.txt`,
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

const scenesArg = process.argv.find((arg) => arg.startsWith("--scenes="));
const scenesToGenerate = scenesArg
	? scenesArg
			.split("=")[1]!
			.split(",")
			.map((value) => Number(value.trim()))
			.filter((value) => Number.isInteger(value))
	: [2, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16];

const settled = await Promise.allSettled(scenesToGenerate.map(generateScene));
const results = settled
	.filter((result) => result.status === "fulfilled")
	.map((result) => result.value);
const failures = settled
	.map((result, index) => ({ result, sceneNumber: scenesToGenerate[index] }))
	.filter(
		(item): item is { result: PromiseRejectedResult; sceneNumber: number } =>
			item.result.status === "rejected",
	)
	.map((item) => ({
		error:
			item.result.reason instanceof Error
				? item.result.reason.message
				: String(item.result.reason),
		sceneNumber: item.sceneNumber,
	}));

console.log(JSON.stringify({ failures, results }, null, 2));

if (failures.length > 0) {
	process.exitCode = 1;
}
