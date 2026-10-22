import fsp from "node:fs/promises";
import path from "node:path";
import { configStore, expandPath, readJsonFile } from "@dscpln/server-kit";

export const METHODS = ["standardize", "snapchat", "copy", "reviewed-audio"];
export const MANUAL_PLACEMENT_METHODS = new Set(["standardize", "snapchat", "reviewed-audio"]);

export function defaultConfig() {
  return {
    bindHost: "127.0.0.1",
    port: 8791,
    concurrency: 2,
    trashRetentionDays: 30,
    settleSeconds: 60,
    maxAutoRetries: 3,
    stagingDir: "~/.file-pipelines/staging",
    reviewDir: "~/.file-pipelines/review",
    trashDir: "~/.file-pipelines/trash",
    logDir: "~/.file-pipelines/logs",
    syncLockFile: "~/.file-pipelines/lock.json",
    lockHeartbeatSeconds: 300,
    lockStaleSeconds: 900,
    // Failures always notify; success notifications when true. Delivery goes
    // through the portal relay (DSCPLN_PORTAL_URL), which owns the ntfy topic.
    notifySuccess: true,
    folders: [],
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
    // Notifications relay through the portal now; keep the pre-upgrade
    // notifySuccess choice that used to live under `ntfy`.
    notifySuccess: raw?.notifySuccess ?? raw?.ntfy?.notifySuccess ?? true,
    folders: Array.isArray(raw?.folders) ? raw.folders : [],
  };
  delete cfg.ntfy;
  cfg.notifySuccess = cfg.notifySuccess !== false;
  cfg.concurrency = Math.max(1, Math.floor(asNumber(cfg.concurrency, 2)));
  cfg.port = Math.max(0, Math.floor(asNumber(cfg.port, 8791)));
  if (cfg.port > 65535) cfg.port = 8791;
  cfg.trashRetentionDays = Math.max(0, asNumber(cfg.trashRetentionDays, 30));
  cfg.settleSeconds = Math.max(0, asNumber(cfg.settleSeconds, 60));
  cfg.maxAutoRetries = Math.max(0, Math.floor(asNumber(cfg.maxAutoRetries, 3)));
  cfg.lockHeartbeatSeconds = Math.max(10, asNumber(cfg.lockHeartbeatSeconds, 300));
  cfg.lockStaleSeconds = Math.max(cfg.lockHeartbeatSeconds * 2, asNumber(cfg.lockStaleSeconds, 900));
  // Runtime toggles are persisted separately by the daemon.
  delete cfg.paused;
  delete cfg.dryRun;
  cfg.stagingDir = expandPath(cfg.stagingDir);
  cfg.reviewDir = expandPath(cfg.reviewDir);
  cfg.trashDir = expandPath(cfg.trashDir);
  cfg.logDir = expandPath(cfg.logDir);
  cfg.syncLockFile = expandPath(cfg.syncLockFile);
  cfg.folders = cfg.folders.map((folder) => {
    // `voicenotes` was renamed to `reviewed-audio`; accept old configs and
    // normalize them on load/save so they do not need a manual migration.
    const method = folder.method === "voicenotes" ? "reviewed-audio" : folder.method;
    return {
      name: String(folder.name ?? "").trim(),
      source: expandPath(folder.source) || "",
      destination: expandPath(folder.destination),
      method,
      filePattern: folder.filePattern || null,
      datePattern: method === "reviewed-audio" ? String(folder.datePattern ?? "").trim() || null : null,
      concat: method === "reviewed-audio" ? folder.concat !== false : true,
      settleSeconds: folder.settleSeconds === undefined ? cfg.settleSeconds : Math.max(0, asNumber(folder.settleSeconds, cfg.settleSeconds)),
      groupWindowSeconds: Math.max(1, asNumber(folder.groupWindowSeconds, 15)),
      // Copy folders can mirror whole trees; reviewed audio always needs subdirs.
      recursive: Boolean(folder.recursive) || method === "reviewed-audio",
      includeHidden: Boolean(folder.includeHidden),
      onChanged: folder.onChanged === "conflict" ? "conflict" : "overwrite",
      // Reviewed audio is approval-only: the source files are the queue, so
      // the normal cleanup/manual-parking flags do not apply.
      cleanup: method === "reviewed-audio" ? false : folder.cleanup !== false,
      placement: method === "reviewed-audio" ? "manual" : folder.placement === "manual" ? "manual" : "auto",
      autoProcess: method === "reviewed-audio" ? false : Boolean(folder.autoProcess),
      notify: folder.notify === "errors" ? "errors" : "all",
    };
  });
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
    if (folder.method === "reviewed-audio" && folder.datePattern) {
      try {
        new RegExp(folder.datePattern);
      } catch (err) {
        errors.push(`folder ${folder.name}: invalid datePattern: ${err.message}`);
      }
    }
    if (folder.placement === "manual" && !MANUAL_PLACEMENT_METHODS.has(folder.method)) {
      errors.push(`folder ${folder.name}: manual placement is only supported for ${[...MANUAL_PLACEMENT_METHODS].join(", ")}`);
    }
    if (folder.source && folder.destination) {
      const dst = path.resolve(folder.destination);
      const src = path.resolve(folder.source);
      if (src === dst) errors.push(`folder ${folder.name}: source and destination are the same`);
      if (dst.startsWith(src + path.sep)) errors.push(`folder ${folder.name}: destination is inside source`);
      if (src.startsWith(dst + path.sep)) errors.push(`folder ${folder.name}: source is inside destination`);
    }
  }
  if (!cfg.stagingDir) errors.push("stagingDir is required");
  if (!cfg.reviewDir) errors.push("reviewDir is required");
  if (!cfg.trashDir) errors.push("trashDir is required");
  if (errors.length > 0) {
    const err = new Error(`invalid config: ${errors.join("; ")}`);
    err.validationErrors = errors;
    throw err;
  }
  return cfg;
}

function storeFor(file) {
  return configStore(file, {
    defaults: defaultConfig(),
    normalize: normalizeConfig,
    validate: validateConfig,
  });
}

export async function loadConfig(file) {
  // Read the raw file once to migrate the old in-config runtime toggles; the
  // persisted config itself is owned by configStore and never contains them.
  const legacy = await readJsonFile(file, null);
  const cfg = await storeFor(file).load();
  return { ...cfg, paused: legacy?.paused === true, dryRun: legacy?.dryRun === true };
}

export async function saveConfig(file, cfg) {
  await storeFor(file).save(cfg);
}

export async function ensureRuntimeDirs(cfg, warn = () => {}) {
  const dirs = [
    ["staging", cfg.stagingDir],
    ["review", cfg.reviewDir],
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
