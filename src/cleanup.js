import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { findExpectedDestName, verificationFor } from "./verify.js";
import { probeDuration } from "./ffmpeg.js";
import { pathExists, sha256File, uniqueSuffix } from "./util.js";
import { STATUS } from "./store.js";

export async function verifyCleanupTarget(ctx, folder, file) {
  const { store, exiftool } = ctx;
  const sourcePath = path.join(folder.def.source, file.name);
  if (!(await pathExists(sourcePath))) return { ok: false, reason: "source file is missing" };

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

export async function trashFile(ctx, sourcePath) {
  const { config } = ctx;
  const day = new Date().toISOString().slice(0, 10);
  const dir = path.join(config.trashDir, day);
  await fsp.mkdir(dir, { recursive: true });
  const base = path.basename(sourcePath);
  let target = path.join(dir, base);
  if (await pathExists(target)) target = path.join(dir, `${uniqueSuffix()}-${base}`);
  try {
    await fsp.rename(sourcePath, target);
    return target;
  } catch (err) {
    if (err.code !== "EXDEV") throw err;
  }
  await fsp.copyFile(sourcePath, target, fs.constants.COPYFILE_EXCL);
  const [srcHash, dstHash] = await Promise.all([sha256File(sourcePath), sha256File(target)]);
  if (srcHash !== dstHash) {
    await fsp.rm(target, { force: true });
    throw new Error("trash copy failed hash verification");
  }
  await fsp.unlink(sourcePath);
  return target;
}

export function cleanupPreview(folder) {
  return [...folder.files.values()]
    .filter((f) => f.status === STATUS.DONE || f.status === STATUS.DUPLICATE)
    .map((f) => ({ name: f.name, size: f.size, destName: f.destName, status: f.status }));
}

export async function cleanupFiles(ctx, folder, names) {
  const { store, log, notify } = ctx;
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
      const trashPath = await trashFile(ctx, sourcePath);
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

export async function listTrash(ctx) {
  const { config } = ctx;
  const entries = [];
  const days = await fsp.readdir(config.trashDir).catch(() => []);
  for (const day of days) {
    const dir = path.join(config.trashDir, day);
    const stat = await fsp.stat(dir).catch(() => null);
    if (!stat?.isDirectory()) continue;
    const files = await fsp.readdir(dir).catch(() => []);
    let bytes = 0;
    for (const f of files) {
      const s = await fsp.stat(path.join(dir, f)).catch(() => null);
      if (s?.isFile()) bytes += s.size;
    }
    entries.push({ day, files: files.length, bytes });
  }
  return entries.sort((a, b) => b.day.localeCompare(a.day));
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
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
    if (day < cutoff) {
      await fsp.rm(path.join(config.trashDir, day), { recursive: true, force: true });
      removed++;
    }
  }
  if (removed > 0) log(`trash sweep removed ${removed} day(s) older than ${cutoff}`);
}
