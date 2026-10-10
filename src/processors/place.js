import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

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
