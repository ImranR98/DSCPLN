import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { uniqueSuffix } from "../util.js";

export class DestExistsError extends Error {
  constructor(dest) {
    super(`destination already exists: ${dest}`);
    this.name = "DestExistsError";
    this.code = "DEST_EXISTS";
    this.dest = dest;
  }
}

const FALLBACK_CODES = new Set(["EXDEV", "EPERM", "EOPNOTSUPP", "ENOTSUP", "EACCES", "EMLINK", "EINVAL"]);

export async function moveIntoPlace(src, dest) {
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  try {
    await fsp.link(src, dest);
    await fsp.unlink(src);
    return "link";
  } catch (err) {
    if (err.code === "EEXIST") throw new DestExistsError(dest);
    if (!FALLBACK_CODES.has(err.code)) throw err;
  }
  try {
    await fsp.copyFile(src, dest, fs.constants.COPYFILE_EXCL);
  } catch (err) {
    if (err.code === "EEXIST") throw new DestExistsError(dest);
    throw err;
  }
  const [srcStat, destStat] = await Promise.all([fsp.stat(src), fsp.stat(dest)]);
  if (srcStat.size !== destStat.size) {
    await fsp.rm(dest, { force: true });
    throw new Error(`size mismatch after cross-device copy (${srcStat.size} vs ${destStat.size})`);
  }
  await fsp.unlink(src);
  return "copy";
}

// Atomic replace: the staged copy is written to a hidden temp file in the
// destination directory (same filesystem), size-verified, then renamed over
// the existing destination file. The destination never sees a partial file.
export async function replaceIntoPlace(src, dest) {
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  const tmp = path.join(path.dirname(dest), `.${path.basename(dest)}.file-pipelines-${uniqueSuffix()}.tmp`);
  try {
    await fsp.copyFile(src, tmp);
    const [srcStat, tmpStat] = await Promise.all([fsp.stat(src), fsp.stat(tmp)]);
    if (srcStat.size !== tmpStat.size) {
      throw new Error(`size mismatch while replacing destination (${srcStat.size} vs ${tmpStat.size})`);
    }
    await fsp.rename(tmp, dest);
  } catch (err) {
    await fsp.rm(tmp, { force: true });
    throw err;
  }
  await fsp.unlink(src);
  return "replace";
}
