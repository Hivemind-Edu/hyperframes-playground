import { cert, getApps, initializeApp, type App, type ServiceAccount } from "firebase-admin/app";
import { getStorage } from "firebase-admin/storage";
import { gzipSync } from "node:zlib";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import pg from "pg";

type EnvMap = Record<string, string>;

type PublishTarget = {
  databaseUrl: string;
  databaseSsl: false | { rejectUnauthorized: boolean };
  envFilePaths: string[];
  firebaseConfigPath: string;
  name: "local" | "staging" | "prod";
  posthogProjectId: number;
};

const PLAYGROUND_ROOT = resolve(import.meta.dir, "..");
const HIVEMIND_ROOT = resolve(PLAYGROUND_ROOT, "..");
const HONO_ROOT = join(HIVEMIND_ROOT, "hivemind-hono");
const FINAL_PACKAGE_DIR = join(
  HIVEMIND_ROOT,
  "FINAL DEMO VIDEOS",
  "10 Alesia-POVSlideshow-NanoBanana",
);

const POST_ID = "p_brainjuice-onboarding-alesia-pov";
const POSTHOG_FLAG_KEY = "onboarding-brainjuice-demo-post-ids";
const INSERT_INDEX = 8;
const TAG_IDS = ["history"];
const FALLBACK_SAMPLE_POST_IDS = [
  "p_brainjuice-onboarding-philosophy",
  "p_brainjuice-onboarding-psychology",
  "p_brainjuice-onboarding-startups",
  "p_brainjuice-onboarding-health",
  "p_brainjuice-onboarding-history",
  "p_brainjuice-onboarding-finance",
  "p_brainjuice-onboarding-environment",
  "p_brainjuice-onboarding-productivity",
  "p_brainjuice-onboarding-ai_tech",
  "p_brainjuice-onboarding-mathematics",
  "p_brainjuice-onboarding-composite-quiz",
];
const FALLBACK_SAMPLE_POST_TAG_MAP: Record<string, string[]> = {
  "p_brainjuice-onboarding-philosophy": ["philosophy"],
  "p_brainjuice-onboarding-psychology": ["psychology"],
  "p_brainjuice-onboarding-startups": ["startups"],
  "p_brainjuice-onboarding-health": ["health"],
  "p_brainjuice-onboarding-history": ["history"],
  "p_brainjuice-onboarding-finance": ["finance"],
  "p_brainjuice-onboarding-environment": ["environment"],
  "p_brainjuice-onboarding-productivity": ["productivity"],
  "p_brainjuice-onboarding-ai_tech": ["ai_tech"],
  "p_brainjuice-onboarding-mathematics": ["mathematics"],
};
const DEMO_USER_ID = "DEMO";
const DEMO_FEED_ID = "f_brainjuice-onboarding-dev-rendered-demo";
const DEMO_CHAPTER_ID = "ch_brainjuice-onboarding-dev-rendered-demo";
const DEMO_PROFILE_ID = "prof_brainjuice-onboarding-dev-rendered-demo";
const SOURCE_LABEL = "hyperframes-playground-alesia-pov-demo";

const POST_TITLE = "Inside Caesar's Siege of Alesia";
const POST_DESCRIPTION =
  "A photorealistic POV slideshow following a Roman legionary through Caesar's double siege line at Alesia, from digging trenches to surviving the two-sided attack.";
const DURATION_SECONDS = 90;

const DEMO_SYNTH_USERS = [
  {
    id: "su_brainjuice-onboarding-dev-demo-host",
    name: "Brainjuice Demo",
    picture: "synth_user_picture/TZroj7hWcbQPnbwCvnzyfW",
    profileId: DEMO_PROFILE_ID,
    username: "brainjuice_demo_host",
  },
  {
    id: "su_brainjuice-onboarding-dev-commenter-01",
    name: "Maya",
    picture: "synth_user_picture/F6YMypxxP9znQp8CpsEuD7",
    profileId: "prof_brainjuice-onboarding-dev-commenter-01",
    username: "maya_demo",
  },
  {
    id: "su_brainjuice-onboarding-dev-commenter-02",
    name: "Theo",
    picture: "synth_user_picture/EiWeQg543N6TerUx5a5aNx",
    profileId: "prof_brainjuice-onboarding-dev-commenter-02",
    username: "theo_demo",
  },
  {
    id: "su_brainjuice-onboarding-dev-commenter-03",
    name: "Rina",
    picture: "synth_user_picture/g6iBNgpqEtzqD4VHFL8Nq6",
    profileId: "prof_brainjuice-onboarding-dev-commenter-03",
    username: "rina_demo",
  },
] as const;

