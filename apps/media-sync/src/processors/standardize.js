import fsp from "node:fs/promises";
import path from "node:path";
import {
  applyDates,
  findRealExifDate,
  readBackDateTimeOriginal,
  readMediaCreateDate,
  standardNameFor,
} from "../exif.js";
import { classifyDestMatch, statSize } from "../verify.js";
import { sha256File, uniqueSuffix } from "../util.js";
import { parkOutput } from "../review.js";
import { STATUS } from "../store.js";
import { DestExistsError, moveIntoPlace } from "./place.js";
import { classifyExistingDest } from "./existingDest.js";

export async function stageCopy(sourcePath, stagingDir, fileName) {
  await fsp.mkdir(stagingDir, { recursive: true });
  const staged = path.join(stagingDir, `${uniqueSuffix()}-${fileName}`);
  await fsp.copyFile(sourcePath, staged);
  const [srcStat, stagedStat] = await Promise.all([fsp.stat(sourcePath), fsp.stat(staged)]);
  if (srcStat.size !== stagedStat.size) {
    await fsp.rm(staged, { force: true });
    throw new Error("staging copy size mismatch");
  }
  return staged;
}

export async function standardizePath(ctx, folder, file, stagedPath, { forcedDate = null } = {}) {
  const { exiftool, store, log } = ctx;
  const date = forcedDate ?? (await findRealExifDate(exiftool, stagedPath));
  if (!date) return { status: "error", kind: "nodate", message: "no usable date metadata found" };

  await applyDates(exiftool, stagedPath, date);

  let dto = await readBackDateTimeOriginal(exiftool, stagedPath);
  if (!dto && /^PXL_/i.test(file.name) && /\.mp4$/i.test(file.name)) {
    dto = await readMediaCreateDate(exiftool, stagedPath);
  }
  if (!dto) return { status: "error", kind: "nodate", message: "failed to write date metadata" };

  const destName = standardNameFor(file.name.split("/").pop(), dto);
  if (folder.def.placement === "manual") {
    await parkOutput(ctx, folder, { destName, inputs: [file.name], expectedDuration: null }, stagedPath);
    return { status: STATUS.REVIEW, destName, message: "awaiting review" };
  }
  const destPath = path.join(folder.def.destination, destName);
  const existingSize = await statSize(destPath);
  if (existingSize !== null) {
    const verdict = classifyDestMatch({ method: "standardize", sourceSize: file.size, destSize: existingSize });
    store.invalidateDest(folder.def.name);
    if (verdict === "conflict") {
      return {
        status: "conflict",
        destName,
        message: `destination ${destName} already exists with a very different size — review`,
      };
    }
    return { status: "duplicate", destName, message: "destination already contained this file" };
  }

  try {
    await moveIntoPlace(stagedPath, destPath);
  } catch (err) {
    if (err instanceof DestExistsError) {
      return classifyExistingDest(store, folder, destPath, file.size, "standardize");
    }
    throw err;
  }
  store.invalidateDest(folder.def.name);
  log(`standardized ${file.name} -> ${destName}`);
  return { status: "done", destName };
}

export async function processStandardize(ctx, folder, file, { forcedDate = null } = {}) {
  const { config, exiftool } = ctx;
  const sourcePath = path.join(folder.def.source, file.name);
  const before = await fsp.stat(sourcePath).catch(() => null);
  if (!before) return { status: "error", kind: "gone", message: "source file disappeared" };

  if (config.dryRun) {
    const date = forcedDate ?? (await findRealExifDate(exiftool, sourcePath));
    if (!date) return { status: "error", kind: "nodate", message: "no usable date metadata found" };
    const destName = standardNameFor(file.name, date);
    return { status: "pending", message: `dry run: would place ${destName}` };
  }

  const jobDir = path.join(config.stagingDir, "jobs", `${folder.def.name}-${uniqueSuffix()}`);
  let staged = null;
  try {
    staged = await stageCopy(sourcePath, jobDir, file.name);
    const after = await fsp.stat(sourcePath).catch(() => null);
    if (!after || after.size !== before.size || after.mtimeMs !== before.mtimeMs) {
      return { status: "error", kind: "changed", message: "source changed while copying; will retry" };
    }
    const result = await standardizePath(ctx, folder, file, staged, { forcedDate });
    return result;
  } finally {
    if (staged) await fsp.rm(staged, { force: true });
    await fsp.rm(jobDir, { recursive: true, force: true });
  }
}

export async function processImportAsIs(ctx, folder, file) {
  const { config, store, log } = ctx;
  const sourcePath = path.join(folder.def.source, ...file.name.split("/"));
  const before = await fsp.stat(sourcePath).catch(() => null);
  if (!before) return { status: "error", kind: "gone", message: "source file disappeared" };

  if (config.dryRun) {
    return { status: "pending", message: `dry run: would copy as-is to ${file.name}` };
  }

  const destName = file.name.split("/").pop();
  const jobDir = path.join(config.stagingDir, "jobs", `${folder.def.name}-${uniqueSuffix()}`);
  let staged = null;
  try {
    staged = await stageCopy(sourcePath, jobDir, destName);
    const [srcHash, stagedHash] = await Promise.all([sha256File(sourcePath), sha256File(staged)]);
    if (srcHash !== stagedHash) {
      return { status: "error", kind: "changed", message: "source changed while copying; will retry" };
    }
    if (folder.def.placement === "manual") {
      await parkOutput(ctx, folder, { destName, inputs: [file.name], expectedDuration: null }, staged);
      staged = null;
      return { status: STATUS.REVIEW, destName, message: "awaiting review" };
    }
    const destPath = path.join(folder.def.destination, destName);
    const existingSize = await statSize(destPath);
    if (existingSize !== null) {
      store.invalidateDest(folder.def.name);
      return { status: "duplicate", destName, message: "destination already contained this file" };
    }
    try {
      await moveIntoPlace(staged, destPath);
    } catch (err) {
      if (err instanceof DestExistsError) {
        return classifyExistingDest(store, folder, destPath, file.size, "copy");
      }
      throw err;
    }
    staged = null;
    store.invalidateDest(folder.def.name);
    log(`imported as-is ${file.name}`);
    return { status: "done", destName, message: "imported as-is (not standardized)" };
  } finally {
    if (staged) await fsp.rm(staged, { force: true });
    await fsp.rm(jobDir, { recursive: true, force: true });
  }
}
