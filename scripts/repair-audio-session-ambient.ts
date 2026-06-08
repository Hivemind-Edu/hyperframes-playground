import { cert, initializeApp, type App } from "firebase-admin/app";
import { getStorage } from "firebase-admin/storage";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { gzipSync } from "node:zlib";
import pg from "pg";

const { Client } = pg;

type EnvName = "dev" | "staging" | "prod";
type AudioSessionType = "ambient" | "playback";
type Renderer = "hyperframes" | "html-slideshow";

type Target = {
	id: string;
	renderer: Renderer;
	storagePath: string;
	title: string;
};

type RepairStatus =
	| "already-ambient"
	| "already-playback"
	| "fetch-error"
	| "missing-audioSession"
	| "not-found"
	| "repaired"
	| "upload-error";

type RepairResult = {
	error?: string;
	id: string;
	renderer: Renderer;
	status: RepairStatus;
	storagePath: string;
	title: string;
};

const root = resolve(import.meta.dir, "..");

function audioSessionLiteral(type: AudioSessionType) {
	return `navigator.audioSession.type = "${type}";`;
}

function getFirebaseStorageMediaUrl(bucket: string, storagePath: string) {
	return `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodeURIComponent(
		storagePath,
	)}?alt=media`;
}

function parseArgs(argv: string[]) {
	const envNames: EnvName[] = [];
	const postIds: string[] = [];
	let dryRun = false;
	let concurrency = 24;
	let to: AudioSessionType = "ambient";

	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === "--dry-run") {
			dryRun = true;
			continue;
		}
		if (arg === "--env") {
			const value = argv[index + 1] as EnvName | undefined;
			index += 1;
			if (value !== "dev" && value !== "staging" && value !== "prod") {
				throw new Error(`--env must be dev, staging, or prod. Got: ${value}`);
			}
			envNames.push(value);
			continue;
		}
		if (arg === "--id") {
			const value = argv[index + 1];
			index += 1;
			if (!value) {
				throw new Error("--id requires a post id.");
			}
			postIds.push(value);
			continue;
		}
		if (arg === "--to") {
			const value = argv[index + 1] as AudioSessionType | undefined;
			index += 1;
			if (value !== "ambient" && value !== "playback") {
				throw new Error(`--to must be ambient or playback. Got: ${value}`);
			}
			to = value;
			continue;
		}
		if (arg === "--concurrency") {
			const value = Number(argv[index + 1]);
			index += 1;
			if (!Number.isFinite(value) || value < 1) {
				throw new Error("--concurrency must be a positive number.");
			}
			concurrency = Math.floor(value);
		}
	}

	return {
		concurrency,
		dryRun,
		envNames: envNames.length > 0 ? envNames : (["dev", "staging", "prod"] as EnvName[]),
		postIds,
		to,
	};
}

function loadEnvFile(envName: EnvName): Record<string, string> {
	const path = join(root, `.env.${envName}`);
	const vars: Record<string, string> = {};
	const raw = readFileSync(path, "utf8");

	for (const line of raw.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) continue;
		const equalsIndex = trimmed.indexOf("=");
		if (equalsIndex <= 0) continue;
		const key = trimmed.slice(0, equalsIndex).trim();
		let value = trimmed.slice(equalsIndex + 1).trim();
		if (
			(value.startsWith('"') && value.endsWith('"')) ||
			(value.startsWith("'") && value.endsWith("'"))
		) {
			value = value.slice(1, -1);
		}
		vars[key] = value;
	}

	return vars;
}

function getFirebaseStorageBucket(env: Record<string, string>) {
	if (env.FIREBASE_STORAGE_BUCKET) return env.FIREBASE_STORAGE_BUCKET;
	const serviceAccount = JSON.parse(readFileSync(env.FIREBASE_CONFIG!, "utf8")) as {
		project_id?: string;
	};
	if (!serviceAccount.project_id) {
		throw new Error("FIREBASE_STORAGE_BUCKET missing and service account has no project_id.");
	}
	return `${serviceAccount.project_id}.firebasestorage.app`;
}

function initializeFirebaseApp(envName: EnvName, env: Record<string, string>): App {
	const serviceAccount = JSON.parse(readFileSync(env.FIREBASE_CONFIG!, "utf8"));
	return initializeApp(
		{
			credential: cert(serviceAccount),
			storageBucket: getFirebaseStorageBucket(env),
		},
		`repair-audio-session-${envName}-${Date.now()}`,
	);
}

async function loadTargets(envName: EnvName, databaseUrl: string): Promise<Target[]> {
	const client = new Client({
		connectionString: databaseUrl,
		connectionTimeoutMillis: 8_000,
		query_timeout: 30_000,
		ssl: envName === "prod" ? { rejectUnauthorized: false } : undefined,
	});
	await client.connect();
	try {
		const { rows } = await client.query<{
			id: string;
			renderer: Renderer;
			title: string | null;
		}>(`
			select id,
						 left(coalesce(text, ''), 120) as title,
						 contents -> 'videoData' ->> 'renderer' as renderer
				from post
			 where parent_post_id is null
				 and display_style = 'BASIC'
				 and gen_state = 'COMPLETE'
				 and contents -> 'videoData' is not null
				 and coalesce((contents -> 'videoData' ->> 'renderedOnly')::boolean, false) = false
				 and contents -> 'videoData' ->> 'renderer' in ('hyperframes', 'html-slideshow')
			 order by inserttime desc
		`);

		return rows.map((row) => ({
			id: row.id,
			renderer: row.renderer,
			storagePath:
				row.renderer === "hyperframes"
					? `brainjuice/generated/${row.id}/artifact/player.html`
					: `brainjuice/generated/${row.id}/artifact/index.html`,
			title: row.title ?? "",
		}));
	} finally {
		await client.end();
	}
}

