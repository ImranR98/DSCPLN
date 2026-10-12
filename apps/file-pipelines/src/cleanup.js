import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { findExpectedDestName, parseSnapInputs, verificationFor } from "./verify.js";
import { probeDuration } from "./ffmpeg.js";
import { DestExistsError, moveIntoPlace } from "./processors/place.js";
import { atomicWriteFile, pathExists, sha256File, uniqueSuffix } from "./util.js";
import { STATUS } from "./store.js";
import { voiceNoteDestName, voiceNoteGroupOf } from "./voicenotes.js";

const MANIFEST_NAME = ".manifest.json";

export async function verifyCleanupTarget(ctx, folder, file) {
  const { store, exiftool } = ctx;
  const sourcePath = path.join(folder.def.source, ...file.name.split("/"));
  if (!(await pathExists(sourcePath))) return { ok: false, reason: "source file is missing" };

  if (folder.def.method === "voicenotes") {
    const group = voiceNoteGroupOf(file.name, folder.def.datePattern);
    if (!group) return { ok: false, reason: "not a voice note (no date in the file name)" };
    const destName = voiceNoteDestName(group.chat, group.date);
    const destPath = path.join(folder.def.destination, destName);
    if (!(await pathExists(destPath))) return { ok: false, reason: "no verified merged file found in destination" };
    const tags = await exiftool.readRaw(destPath, ["-m", "-api", "LargeFileSupport=1"]).catch(() => null);
    const inputs = parseSnapInputs(tags?.Inputs);
    if (!inputs || !inputs.includes(file.name)) {
      return { ok: false, reason: "the merged destination file does not list this clip" };
    }
    return { ok: true, destPath, how: "xmp" };
  }

  if (folder.def.method === "snapchat") {
    await store.refreshSnapOutputs(folder, { force: true });
    const output = folder.snapInputMap.get(file.name);
    if (!output) return { ok: false, reason: "no destination output records this clip" };
    if (!(await pathExists(output.path))) return { ok: false, reason: "destination output is missing" };
    if (output.expectedDuration) {
      const actual = await probeDuration(output.path);
      const tolerance = 0.1 * Math.max(1, output.inputs.length);
      if (actual > 0 && Math.abs(output.expectedDuration - actual) > tolerance) {
        return { ok: false, reason: `destination output duration mismatch (${actual}s vs ${output.expectedDuration}s)` };
      }
    }
    return { ok: true, destPath: output.path, how: "xmp" };
  }

  const destDir = folder.def.destination;
  store.cache.invalidate(destDir);
  const names = await store.cache.list(destDir);
  let match = names.includes(file.name) ? file.name : null;
  if (!match) {
    const expected = await store.expectedDestName(folder, file);
    if (expected) match = findExpectedDestName(names, expected);
  }
  if (!match) return { ok: false, reason: "no verified file found in destination" };
  const destPath = path.join(destDir, match);
  const verification = await verificationFor({ method: folder.def.method, sourcePath, destPath, exiftool });
  if (!verification.ok) return { ok: false, reason: verification.reason };
  return { ok: true, destPath, how: verification.how, note: verification.note };
}

async function readManifest(dir) {
  try {
    const parsed = JSON.parse(await fsp.readFile(path.join(dir, MANIFEST_NAME), "utf8"));
    if (parsed && typeof parsed === "object" && parsed.files && typeof parsed.files === "object") {
      return parsed;
    }
  } catch {
    // missing or unreadable manifest
  }
  return { files: {} };
}

async function writeManifest(dir, manifest) {
  if (Object.keys(manifest.files).length === 0) {
    await fsp.rm(path.join(dir, MANIFEST_NAME), { force: true });
    return;
  }
  await atomicWriteFile(path.join(dir, MANIFEST_NAME), JSON.stringify(manifest, null, 2) + "\n");
}