const COMMENTS = [
  "The double wall detail is wild. They were besieging a city while preparing to be besieged themselves.",
  "This makes Alesia feel less like a map and more like a terrifying engineering problem.",
  "The POV format works really well here. Caesar's plan suddenly feels claustrophobic.",
  "I never understood why the Romans kept digging until this. The walls were the weapon.",
  "The relief army arriving behind them is such a brutal twist.",
  "Seeing the inner and outer defenses together makes the whole battle click.",
  "Alesia always sounded like one siege. This makes it feel like two sieges at once.",
  "The silent defenders watching the trenches go up is the most unsettling part.",
  "This is the first time Caesar's engineering advantage felt this concrete to me.",
  "The night attack from both sides must have been absolute chaos.",
  "Those stake pits and trenches explain why numbers alone did not decide it.",
  "The final dawn shot lands hard. The fortifications basically tell the whole story.",
];

const POSTHOG_PROJECTS = {
  local: 131639,
  staging: 131638,
  prod: 131637,
} as const;

function parseArgs(argv: string[]) {
  const dryRun = argv.includes("--dry-run");
  const targetsArgIndex = argv.indexOf("--targets");
  const targetNames =
    targetsArgIndex >= 0
      ? argv[targetsArgIndex + 1]?.split(",").map((value) => value.trim())
      : ["local", "staging", "prod"];
  if (!targetNames || targetNames.some((name) => !["local", "staging", "prod"].includes(name))) {
    throw new Error("--targets must be a comma-separated list of local,staging,prod");
  }
  return {
    dryRun,
    targetNames: targetNames as Array<PublishTarget["name"]>,
  };
}

