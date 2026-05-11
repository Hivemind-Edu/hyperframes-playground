/**
 * Firebase Admin storage helpers — mirrors hivemind-hono's brainjuice asset
 * upload semantics:
 *
 *   - Gzip + cache-control:public,max-age=31536000,immutable for text/html,
 *     application/javascript, text/css
 *   - Plain upload for binary types
 *   - getFirebaseStorageMediaUrl produces the same `?alt=media` URL hono
 *     uses, so the brainjuice WebView player can resolve our uploads.
 */

import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getStorage } from "firebase-admin/storage";
import { gzipSync } from "node:zlib";
import { readFileSync, statSync } from "node:fs";
import { extname } from "node:path";

let configured = false;
let bucketName = "";

const GZIP_TYPES = new Set([
  "text/html",
  "text/css",
  "application/javascript",
  "application/json",
  "image/svg+xml",
]);

const CONTENT_TYPE_BY_EXT: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
};

const CACHE_CONTROL = "public, max-age=31536000, immutable";

export function initFirebase(config: {
  firebaseConfigPath: string;
  firebaseStorageBucket: string;
}): void {
  if (configured) return;
  const serviceAccount = JSON.parse(readFileSync(config.firebaseConfigPath, "utf8"));
  if (getApps().length === 0) {
    initializeApp({
      credential: cert(serviceAccount),
      storageBucket: config.firebaseStorageBucket,
    });
  }
  bucketName = config.firebaseStorageBucket;
  configured = true;
}

function inferContentType(filenameOrPath: string, override?: string): string {
  if (override) return override;
  const ext = extname(filenameOrPath).toLowerCase();
  return CONTENT_TYPE_BY_EXT[ext] ?? "application/octet-stream";
}

function isGzipCandidate(contentType: string): boolean {
  const mediaType = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  return GZIP_TYPES.has(mediaType);
}

export async function uploadBufferToStorage(args: {
  storagePath: string;
  data: Buffer | string;
  contentType?: string;
}): Promise<string> {
  if (!configured) throw new Error("Firebase not initialized");
  const buffer = Buffer.isBuffer(args.data) ? args.data : Buffer.from(args.data);
  const contentType = inferContentType(args.storagePath, args.contentType);
  const shouldGzip = isGzipCandidate(contentType);
  const finalData = shouldGzip ? gzipSync(buffer) : buffer;
  const file = getStorage().bucket().file(args.storagePath);
  const metadata: {
    cacheControl: string;
    contentType: string;
    contentEncoding?: string;
  } = {
    cacheControl: CACHE_CONTROL,
    contentType,
  };
  if (shouldGzip) metadata.contentEncoding = "gzip";
  await file.save(finalData, { metadata });
  return args.storagePath;
}

export async function uploadFileToStorage(args: {
  storagePath: string;
  localPath: string;
  contentType?: string;
}): Promise<string> {
  const stat = statSync(args.localPath);
  if (!stat.isFile()) throw new Error(`Not a file: ${args.localPath}`);
  return uploadBufferToStorage({
    storagePath: args.storagePath,
    data: readFileSync(args.localPath),
    contentType: args.contentType,
  });
}

export function getFirebaseStorageMediaUrl(storagePath: string): string {
  if (!bucketName) throw new Error("Firebase not initialized");
  return `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(storagePath)}?alt=media`;
}

export const BRAINJUICE_NO_TEXT_SELECTION_STYLE_ID = "brainjuice-no-text-selection-style";

export const BRAINJUICE_NO_TEXT_SELECTION_CSS = `
  html,
  body,
  body * {
    -webkit-touch-callout: none !important;
    -webkit-user-select: none !important;
    user-select: none !important;
  }

  ::selection {
    background: transparent !important;
  }
`;

export function ensureBrainjuiceNoTextSelectionCss(html: string): string {
  if (
    html.includes(`id="${BRAINJUICE_NO_TEXT_SELECTION_STYLE_ID}"`) ||
    html.includes(`id='${BRAINJUICE_NO_TEXT_SELECTION_STYLE_ID}'`)
  ) {
    return html;
  }
  const styleTag = `<style id="${BRAINJUICE_NO_TEXT_SELECTION_STYLE_ID}">${BRAINJUICE_NO_TEXT_SELECTION_CSS}</style>`;
  if (html.includes("</head>")) {
    return html.replace("</head>", `${styleTag}\n</head>`);
  }
  if (html.includes("<body")) {
    return html.replace("<body", `<head>${styleTag}</head>\n<body`);
  }
  return `${styleTag}\n${html}`;
}

