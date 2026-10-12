import fsp from "node:fs/promises";
import path from "node:path";
import { formatDateStamp, originalBaseOf, readBackDateTimeOriginal, splitName } from "./exif.js";
import { sha256File } from "./util.js";

export function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function taggedVariantRegex(standardName) {
  const { base, ext } = splitName(standardName);
  return new RegExp(`^${escapeRegex(base)}-\\[[^\\]]*\\]\\.${escapeRegex(ext)}$`);
}

export function findExpectedDestName(destNames, standardName) {
  if (destNames.includes(standardName)) return standardName;
  const tagged = taggedVariantRegex(standardName);
  return destNames.find((n) => tagged.test(n)) ?? null;
}

export class DirCache {
  constructor(ttlMs = 30_000) {
    this.ttlMs = ttlMs;
    this.entries = new Map();
  }

  async list(dir) {
    const now = Date.now();
    const cached = this.entries.get(dir);
    if (cached && now - cached.at < this.ttlMs) return cached.names;
    const names = await fsp.readdir(dir).catch(() => []);
    this.entries.set(dir, { at: now, names });
    return names;
  }

  invalidate(dir) {
    if (dir) this.entries.delete(dir);
    else this.entries.clear();
  }
}

export async function destNamesForSource(cache, destDir, sourceName) {
  const names = await cache.list(destDir);
  const exact = names.includes(sourceName) ? sourceName : null;
  const orig = originalBaseOf(sourceName);
  const re = new RegExp("-\\(" + escapeRegex(orig) + "\\)");
  const fuzzy = names
    .filter((n) => re.test(n))
    .filter((n) => {
      const { ext } = splitName(n);
      const { ext: srcExt } = splitName(sourceName);
      return ext.toLowerCase() === srcExt.toLowerCase();
    })
    .sort();
  return { exact, fuzzy: fuzzy.filter((n) => n !== exact) };
}

export function plausibleSameSize(a, b) {
  const diff = Math.abs(a - b);
  return diff <= Math.max(64 * 1024, a * 0.02);
}

export async function statSize(file) {
  try {
    const stat = await fsp.stat(file);
    if (!stat.isFile()) return null;
    return stat.size;
  } catch {
    return null;
  }
}

export function classifyDestMatch({ method, sourceSize, destSize }) {
  if (destSize === null) return "place";
  if (destSize === 0) return "conflict";
  if (method === "copy") return "duplicate";
  return plausibleSameSize(sourceSize, destSize) ? "duplicate" : "conflict";
}

export async function verificationFor({ method, sourcePath, destPath, exiftool }) {
  const destSize = await statSize(destPath);
  if (!destSize) return { ok: false, reason: destSize === 0 ? "destination file is empty" : "destination file missing" };
  if (method === "copy") {
    const [srcHash, dstHash] = await Promise.all([sha256File(sourcePath), sha256File(destPath)]);
    if (srcHash !== dstHash) return { ok: false, reason: "source and destination hashes differ" };
    return { ok: true, how: "hash" };
  }
  if (method === "standardize") {
    const name = path.basename(destPath);
    const dto = await readBackDateTimeOriginal(exiftool, destPath);
    const expectedStamp = name.slice(0, 19);
    if (dto) {
      const actualStamp = formatDateStamp(dto);
      if (actualStamp !== expectedStamp) {
        return { ok: false, reason: `destination date ${actualStamp} differs from its file name ${expectedStamp}` };
      }
      return { ok: true, how: "date" };
    }
    return { ok: true, how: "name" };
  }
  return { ok: true, how: "name" };
}

export function parseSnapInputs(rawInputs) {
  if (!rawInputs) return null;
  const text = Array.isArray(rawInputs) ? rawInputs[0] : rawInputs;
  if (typeof text !== "string" || text.trim() === "") return null;
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed.filter((x) => typeof x === "string");
  } catch {
    const list = text.split(",").map((s) => s.trim()).filter(Boolean);
    return list.length > 0 ? list : null;
  }
  return null;
}

export function isSnapOutputName(name) {
  return /\(Snap_[^)]*\)(?:-\[[^\]]*\])?\.[A-Za-z0-9]+$/.test(name);
}

export async function readSnapOutputs(cache, exiftool, destDir) {
  const names = await cache.list(destDir);
  const outputs = [];
  for (const name of names) {
    if (!isSnapOutputName(name)) continue;
    const file = path.join(destDir, name);
    const tags = await exiftool.readRaw(file, ["-m", "-api", "LargeFileSupport=1"]).catch(() => null);
    if (!tags) continue;
    const inputs = parseSnapInputs(tags.Inputs);
    if (!inputs) continue;
    outputs.push({
      path: file,
      name,
      inputs,
      expectedDuration: Number.parseFloat(tags.ExpectedDuration ?? "") || null,
    });
  }
  return outputs;
}

export function mapSnapInputs(outputs) {
  const map = new Map();
  for (const output of outputs) {
    for (const input of output.inputs) {
      if (!map.has(input)) map.set(input, output);
    }
  }
  return map;
}