function loadDotenvFile(envFilePath: string): EnvMap {
  if (!existsSync(envFilePath)) {
    throw new Error(`Missing env file: ${envFilePath}`);
  }

  const env: EnvMap = {};
  for (const line of readFileSync(envFilePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

function loadMergedEnv(envFilePaths: string[]): EnvMap {
  return Object.assign({}, ...envFilePaths.map(loadDotenvFile));
}

function resolveEnvPath(envFilePath: string, maybeRelativePath: string): string {
  return isAbsolute(maybeRelativePath)
    ? maybeRelativePath
    : resolve(dirname(envFilePath), maybeRelativePath);
}

function buildTarget(name: PublishTarget["name"]): PublishTarget {
  const envFilePaths =
    name === "local"
      ? [
          join(HONO_ROOT, ".env.local"),
          join(HONO_ROOT, ".env.brainjuice.local"),
        ]
      : [join(PLAYGROUND_ROOT, `.env.${name}`)];
  const env = loadMergedEnv(envFilePaths);
  const databaseUrl = env.DATABASE_URL;
  const firebaseConfig = env.FIREBASE_CONFIG;
  if (!databaseUrl) throw new Error(`${name} is missing DATABASE_URL`);
  if (!firebaseConfig) throw new Error(`${name} is missing FIREBASE_CONFIG`);

  return {
    databaseUrl,
    databaseSsl:
      name === "prod" || env.DB_SSL === "true"
        ? { rejectUnauthorized: env.DB_SSL_REJECT_UNAUTHORIZED === "true" }
        : false,
    envFilePaths,
    firebaseConfigPath: resolveEnvPath(envFilePaths.at(-1)!, firebaseConfig),
    name,
    posthogProjectId: POSTHOG_PROJECTS[name],
  };
}

function initFirebaseForTarget(target: PublishTarget): {
  app: App;
  bucketName: string;
} {
  const serviceAccount = JSON.parse(readFileSync(target.firebaseConfigPath, "utf8")) as ServiceAccount & {
    project_id?: string;
  };
  if (!serviceAccount.project_id) {
    throw new Error(`${target.name} Firebase service account is missing project_id`);
  }
  const bucketName = `${serviceAccount.project_id}.firebasestorage.app`;
  const appName = `alesia-demo-${target.name}`;
  const existing = getApps().find((app) => app.name === appName);
  const app =
    existing ??
    initializeApp(
      {
        credential: cert(serviceAccount),
        storageBucket: bucketName,
      },
      appName,
    );
  return { app, bucketName };
}

function firebaseMediaUrl(bucketName: string, storagePath: string): string {
  return `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(storagePath)}?alt=media`;
}

function rewriteDevBucketStaticUrls(html: string, bucketName: string): string {
  return html.replace(
    /https:\/\/firebasestorage\.googleapis\.com\/v0\/b\/brainjuice-dev\.firebasestorage\.app\/o\/([^"'()\s<>&]+)\?alt=media/g,
    (_match, encodedPath: string) =>
      firebaseMediaUrl(bucketName, decodeURIComponent(encodedPath)),
  );
}

function ensureNoTextSelectionCss(html: string): string {
  if (
    html.includes('id="brainjuice-no-text-selection-style"') ||
    html.includes("id='brainjuice-no-text-selection-style'")
  ) {
    return html;
  }
  const style = `<style id="brainjuice-no-text-selection-style">
html,body,body *{-webkit-touch-callout:none!important;-webkit-user-select:none!important;user-select:none!important}
::selection{background:transparent!important}
</style>`;
  return html.includes("</head>") ? html.replace("</head>", `${style}</head>`) : `${style}${html}`;
}

function assertFinalPackage() {
  const requiredFiles = ["index.html", ...slideFilenames()];
  for (const filename of requiredFiles) {
    const path = join(FINAL_PACKAGE_DIR, filename);
    if (!existsSync(path) || !statSync(path).isFile()) {
      throw new Error(`Missing final package file: ${path}`);
    }
  }
}

function slideFilenames(): string[] {
  return Array.from({ length: 9 }, (_, index) => `slide-${String(index + 1).padStart(2, "0")}.webp`);
}

async function uploadBuffer(args: {
  app: App;
  contentType: string;
  data: Buffer | string;
  storagePath: string;
}) {
  const bucket = getStorage(args.app).bucket();
  const buffer = Buffer.isBuffer(args.data) ? args.data : Buffer.from(args.data);
  const isText = args.contentType.startsWith("text/") || args.contentType === "application/javascript";
  await bucket.file(args.storagePath).save(isText ? gzipSync(buffer) : buffer, {
    metadata: {
      cacheControl: "public, max-age=31536000, immutable",
      contentEncoding: isText ? "gzip" : undefined,
      contentType: args.contentType,
    },
  });
}

async function uploadArtifact(target: PublishTarget) {
  const { app, bucketName } = initFirebaseForTarget(target);
  const storagePrefix = `brainjuice/generated/${POST_ID}`;

  for (const filename of slideFilenames()) {
    await uploadBuffer({
      app,
      contentType: "image/webp",
      data: readFileSync(join(FINAL_PACKAGE_DIR, filename)),
      storagePath: `${storagePrefix}/${filename}`,
    });
  }

  let html = readFileSync(join(FINAL_PACKAGE_DIR, "index.html"), "utf8");
  html = rewriteDevBucketStaticUrls(html, bucketName);
  for (const filename of slideFilenames()) {
    html = html.replaceAll(filename, firebaseMediaUrl(bucketName, `${storagePrefix}/${filename}`));
  }
  html = ensureNoTextSelectionCss(html);

  const indexStoragePath = `${storagePrefix}/artifact/index.html`;
  await uploadBuffer({
    app,
    contentType: "text/html; charset=utf-8",
    data: html,
    storagePath: indexStoragePath,
  });

  return {
    artifactUrl: firebaseMediaUrl(bucketName, indexStoragePath),
    bucketName,
    uploadedFileCount: 10,
  };
}

async function upsertDatabaseRows(target: PublishTarget, artifactUrl: string) {
  const pool = new pg.Pool({
    connectionString: target.databaseUrl,
    max: 2,
    ssl: target.databaseSsl,
  });
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(
      `insert into "user" (id, email, name, language)
       values ($1, $2, $3, $4)
       on conflict (id) do nothing`,
      [DEMO_USER_ID, "demo@brainjuice.dev", "Brainjuice Demo", "en"],
    );
    await client.query(
      `insert into feed (
        id, name, origin_type, origin_info, gen_state, gen_info, gen_history,
        user_id, picture_path, short_desc, contents, language, first_post_id,
        gen_duration_ms, observation_id, picture, source_podcast_episode_id, userfile_id
      ) values (
        $1, $2, 'USER', $3::jsonb, 'COMPLETE', '{}'::jsonb, '[]'::jsonb,
        $4, null, $5, $6::jsonb, 'en', $7,
        null, null, null, null, null
      )
      on conflict (id) do update set
        name = excluded.name,
        origin_type = excluded.origin_type,
        origin_info = excluded.origin_info,
        gen_state = excluded.gen_state,
        gen_info = excluded.gen_info,
        gen_history = excluded.gen_history,
        user_id = excluded.user_id,
        short_desc = excluded.short_desc,
        contents = excluded.contents,
        language = excluded.language`,
      [
        DEMO_FEED_ID,
        "Brainjuice Rendered Demo Feed",
        JSON.stringify({ source: SOURCE_LABEL }),
        DEMO_USER_ID,
        "Onboarding demo feed for Brainjuice sample videos.",
        JSON.stringify({ demo: true, onboarding: true }),
        POST_ID,
      ],
    );
    await client.query(
      `insert into synthuser (
        id, name, username, picture, gender, tagline, profession, visual_description
      ) values
        ${DEMO_SYNTH_USERS.map(
          (_, index) =>
            `($${index * 8 + 1}, $${index * 8 + 2}, $${index * 8 + 3}, $${index * 8 + 4}, $${index * 8 + 5}, $${index * 8 + 6}, $${index * 8 + 7}, $${index * 8 + 8})`,
        ).join(", ")}
      on conflict (id) do update set
        name = excluded.name,
        username = excluded.username,
        picture = excluded.picture,
        gender = excluded.gender,
        tagline = excluded.tagline,
        profession = excluded.profession,
        visual_description = excluded.visual_description`,
      DEMO_SYNTH_USERS.flatMap((user) => [
        user.id,
        user.name,
        user.username,
        user.picture,
        "unknown",
        "Brainjuice onboarding demo persona",
        "Demo learner",
        "Friendly illustrated avatar for onboarding demo testing.",
      ]),
    );
    for (const profile of DEMO_SYNTH_USERS) {
      await client.query(
        `insert into profile (
          id, name, type, feed_id, chapter_id, owner_user_id, synthuser_id, user_id
        ) values ($1, $2, 'SYNTHETIC', $3, null, null, $4, null)
        on conflict (id) do update set
          name = excluded.name,
          type = excluded.type,
          feed_id = excluded.feed_id,
          synthuser_id = excluded.synthuser_id`,
        [profile.profileId, profile.name, DEMO_FEED_ID, profile.id],
      );
    }
    await client.query(
      `insert into chapter (
        id, feed_id, name, "desc", sort_order, gen_state, gen_info, gen_history,
        origin_info, origin_type, contents, gen_duration_ms, learning_topic_id,
        observation_id, suggested_by
      ) values (
        $1, $2, $3, $4, 0, 'COMPLETE', '{}'::jsonb, '[]'::jsonb,
        $5::jsonb, 'USER', $6::jsonb, null, null, null, null
      )
      on conflict (id) do update set
        feed_id = excluded.feed_id,
        name = excluded.name,
        "desc" = excluded."desc",
        sort_order = excluded.sort_order,
        gen_state = excluded.gen_state,
        gen_info = excluded.gen_info,
        gen_history = excluded.gen_history,
        origin_info = excluded.origin_info,
        origin_type = excluded.origin_type,
        contents = excluded.contents`,
      [
        DEMO_CHAPTER_ID,
        DEMO_FEED_ID,
        "Brainjuice onboarding demos",
        "Demo videos for Brainjuice onboarding.",
        JSON.stringify({ source: SOURCE_LABEL }),
        JSON.stringify({ demo: true, onboarding: true }),
      ],
    );

    const contents = {
      description: POST_DESCRIPTION,
      shortTitle: POST_TITLE,
      videoData: {
        durationSeconds: DURATION_SECONDS,
        props: {},
        recompiledAt: new Date().toISOString(),
        renderer: "html-slideshow",
        templateId: "POVSlideshowTemplate",
      },
      videoDescription: POST_DESCRIPTION,
    };
    await client.query(
      `insert into post (
        id, chapter_id, contents, display_style, gen_state, gen_info, gen_history,
        origin_info, origin_type, parent_post_id, poster_profile_id, sort_order,
        seed_vote_count, text, attachment, gen_duration_ms, observation_id, quiz_data, user_interactions
      ) values (
        $1, $2, $3::jsonb, 'BASIC', 'COMPLETE', '{}'::jsonb, '[]'::jsonb,
        $4::jsonb, 'USER', null, $5, $6, $7, $8, null, null, null, null, null
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
        text = excluded.text`,
      [
        POST_ID,
        DEMO_CHAPTER_ID,
        JSON.stringify(contents),
        JSON.stringify({
          firebaseStoragePath: `brainjuice/generated/${POST_ID}/artifact/index.html`,
          source: SOURCE_LABEL,
          viewerUrl: artifactUrl,
        }),
        DEMO_PROFILE_ID,
        INSERT_INDEX,
        39,
        POST_TITLE,
      ],
    );

    for (const [index, text] of COMMENTS.entries()) {
      const commenter = DEMO_SYNTH_USERS[(index % (DEMO_SYNTH_USERS.length - 1)) + 1]!;
      await client.query(
        `insert into post (
          id, chapter_id, contents, display_style, gen_state, gen_info, gen_history,
          origin_info, origin_type, parent_post_id, poster_profile_id, sort_order,
          seed_vote_count, text, attachment, gen_duration_ms, observation_id, quiz_data, user_interactions
        ) values (
          $1, $2, null, 'COMMENT', 'COMPLETE', '{}'::jsonb, '[]'::jsonb,
          $3::jsonb, 'LLM', $4, $5, $6, $7, $8, null, null, null, null, null
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
          text = excluded.text`,
        [
          `${POST_ID}_c${String(index + 1).padStart(2, "0")}`,
          DEMO_CHAPTER_ID,
          JSON.stringify({
            parentPostId: POST_ID,
            source: SOURCE_LABEL,
          }),
          POST_ID,
          commenter.profileId,
          index,
          Math.max(1, 18 - index),
          text,
        ],
      );
    }
    await client.query(`update feed set first_post_id = $1 where id = $2`, [
      POST_ID,
      DEMO_FEED_ID,
    ]);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

function loadPosthogEnv(): EnvMap {
  return loadDotenvFile(join(HONO_ROOT, ".env.local"));
}

function parsePayload(payload: unknown): {
  postIds: string[];
  postTagMap: Record<string, string[]>;
} {
  if (typeof payload === "string") {
    try {
      return parsePayload(JSON.parse(payload));
    } catch {
      return { postIds: [], postTagMap: {} };
    }
  }
  if (Array.isArray(payload)) {
    return {
      postIds: payload.filter((value): value is string => typeof value === "string" && value.length > 0),
      postTagMap: {},
    };
  }
  if (!payload || typeof payload !== "object") {
    return { postIds: [], postTagMap: {} };
  }
  const record = payload as { postIds?: unknown; postTagMap?: unknown };
  const postIds = Array.isArray(record.postIds)
    ? record.postIds.filter((value): value is string => typeof value === "string" && value.length > 0)
    : [];
  const postTagMap: Record<string, string[]> = {};
  if (record.postTagMap && typeof record.postTagMap === "object" && !Array.isArray(record.postTagMap)) {
    for (const [key, value] of Object.entries(record.postTagMap)) {
      if (!Array.isArray(value)) continue;
      const tags = value.filter((tag): tag is string => typeof tag === "string" && tag.length > 0);
      if (tags.length > 0) postTagMap[key] = tags;
    }
  }
  return { postIds, postTagMap };
}

function insertPostIdAtIndex(postIds: string[]): string[] {
  const withoutPost = postIds.filter((id) => id !== POST_ID);
  withoutPost.splice(Math.min(INSERT_INDEX, withoutPost.length), 0, POST_ID);
  return withoutPost;
}

async function updatePosthogFlag(target: PublishTarget, dryRun: boolean) {
  const posthogEnv = loadPosthogEnv();
  const host = posthogEnv.POSTHOG_HOST;
  const apiKey = posthogEnv.POSTHOG_PERSONAL_API_KEY;
  if (!host || !apiKey) {
    throw new Error("Missing POSTHOG_HOST or POSTHOG_PERSONAL_API_KEY in hivemind-hono/.env.local");
  }
  const baseUrl = `${host}/api/projects/${target.posthogProjectId}`;
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
  const listResponse = await fetch(
    `${baseUrl}/feature_flags/?search=${encodeURIComponent(POSTHOG_FLAG_KEY)}`,
    { headers },
  );
  if (!listResponse.ok) {
    throw new Error(
      `${target.name} PostHog feature flag lookup failed ${listResponse.status}: ${await listResponse.text()}`,
    );
  }
  const listData = (await listResponse.json()) as {
    results?: Array<{ filters?: { payloads?: { true?: unknown } }; id: number; key: string; name?: string }>;
  };
  const existing = listData.results?.find((flag) => flag.key === POSTHOG_FLAG_KEY);
  const parsed = existing
    ? parsePayload(existing.filters?.payloads?.true)
    : {
        postIds: FALLBACK_SAMPLE_POST_IDS,
        postTagMap: FALLBACK_SAMPLE_POST_TAG_MAP,
      };
  const nextPayload = {
    postIds: insertPostIdAtIndex(parsed.postIds),
    postTagMap: {
      ...parsed.postTagMap,
      [POST_ID]: TAG_IDS,
    },
  };
  const filters = {
    aggregation_group_type_index: null,
    groups: [
      {
        aggregation_group_type_index: null,
        properties: [],
        rollout_percentage: 100,
        variant: null,
      },
    ],
    multivariate: null,
    payloads: {
      true: JSON.stringify(nextPayload),
    },
  };

  if (dryRun) {
    console.log(`[dry-run] ${target.name} PostHog next payload`, nextPayload);
    return nextPayload;
  }

  const body = JSON.stringify({
    active: true,
    filters,
    key: POSTHOG_FLAG_KEY,
    name: existing?.name ?? "Brainjuice onboarding demo post IDs",
  });
  const response = existing
    ? await fetch(`${baseUrl}/feature_flags/${existing.id}/`, {
        body,
        headers,
        method: "PATCH",
      })
    : await fetch(`${baseUrl}/feature_flags/`, {
        body,
        headers,
        method: "POST",
      });
  if (!response.ok) {
    throw new Error(
      `${target.name} PostHog feature flag update failed ${response.status}: ${await response.text()}`,
    );
  }
  return nextPayload;
}

async function verifyDatabase(target: PublishTarget) {
  const pool = new pg.Pool({
    connectionString: target.databaseUrl,
    max: 1,
    ssl: target.databaseSsl,
  });
  try {
    const result = await pool.query(
      `select
        p.id,
        p.text,
        p.sort_order,
        p.contents -> 'videoData' ->> 'renderer' as renderer,
        (
          select count(*)
          from post c
          where c.parent_post_id = p.id and c.display_style = 'COMMENT'
        )::int as comments
      from post p
      where p.id = $1`,
      [POST_ID],
    );
    return result.rows[0] as
      | {
          comments: number;
          id: string;
          renderer: string;
          sort_order: number;
          text: string;
        }
      | undefined;
  } finally {
    await pool.end();
  }
}

async function main() {
  const options = parseArgs(Bun.argv.slice(2));
  assertFinalPackage();
  const targets = options.targetNames.map(buildTarget);
  console.log("[alesia-demo] publishing", {
    dryRun: options.dryRun,
    postId: POST_ID,
    targets: targets.map((target) => target.name),
  });

  const summaries = [];
  for (const target of targets) {
    console.log(`[alesia-demo] target ${target.name}: upload artifact`);
    const upload = options.dryRun
      ? {
          artifactUrl: "(dry-run)",
          bucketName: JSON.parse(readFileSync(target.firebaseConfigPath, "utf8")).project_id + ".firebasestorage.app",
          uploadedFileCount: 0,
        }
      : await uploadArtifact(target);
    console.log(`[alesia-demo] target ${target.name}: upsert DB rows`);
    if (!options.dryRun) await upsertDatabaseRows(target, upload.artifactUrl);
    console.log(`[alesia-demo] target ${target.name}: update PostHog`);
    const posthogPayload = await updatePosthogFlag(target, options.dryRun);
    const dbRow = options.dryRun ? undefined : await verifyDatabase(target);
    summaries.push({
      artifactUrl: upload.artifactUrl,
      bucket: upload.bucketName,
      dbRow,
      posthogIndex: posthogPayload.postIds.indexOf(POST_ID),
      posthogPostCount: posthogPayload.postIds.length,
      target: target.name,
      uploadedFileCount: upload.uploadedFileCount,
    });
  }
  console.log(JSON.stringify({ postId: POST_ID, summaries }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