const PLAYER_WIDTH = 393;
const PLAYER_HEIGHT = 769;

/**
 * Renders the brainjuice player shell that wraps the artifact in a
 * <hyperframes-player> element with the React-Native bridge wiring.
 * Mirrors hivemind-hono's `renderBrainjuiceHyperFramesPlayerShell`. The
 * playerScriptSrc must point at the player IIFE bundle in the env's
 * Firebase bucket.
 */
export function renderPlayerShellHtml(args: {
  compositionSrc: string;
  playerScriptSrc: string;
  debugLogsEnabled?: boolean;
}): string {
  const debug = args.debugLogsEnabled ?? false;
  const audioSessionScript = `(function () {
  try {
    if (navigator.audioSession) {
      navigator.audioSession.type = "playback";
    }
  } catch (error) {
    if (${debug ? "true" : "false"}) {
      console.warn("[Brainjuice HyperFrames Player] audioSession setup failed", error);
    }
  }
})();`;

  const controlScript = renderPlayerControlScript(debug);

  return `<!doctype html><html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover" /><script>${audioSessionScript}</script><script src="${args.playerScriptSrc}"></script><style>html,body{background:#000;height:100%;margin:0;overflow:hidden;padding:0;width:100%;}${BRAINJUICE_NO_TEXT_SELECTION_CSS}hyperframes-player{background:#000;display:block;height:100vh;width:100vw;}</style></head><body><hyperframes-player id="brainjuice-hyperframes-player" src="${args.compositionSrc}" width="${PLAYER_WIDTH}" height="${PLAYER_HEIGHT}" loop></hyperframes-player><script>${controlScript}</script></body></html>`;
}

