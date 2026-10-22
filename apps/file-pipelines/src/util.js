import fs from "node:fs";
import crypto from "node:crypto";

// App-specific helpers. Filesystem/config primitives (expandPath, atomic
// writes, stat/path checks) come from @dscpln/server-kit.

export function sha256File(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(file);
    stream.on("error", reject);
    stream.on("data", (d) => hash.update(d));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

export function isHiddenName(name) {
  return name.startsWith(".");
}

export function isTempName(name) {
  if (name.endsWith(".tmp") || name.endsWith(".part") || name.endsWith("!sync")) return true;
  return false;
}

// Files/folders that are never ingested regardless of includeHidden: Syncthing
// internals/partials, file-pipelines scratch files and similar sync/temp artifacts.
export function isSyncOrTempName(name) {
  if (isTempName(name)) return true;
  if (name.endsWith(".tmp.chck")) return true;
  if (name === ".stfolder" || name === ".stversions" || name === ".stignore" || name.startsWith(".stignore.")) return true;
  if (name.startsWith(".syncthing")) return true;
  if (name.startsWith(".file-pipelines")) return true;
  return false;
}

export function shouldSkipName(name, includeHidden = false) {
  if (isSyncOrTempName(name)) return true;
  return !includeHidden && isHiddenName(name);
}

export function isSyncConflictName(name) {
  return name.includes(".sync-conflict-");
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export function uniqueSuffix() {
  return `${Date.now().toString(36)}-${crypto.randomBytes(4).toString("hex")}`;
}

export function matchesPattern(name, pattern) {
  if (!pattern) return true;
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  const regexSource = escaped.replace(/\*/g, ".*").replace(/\?/g, ".");
  return new RegExp(`^${regexSource}$`).test(name);
}
