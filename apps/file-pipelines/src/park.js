import fsp from "node:fs/promises";
import path from "node:path";
import { atomicWriteFile } from "@dscpln/server-kit";

// Parked ("awaiting review") outputs live under <reviewDir>/<folder>/ as the
// final standardized file plus a sidecar manifest next to it. Parked files are
// identical to what would land in the destination; placing them is an atomic
// rename, so the destination never sees partial files.

export const parkManifestName = (fileName) => `${fileName}.json`;

export function parkDirFor(config, folderName) {
  return path.join(config.reviewDir, folderName);
}

// Parked ids come from the review API (URL/body), so containment is enforced
// here for every caller: ids may never resolve outside the folder's park dir.
export function parkPathFor(config, folderName, id) {
  const dir = parkDirFor(config, folderName);
  const resolved = path.resolve(dir, String(id ?? ""));
  const root = path.resolve(dir);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error("invalid park path");
  }
  return resolved;
}

export async function readParkManifest(config, folderName, id) {
  try {
    const parsed = JSON.parse(
      await fsp.readFile(parkPathFor(config, folderName, parkManifestName(id)), "utf8"),
    );
    if (parsed && typeof parsed === "object" && typeof parsed.destName === "string") {
      return parsed;
    }
  } catch {
    // missing or unreadable manifest
  }
  return null;
}

export async function writeParkManifest(config, folderName, manifest) {
  const file = parkPathFor(config, folderName, parkManifestName(manifest.destName));
  await atomicWriteFile(file, JSON.stringify(manifest, null, 2) + "\n");
}

export async function removeParked(config, folderName, id) {
  await fsp.rm(parkPathFor(config, folderName, id), { force: true });
  await fsp.rm(parkPathFor(config, folderName, parkManifestName(id)), { force: true });
}

export async function listParked(config, folderName) {
  const dir = parkDirFor(config, folderName);
  const names = await fsp.readdir(dir).catch(() => []);
  const entries = [];
  for (const name of names) {
    if (name.startsWith(".") || name.endsWith(".json")) continue;
    const manifest = await readParkManifest(config, folderName, name);
    if (!manifest) continue;
    const stat = await fsp.stat(path.join(dir, name)).catch(() => null);
    if (!stat || !stat.isFile()) continue;
    entries.push({
      id: name,
      folder: folderName,
      destName: manifest.destName,
      chat: manifest.chat ?? null,
      date: manifest.date ?? null,
      inputs: manifest.inputs ?? [],
      expectedDuration: manifest.expectedDuration ?? null,
      size: stat.size,
      createdAt: manifest.createdAt ?? null,
      modifiedAt: stat.mtimeMs,
    });
  }
  entries.sort((a, b) => String(a.id).localeCompare(String(b.id)));
  return entries;
}
