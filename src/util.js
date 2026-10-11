import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";

export function expandPath(p) {
  if (!p) return p;
  let out = p;
  if (out === "~") out = os.homedir();
  else if (out.startsWith("~/")) out = path.join(os.homedir(), out.slice(2));
  out = out.replace(/\$(\{([A-Za-z_][A-Za-z0-9_]*)\}|([A-Za-z_][A-Za-z0-9_]*))/g, (_, _m, a, b) => process.env[a ?? b] ?? "");
  return path.resolve(out);
}

export function sha256File(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(file);
    stream.on("error", reject);
    stream.on("data", (d) => hash.update(d));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}


export async function atomicWriteFile(file, data) {
  const dir = path.dirname(file);
  await fsp.mkdir(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(file)}.tmp-${process.pid}-${Date.now()}`);
  const handle = await fsp.open(tmp, "w");
  try {
    await handle.writeFile(data);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await fsp.rename(tmp, file);
}

export async function pathExists(p) {
  try {
    await fsp.access(p);
    return true;
  } catch {
    return false;
  }
}

export function statOrNull(p) {
  try {
    return fs.statSync(p);
  } catch {
    return null;
  }
}


export function isHiddenName(name) {
  return name.startsWith(".");
}

export function isTempName(name) {
  if (name.endsWith(".tmp") || name.endsWith(".part") || name.endsWith("!sync")) return true;
  return false;
}

// Files/folders that are never ingested regardless of includeHidden: Syncthing
// internals/partials, media-sync scratch files and similar sync/temp artifacts.
export function isSyncOrTempName(name) {
  if (isTempName(name)) return true;
  if (name === ".stfolder" || name === ".stversions" || name === ".stignore" || name.startsWith(".stignore.")) return true;
  if (name.startsWith(".syncthing")) return true;
  if (name.startsWith(".media-sync")) return true;
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