export async function trashFile(ctx, sourcePath, origin = {}) {
  const { config } = ctx;
  const day = new Date().toISOString().slice(0, 10);
  const dir = path.join(config.trashDir, day);
  await fsp.mkdir(dir, { recursive: true });
  const base = path.basename(sourcePath);
  let storedName = base;
  if (await pathExists(path.join(dir, storedName))) {
    storedName = `${uniqueSuffix()}-${base}`;
  }
  const target = path.join(dir, storedName);
  let moved = false;
  try {
    await fsp.rename(sourcePath, target);
    moved = true;
  } catch (err) {
    if (err.code !== "EXDEV") throw err;
  }
  if (!moved) {
    await fsp.copyFile(sourcePath, target, fs.constants.COPYFILE_EXCL);
    const [srcHash, dstHash] = await Promise.all([sha256File(sourcePath), sha256File(target)]);
    if (srcHash !== dstHash) {
      await fsp.rm(target, { force: true });
      throw new Error("trash copy failed hash verification");
    }
    await fsp.unlink(sourcePath);
  }
  const manifest = await readManifest(dir);
  manifest.files[storedName] = {
    originalName: base,
    sourceDir: origin.sourceDir ?? null,
    folder: origin.folder ?? null,
    destName: origin.destName ?? null,
    cleanedAt: new Date().toISOString(),
  };
  await writeManifest(dir, manifest);
  return target;
}

export function cleanupPreview(folder) {
  return [...folder.files.values()]
    .filter((f) => f.status === STATUS.DONE || f.status === STATUS.DUPLICATE)
    .map((f) => ({ name: f.name, size: f.size, destName: f.destName, status: f.status }));
}

export async function cleanupFiles(ctx, folder, names) {
  const { store, log, notify } = ctx;
  if (folder.def.cleanup === false) {
    return names.map((name) => ({ name, ok: false, reason: "cleanup is disabled for this folder" }));
  }
  const results = [];
  let trashed = 0;
  let bytes = 0;
  for (const name of names) {
    const file = store.fileFor(folder.def.name, name);
    if (!file || (file.status !== STATUS.DONE && file.status !== STATUS.DUPLICATE)) {
      results.push({ name, ok: false, reason: "file is not in a processed state" });
      continue;
    }
    const verify = await verifyCleanupTarget(ctx, folder, file);
    if (!verify.ok) {
      store.updateFile(folder.def.name, name, {
        status: STATUS.CONFLICT,
        message: `cleanup blocked: ${verify.reason}`,
      });
      results.push({ name, ok: false, reason: verify.reason });
      continue;
    }
    try {
      const sourcePath = path.join(folder.def.source, name);
      const trashPath = await trashFile(ctx, sourcePath, {
        sourceDir: folder.def.source,
        folder: folder.def.name,
        destName: verify.destPath ? path.basename(verify.destPath) : file.destName ?? null,
      });
      store.removeFile(folder.def.name, name, STATUS.CLEANED);
      results.push({ name, ok: true, destPath: verify.destPath, trashPath });
      trashed++;
      bytes += file.size ?? 0;
    } catch (err) {
      store.updateFile(folder.def.name, name, {
        status: STATUS.ERROR,
        errorKind: "cleanup",
        message: `cleanup failed: ${err.message}`,
        nextRetryAt: 0,
      });
      results.push({ name, ok: false, reason: err.message });
    }
  }
  if (trashed > 0) log(`cleaned ${trashed} file(s) from ${folder.def.name} (${bytes} bytes)`);
  if (results.some((r) => !r.ok)) {
    notify.notify("warn", `${folder.def.name}: ${results.filter((r) => !r.ok).length} file(s) could not be cleaned`);
  }
  return results;
}

function dayString(offsetDays = 0) {
  const d = new Date(Date.now() - offsetDays * 86_400_000);
  return d.toISOString().slice(0, 10);
}

export function isValidDay(day) {
  return /^\d{4}-\d{2}-\d{2}$/.test(day);
}

export function isValidTrashName(name) {
  return typeof name === "string" && name.length > 0 && !name.startsWith(".") && !name.includes("/") && !name.includes("\\");
}

