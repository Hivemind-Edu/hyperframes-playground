import { existsSync } from "node:fs";
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

type DeepgramCaptionMetadata = {
	audioDurationSeconds?: number;
	wordCaptions: VoiceoverMetadata["wordCaptions"];
};

type ScenePlan = {
	scenes: Array<{
		id: number;
		voiceover: string;
	}>;
};

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectDir = dirname(__dirname);
const assetsDir = join(projectDir, "assets");
const voiceoverPath = join(assetsDir, "voiceover-eleven-v3-adam.json");
const deepgramCaptionsPath = join(
	assetsDir,
	"voiceover-deepgram-word-captions.json",
);
const scenePlanPath = join(projectDir, "prompts", "scene-plan-v1.json");
const compositionId =
	"brainjuice-animated-video-rome-industrial-revolution-scenario";

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

const sceneImagePaths: Record<number, string> = {
	1: "assets/keyframes/scene-01-keyframe-v2-iphone-nb2-1k.jpg",
	2: "assets/keyframes/scene-02-keyframe-v3-iphone-nb2-1k.jpg",
	3: "assets/keyframes/scene-03-keyframe-v2-iphone-nb2-1k.jpg",
	4: "assets/keyframes/scene-04-keyframe-v2-iphone-nb2-1k.jpg",
	5: "assets/keyframes/scene-05-keyframe-v3-iphone-nb2-1k.jpg",
	6: "assets/keyframes/scene-06-keyframe-v3-iphone-nb2-1k.jpg",
	7: "assets/keyframes/scene-07-keyframe-v3-iphone-nb2-1k.jpg",
	8: "assets/keyframes/scene-08-keyframe-v3-iphone-nb2-1k.jpg",
	9: "assets/keyframes/scene-09-keyframe-v3-iphone-nb2-1k.jpg",
	10: "assets/keyframes/scene-10-keyframe-v3-iphone-nb2-1k.jpg",
	11: "assets/keyframes/scene-11-keyframe-v3-iphone-nb2-1k.jpg",
	12: "assets/keyframes/scene-12-keyframe-v3-iphone-nb2-1k.jpg",
	13: "assets/keyframes/scene-13-keyframe-v3-iphone-nb2-1k.jpg",
	14: "assets/keyframes/scene-14-keyframe-v3-iphone-nb2-1k.jpg",
	15: "assets/keyframes/scene-15-keyframe-v3-iphone-nb2-1k.jpg",
	16: "assets/keyframes/scene-16-keyframe-v3-iphone-nb2-1k.jpg",
};

function sceneId(sceneNumber: number): string {
	return String(sceneNumber).padStart(2, "0");
}

function sceneVideoPath(sceneNumber: number): string {
	return `assets/videos/scene-${sceneId(sceneNumber)}-grok-imagine-1.5-720p.mp4`;
}

function formatSeconds(seconds: number): string {
	const safeSeconds = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
	return Number.isInteger(safeSeconds)
		? String(safeSeconds)
		: safeSeconds.toFixed(3);
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

function buildCaptionPages(voiceover: VoiceoverMetadata): CaptionPage[] {
	const words = voiceover.wordCaptions
		.map((token) => ({
			endMs: Math.round(token.endMs),
			startMs: Math.round(token.startMs),
			text: token.text.replace(/\s+/g, " ").trim(),
		}))
		.filter((token) => token.text.length > 0)
		.map((token, index, allTokens) => {
			const minEndMs = token.startMs + 90;
			if (token.endMs >= minEndMs) return token;

			const nextStartMs = allTokens[index + 1]?.startMs;
			if (nextStartMs && nextStartMs > token.startMs + 120) {
				return { ...token, endMs: Math.max(minEndMs, nextStartMs - 24) };
			}

			return { ...token, endMs: minEndMs };
		});

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
		const endMs = Math.max(...tokens.map((token) => token.endMs ?? startMs + 300));
		pages.push({
			durationMs: Math.max(90, endMs - startMs),
			startMs,
			text: tokens.map((token) => token.text.trim()).join(" "),
			tokens,
		});
	}

	return pages.map((page, pageIndex) => {
		const nextPage = pages[pageIndex + 1];
		const pageEndMs = nextPage
			? nextPage.startMs
			: page.startMs + page.durationMs;
		return {
			...page,
			durationMs: Math.max(90, pageEndMs - page.startMs),
		};
	});
}

function sceneWordTokens(text: string): string[] {
	return (
		text
			.replace(/\bwatermills\b/gi, "water mills")
			.match(/[a-z0-9]+/gi) ?? []
	);
}

