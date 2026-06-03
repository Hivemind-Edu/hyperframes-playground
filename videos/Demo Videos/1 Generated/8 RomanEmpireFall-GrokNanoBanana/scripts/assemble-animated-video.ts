import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { compileAnimatedVideoTemplateToHyperframesHtml } from "/Users/mark/hivemind/hivemind-hono/src/brainjuice/templates/AnimatedVideoTemplate/compileArtifact.tsx";

type CaptionToken = {
	endMs?: number;
	fromMs?: number;
	startMs?: number;
	text: string;
	toMs?: number;
};

type CaptionPage = {
	durationMs: number;
	startMs: number;
	text: string;
	tokens: CaptionToken[];
};

type VoiceoverMetadata = {
	audioDurationSeconds: number;
	wordCaptions: {
		endMs: number;
		startMs: number;
		text: string;
	}[];
	honoTimelineScenes: {
		durationSeconds: number;
		endSeconds: number;
		scene: number;
		startSeconds: number;
		text: string;
	}[];
};

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectDir = dirname(__dirname);
const assetsDir = join(projectDir, "assets");
const voiceoverPath = join(assetsDir, "voiceover-eleven-v3-adam.json");
const compositionId =
	"brainjuice-animated-video-roman-empire-fall-grok-nano-banana";

const brainjuiceFontFaceCss = `@font-face{font-family:'Anton';font-style:normal;font-weight:400;font-display:swap;src:url('https://firebasestorage.googleapis.com/v0/b/brainjuice-dev.firebasestorage.app/o/brainjuice%2FstaticVideoAssets%2Ffonts%2Fanton-400.woff2?alt=media') format('woff2');}@font-face{font-family:'Inter';font-style:normal;font-weight:400;font-display:swap;src:url('https://firebasestorage.googleapis.com/v0/b/brainjuice-dev.firebasestorage.app/o/brainjuice%2FstaticVideoAssets%2Ffonts%2Finter-400.woff2?alt=media') format('woff2');}@font-face{font-family:'Inter';font-style:normal;font-weight:700;font-display:swap;src:url('https://firebasestorage.googleapis.com/v0/b/brainjuice-dev.firebasestorage.app/o/brainjuice%2FstaticVideoAssets%2Ffonts%2Finter-700.woff2?alt=media') format('woff2');}@font-face{font-family:'Inter';font-style:normal;font-weight:900;font-display:swap;src:url('https://firebasestorage.googleapis.com/v0/b/brainjuice-dev.firebasestorage.app/o/brainjuice%2FstaticVideoAssets%2Ffonts%2Finter-900.woff2?alt=media') format('woff2');}`;

const romanCaptionCss = `
		.hf-roman-caption-page {
			align-items: flex-end;
			box-sizing: border-box;
			display: flex;
			inset: 0;
			justify-content: center;
			padding: 0 24px 126px;
			pointer-events: none;
			position: absolute;
			z-index: 18;
		}

		.hf-roman-caption-text {
			-webkit-text-stroke: 2px #000;
			color: #fff;
			font-family: Anton, Impact, 'Arial Black', sans-serif;
			font-size: 25px;
			font-weight: 900;
			letter-spacing: 0;
			line-height: 1.08;
			max-width: 282px;
			paint-order: stroke;
			text-align: center;
			text-shadow: 0 4px 14px rgba(0, 0, 0, 0.72);
			text-transform: none;
			white-space: normal;
		}

		.hf-roman-caption-word {
			color: #fff;
			display: inline-block;
			margin: 0 0.07em;
			transform-origin: 50% 65%;
		}
`;

function formatSeconds(seconds: number): string {
	const safeSeconds = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
	return Number.isInteger(safeSeconds)
		? String(safeSeconds)
		: safeSeconds.toFixed(3);
}

function sceneId(sceneNumber: number): string {
	return String(sceneNumber).padStart(2, "0");
}

