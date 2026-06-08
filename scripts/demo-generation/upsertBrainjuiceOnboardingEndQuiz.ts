import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import pg from "pg";

type EnvName = "local" | "staging" | "prod";

const FEED_ID = "f_brainjuice-onboarding-composites";
const CHAPTER_ID = "c_brainjuice-onboarding-composites";
const POST_ID = "p_brainjuice-onboarding-composite-quiz";
const SYSTEM_USER_ID = "u_brainjuice-onboarding-system";
const DEMO_USER_ID = "DEMO";
const HIVEMIND_ROOT = resolve(import.meta.dir, "../../..");
const HONO_ROOT = join(HIVEMIND_ROOT, "hivemind-hono");

const quizData = {
	questions: [
		{
			question:
				"What replaces bloodline as the real rule of power in Rome's Military Anarchy?",
			options: ["Religion", "Payroll", "Trade", "Philosophy"],
			correctIndex: 1,
		},
		{
			question: "What does the crRNA carry in CRISPR targeting?",
			options: [
				"The address copied from an old invader",
				"The enzyme that repairs DNA",
				"The protein shell around Cas9",
				"The signal that blocks all cutting",
			],
			correctIndex: 0,
		},
		{
			question: "What causes the tragedy of the commons?",
			options: [
				"The private reward is clear, but the shared damage is spread out",
				"Everyone refuses to use the pasture",
				"The shared resource becomes stronger the more people use it",
				"One person owns the entire pasture",
			],
			correctIndex: 0,
		},
		{
			question: "What two things collide in human childbirth?",
			options: [
				"Strong legs and weak arms",
				"Fast walking and slow hearing",
				"A larger skull and a narrower exit",
				"Sharp teeth and soft bones",
			],
			correctIndex: 2,
		},
		{
			question: "What made Caesar's siege of Alesia so famous?",
			options: [
				"He attacked only the main gate",
				"He waited until the Gauls surrendered",
				"He built two walls, one against Alesia and one against the relief army",
				"He destroyed the city with ships",
			],
			correctIndex: 2,
		},
	],
};

const envFilesByName: Record<EnvName, string[]> = {
	local: [".env.local", ".env.brainjuice.local"],
	staging: [".env.staging"],
	prod: [".env.prod"],
};

function loadEnvFiles(files: string[]) {
	for (const file of files) {
		const path = resolve(HONO_ROOT, file);
		const contents = readFileSync(path, "utf8");
		for (const rawLine of contents.split("\n")) {
			const line = rawLine.trim();
			if (!line || line.startsWith("#")) continue;
			const separator = line.indexOf("=");
			if (separator < 0) continue;
			const key = line.slice(0, separator).trim();
			let value = line.slice(separator + 1).trim();
			if (
				(value.startsWith('"') && value.endsWith('"')) ||
				(value.startsWith("'") && value.endsWith("'"))
			) {
				value = value.slice(1, -1);
			}
			process.env[key] = value;
		}
	}
}

function parseArgs(): { envs: EnvName[]; dryRun: boolean } {
	const args = Bun.argv.slice(2);
	const envArg = args.find((arg) => arg.startsWith("--env="));
	const dryRun = args.includes("--dry-run");

	if (!envArg) {
		return { envs: ["local", "staging", "prod"], dryRun };
	}

	const envs = envArg
		.slice("--env=".length)
		.split(",")
		.map((env) => env.trim())
		.filter(Boolean);

	for (const env of envs) {
		if (!["local", "staging", "prod"].includes(env)) {
			throw new Error(`Unsupported --env value: ${env}`);
		}
	}

	return { envs: envs as EnvName[], dryRun };
}

function createPool() {
	const connectionString =
		process.env.PGBOUNCER_URL ?? process.env.DATABASE_URL;
	if (!connectionString) {
		throw new Error("DATABASE_URL or PGBOUNCER_URL is required");
	}
	const hostname = new URL(connectionString).hostname;
	const isLocalhost = hostname === "localhost" || hostname === "127.0.0.1";
	const shouldUseSsl =
		!isLocalhost &&
		(process.env.SSL_REJECT_UNAUTHORIZED === "false" ||
			process.env.DB_SSL_REJECT_UNAUTHORIZED === "false");

	return new pg.Pool({
		connectionString,
		max: 1,
		ssl: shouldUseSsl ? { rejectUnauthorized: false } : undefined,
	});
}