async function mapLimit<T, R>(
	items: T[],
	limit: number,
	fn: (item: T, index: number) => Promise<R>,
) {
	let nextIndex = 0;
	const results: R[] = [];
	async function worker() {
		while (nextIndex < items.length) {
			const index = nextIndex;
			nextIndex += 1;
			results[index] = await fn(items[index]!, index);
		}
	}
	await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
	return results;
}

function classifyHtml(
	html: string,
	{
		replacementLiteral,
		targetLiteral,
		to,
	}: {
		replacementLiteral: string;
		targetLiteral: string;
		to: AudioSessionType;
	},
): RepairStatus {
	if (html.includes(targetLiteral)) return "repaired";
	if (html.includes(replacementLiteral)) {
		return to === "ambient" ? "already-ambient" : "already-playback";
	}
	return "missing-audioSession";
}

async function repairTarget({
	app,
	bucketName,
	dryRun,
	replacementLiteral,
	target,
	targetLiteral,
	to,
}: {
	app: App;
	bucketName: string;
	dryRun: boolean;
	replacementLiteral: string;
	target: Target;
	targetLiteral: string;
	to: AudioSessionType;
}): Promise<RepairResult> {
	const file = getStorage(app).bucket().file(target.storagePath);
	let html: string;

	try {
		const response = await fetch(
			getFirebaseStorageMediaUrl(bucketName, target.storagePath),
		);
		if (response.status === 404) {
			return { ...target, status: "not-found" };
		}
		if (!response.ok) {
			return {
				...target,
				error: `HTTP ${response.status}`,
				status: "fetch-error",
			};
		}
		html = await response.text();
	} catch (error) {
		return {
			...target,
			error: error instanceof Error ? error.message : String(error),
			status: "fetch-error",
		};
	}

	const status = classifyHtml(html, { replacementLiteral, targetLiteral, to });
	if (status !== "repaired") {
		return { ...target, status };
	}

	if (dryRun) {
		return { ...target, status };
	}

	const repairedHtml = html.replaceAll(targetLiteral, replacementLiteral);
	try {
		await file.save(gzipSync(Buffer.from(repairedHtml)), {
			metadata: {
				cacheControl: "public, max-age=31536000, immutable",
				contentEncoding: "gzip",
				contentType: "text/html; charset=utf-8",
			},
		});
		return { ...target, status };
	} catch (error) {
		return {
			...target,
			error: error instanceof Error ? error.message : String(error),
			status: "upload-error",
		};
	}
}

function summarize(results: RepairResult[]) {
	return results.reduce<Record<string, number>>((counts, result) => {
		counts[result.status] = (counts[result.status] ?? 0) + 1;
		return counts;
	}, {});
}

async function main() {
	const options = parseArgs(Bun.argv.slice(2));
	const targetLiteral = audioSessionLiteral(
		options.to === "ambient" ? "playback" : "ambient",
	);
	const replacementLiteral = audioSessionLiteral(options.to);
	const report: Record<string, unknown> = {};

	for (const envName of options.envNames) {
		const env = loadEnvFile(envName);
		const bucketName = getFirebaseStorageBucket(env);
		const app = initializeFirebaseApp(envName, env);
		const allTargets = await loadTargets(envName, env.DATABASE_URL!);
		const targets =
			options.postIds.length > 0
				? allTargets.filter((target) => options.postIds.includes(target.id))
				: allTargets;
		console.log(
			JSON.stringify({
				concurrency: options.concurrency,
				dryRun: options.dryRun,
				env: envName,
				filteredIds: options.postIds.length,
				to: options.to,
				targets: targets.length,
			}),
		);

		let completed = 0;
		const progressCounts: Record<string, number> = {};
		const results = await mapLimit(targets, options.concurrency, async (target) => {
			const result = await repairTarget({
				app,
				bucketName,
				dryRun: options.dryRun,
				replacementLiteral,
				target,
				targetLiteral,
				to: options.to,
			});
			completed += 1;
			progressCounts[result.status] = (progressCounts[result.status] ?? 0) + 1;
			if (completed % 1000 === 0 || completed === targets.length) {
				console.log(
					JSON.stringify({
						completed,
						env: envName,
						summary: progressCounts,
						targets: targets.length,
					}),
				);
			}
			return result;
		});

		const envReport = {
			bucket: bucketName,
			counts: summarize(results),
			dryRun: options.dryRun,
			samples: Object.fromEntries(
				Object.entries(
					results.reduce<Record<string, RepairResult[]>>((samples, result) => {
						const bucket = (samples[result.status] ??= []);
						if (bucket.length < 10) bucket.push(result);
						return samples;
					}, {}),
				),
			),
			targets: targets.length,
			to: options.to,
		};
		report[envName] = envReport;
		console.log(JSON.stringify({ env: envName, ...envReport }, null, 2));
	}

	const reportPath = join(
		root,
		"tmp",
		`audio-session-${options.to}-repair-${new Date().toISOString().replaceAll(":", "-")}.json`,
	);
	mkdirSync(join(root, "tmp"), { recursive: true });
	writeFileSync(reportPath, JSON.stringify(report, null, 2));
	console.log(`report=${reportPath}`);
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