export async function listTrash(ctx) {
  const { config } = ctx;
  const entries = [];
  const days = await fsp.readdir(config.trashDir).catch(() => []);
  for (const day of days) {
    if (!isValidDay(day)) continue;
    const dir = path.join(config.trashDir, day);
    const stat = await fsp.stat(dir).catch(() => null);
    if (!stat?.isDirectory()) continue;
    const manifest = await readManifest(dir);
    const names = await fsp.readdir(dir).catch(() => []);
    const files = [];
    let bytes = 0;
    for (const name of names) {
      if (name.startsWith(".")) continue;
      const s = await fsp.stat(path.join(dir, name)).catch(() => null);
      if (!s?.isFile()) continue;
      bytes += s.size;
      const origin = manifest.files[name] ?? {};
      files.push({
        name,
        originalName: origin.originalName ?? name,
        size: s.size,
        sourceDir: origin.sourceDir ?? null,
        folder: origin.folder ?? null,
        destName: origin.destName ?? null,
        cleanedAt: origin.cleanedAt ?? null,
      });
    }
    files.sort((a, b) => a.name.localeCompare(b.name));
    if (files.length === 0) continue;
    entries.push({ day, count: files.length, bytes, files });
  }
  return entries.sort((a, b) => b.day.localeCompare(a.day));
}

export async function restoreTrashFiles(ctx, items, { targetDir = null } = {}) {
  const { config, log, notify } = ctx;
  const results = [];
  for (const item of items ?? []) {
    const day = item?.day;
    const name = item?.name;
    if (!isValidDay(day) || !isValidTrashName(name)) {
      results.push({ name: String(name ?? "?"), ok: false, reason: "invalid trash entry" });
      continue;
    }
    const dir = path.join(config.trashDir, day);
    const trashPath = path.join(dir, name);
    const stat = await fsp.stat(trashPath).catch(() => null);
    if (!stat?.isFile()) {
      results.push({ name, ok: false, reason: "no longer in trash" });
      continue;
    }
    const manifest = await readManifest(dir);
    const origin = manifest.files[name] ?? {};
    const restoreDir = origin.sourceDir || targetDir || null;
    if (!restoreDir) {
      results.push({ name, ok: false, reason: "no recorded origin; provide a restore directory" });
      continue;
    }
    const restoreName = origin.originalName ?? name.replace(/^[^-]+-[^-]+-/, "");
    const destPath = path.join(restoreDir, restoreName);
    try {
      await moveIntoPlace(trashPath, destPath);
    } catch (err) {
      const reason = err instanceof DestExistsError
        ? `${restoreName} already exists in ${restoreDir}`
        : err.message;
      results.push({ name, ok: false, reason });
      continue;
    }
    delete manifest.files[name];
    await writeManifest(dir, manifest);
    await fsp.rm(dir).catch(() => {});
    log(`restored ${name} → ${destPath}`);
    results.push({ name, ok: true, destPath });
  }
  if (results.some((r) => !r.ok)) {
    notify.notify("warn", `${results.filter((r) => !r.ok).length} trash file(s) could not be restored`);
  }
  return results;
}

export async function emptyTrash(ctx) {
  const { config, log } = ctx;
  const days = await fsp.readdir(config.trashDir).catch(() => []);
  for (const day of days) {
    await fsp.rm(path.join(config.trashDir, day), { recursive: true, force: true });
  }
  log("emptied trash");
}

export async function sweepTrash(ctx) {
  const { config, log } = ctx;
  const cutoff = dayString(config.trashRetentionDays);
  const days = await fsp.readdir(config.trashDir).catch(() => []);
  let removed = 0;
  for (const day of days) {
    if (!isValidDay(day)) continue;
    if (day < cutoff) {
      await fsp.rm(path.join(config.trashDir, day), { recursive: true, force: true });
      removed++;
    }
  }
  if (removed > 0) log(`trash sweep removed ${removed} day(s) older than ${cutoff}`);
}