async function upsertEnv(envName: EnvName, dryRun: boolean) {
	loadEnvFiles(envFilesByName[envName]);
	const pool = createPool();
	const client = await pool.connect();

	try {
		await client.query("begin");
		const userResult = await client.query<{ id: string }>(
			`select id from "user" where id in ($1, $2)
			order by case when id = $1 then 0 else 1 end
			limit 1`,
			[SYSTEM_USER_ID, DEMO_USER_ID],
		);
		const feedUserId = userResult.rows[0]?.id;
		if (!feedUserId) {
			throw new Error(
				`Neither ${SYSTEM_USER_ID} nor ${DEMO_USER_ID} exists in "user"`,
			);
		}

		await client.query(
			`insert into feed (
				id, contents, first_post_id, gen_duration_ms, gen_history, gen_info,
				gen_state, language, name, observation_id, origin_info, origin_type,
				picture, picture_path, short_desc, source_podcast_episode_id, user_id,
				userfile_id
			) values (
				$1, null, null, null, '[]'::jsonb, '{}'::jsonb,
				'COMPLETE', null, $2, null, $3::jsonb, 'LLM',
				null, null, $4, null, $5, null
			)
			on conflict (id) do update set
				gen_history = excluded.gen_history,
				gen_info = excluded.gen_info,
				gen_state = excluded.gen_state,
				name = excluded.name,
				origin_info = excluded.origin_info,
				origin_type = excluded.origin_type,
				short_desc = excluded.short_desc,
				user_id = excluded.user_id`,
			[
				FEED_ID,
				"Brainjuice Onboarding Composites",
				JSON.stringify({ source: "brainjuice-onboarding-end-quiz-script" }),
				"Composite onboarding quiz shown after the sample videos.",
				feedUserId,
			],
		);

		await client.query(
			`insert into chapter (
				id, contents, "desc", feed_id, gen_duration_ms, gen_history, gen_info,
				gen_state, learning_topic_id, name, observation_id, origin_info,
				origin_type, sort_order, suggested_by
			) values (
				$1, '{}'::jsonb, $2, $3, null, '[]'::jsonb, '{}'::jsonb,
				'COMPLETE', null, $4, null, $5::jsonb, 'USER', 9000, null
			)
			on conflict (id) do update set
				contents = excluded.contents,
				"desc" = excluded."desc",
				feed_id = excluded.feed_id,
				gen_history = excluded.gen_history,
				gen_info = excluded.gen_info,
				gen_state = excluded.gen_state,
				name = excluded.name,
				origin_info = excluded.origin_info,
				origin_type = excluded.origin_type,
				sort_order = excluded.sort_order`,
			[
				CHAPTER_ID,
				"Onboarding Composites",
				FEED_ID,
				"Onboarding Composites",
				JSON.stringify({ source: "brainjuice-onboarding-end-quiz-script" }),
			],
		);

		await client.query(
			`insert into post (
				id, chapter_id, contents, display_style, gen_state, gen_info,
				gen_history, origin_info, origin_type, parent_post_id,
				poster_profile_id, sort_order, seed_vote_count, text, attachment,
				gen_duration_ms, observation_id, quiz_data, user_interactions
			) values (
				$1, $2, $3::jsonb, 'QUIZ', 'COMPLETE', '{}'::jsonb,
				'[]'::jsonb, $4::jsonb, 'USER', null,
				null, 9000, 0, $5, null,
				null, null, $6::jsonb, null
			)
			on conflict (id) do update set
				chapter_id = excluded.chapter_id,
				contents = excluded.contents,
				display_style = excluded.display_style,
				gen_state = excluded.gen_state,
				gen_info = excluded.gen_info,
				gen_history = excluded.gen_history,
				origin_info = excluded.origin_info,
				origin_type = excluded.origin_type,
				parent_post_id = excluded.parent_post_id,
				poster_profile_id = excluded.poster_profile_id,
				sort_order = excluded.sort_order,
				seed_vote_count = excluded.seed_vote_count,
				text = excluded.text,
				quiz_data = excluded.quiz_data,
				user_interactions = excluded.user_interactions`,
			[
				POST_ID,
				CHAPTER_ID,
				JSON.stringify({
					shortTitle: "End Quiz",
					description: "Five-question onboarding quiz.",
					source: "brainjuice-onboarding-end-quiz-script",
				}),
				JSON.stringify({ source: "brainjuice-onboarding-end-quiz-script" }),
				"End Quiz",
				JSON.stringify(quizData),
			],
		);

		const verification = await client.query(
			`select p.id, p.display_style, p.text,
				jsonb_array_length((p.quiz_data::jsonb)->'questions')::int as question_count,
				c.feed_id
			from post p
			join chapter c on c.id = p.chapter_id
			where p.id = $1`,
			[POST_ID],
		);

		if (dryRun) {
			await client.query("rollback");
		} else {
			await client.query("commit");
		}

		console.log(
			JSON.stringify({
				env: envName,
				dryRun,
				post: verification.rows[0],
			}),
		);
	} catch (error) {
		await client.query("rollback");
		throw error;
	} finally {
		client.release();
		await pool.end();
	}
}

async function main() {
	const { envs, dryRun } = parseArgs();
	for (const envName of envs) {
		await upsertEnv(envName, dryRun);
	}
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