function escapeHtml(text: string): string {
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

function escapeScriptJson(value: unknown): string {
	return JSON.stringify(value).replaceAll("</", "<\\/");
}

function splitWords(text: string): string[] {
	return text.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
}

function allocateSceneWords(scene: VoiceoverMetadata["honoTimelineScenes"][number]) {
	const words = splitWords(scene.text);
	const startMs = Math.round(scene.startSeconds * 1000);
	const endMs = Math.round(scene.endSeconds * 1000);
	const durationMs = endMs - startMs;
	const weights = words.map((word) =>
		Math.max(0.72, word.replace(/[.,!?;:]/g, "").length * 0.18),
	);
	const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
	let cursor = startMs;
	return words.map((word, index) => {
		const isLast = index === words.length - 1;
		const nextCursor = isLast
			? endMs
			: Math.round(cursor + (durationMs * weights[index]) / totalWeight);
		const token = {
			endMs: Math.max(cursor + 110, nextCursor),
			startMs: cursor,
			text: word,
		};
		cursor = token.endMs;
		return token;
	});
}

function buildFixedWordCaptions(voiceover: VoiceoverMetadata) {
	const sceneThirteen = voiceover.honoTimelineScenes.find(
		(scene) => scene.scene === 13,
	);
	const sceneThirteenStartMs = sceneThirteen
		? Math.round(sceneThirteen.startSeconds * 1000)
		: -1;
	const sceneThirteenEndMs = sceneThirteen
		? Math.round(sceneThirteen.endSeconds * 1000)
		: -1;
	const words = voiceover.wordCaptions
		.map((token) => ({
			endMs: Math.round(token.endMs),
			startMs: Math.round(token.startMs),
			text: token.text.replace(/\s+/g, " ").trim(),
		}))
		.filter((token) => token.text.length > 0)
		.filter(
			(token) =>
				token.startMs < sceneThirteenStartMs ||
				token.startMs >= sceneThirteenEndMs,
		);

	if (sceneThirteen) {
		const insertAt = words.findIndex((word) => word.startMs > sceneThirteenStartMs);
		words.splice(
			insertAt === -1 ? words.length : insertAt,
			0,
			...allocateSceneWords(sceneThirteen),
		);
	}

	return words.map((token, index, allTokens) => {
		const minEndMs = token.startMs + 90;
		if (token.endMs >= minEndMs) return token;

		const nextStartMs = allTokens[index + 1]?.startMs;
		if (nextStartMs && nextStartMs > token.startMs + 120) {
			return {
				...token,
				endMs: Math.max(minEndMs, nextStartMs - 24),
			};
		}

		return {
			...token,
			endMs: minEndMs,
		};
	});
}

function buildHardcodedCaptionPages(voiceover: VoiceoverMetadata): CaptionPage[] {
	const words = buildFixedWordCaptions(voiceover);
	const pages: CaptionPage[] = [];

	for (let index = 0; index < words.length; index += 3) {
		const tokens = words.slice(index, index + 3).map((word) => ({
			endMs: word.endMs,
			fromMs: word.startMs,
			startMs: word.startMs,
			text: word.text,
			toMs: word.endMs,
		}));
		const startMs = tokens[0]?.startMs ?? 0;
		const endMs = Math.max(
			...tokens.map((token) => token.endMs ?? startMs + 300),
		);
		pages.push({
			durationMs: Math.max(90, endMs - startMs),
			startMs,
			text: tokens.map((token) => token.text.trim()).join(" "),
			tokens,
		});
	}

	return pages;
}

function renderInlineCaptionPages(captionPages: CaptionPage[]): string {
	return captionPages
		.map((page, pageIndex) => {
			const tokens = page.tokens
				.map(
					(token, tokenIndex) =>
						`<span class="hf-roman-caption-word" id="roman-caption-${pageIndex}-${tokenIndex}">${escapeHtml(token.text.trim())}</span>`,
				)
				.join("");
			return `<div class="clip hf-roman-caption-page" data-duration="${formatSeconds(Math.max(0.05, page.durationMs / 1000))}" data-layout-allow-overflow="" data-start="${formatSeconds(page.startMs / 1000)}" data-track-index="${900 + pageIndex}" id="roman-caption-page-${pageIndex}"><div class="hf-roman-caption-text">${tokens || escapeHtml(page.text)}</div></div>`;
		})
		.join("");
}

function renderInlineCaptionTimeline(captionPages: CaptionPage[]): string {
	const phraseCaptionPages = captionPages.map((page, pageIndex) => ({
		id: `roman-caption-page-${pageIndex}`,
		start: page.startMs / 1000,
	}));
	const captionTokens = captionPages.flatMap((page, pageIndex) =>
		page.tokens.map((token, tokenIndex) => ({
			activeColor: "#F7C204",
			from: (token.fromMs ?? token.startMs ?? page.startMs) / 1000,
			id: `roman-caption-${pageIndex}-${tokenIndex}`,
			pageId: `roman-caption-page-${pageIndex}`,
			spokenColor: "#fff",
			to: (token.toMs ?? token.endMs ?? page.startMs + page.durationMs) / 1000,
		})),
	);

	return `
		const romanCaptionPages = ${escapeScriptJson(phraseCaptionPages)};
		for (const page of romanCaptionPages) {
			tl.set("#" + page.id + " .hf-roman-caption-word", { color: "#fff" }, page.start);
			tl.fromTo("#" + page.id + " .hf-roman-caption-text", { opacity: 0, scale: 0.92, y: 6 }, { opacity: 1, scale: 1, y: 0, duration: 0.14, ease: "back.out(1.4)" }, page.start);
		}
		const romanCaptionTokens = ${escapeScriptJson(captionTokens)};
		for (const token of romanCaptionTokens) {
			tl.set("#" + token.pageId + " .hf-roman-caption-word", { color: token.spokenColor }, token.from);
			tl.set("#" + token.id, { color: token.activeColor }, token.from);
			tl.set("#" + token.id, { color: token.spokenColor }, token.to);
		}
`;
}

function removePersistentTitleFragments(html: string): string {
	return html.replace(
		/(?:39;s Legitimacy<\/div><\/div>|#39;s Legitimacy<\/div><\/div>)+/g,
		"",
	);
}

function stripPersistentTitleCss(html: string): string {
	return html
		.replace(/\s*\.hf-narrated-title\s*\{[^}]*\}/g, "")
		.replace(/\s*\.hf-persistent-title-overlay\s*\{[^}]*\}/g, "");
}

