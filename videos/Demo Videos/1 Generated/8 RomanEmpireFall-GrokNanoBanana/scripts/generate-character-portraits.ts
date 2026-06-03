import { join } from "node:path";
import {
	characterPortraitPath,
	cropPanel,
	ensureDirs,
	generateNb2Image,
	mimeTypeForPath,
	readPlan,
	unique,
} from "./generation-utils";

const plan = await readPlan();
await ensureDirs();

const results = await Promise.all(
	plan.characters.map(async (character) => {
		const panelRefs = unique(character.referencePanels).map(cropPanel);
		const prompt = `Use the attached panel references only to preserve this recurring character's face, costume, proportions, and painterly style.

${character.prompt}

Style:
${plan.stylePrompt}`;

		const outputPath = characterPortraitPath(character.id);
		const metadataPath = outputPath.replace(/\.jpg$/, ".json");
		const result = await generateNb2Image({
			extraMetadata: {
				characterId: character.id,
				characterName: character.name,
				referencePanels: character.referencePanels,
			},
			metadataPath,
			model: plan.model,
			outputPath,
			prompt,
			references: panelRefs.map((path) => ({
				mimeType: mimeTypeForPath(path),
				path,
			})),
		});

		return {
			characterId: character.id,
			latencyMs: result.latencyMs,
			outputPath,
		};
	}),
);

console.log(JSON.stringify({ results }, null, 2));
