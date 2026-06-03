import { cert, getApps, initializeApp, type ServiceAccount } from "firebase-admin/app";
import { getStorage } from "firebase-admin/storage";
import { mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import pg from "pg";

type EnvMap = Record<string, string>;

type DemoPost = {
  description: string;
  id: string;
  seedVoteCount: number;
  tagIds: string[];
  title: string;
};

const PLAYGROUND_ROOT = resolve(import.meta.dir, "..");
const HIVEMIND_ROOT = resolve(PLAYGROUND_ROOT, "..");
const HONO_ROOT = join(HIVEMIND_ROOT, "hivemind-hono");
const ROMAN_SOURCE_DIR = join(
  PLAYGROUND_ROOT,
  "videos",
  "Demo Videos",
  "1 Generated",
  "8 RomanEmpireFall-GrokNanoBanana",
);
const ROMAN_ASSETS_DIR = join(ROMAN_SOURCE_DIR, "assets");
const DEMO_SOURCE_ROOT = join(
  PLAYGROUND_ROOT,
  "videos",
  "Brainjuice Dev Onboarding Rendered Demos",
);
const OUTPUT_ROOT = join(
  PLAYGROUND_ROOT,
  "build",
  "dev-onboarding-rendered-demos",
);
const POSTHOG_BRAINJUICE_DEV_PROJECT_ID = 131639;
const DEMO_POST_IDS_FLAG = "onboarding-brainjuice-demo-post-ids";
const DEMO_USER_ID = "DEMO";
const DEMO_FEED_ID = "f_brainjuice-onboarding-dev-rendered-demo";
const DEMO_CHAPTER_ID = "ch_brainjuice-onboarding-dev-rendered-demo";
const DEMO_PROFILE_ID = "prof_brainjuice-onboarding-dev-rendered-demo";
const DURATION_SECONDS = 48;
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

const DEMO_COMMENTER_SYNTH_USERS = DEMO_SYNTH_USERS.slice(1);

const demoPosts: DemoPost[] = [
  {
    id: "p_brainjuice-onboarding-dev-rendered-01-roman-empire-fall",
    seedVoteCount: 42,
    tagIds: ["history"],
    title: "Why Rome Started Falling Apart",
    description:
      "A rendered-only onboarding demo post using the RomanEmpireFall Grok Nano Banana composition as the first sample video.",
  },
  {
    id: "p_brainjuice-onboarding-dev-rendered-02-black-holes",
    seedVoteCount: 31,
    tagIds: ["mathematics"],
    title: "Black Holes Bend Time",
    description:
      "A fast visual explanation of why gravity near a black hole changes how time passes.",
  },
  {
    id: "p_brainjuice-onboarding-dev-rendered-03-market-crashes",
    seedVoteCount: 28,
    tagIds: ["finance"],
    title: "Why Markets Crash",
    description:
      "A simple model of leverage, panic, and feedback loops during a financial crash.",
  },
  {
    id: "p_brainjuice-onboarding-dev-rendered-04-antibiotics",
    seedVoteCount: 24,
    tagIds: ["health"],
    title: "How Antibiotics Fight Back",
    description:
      "A visual primer on how antibiotics disrupt bacteria and why resistance emerges.",
  },
  {
    id: "p_brainjuice-onboarding-dev-rendered-05-internet-packets",
    seedVoteCount: 22,
    tagIds: ["ai_tech"],
    title: "The Internet Ships Packets",
    description:
      "A quick breakdown of how messages are split, routed, and reassembled across networks.",
  },
  {
    id: "p_brainjuice-onboarding-dev-rendered-06-memory-tricks",
    seedVoteCount: 19,
    tagIds: ["psychology"],
    title: "Your Memory Edits Itself",
    description:
      "A compact explanation of how recall can reshape the memories it tries to retrieve.",
  },
  {
    id: "p_brainjuice-onboarding-dev-rendered-07-battery-aging",
    seedVoteCount: 17,
    tagIds: ["ai_tech"],
    title: "Why Batteries Fade",
    description:
      "A visual explanation of lithium-ion wear, charge cycles, and chemical side effects.",
  },
  {
    id: "p_brainjuice-onboarding-dev-rendered-08-dopamine-loop",
    seedVoteCount: 26,
    tagIds: ["psychology"],
    title: "Dopamine Is a Prediction Signal",
    description:
      "A simple explanation of why dopamine responds to surprise, cues, and expected rewards.",
  },
  {
    id: "p_brainjuice-onboarding-dev-rendered-09-volcanic-islands",
    seedVoteCount: 15,
    tagIds: ["environment"],
    title: "How Volcanoes Build Islands",
    description:
      "A quick tour of hotspots, magma, cooling lava, and the birth of new land.",
  },
  {
    id: "p_brainjuice-onboarding-dev-rendered-10-navigation-map",
    seedVoteCount: 21,
    tagIds: ["mathematics"],
    title: "The Map That Changed Navigation",
    description:
      "A short explanation of why map projections trade shape, direction, distance, and area.",
  },
];

const sceneVideos = [
  "scene-01-grok-imagine-1.5-720p.mp4",
  "scene-02-grok-imagine-1.5-720p.mp4",
  "scene-03-grok-imagine-1.5-720p.mp4",
  "scene-04-grok-imagine-1.5-720p.mp4",
  "scene-05-grok-imagine-1.5-720p.mp4",
  "scene-06-grok-imagine-1.5-720p.mp4",
  "scene-07-grok-imagine-1.5-720p.mp4",
  "scene-08-grok-imagine-1.5-720p.mp4",
  "scene-09-grok-imagine-1.5-720p.mp4",
  "scene-10-grok-imagine-1.5-720p.mp4",
  "scene-11-grok-imagine-1.5-720p.mp4",
  "scene-12-grok-imagine-1.5-720p.mp4",
];

function loadEnvFiles(paths: string[]): EnvMap {
  const env: EnvMap = {};
  for (const path of paths) {
    if (!existsSync(path)) continue;
    const raw = readFileSync(path, "utf8");
    for (const line of raw.split(/\r?\n/)) {
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
      process.env[key] ??= value;
    }
  }
  return env;
}

function required(env: EnvMap, key: string): string {
  const value = env[key] ?? process.env[key];
  if (!value) throw new Error(`Missing required env var ${key}`);
  return value;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function sourceDirForPost(post: DemoPost, index: number): string {
  if (index === 0) return ROMAN_SOURCE_DIR;
  return join(
    DEMO_SOURCE_ROOT,
    `${String(index + 1).padStart(2, "0")} ${post.id}`,
  );
}

function outputPathForPost(post: DemoPost): string {
  return join(OUTPUT_ROOT, post.id, "rendered.mp4");
}

function storagePathForPost(post: DemoPost): string {
  return `brainjuice/generated/${post.id}/rendered.mp4`;
}

function demoCommentsForPost(post: DemoPost, index: number) {
  return [
    {
      id: `${post.id}_comment_01`,
      profile:
        DEMO_COMMENTER_SYNTH_USERS[index % DEMO_COMMENTER_SYNTH_USERS.length]!,
      seedVoteCount: Math.max(1, Math.round(post.seedVoteCount / 4)),
      sortOrder: 0,
      text: `This made ${post.title.toLowerCase()} click faster than a normal explainer.`,
    },
    {
      id: `${post.id}_comment_02`,
      profile:
        DEMO_COMMENTER_SYNTH_USERS[
          (index + 1) % DEMO_COMMENTER_SYNTH_USERS.length
        ]!,
      seedVoteCount: Math.max(1, Math.round(post.seedVoteCount / 5)),
      sortOrder: 1,
      text: "The visual pacing feels right for onboarding. I would keep this in the demo feed.",
    },
  ];
}

async function ensureGeneratedCompositions() {
  await mkdir(DEMO_SOURCE_ROOT, { recursive: true });

  for (const [index, post] of demoPosts.entries()) {
    if (index === 0) continue;
    const sourceDir = sourceDirForPost(post, index);
    await mkdir(sourceDir, { recursive: true });
    await writeFile(
      join(sourceDir, "hyperframes.json"),
      `${JSON.stringify(
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
      )}\n`,
    );

    const assetsLink = join(sourceDir, "assets");
    if (!existsSync(assetsLink)) {
      await symlink(ROMAN_ASSETS_DIR, assetsLink, "dir");
    }

    await writeFile(join(sourceDir, "index.html"), renderDemoHtml(post, index));
  }
}

function renderDemoHtml(post: DemoPost, index: number): string {
  const sceneDuration = DURATION_SECONDS / sceneVideos.length;
  const hue = (index * 37) % 360;
  const captions = buildCaptions(post);
  const videoClips = sceneVideos
    .map((fileName, sceneIndex) => {
      const start = sceneIndex * sceneDuration;
      return `<video id="scene-video-${sceneIndex}" class="clip scene-video" data-start="${start.toFixed(3)}" data-duration="${sceneDuration.toFixed(3)}" data-track-index="${100 + sceneIndex}" src="assets/videos/${fileName}" muted playsinline loop></video>`;
    })
    .join("\n");
  const captionClips = captions
    .map((caption, captionIndex) => {
      const start = captionIndex * (DURATION_SECONDS / captions.length);
      return `<div id="caption-${captionIndex}" class="clip caption-card" data-start="${start.toFixed(3)}" data-duration="${(DURATION_SECONDS / captions.length).toFixed(3)}" data-track-index="${200 + captionIndex}"><span>${escapeHtml(caption.kicker)}</span><strong>${escapeHtml(caption.line)}</strong></div>`;
    })
    .join("\n");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(post.title)}</title>
    <style>
      html, body {
        background: #000;
        height: 100%;
        margin: 0;
        overflow: hidden;
        width: 100%;
      }

      [data-composition-id] {
        background: #050505;
        color: #fff;
        font-family: Arial, sans-serif;
        height: 768px;
        overflow: hidden;
        position: relative;
        width: 392px;
      }

      .scene-video {
        height: 100%;
        inset: 0;
        object-fit: cover;
        position: absolute;
        width: 100%;
      }

      .shade {
        background:
          radial-gradient(circle at 50% 16%, hsla(${hue}, 82%, 55%, 0.28), transparent 34%),
          linear-gradient(to bottom, rgba(0,0,0,0.1), rgba(0,0,0,0.88));
        inset: 0;
        position: absolute;
        z-index: 8;
      }

      .grain {
        background-image:
          repeating-linear-gradient(0deg, rgba(255,255,255,0.05) 0, rgba(255,255,255,0.05) 1px, transparent 1px, transparent 5px);
        inset: 0;
        mix-blend-mode: overlay;
        opacity: 0.22;
        position: absolute;
        z-index: 9;
      }

      .title {
        box-sizing: border-box;
        display: flex;
        flex-direction: column;
        gap: 10px;
        left: 0;
        padding: 42px 28px 0;
        position: absolute;
        right: 0;
        text-shadow: 0 5px 18px rgba(0,0,0,0.75);
        top: 0;
        z-index: 12;
      }

      .title span {
        color: hsla(${hue}, 100%, 82%, 0.92);
        font-size: 14px;
        font-weight: 800;
        letter-spacing: 0;
        text-transform: uppercase;
      }

      .title h1 {
        font-size: 38px;
        font-weight: 950;
        letter-spacing: 0;
        line-height: 1.02;
        margin: 0;
        max-width: 340px;
      }

      .caption-card {
        align-items: center;
        bottom: 118px;
        box-sizing: border-box;
        display: flex;
        flex-direction: column;
        gap: 8px;
        left: 22px;
        padding: 16px 18px;
        position: absolute;
        right: 22px;
        text-align: center;
        text-shadow: 0 4px 16px rgba(0,0,0,0.88);
        z-index: 14;
      }

      .caption-card span {
        color: hsla(${hue}, 95%, 82%, 0.94);
        font-size: 13px;
        font-weight: 900;
        letter-spacing: 0;
        text-transform: uppercase;
      }

      .caption-card strong {
        -webkit-text-stroke: 1.5px #000;
        color: #fff;
        font-size: 27px;
        font-weight: 950;
        letter-spacing: 0;
        line-height: 1.06;
        paint-order: stroke;
      }
    </style>
  </head>
  <body>
    <div id="${post.id}" data-composition-id="${post.id}" data-start="0" data-duration="${DURATION_SECONDS}" data-width="392" data-height="768">
      ${videoClips}
      <div class="shade"></div>
      <div class="grain"></div>
      <div class="title">
        <span>Brainjuice demo</span>
        <h1>${escapeHtml(post.title)}</h1>
      </div>
      ${captionClips}
    </div>
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
    <script>
      window.__timelines = window.__timelines || {};
      window.__timelines["${post.id}"] = gsap.timeline({ paused: true });
    </script>
  </body>
</html>
`;
}

function buildCaptions(post: DemoPost): { kicker: string; line: string }[] {
  const words = post.title.split(/\s+/).filter(Boolean);
  const anchor = words.slice(-2).join(" ");
  return [
    {
      kicker: "Start here",
      line: post.description.split(".")[0] ?? post.title,
    },
    {
      kicker: "Key idea",
      line: `${anchor} is easier when you see the system.`,
    },
    { kicker: "Look closer", line: "Small forces stack into visible change." },
    { kicker: "Pattern", line: "The important part is the feedback loop." },
    { kicker: "Remember", line: "Cause and effect rarely move in one line." },
    {
      kicker: "Final beat",
      line: "Once you spot the pattern, the topic clicks.",
    },
  ];
}

async function runCommand(command: string, args: string[], cwd: string) {
  console.log(
    `$ ${command} ${args.map((arg) => JSON.stringify(arg)).join(" ")}`,
  );
  const child = Bun.spawn([command, ...args], {
    cwd,
    stderr: "inherit",
    stdout: "inherit",
  });
  const exitCode = await child.exited;
  if (exitCode !== 0) {
    throw new Error(`${command} exited with ${exitCode}`);
  }
}

async function renderPost(post: DemoPost, index: number) {
  const sourceDir = sourceDirForPost(post, index);
  const outputPath = outputPathForPost(post);
  await mkdir(dirname(outputPath), { recursive: true });
  if (index === 0 && existsSync(outputPath)) {
    console.log("[dev demo] reuse existing Roman render", { outputPath });
    return;
  }
  await rm(outputPath, { force: true });
  const encoderArgs =
    index === 0 ? ["--crf", "26"] : ["--video-bitrate", "2500k"];
  await runCommand(
    "bunx",
    [
      "hyperframes",
      "render",
      sourceDir,
      "--output",
      outputPath,
      "--fps",
      "24",
      "--quality",
      "standard",
      ...encoderArgs,
      "--workers",
      "2",
    ],
    PLAYGROUND_ROOT,
  );
}

function initFirebase(firebaseConfigPath: string) {
  const serviceAccount = JSON.parse(
    readFileSync(firebaseConfigPath, "utf8"),
  ) as ServiceAccount & {
    project_id?: string;
  };
  if (!serviceAccount.project_id) {
    throw new Error("Firebase service account is missing project_id");
  }
  const storageBucket = `${serviceAccount.project_id}.firebasestorage.app`;
  if (getApps().length === 0) {
    initializeApp({
      credential: cert(serviceAccount),
      storageBucket,
    });
  }
  return storageBucket;
}

async function uploadRenderedVideos(storageBucket: string) {
  const bucket = getStorage().bucket(storageBucket);
  for (const post of demoPosts) {
    const localPath = outputPathForPost(post);
    if (!existsSync(localPath) || !statSync(localPath).isFile()) {
      throw new Error(`Rendered video missing: ${localPath}`);
    }
    const storagePath = storagePathForPost(post);
    console.log("[dev demo] upload", { localPath, storagePath });
    await bucket.upload(localPath, {
      destination: storagePath,
      metadata: {
        cacheControl: "public, max-age=31536000, immutable",
        contentType: "video/mp4",
      },
    });
  }
}

async function upsertDatabaseRows(databaseUrl: string) {
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 2 });
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
        $4, null, $5, $6::jsonb, 'en', null,
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
        JSON.stringify({ source: "hyperframes-playground-dev-rendered-demos" }),
        DEMO_USER_ID,
        "Rendered-only onboarding demo feed for local/dev testing.",
        JSON.stringify({ demo: true, renderedOnly: true }),
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
        "Friendly illustrated avatar for local onboarding demo testing.",
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
        "Rendered-only onboarding demos",
        "Ten rendered-only demo videos for Brainjuice onboarding.",
        JSON.stringify({ source: "hyperframes-playground-dev-rendered-demos" }),
        JSON.stringify({ demo: true, renderedOnly: true }),
      ],
    );

    for (const [index, post] of demoPosts.entries()) {
      const contents = {
        description: post.description,
        shortTitle: post.title,
        videoData: {
          durationSeconds: index === 0 ? 72.32 : DURATION_SECONDS,
          props: {},
          recompiledAt: new Date().toISOString(),
          renderedOnly: true,
          renderer: "hyperframes",
          templateId: "DemoHyperFramesRenderedOnlyArtifact",
        },
        videoDescription: post.description,
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
          post.id,
          DEMO_CHAPTER_ID,
          JSON.stringify(contents),
          JSON.stringify({
            firebaseStoragePath: storagePathForPost(post),
            source: "hyperframes-playground-dev-rendered-demos",
          }),
          DEMO_SYNTH_USERS[0]!.profileId,
          index,
          post.seedVoteCount,
          post.title,
        ],
      );

      for (const comment of demoCommentsForPost(post, index)) {
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
            comment.id,
            DEMO_CHAPTER_ID,
            JSON.stringify({
              parentPostId: post.id,
              source: "hyperframes-playground-dev-rendered-demos",
            }),
            post.id,
            comment.profile.profileId,
            comment.sortOrder,
            comment.seedVoteCount,
            comment.text,
          ],
        );
      }
    }

    await client.query(`update feed set first_post_id = $1 where id = $2`, [
      demoPosts[0]!.id,
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

async function upsertPosthogFlag(posthogEnv: EnvMap) {
  const host = required(posthogEnv, "POSTHOG_HOST");
  const apiKey = required(posthogEnv, "POSTHOG_PERSONAL_API_KEY");
  const baseUrl = `${host}/api/projects/${POSTHOG_BRAINJUICE_DEV_PROJECT_ID}`;
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
  const payload = JSON.stringify({
    postIds: demoPosts.map((post) => post.id),
    postTagMap: Object.fromEntries(
      demoPosts.map((post) => [post.id, post.tagIds]),
    ),
  });
  const filters = {
    groups: [
      {
        aggregation_group_type_index: null,
        properties: [],
        rollout_percentage: 100,
        variant: null,
      },
    ],
    payloads: {
      true: payload,
    },
    multivariate: null,
    aggregation_group_type_index: null,
  };

  const listResponse = await fetch(
    `${baseUrl}/feature_flags/?search=${encodeURIComponent(DEMO_POST_IDS_FLAG)}`,
    { headers },
  );
  if (!listResponse.ok) {
    throw new Error(
      `PostHog feature flag lookup failed ${listResponse.status}: ${await listResponse.text()}`,
    );
  }
  const listData = (await listResponse.json()) as {
    results?: { id: number; key: string }[];
  };
  const existing = listData.results?.find(
    (flag) => flag.key === DEMO_POST_IDS_FLAG,
  );

  if (existing) {
    const response = await fetch(`${baseUrl}/feature_flags/${existing.id}/`, {
      body: JSON.stringify({
        active: true,
        filters,
        key: DEMO_POST_IDS_FLAG,
        name: "Brainjuice dev onboarding rendered-only demo post IDs",
      }),
      headers,
      method: "PATCH",
    });
    if (!response.ok) {
      throw new Error(
        `PostHog feature flag update failed ${response.status}: ${await response.text()}`,
      );
    }
    console.log("[dev demo] updated PostHog flag", {
      flagId: existing.id,
      projectId: POSTHOG_BRAINJUICE_DEV_PROJECT_ID,
    });
    return;
  }

  const response = await fetch(`${baseUrl}/feature_flags/`, {
    body: JSON.stringify({
      active: true,
      filters,
      key: DEMO_POST_IDS_FLAG,
      name: "Brainjuice dev onboarding rendered-only demo post IDs",
    }),
    headers,
    method: "POST",
  });
  if (!response.ok) {
    throw new Error(
      `PostHog feature flag create failed ${response.status}: ${await response.text()}`,
    );
  }
  const created = (await response.json()) as { id: number };
  console.log("[dev demo] created PostHog flag", {
    flagId: created.id,
    projectId: POSTHOG_BRAINJUICE_DEV_PROJECT_ID,
  });
}

async function writeSummary(storageBucket: string) {
  const rows = demoPosts.map((post) => ({
    id: post.id,
    localPath: outputPathForPost(post),
    sizeBytes: statSync(outputPathForPost(post)).size,
    storagePath: storagePathForPost(post),
    url: `https://firebasestorage.googleapis.com/v0/b/${storageBucket}/o/${encodeURIComponent(storagePathForPost(post))}?alt=media`,
  }));
  await mkdir(OUTPUT_ROOT, { recursive: true });
  await writeFile(
    join(OUTPUT_ROOT, "summary.json"),
    `${JSON.stringify(rows, null, 2)}\n`,
  );
  console.table(
    rows.map((row) => ({
      id: row.id,
      mb: (row.sizeBytes / 1024 / 1024).toFixed(1),
      storagePath: row.storagePath,
    })),
  );
}