function buildDeepgramSceneTimeline(
	scenePlan: ScenePlan,
	wordCaptions: VoiceoverMetadata["wordCaptions"],
	totalDuration: number,
): VoiceoverMetadata["honoTimelineScenes"] {
	let wordCursor = 0;

	const scenes = scenePlan.scenes.map((scene, sceneIndex) => {
		const wordCount = sceneWordTokens(scene.voiceover).length;
		const sceneWords = wordCaptions.slice(wordCursor, wordCursor + wordCount);
		wordCursor += wordCount;

		if (sceneWords.length === 0) {
			throw new Error(`No Deepgram words allocated to scene ${scene.id}`);
		}

		const nextWord = wordCaptions[wordCursor];
		const startSeconds =
			sceneIndex === 0
				? 0
				: Number((sceneWords[0]!.startMs / 1000).toFixed(3));
		const endSeconds =
			sceneIndex === scenePlan.scenes.length - 1 || !nextWord
				? totalDuration
				: Number((nextWord.startMs / 1000).toFixed(3));

		return {
			durationSeconds: Number((endSeconds - startSeconds).toFixed(3)),
			endSeconds,
			scene: scene.id,
			startSeconds,
			text: scene.voiceover,
		};
	});

	if (wordCursor !== wordCaptions.length) {
		console.warn(
			`Allocated ${wordCursor} scene words from ${wordCaptions.length} Deepgram words.`,
		);
	}

	return scenes;
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
	const captionTokenCues = captionPages
		.flatMap((page, pageIndex) =>
			page.tokens.map((token, tokenIndex) => ({
				activeColor: "#F7C204",
				from: (token.fromMs ?? token.startMs ?? page.startMs) / 1000,
				id: `roman-caption-${pageIndex}-${tokenIndex}`,
				pageId: `roman-caption-page-${pageIndex}`,
				spokenColor: "#fff",
				to:
					(token.toMs ?? token.endMs ?? page.startMs + page.durationMs) /
					1000,
			})),
		)
		.sort((a, b) => a.from - b.from || a.to - b.to);
	const captionTokens = captionTokenCues.map((token, tokenIndex) => {
		const nextToken = captionTokenCues
			.slice(tokenIndex + 1)
			.find((candidate) => candidate.from > token.from + 0.001);
		return {
			activeColor: "#F7C204",
			from: token.from,
			holdTo: Math.max(token.from + 0.05, nextToken?.from ?? token.to),
			id: token.id,
			pageId: token.pageId,
			spokenColor: "#fff",
		};
	});

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
			tl.set("#" + token.id, { color: token.spokenColor }, token.holdTo);
		}
`;
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

function forceSceneImagesToCover(html: string): string {
	return html
		.replace(/(\.hf-scene-image\s*\{[^}]*?object-fit:\s*)contain/g, "$1cover")
		.replace(/(\.hf-scene-media\s*\{[^}]*?object-fit:\s*)contain/g, "$1cover");
}

function forceSceneVideosToCover(html: string): string {
	return html.replace(
		/(\.hf-scene-video\s*\{[^}]*?object-fit:\s*)contain/g,
		"$1cover",
	);
}

async function main() {
	const voiceover = JSON.parse(
		await readFile(voiceoverPath, "utf8"),
	) as VoiceoverMetadata;
	const deepgramCaptions = JSON.parse(
		await readFile(deepgramCaptionsPath, "utf8"),
	) as DeepgramCaptionMetadata;
	const scenePlan = JSON.parse(await readFile(scenePlanPath, "utf8")) as ScenePlan;
	const totalDuration = Number(
		(
			deepgramCaptions.audioDurationSeconds ?? voiceover.audioDurationSeconds
		).toFixed(3),
	);
	const timedVoiceover: VoiceoverMetadata = {
		...voiceover,
		audioDurationSeconds: totalDuration,
		honoTimelineScenes: buildDeepgramSceneTimeline(
			scenePlan,
			deepgramCaptions.wordCaptions,
			totalDuration,
		),
		wordCaptions: deepgramCaptions.wordCaptions,
	};
	const captionPages = buildCaptionPages(timedVoiceover);

	const props = {
		title: undefined,
		styleId: "iphone_rome_engineer_scenario",
		layoutId: "double_2x2_portrait",
		timeline: {
			totalDuration,
			scenes: timedVoiceover.honoTimelineScenes.map((scene) => {
				const imagePath = sceneImagePaths[scene.scene];
				const videoPath = sceneVideoPath(scene.scene);
				const hasVideo = existsSync(join(projectDir, videoPath));
				return {
					script: "",
					startTime: scene.startSeconds,
					endTime: scene.endSeconds,
					audioFilePath:
						scene.scene === 1
							? "assets/voiceover-eleven-v3-adam.mp3"
							: undefined,
					mediaFilePath: hasVideo ? videoPath : imagePath,
					bgFilePath: imagePath,
					mediaType: hasVideo ? ("video" as const) : ("image" as const),
					camera: hasVideo ? "static" : "kenBurns",
					transition: scene.scene === 1 ? undefined : "crossfade",
				};
			}),
		},
		captions: undefined,
		visualSfx: undefined,
	};

	const compiled = compileAnimatedVideoTemplateToHyperframesHtml(props, {
		videoSeed: "rome-industrial-revolution-scenario",
	});
	const html = injectCaptionTimeline(
		injectInlineCaptions(
			forceSceneImagesToCover(
				forceSceneVideosToCover(
					compiled.html.replace(
						"<style>",
						`<style>${brainjuiceFontFaceCss}${romanCaptionCss}`,
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
				captionPages: captionPages.length,
				done: true,
				durationSeconds: compiled.durationSeconds,
				hyperframesJson: join(projectDir, "hyperframes.json"),
				indexHtml: join(projectDir, "index.html"),
				sceneCount: timedVoiceover.honoTimelineScenes.length,
				timingProvider: "deepgram",
			},
			null,
			2,
		),
	);
}

await main();
