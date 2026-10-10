import fsp from "node:fs/promises";
import path from "node:path";
import { atomicWriteFile, expandPath, pathExists } from "./util.js";

export const METHODS = ["standardize", "snapchat", "copy"];

export function defaultConfig() {
  return {
    configVersion: 1,
    bindHost: "127.0.0.1",
    port: 8791,
    concurrency: 2,
    paused: false,
    dryRun: false,
    trashRetentionDays: 30,
    settleSeconds: 60,
    maxAutoRetries: 3,
    stagingDir: "~/Main/.media-sync-staging",
    trashDir: "~/.media-sync/trash",
    logDir: "~/.media-sync/logs",
    syncLockFile: "~/deviceSync/.media-sync.lock",
    lockHeartbeatSeconds: 300,
    lockStaleSeconds: 900,
    ntfy: { url: "", token: "" },
    folders: [
      {
        name: "Camera",
        source: "~/deviceSync/DCIM/Camera",
        destination: "~/Main/Media/Camera",
        method: "standardize",
        settleSeconds: 60,
      },
      {
        name: "Screenshots",
        source: "~/deviceSync/Screenshots",
        destination: "~/Main/Media/Screenshots",
        method: "standardize",
        settleSeconds: 60,
      },
      {
        name: "Screen Recs",
        source: "~/deviceSync/ScreenRecs",
        destination: "~/Main/Media/Screenshots",
        method: "standardize",
        settleSeconds: 60,
      },
      {
        name: "Snapchat",
        source: "~/deviceSync/DCIM/Snapchat",
        destination: "~/Main/Media/Camera",
        method: "snapchat",
        filePattern: "Snapchat-*.mp4",
        groupWindowSeconds: 15,
        settleSeconds: 1800,
      },
      {
        name: "Calls",
        source: "~/deviceSync/Calls",
        destination: "~/Main/Media/Recordings/Call Recorder",
        method: "copy",
        settleSeconds: 60,
      },
    ],
  };
}

function asNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function normalizeConfig(raw) {
  const cfg = {
    ...defaultConfig(),
    ...raw,
    ntfy: { url: "", token: "", ...(raw?.ntfy ?? {}) },
    folders: Array.isArray(raw?.folders) ? raw.folders : [],
  };
  cfg.concurrency = Math.max(1, Math.floor(asNumber(cfg.concurrency, 2)));
  cfg.port = Math.max(0, Math.floor(asNumber(cfg.port, 8791)));
  if (cfg.port > 65535) cfg.port = 8791;
  cfg.trashRetentionDays = Math.max(0, asNumber(cfg.trashRetentionDays, 30));
  cfg.settleSeconds = Math.max(0, asNumber(cfg.settleSeconds, 60));
  cfg.maxAutoRetries = Math.max(0, Math.floor(asNumber(cfg.maxAutoRetries, 3)));
  cfg.lockHeartbeatSeconds = Math.max(10, asNumber(cfg.lockHeartbeatSeconds, 300));
  cfg.lockStaleSeconds = Math.max(cfg.lockHeartbeatSeconds * 2, asNumber(cfg.lockStaleSeconds, 900));
  cfg.paused = Boolean(cfg.paused);
  cfg.dryRun = Boolean(cfg.dryRun);
  cfg.stagingDir = expandPath(cfg.stagingDir);
  cfg.trashDir = expandPath(cfg.trashDir);
  cfg.logDir = expandPath(cfg.logDir);
  cfg.syncLockFile = expandPath(cfg.syncLockFile);
  cfg.folders = cfg.folders.map((folder) => ({
    name: String(folder.name ?? "").trim(),
    source: expandPath(folder.source),
    destination: expandPath(folder.destination),
    method: folder.method,
    filePattern: folder.filePattern || null,
    settleSeconds: folder.settleSeconds === undefined ? cfg.settleSeconds : Math.max(0, asNumber(folder.settleSeconds, cfg.settleSeconds)),
    groupWindowSeconds: Math.max(1, asNumber(folder.groupWindowSeconds, 15)),
  }));
  return cfg;
}

export function validateConfig(cfg) {
  const errors = [];
  const seen = new Set();
  for (const folder of cfg.folders) {
    if (!folder.name) errors.push("folder with empty name");
    if (seen.has(folder.name)) errors.push(`duplicate folder name: ${folder.name}`);
    seen.add(folder.name);
    if (!folder.source) errors.push(`folder ${folder.name}: missing source`);
    if (!folder.destination) errors.push(`folder ${folder.name}: missing destination`);
    if (!METHODS.includes(folder.method)) errors.push(`folder ${folder.name}: unknown method ${folder.method}`);
    if (folder.source && folder.destination) {
      const src = path.resolve(folder.source);
      const dst = path.resolve(folder.destination);
      if (src === dst) errors.push(`folder ${folder.name}: source and destination are the same`);
      if (dst.startsWith(src + path.sep)) errors.push(`folder ${folder.name}: destination is inside source`);
      if (src.startsWith(dst + path.sep)) errors.push(`folder ${folder.name}: source is inside destination`);
    }
  }
  if (!cfg.stagingDir) errors.push("stagingDir is required");
  if (!cfg.trashDir) errors.push("trashDir is required");
  if (errors.length > 0) {
    const err = new Error(`invalid config: ${errors.join("; ")}`);
    err.validationErrors = errors;
    throw err;
  }
  return cfg;
}

export async function loadConfig(file) {
  let raw = null;
  if (await pathExists(file)) {
    raw = JSON.parse(await fsp.readFile(file, "utf8"));
  }
  // Fresh installs start with no folders; everything is configured from the UI.
  const cfg = normalizeConfig(raw ?? { ...defaultConfig(), folders: [] });
  validateConfig(cfg);
  if (!raw) {
    await saveConfig(file, cfg);
  }
  return cfg;
}

export async function saveConfig(file, cfg) {
  await atomicWriteFile(file, JSON.stringify(cfg, null, 2) + "\n");
}

export async function ensureRuntimeDirs(cfg, warn = () => {}) {
  const dirs = [
    ["staging", cfg.stagingDir],
    ["trash", cfg.trashDir],
    ["log", cfg.logDir],
  ];
  for (const [label, dir] of dirs) {
    try {
      await fsp.mkdir(dir, { recursive: true });
    } catch (err) {
      warn(`could not create ${label} directory ${dir}: ${err.message}`);
    }
  }
}