async function main() {
  const options = new Set(Bun.argv.slice(2));
  const prepareOnly = options.has("--prepare-only");
  const dbOnly = options.has("--db-only");
  const posthogOnly = options.has("--posthog-only");
  const skipRender = options.has("--skip-render");
  const skipPosthog = options.has("--skip-posthog");

  const firebaseEnv = loadEnvFiles([join(PLAYGROUND_ROOT, ".env.dev")]);
  const dbEnv = loadEnvFiles([
    join(HONO_ROOT, ".env.local"),
    join(HONO_ROOT, ".env.brainjuice.local"),
  ]);
  const posthogEnv = loadEnvFiles([join(HONO_ROOT, ".env.local")]);

  if (posthogOnly) {
    await upsertPosthogFlag(posthogEnv);
    return;
  }

  await ensureGeneratedCompositions();
  if (prepareOnly) {
    console.log("[dev demo] prepared source compositions", {
      sourceRoot: DEMO_SOURCE_ROOT,
    });
    return;
  }

  if (dbOnly) {
    await upsertDatabaseRows(required(dbEnv, "DATABASE_URL"));
    console.log("[dev demo] upserted database rows only");
    return;
  }

  if (!skipRender) {
    for (const [index, post] of demoPosts.entries()) {
      await renderPost(post, index);
    }
  }

  const storageBucket = initFirebase(required(firebaseEnv, "FIREBASE_CONFIG"));
  await uploadRenderedVideos(storageBucket);
  await upsertDatabaseRows(required(dbEnv, "DATABASE_URL"));
  await writeSummary(storageBucket);
  if (!skipPosthog) {
    await upsertPosthogFlag(posthogEnv);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