function forceSceneVideosToCover(html: string): string {
	return html.replace(
		/(\.hf-scene-video\s*\{[^}]*?object-fit:\s*)contain/g,
		"$1cover",
	);
}

function injectInlineCaptions(html: string, captionPages: CaptionPage[]): string {
	const marker = "</div><script";
	if (!html.includes(marker)) {
		throw new Error("Could not find root composition closing marker");
	}
	return html.replace(marker, `${renderInlineCaptionPages(captionPages)}${marker}`);
}

function injectCaptionTimeline(html: string, captionPages: CaptionPage[]): string {
	const marker = `const registerTimeline = () => {
			window.__timelines["${compositionId}"] = tl;`;
	if (!html.includes(marker)) {
		throw new Error("Could not find root timeline registration marker");
	}
	return html.replace(
		marker,
		`${renderInlineCaptionTimeline(captionPages)}
		${marker}`,
	);
}

async function main() {
	const voiceover = JSON.parse(
		await readFile(voiceoverPath, "utf8"),
	) as VoiceoverMetadata;
	const totalDuration = Number(voiceover.audioDurationSeconds.toFixed(3));
	const captionPages = buildHardcodedCaptionPages(voiceover);

	const props = {
		title: undefined,
		styleId: "studio_ghibli_roman_history",
		layoutId: "double_2x2_portrait",
		timeline: {
			totalDuration,
			scenes: voiceover.honoTimelineScenes.map((scene) => {
				const id = sceneId(scene.scene);
				return {
					script: "",
					startTime: scene.startSeconds,
					endTime: scene.endSeconds,
					audioFilePath:
						scene.scene === 1 ? "assets/voiceover-eleven-v3-adam.mp3" : undefined,
					mediaFilePath: `assets/videos/scene-${id}-grok-imagine-1.5-720p.mp4`,
					bgFilePath: `assets/scene-${id}-nb2-1k.jpg`,
					mediaType: "video" as const,
					camera: "static",
					transition: scene.scene === 1 ? undefined : "crossfade",
				};
			}),
		},
		captions: undefined,
		visualSfx: undefined,
	};

	const compiled = compileAnimatedVideoTemplateToHyperframesHtml(props, {
		videoSeed: "roman-empire-fall-grok-nano-banana",
	});
	const html = injectCaptionTimeline(
		injectInlineCaptions(
			stripPersistentTitleCss(
				removePersistentTitleFragments(
					forceSceneVideosToCover(
						compiled.html.replace(
							"<style>",
							`<style>${brainjuiceFontFaceCss}${romanCaptionCss}`,
						),
					),
				),
			),
			captionPages,
		),
		captionPages,
	);

	await mkdir(join(projectDir, "compositions"), { recursive: true });
	await writeFile(join(projectDir, "index.html"), html);
	await writeFile(
		join(projectDir, "hyperframes.json"),
		JSON.stringify(
			{
				$schema: "https://hyperframes.heygen.com/schema/hyperframes.json",
				registry:
					"https://raw.githubusercontent.com/heygen-com/hyperframes/main/registry",
				paths: {
					assets: "assets",
					blocks: "compositions",
					components: "compositions/components",
				},
			},
			null,
			2,
		),
	);

	console.info(
		JSON.stringify(
			{
				done: true,
				durationSeconds: compiled.durationSeconds,
				indexHtml: join(projectDir, "index.html"),
				hyperframesJson: join(projectDir, "hyperframes.json"),
				captionPages: captionPages.length,
				sceneCount: voiceover.honoTimelineScenes.length,
			},
			null,
			2,
		),
	);
}

await main();
