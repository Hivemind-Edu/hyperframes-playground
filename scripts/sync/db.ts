/**
 * Minimal Kysely-shaped DB schema for the tables we touch from the sync
 * step. Mirrors the brainjuice Postgres types we care about (subset of
 * hivemind-hono's generated.ts) so we can UPSERT without depending on the
 * full generated schema.
 *
 * If columns drift in hono, fix them here too.
 */

import { Kysely, PostgresDialect, sql, type Generated, type Insertable } from "kysely";
import pg from "pg";

export type Json = unknown;

type FeedRow = {
  id: string;
  contents: Json | null;
  first_post_id: string | null;
  gen_duration_ms: number | null;
  gen_history: Json;
  gen_info: Json;
  gen_state: string;
  inserttime: Generated<Date>;
  language: string | null;
  name: string;
  observation_id: string | null;
  origin_info: Json;
  origin_type: string;
  picture: Buffer | null;
  picture_path: string | null;
  pipeline_version: Generated<number>;
  short_desc: string | null;
  source_podcast_episode_id: string | null;
  user_id: string;
  userfile_id: string | null;
};

type ChapterRow = {
  id: string;
  contents: Json;
  desc: string;
  feed_id: string;
  gen_duration_ms: number | null;
  gen_history: Json;
  gen_info: Json;
  gen_state: string;
  inserttime: Generated<Date>;
  learning_topic_id: string | null;
  name: string;
  observation_id: string | null;
  origin_info: Json;
  origin_type: string;
  sort_order: number | null;
  suggested_by: string | null;
};

type ProfileRow = {
  id: string;
  chapter_id: string | null;
  feed_id: string | null;
  inserttime: Generated<Date>;
  name: string | null;
  owner_user_id: string | null;
  synthuser_id: string | null;
  type: string;
  user_id: string | null;
};

type PostRow = {
  id: string;
  attachment: Buffer | null;
  chapter_id: string;
  contents: Json | null;
  display_style: string;
  gen_duration_ms: number | null;
  gen_history: Json;
  gen_info: Json;
  gen_state: string;
  inserttime: Generated<Date>;
  observation_id: string | null;
  origin_info: Json;
  origin_type: string;
  parent_post_id: string | null;
  poster_profile_id: string | null;
  quiz_data: Json | null;
  seed_vote_count: Generated<number>;
  sort_order: number;
  text: string | null;
  user_interactions: Json | null;
};

type FeedtagRow = {
  feed_id: string;
  tag_id: string;
  inserttime: Generated<Date>;
};

export type Database = {
  feed: FeedRow;
  chapter: ChapterRow;
  profile: ProfileRow;
  post: PostRow;
  feedtag: FeedtagRow;
};

export type FeedInsert = Insertable<FeedRow>;
export type ChapterInsert = Insertable<ChapterRow>;
export type ProfileInsert = Insertable<ProfileRow>;
export type PostInsert = Insertable<PostRow>;
export type FeedtagInsert = Insertable<FeedtagRow>;

export function createDb(databaseUrl: string): Kysely<Database> {
  return new Kysely<Database>({
    dialect: new PostgresDialect({
      pool: new pg.Pool({ connectionString: databaseUrl, max: 4 }),
    }),
  });
}

export async function upsertFeed(
  db: Kysely<Database>,
  values: FeedInsert,
): Promise<void> {
  await db
    .insertInto("feed")
    .values(values)
    .onConflict((oc) =>
      oc.column("id").doUpdateSet({
        name: (eb) => eb.ref("excluded.name"),
        origin_type: (eb) => eb.ref("excluded.origin_type"),
        origin_info: (eb) => eb.ref("excluded.origin_info"),
        gen_state: (eb) => eb.ref("excluded.gen_state"),
        gen_info: (eb) => eb.ref("excluded.gen_info"),
        gen_history: (eb) => eb.ref("excluded.gen_history"),
        picture_path: (eb) => eb.ref("excluded.picture_path"),
        user_id: (eb) => eb.ref("excluded.user_id"),
        short_desc: (eb) => eb.ref("excluded.short_desc"),
        contents: (eb) => eb.ref("excluded.contents"),
        language: (eb) => eb.ref("excluded.language"),
      }),
    )
    .execute();
}