function renderPlayerControlScript(debugLogsEnabled: boolean): string {
  // Verbatim port of hono's player control script. Kept as a single template
  // literal so the playground stays self-contained.
  return `(function () {
  var currentCommand = { command: "PAUSE", commandId: null, playbackRate: 1, playerId: null, postId: null, resetOnPause: false, shouldPlay: false };
  var isReady = false;
  var pendingSeekSeconds = null;
  var lastTimeUpdatePostMs = 0;
  var latestCommandId = null;
  var lastPlayHealthBaseline = null;
  var player = document.getElementById("brainjuice-hyperframes-player");
  var logPrefix = "[Brainjuice HyperFrames Player]";
  var debugLogsEnabled = ${debugLogsEnabled ? "true" : "false"};
  var SEEK_PLAY_DELAY_MS = 100;
  var TIMEUPDATE_POST_INTERVAL_MS = 500;
  var pendingSeekPlayTimer = null;

  function debugLog() { if (!debugLogsEnabled) return; console.log.apply(console, arguments); }
  function debugWarn() { if (!debugLogsEnabled) return; console.warn.apply(console, arguments); }

  debugLog(logPrefix, "boot", { playerFound: !!player, src: player ? player.getAttribute("src") : null, pageUrl: window.location.href });

  function post(type, data) {
    if (!window.ReactNativeWebView) return;
    window.ReactNativeWebView.postMessage(JSON.stringify({ data: data || {}, type: type }));
  }
  function postAck(command, state) {
    if (!command || command.commandId !== latestCommandId) return;
    post("brainjuice:hyperframes:ack", { commandId: command.commandId, playerId: command.playerId, postId: command.postId, state: state });
  }
  function clearPendingSeekPlay() { if (pendingSeekPlayTimer !== null) { window.clearTimeout(pendingSeekPlayTimer); pendingSeekPlayTimer = null; } }
  function play(command) {
    clearPendingSeekPlay();
    player.playbackRate = command.playbackRate;
    lastPlayHealthBaseline = { atMs: Date.now(), commandId: command.commandId, currentTime: (typeof player.currentTime === "number" ? player.currentTime : 0) };
    var result = player.play();
    if (result && typeof result.catch === "function") {
      result.then(function () { postAck(command, "playing"); })
            .catch(function (error) { debugWarn(logPrefix, "play failed", error); post("brainjuice:hyperframes:error", { commandId: command.commandId, message: error && error.message ? error.message : String(error), playerId: command.playerId, postId: command.postId, source: "play" }); postAck(command, "paused"); });
      return;
    }
    postAck(command, "playing");
  }
  function pause(command) {
    clearPendingSeekPlay();
    player.pause();
    if (typeof player.releaseAudioContext === "function") player.releaseAudioContext();
    if (command) postAck(command, "paused");
  }
  function playAfterSeekSettles(command) {
    clearPendingSeekPlay();
    pendingSeekPlayTimer = window.setTimeout(function () {
      pendingSeekPlayTimer = null;
      if (!isReady || latestCommandId !== command.commandId || currentCommand.commandId !== command.commandId || !currentCommand.shouldPlay || document.hidden) return;
      play(command);
    }, SEEK_PLAY_DELAY_MS);
  }
  function normalizeCommand(data) {
    var command = data && data.command === "PLAY" ? "PLAY" : data && data.command === "SEEK" ? "SEEK" : "PAUSE";
    var playbackRate = data && typeof data.playbackRate === "number" && Number.isFinite(data.playbackRate) ? data.playbackRate : 1;
    return {
      command: command,
      commandId: data && typeof data.commandId === "string" ? data.commandId : null,
      playbackRate: playbackRate,
      playerId: data && typeof data.playerId === "string" ? data.playerId : null,
      postId: data && typeof data.postId === "string" ? data.postId : null,
      resetOnPause: Boolean(data && data.resetOnPause),
      seconds: data && typeof data.seconds === "number" && Number.isFinite(data.seconds) ? data.seconds : null,
      shouldPlay: command === "PLAY" || Boolean(data && data.shouldPlay)
    };
  }
  function applyCommand(command) {
    if (!command.commandId) return;
    currentCommand = command;
    latestCommandId = command.commandId;
    player.loop = true;
    player.playbackRate = command.playbackRate;
    debugLog(logPrefix, "command", command);
    if (!isReady) {
      if (command.command === "SEEK") pendingSeekSeconds = command.seconds;
      pause(command.command === "PAUSE" ? command : null);
      return;
    }
    if (command.command === "SEEK") {
      player.seek(command.seconds == null ? 0 : command.seconds);
      if (command.shouldPlay) playAfterSeekSettles(command); else pause(command);
      return;
    }
    if (command.command === "PLAY") play(command);
    else { if (command.resetOnPause) player.seek(0); pause(command); }
  }
  window.__brainjuiceHyperFramesDispatch = function (serializedMessage) {
    try {
      var message = JSON.parse(serializedMessage);
      debugLog(logPrefix, "dispatch", message.type, message.data);
      if (message.type === "command") applyCommand(normalizeCommand(message.data));
    } catch (error) { debugWarn(logPrefix, "dispatch failed", error); post("brainjuice:hyperframes:error", { message: error && error.message ? error.message : String(error), source: "dispatch" }); }
  };
  post("brainjuice:hyperframes:bridge-ready", {});
  player.addEventListener("ready", function () {
    debugLog(logPrefix, "ready");
    pause();
    player.seek(pendingSeekSeconds == null ? 0 : pendingSeekSeconds);
    requestAnimationFrame(function () {
      isReady = true;
      if (!window.ReactNativeWebView) applyCommand(normalizeCommand({ command: "PLAY", commandId: "studio-autoplay", playbackRate: 1 }));
      else applyCommand(currentCommand);
      post("brainjuice:hyperframes:ready", {});
    });
  });
  player.addEventListener("timeupdate", function (event) {
    var now = Date.now();
    if (now - lastTimeUpdatePostMs < TIMEUPDATE_POST_INTERVAL_MS) return;
    var seconds = event.detail && event.detail.currentTime;
    if (typeof seconds !== "number" && typeof player.currentTime === "number") seconds = player.currentTime;
    if (typeof seconds === "number" && Number.isFinite(seconds)) { lastTimeUpdatePostMs = now; post("brainjuice:hyperframes:timeupdate", { seconds: seconds }); }
  });
  function handlePlayerError(event) {
    var detail = event.detail || {};
    debugWarn(logPrefix, "player error", { message: detail.message, source: detail.source || event.type });
    post("brainjuice:hyperframes:error", { message: detail.message, source: detail.source || event.type });
  }
  player.addEventListener("error", handlePlayerError);
  player.addEventListener("playbackerror", handlePlayerError);
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) { pause(); return; }
    if (!document.hidden && currentCommand.shouldPlay && isReady) play(currentCommand);
  });
  window.addEventListener("pagehide", function () { pause(); });
})();`;
}
