import fsp from "node:fs/promises";
import path from "node:path";
import { sha256File, uniqueSuffix } from "../util.js";
import { statSize } from "../verify.js";
import { DestExistsError, moveIntoPlace, replaceIntoPlace } from "./place.js";
import { stageCopy } from "./standardize.js";

// Recursive-safe copy with two change policies:
//   overwrite (default) — a changed source replaces the destination copy,
//                         written atomically via a temp file + rename;
//   conflict            — a changed source is flagged for review instead.
// Destination files are never read for adoption; deriveCopyProcessed compares
// size+mtime by stat and only the overwrite path touches the destination file.
export async function processCopy(ctx, folder, file) {
  const { config, store, log } = ctx;
  const sourcePath = path.join(folder.def.source, ...file.name.split("/"));
  const before = await fsp.stat(sourcePath).catch(() => null);
  if (!before) return { status: "error", kind: "gone", message: "source file disappeared" };

  if (config.dryRun) {
    return { status: "pending", message: `dry run: would copy to ${file.name}` };
  }

  const jobDir = path.join(config.stagingDir, "jobs", `${folder.def.name}-${uniqueSuffix()}`);
  let staged = null;
  try {
    staged = await stageCopy(sourcePath, jobDir, path.basename(file.name));
    const srcHash = await sha256File(sourcePath);
    const stagedHash = await sha256File(staged);
    if (srcHash !== stagedHash) {
      return { status: "error", kind: "changed", message: "source changed while copying; will retry" };
    }
    const destPath = path.join(folder.def.destination, ...file.name.split("/"));
    const existingSize = await statSize(destPath);
    if (existingSize !== null) {
      store.invalidateDest(folder.def.name);
      if (folder.def.onChanged === "overwrite") {
        await replaceIntoPlace(staged, destPath);
        staged = null;
        await stampMtime(destPath, before.mtimeMs);
        log(`replaced ${file.name}`);
        return { status: "done", destName: file.name, message: "destination updated (source changed)" };
      }
      const destHash = await sha256File(destPath);
      if (destHash === srcHash) {
        return { status: "duplicate", destName: file.name, message: "destination already contained an identical file" };
      }
      return { status: "conflict", destName: file.name, message: "destination file exists with different content — review" };
    }
    try {
      await moveIntoPlace(staged, destPath);
    } catch (err) {
      if (err instanceof DestExistsError) {
        const destHash = await sha256File(destPath);
        store.invalidateDest(folder.def.name);
        if (destHash === srcHash) {
          return { status: "duplicate", destName: file.name, message: "destination already contained an identical file" };
        }
        if (folder.def.onChanged === "overwrite") {
          await replaceIntoPlace(staged, destPath);
          staged = null;
          await stampMtime(destPath, before.mtimeMs);
          return { status: "done", destName: file.name, message: "destination updated (source changed)" };
        }
        return { status: "conflict", destName: file.name, message: "destination file exists with different content — review" };
      }
      throw err;
    }
    staged = null;
    // Preserve the source mtime so restarts can adopt the mirrored tree with
    // plain stat comparisons instead of hashing the destination.
    await stampMtime(destPath, before.mtimeMs);
    const placedHash = await sha256File(destPath);
    if (placedHash !== srcHash) {
      await fsp.rm(destPath, { force: true });
      store.invalidateDest(folder.def.name);
      return { status: "error", kind: "verify", message: "destination copy failed hash verification; removed" };
    }
    store.invalidateDest(folder.def.name);
    log(`copied ${file.name}`);
    return { status: "done", destName: file.name };
  } finally {
    if (staged) await fsp.rm(staged, { force: true });
    await fsp.rm(jobDir, { recursive: true, force: true });
  }
}

async function stampMtime(file, mtimeMs) {
  const atime = new Date();
  const mtime = new Date(mtimeMs);
  await fsp.utimes(file, atime, mtime).catch(() => {});
}