export async function upsertChapter(
  db: Kysely<Database>,
  values: ChapterInsert,
): Promise<void> {
  await db
    .insertInto("chapter")
    .values(values)
    .onConflict((oc) =>
      oc.column("id").doUpdateSet({
        name: (eb) => eb.ref("excluded.name"),
        desc: (eb) => eb.ref("excluded.desc"),
        feed_id: (eb) => eb.ref("excluded.feed_id"),
        sort_order: (eb) => eb.ref("excluded.sort_order"),
        gen_state: (eb) => eb.ref("excluded.gen_state"),
        gen_info: (eb) => eb.ref("excluded.gen_info"),
        gen_history: (eb) => eb.ref("excluded.gen_history"),
        origin_info: (eb) => eb.ref("excluded.origin_info"),
        origin_type: (eb) => eb.ref("excluded.origin_type"),
        contents: (eb) => eb.ref("excluded.contents"),
      }),
    )
    .execute();
}

export async function upsertProfile(
  db: Kysely<Database>,
  values: ProfileInsert,
): Promise<void> {
  await db
    .insertInto("profile")
    .values(values)
    .onConflict((oc) =>
      oc.column("id").doUpdateSet({
        name: (eb) => eb.ref("excluded.name"),
        type: (eb) => eb.ref("excluded.type"),
        feed_id: (eb) => eb.ref("excluded.feed_id"),
      }),
    )
    .execute();
}

export async function upsertPost(
  db: Kysely<Database>,
  values: PostInsert,
): Promise<void> {
  await db
    .insertInto("post")
    .values(values)
    .onConflict((oc) =>
      oc.column("id").doUpdateSet({
        chapter_id: (eb) => eb.ref("excluded.chapter_id"),
        contents: (eb) => eb.ref("excluded.contents"),
        display_style: (eb) => eb.ref("excluded.display_style"),
        gen_state: (eb) => eb.ref("excluded.gen_state"),
        gen_info: (eb) => eb.ref("excluded.gen_info"),
        gen_history: (eb) => eb.ref("excluded.gen_history"),
        origin_info: (eb) => eb.ref("excluded.origin_info"),
        origin_type: (eb) => eb.ref("excluded.origin_type"),
        parent_post_id: (eb) => eb.ref("excluded.parent_post_id"),
        poster_profile_id: (eb) => eb.ref("excluded.poster_profile_id"),
        sort_order: (eb) => eb.ref("excluded.sort_order"),
        text: (eb) => eb.ref("excluded.text"),
      }),
    )
    .execute();
}

export async function syncFeedtags(args: {
  db: Kysely<Database>;
  feedId: string;
  tagIds: string[];
}): Promise<void> {
  const { db, feedId, tagIds } = args;
  if (tagIds.length > 0) {
    await db
      .insertInto("feedtag")
      .values(tagIds.map((tag_id) => ({ feed_id: feedId, tag_id })))
      .onConflict((oc) => oc.columns(["feed_id", "tag_id"]).doNothing())
      .execute();
  }
  await db
    .deleteFrom("feedtag")
    .where("feed_id", "=", feedId)
    .where("tag_id", "not in", tagIds.length > 0 ? tagIds : ["__placeholder__"])
    .execute();
}

export async function setFeedFirstPost(args: {
  db: Kysely<Database>;
  feedId: string;
  firstPostId: string;
}): Promise<void> {
  await args.db
    .updateTable("feed")
    .set({ first_post_id: args.firstPostId })
    .where("id", "=", args.feedId)
    .execute();
}

export const jsonValue = <T,>(value: T) => sql`${JSON.stringify(value)}::jsonb`;
