import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectDir = dirname(__dirname);
const assetsDir = join(projectDir, "assets");
const slidesDir = join(assetsDir, "slides");
const gridPath = join(assetsDir, "alesia-3x3-grid-nb2-4k.jpg");
const manifestPath = join(assetsDir, "slides", "slide-crops.json");

await mkdir(slidesDir, { recursive: true });

const image = sharp(gridPath);
const metadata = await image.metadata();
const width = metadata.width;
const height = metadata.height;

if (!width || !height) {
	throw new Error(`Could not read dimensions for ${gridPath}`);
}

const columns = 3;
const rows = 3;
const panelInsetPx = 18;
const slides = [];

for (let row = 0; row < rows; row++) {
	for (let column = 0; column < columns; column++) {
		const index = row * columns + column + 1;
		const left = Math.round((width * column) / columns);
		const top = Math.round((height * row) / rows);
		const right = Math.round((width * (column + 1)) / columns);
		const bottom = Math.round((height * (row + 1)) / rows);
		const cropWidth = right - left - panelInsetPx * 2;
		const cropHeight = bottom - top - panelInsetPx * 2;
		const outputPath = join(
			slidesDir,
			`slide-${String(index).padStart(2, "0")}.jpg`,
		);

		await sharp(gridPath)
			.extract({
				height: cropHeight,
				left: left + panelInsetPx,
				top: top + panelInsetPx,
				width: cropWidth,
			})
			.jpeg({ mozjpeg: true, quality: 94 })
			.toFile(outputPath);

		slides.push({
			column,
			cropHeight,
			cropWidth,
			inset: panelInsetPx,
			index,
			left: left + panelInsetPx,
			outputPath,
			row,
			top: top + panelInsetPx,
		});
	}
}

await writeFile(
	manifestPath,
	JSON.stringify(
		{
			gridHeight: height,
			gridPath,
			gridWidth: width,
			slides,
		},
		null,
		2,
	),
);

console.log(JSON.stringify({ count: slides.length, manifestPath }, null, 2));
