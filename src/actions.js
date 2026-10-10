import fsp from "node:fs/promises";
import path from "node:path";
import { remuxRepair } from "./ffmpeg.js";
import { STATUS } from "./store.js";
import { processImportAsIs, stageCopy, standardizePath } from "./processors/standardize.js";
import { uniqueSuffix } from "./util.js";

export function parseUserDate(input) {
  const m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(String(input ?? "").trim());
  if (!m) throw new Error("date must look like YYYY-MM-DD or YYYY-MM-DD HH:MM[:SS]");
  const [, y, mo, d, h, mi, s] = m;
  const pad = (v, fallback) => String(v ?? fallback).padStart(2, "0");
  return `${y}:${pad(mo)}:${pad(d)} ${pad(h, 0)}:${pad(mi, 0)}:${pad(s, 0)}`;
}

export async function runAction(ctx, queue, folderName, fileName, action, payload = {}) {
  const folder = ctx.store.getFolder(folderName);
  if (!folder) throw new Error(`unknown folder: ${folderName}`);
  const file = ctx.store.fileFor(folderName, fileName);
  if (!file) throw new Error(`unknown file: ${fileName}`);

  if (action === "retry") {
    ctx.store.updateFile(folderName, fileName, {
      status: STATUS.PENDING,
      attempts: 0,
      errorKind: null,
      nextRetryAt: 0,
      message: null,
      forceNow: true,
    });
    queue.tick();
    return { ok: true, queued: true };
  }

  if (action === "repair") {
    return queue.runManual(folder, [fileName], async () => {
      const jobDir = path.join(ctx.config.stagingDir, "jobs", `${folderName}-${uniqueSuffix()}`);
      try {
        const sourcePath = path.join(folder.def.source, fileName);
        const staged = await stageCopy(sourcePath, jobDir, fileName);
        const repaired = path.join(jobDir, `repaired-${fileName}`);
        await remuxRepair(staged, repaired);
        const result = await standardizePath(ctx, folder, file, repaired);
        return [{ name: fileName, result }];
      } catch (err) {
        return [{ name: fileName, result: { status: STATUS.ERROR, kind: "repair", message: err.message } }];
      } finally {
        await fsp.rm(jobDir, { recursive: true, force: true });
      }
    });
  }

  if (action === "setDate") {
    const forcedDate = parseUserDate(payload.date);
    return queue.runManual(folder, [fileName], async () => {
      const result = await processStandardizeForced(ctx, folder, file, forcedDate);
      return [{ name: fileName, result }];
    });
  }

  if (action === "importAsIs") {
    return queue.runManual(folder, [fileName], async () => {
      const result = await processImportAsIs(ctx, folder, file);
      return [{ name: fileName, result }];
    });
  }

  throw new Error(`unknown action: ${action}`);
}

async function processStandardizeForced(ctx, folder, file, forcedDate) {
  const { config } = ctx;
  const jobDir = path.join(config.stagingDir, "jobs", `${folder.def.name}-${uniqueSuffix()}`);
  try {
    if (config.dryRun) {
      return { status: STATUS.PENDING, message: `dry run: would standardize with ${forcedDate}` };
    }
    const sourcePath = path.join(folder.def.source, file.name);
    const staged = await stageCopy(sourcePath, jobDir, file.name);
    return await standardizePath(ctx, folder, file, staged, { forcedDate });
  } catch (err) {
    return { status: STATUS.ERROR, kind: "tool", message: err.message };
  } finally {
    await fsp.rm(jobDir, { recursive: true, force: true });
  }
}
