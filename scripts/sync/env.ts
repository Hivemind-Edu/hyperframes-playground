/**
 * Loads `.env.<env>` from the playground root and exposes the required
 * credentials. Caller must `await loadEnv("dev"|"staging"|"prod")` before
 * touching firebase or the database.
 */

import { existsSync, readFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export type SyncEnvName = "dev" | "staging" | "prod";

export type SyncEnvConfig = {
  envName: SyncEnvName;
  databaseUrl: string;
  firebaseConfigPath: string;
  firebaseStorageBucket: string;
  /**
   * Versioned brainjuice player script — referenced by player.html. We
   * trust hono's runtime upload to have placed this file in each env.
   */
  hyperframesPlayerStoragePath: string;
};

const playgroundRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

// Match hono's playerShell.tsx — keep in sync if hono updates HF.
const HYPERFRAMES_STORAGE_VERSION = "v0.5.7-main-brainjuice-audio-exclusive-2x";
const HYPERFRAMES_PLAYER_VERSION = "v0.5.7";
export const HYPERFRAMES_PLAYER_BUNDLE_FILENAME = `hyperframes-player-${HYPERFRAMES_PLAYER_VERSION}.global.js`;
export const HYPERFRAMES_PLAYER_BUNDLE_STORAGE_PATH = `brainjuice-runtime/hyperframes/${HYPERFRAMES_STORAGE_VERSION}/player/${HYPERFRAMES_PLAYER_BUNDLE_FILENAME}`;

const REQUIRED_VARS = ["DATABASE_URL", "FIREBASE_CONFIG"] as const;

function loadDotenv(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!existsSync(path)) return out;
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
    out[key] = value;
  }
  return out;
}

export function loadEnv(envName: SyncEnvName): SyncEnvConfig {
  const envFile = join(playgroundRoot, `.env.${envName}`);
  const fileVars = loadDotenv(envFile);

  for (const [key, value] of Object.entries(fileVars)) {
    if (process.env[key] === undefined) process.env[key] = value;
  }

  for (const key of REQUIRED_VARS) {
    if (!process.env[key]) {
      throw new Error(
        `Missing required env var ${key}. Set it in .env.${envName} (at ${envFile}) or in your shell.`,
      );
    }
  }

  const firebaseConfigPath = process.env.FIREBASE_CONFIG!;
  if (!existsSync(firebaseConfigPath)) {
    throw new Error(
      `FIREBASE_CONFIG points to a file that does not exist: ${firebaseConfigPath}`,
    );
  }
  const serviceAccount = JSON.parse(readFileSync(firebaseConfigPath, "utf8")) as {
    project_id?: string;
  };
  const storageBucket =
    process.env.FIREBASE_STORAGE_BUCKET ??
    (serviceAccount.project_id ? `${serviceAccount.project_id}.firebasestorage.app` : "");
  if (!storageBucket) {
    throw new Error(
      "Could not determine Firebase storage bucket. Set FIREBASE_STORAGE_BUCKET or ensure the service account JSON has project_id.",
    );
  }

  return {
    envName,
    databaseUrl: process.env.DATABASE_URL!,
    firebaseConfigPath,
    firebaseStorageBucket: storageBucket,
    hyperframesPlayerStoragePath: HYPERFRAMES_PLAYER_BUNDLE_STORAGE_PATH,
  };
}
