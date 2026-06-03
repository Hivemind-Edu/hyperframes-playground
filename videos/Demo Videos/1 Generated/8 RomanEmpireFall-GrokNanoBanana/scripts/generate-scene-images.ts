import { join } from "node:path";
import {
	assetsDir,
	characterPortraitPath,
	cropNeighborhood,
	cropPanel,
	ensureDirs,
	generateNb2Image,
	mimeTypeForPath,
	readPlan,
	sceneId,
} from "./generation-utils";

const plan = await readPlan();
await ensureDirs();

const sceneArg = process.argv.find((arg) => arg.startsWith("--scene="));
const onlyScene = sceneArg ? Number(sceneArg.split("=")[1]) : undefined;

if (
	onlyScene !== undefined &&
	(!Number.isInteger(onlyScene) || onlyScene < 1 || onlyScene > 16)
) {
	throw new Error(`Expected --scene=1..16, got ${sceneArg}`);
}

const selectedScenes = onlyScene
	? plan.scenes.filter((scene) => scene.id === onlyScene)
	: plan.scenes;

const generateScene = async (scene: (typeof plan.scenes)[number]) => {
	const id = sceneId(scene.id);
	const panelRef = cropPanel(scene.id);
	const neighborhoodRef = cropNeighborhood(scene.id);
	const characterRefs = scene.characters.map(characterPortraitPath);
	const prompt = `Use the attached exact panel crop as the primary composition reference. Use the attached 2x2 neighborhood crop for nearby visual context. Use the attached character portrait references to preserve recurring faces and costumes exactly.

Recreate the panel composition as closely as possible while improving fidelity, detail, and cleanliness for video generation. Do not redesign the shot.

Important: ignore any storyboard frame, black border, white paper margin, white gutter, or panel divider visible in the references. The final image must be full-bleed painted artwork edge to edge with no white borders, no black panel frame, no paper margin, and no letterboxing.

${scene.prompt}

Style:
${plan.stylePrompt}`;

	const outputPath = join(assetsDir, `scene-${id}-nb2-1k.jpg`);
	const metadataPath = join(assetsDir, `scene-${id}-nb2-1k.json`);
	const references = [panelRef, neighborhoodRef, ...characterRefs].map((path) => ({
		mimeType: mimeTypeForPath(path),
		path,
	}));

	const result = await generateNb2Image({
		extraMetadata: {
			characters: scene.characters,
			sceneNumber: scene.id,
		},
		metadataPath,
		model: plan.model,
		outputPath,
		prompt,
		references,
	});

	return {
		characters: scene.characters,
		latencyMs: result.latencyMs,
		outputPath,
		sceneNumber: scene.id,
	};
};

const results = await Promise.all(selectedScenes.map(generateScene));
console.log(JSON.stringify({ results }, null, 2));
