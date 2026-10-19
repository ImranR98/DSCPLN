// Approval-only flow for voicenotes. The source folder is the queue: a group
// is every clip currently present for one chat directory + clip date. The user
// either merges the group and moves the result to the destination, or deletes
// the group into trash. There are no parked outputs and no per-file statuses
// to lose across restarts.

import fsp from "node:fs/promises";
import path from "node:path";
import {
  applyDates,
  readBackDateTimeOriginal,
  standardNameFor,
  WRITE_ARGS,
} from "./exif.js";
import {
  appendFile,
  decodeToPcm,
  durationInfo,
  encodePcmToAac,
  makeTonePcm,
  probeDuration,
} from "./ffmpeg.js";
import { trashFile } from "./cleanup.js";
import { STATUS } from "./store.js";
import { uniqueSuffix } from "./util.js";
import { parseSnapInputs, statSize } from "./verify.js";
import { sanitizeChat, voiceNoteDateOf, voiceNoteDestName, voiceNoteGroupOf } from "./voicenotes.js";
import { DestExistsError, moveIntoPlace } from "./processors/place.js";
import { processStandardize } from "./processors/standardize.js";

function httpError(statusCode, message) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

function perFile(folder) {
  return folder.def.concat === false || !folder.def.datePattern;
}

function groupFiles(folder, { chat, date, file }) {
  if (perFile(folder)) {
    const state = folder.files.get(file);
    if (!state || state.status === STATUS.IGNORED || state.status === STATUS.CLEANED) return [];
    return [file];
  }
  const names = [];
  for (const item of folder.files.values()) {
    if (item.status === STATUS.IGNORED || item.status === STATUS.CLEANED) continue;
    const group = voiceNoteGroupOf(item.name, folder.def.datePattern);
    if (group && group.chat === chat && group.date === date) names.push(item.name);
  }
  return names.sort();
}

async function requireSettled(store, folder, names) {
  const now = Date.now();
  const pending = names.filter((name) => {
    const file = store.fileFor(folder.def.name, name);
    return file && !store.isSettled(folder, file, now);
  });
  if (pending.length) {
    throw httpError(409, `waiting for ${pending.length} clip(s) to settle; try again in a moment`);
  }
}

export async function listVoiceNoteGroups(ctx) {
  const { store } = ctx;
  const now = Date.now();
  const groups = [];
  for (const folder of store.listFolders()) {
    if (folder.def.method !== "voicenotes" || !folder.exists) continue;
    if (perFile(folder)) {
      for (const file of folder.files.values()) {
        if (file.status === STATUS.IGNORED || file.status === STATUS.CLEANED) continue;
        groups.push({
          folder: folder.def.name,
          file: file.name,
          chat: null,
          date: null,
          files: [file.name],
          count: 1,
          bytes: file.size ?? 0,
          settling: !store.isSettled(folder, file, now),
          destName: null,
          destExists: false,
        });
      }
      continue;
    }
    const byKey = new Map();
    for (const file of folder.files.values()) {
      if (file.status === STATUS.IGNORED || file.status === STATUS.CLEANED) continue;
      const group = voiceNoteGroupOf(file.name, folder.def.datePattern);
      if (!group) continue;
      const key = `${group.chat}\u0000${group.date}`;
      let entry = byKey.get(key);
      if (!entry) {
        entry = {
          folder: folder.def.name,
          chat: group.chat,
          date: group.date,
          files: [],
          bytes: 0,
          settling: false,
        };
        byKey.set(key, entry);
      }
      entry.files.push(file.name);
      entry.bytes += file.size ?? 0;
      if (!store.isSettled(folder, file, now)) entry.settling = true;
    }
    for (const entry of byKey.values()) {
      entry.files.sort();
      entry.count = entry.files.length;
      entry.destName = voiceNoteDestName(entry.chat, entry.date);
      entry.destExists = (await statSize(path.join(folder.def.destination, entry.destName))) !== null;
      groups.push(entry);
    }
  }
  groups.sort((a, b) => `${a.folder}\u0000${a.chat}\u0000${a.date}`.localeCompare(`${b.folder}\u0000${b.chat}\u0000${b.date}`));
  return groups;
}

async function mergeGroup(ctx, folder, chat, date, inputs) {
  const { exiftool, config, store } = ctx;
  const jobDir = path.join(config.stagingDir, "jobs", `${folder.def.name}-${uniqueSuffix()}`);
  await fsp.mkdir(jobDir, { recursive: true });
  try {
    const entries = [];
    for (const input of inputs) {
      const file = store.fileFor(folder.def.name, input);
      const sourcePath = path.join(folder.def.source, ...input.split("/"));
      const stat = await fsp.stat(sourcePath).catch(() => null);
      if (!file || !stat) throw httpError(409, `${input} disappeared before it could be merged`);
      entries.push({
        name: input,
        path: sourcePath,
        duration: await durationInfo(exiftool, sourcePath).catch(() => null),
      });
    }
    if (entries.length === 0) throw httpError(409, "no clips left to merge");

    const expected = entries.reduce((sum, entry) => sum + (entry.duration || 0), 0);
    const tonePcm = path.join(jobDir, "tone.pcm");
    await makeTonePcm(tonePcm);
    const resultPcm = path.join(jobDir, "result.pcm");
    await fsp.writeFile(resultPcm, "");
    for (let i = 0; i < entries.length; i++) {
      const pcm = path.join(jobDir, `part-${i}.pcm`);
      await decodeToPcm(entries[i].path, pcm);
      await appendFile(pcm, resultPcm);
      if (i < entries.length - 1) await appendFile(tonePcm, resultPcm);
    }
    const base = `${date}-merged${sanitizeChat(chat) ? `-${sanitizeChat(chat)}` : ""}`;
    const mergedPath = path.join(jobDir, `${base}.mp4`);
    await encodePcmToAac(resultPcm, mergedPath);
    const outputStat = await fsp.stat(mergedPath).catch(() => null);
    if (!outputStat || outputStat.size === 0) throw new Error("concatenation produced an empty file");
    const actual = await probeDuration(mergedPath);
    const tolerance = 0.1 * Math.max(1, entries.length);
    if (expected > 0 && actual > 0 && Math.abs(expected - actual) > tolerance) {
      throw new Error(`duration verification failed: expected ${expected}s, got ${actual}s (tolerance ${tolerance})`);
    }

    const dateValue = `${date.slice(0, 4)}:${date.slice(4, 6)}:${date.slice(6, 8)} 00:00:00`;
    await applyDates(exiftool, mergedPath, dateValue);
    await exiftool.write(
      mergedPath,
      {
        "XMP-media-sync:Inputs": JSON.stringify(inputs),
        "XMP-media-sync:ExpectedDuration": String(expected),
      },
      { writeArgs: WRITE_ARGS },
    );
    const dto = (await readBackDateTimeOriginal(exiftool, mergedPath)) ?? dateValue;
    const destName = standardNameFor(`${base}.mp4`, dto);
    return {
      jobDir,
      mergedPath,
      destName,
      inputs,
      expected,
      outputSize: outputStat.size,
    };
  } catch (err) {
    await fsp.rm(jobDir, { recursive: true, force: true }).catch(() => {});
    throw err;
  }
}

async function trashInputs(ctx, folder, inputs, destName) {
  const trashed = [];
  const failed = [];
  for (const name of inputs) {
    const sourcePath = path.join(folder.def.source, ...name.split("/"));
    const exists = await fsp.access(sourcePath).then(() => true).catch(() => false);
    if (!exists) continue;
    try {
      await trashFile(ctx, sourcePath, {
        sourceDir: folder.def.source,
        folder: folder.def.name,
        destName,
      });
      trashed.push(name);
    } catch (err) {
      failed.push({ name, error: err.message });
    }
  }
  await ctx.store.scanFolder(folder.def.name).catch(() => {});
  return { trashed, failed };
}

async function approveStandardizeFile(ctx, folder, file) {
  const state = ctx.store.fileFor(folder.def.name, file);
  if (!state) throw httpError(404, "file is no longer present");
  let forcedDate = null;
  if (folder.def.datePattern) {
    const raw = voiceNoteDateOf(path.basename(file), folder.def.datePattern);
    if (!raw) throw httpError(409, "the file name does not match datePattern");
    forcedDate = `${raw.slice(0, 4)}:${raw.slice(4, 6)}:${raw.slice(6, 8)} 00:00:00`;
  }
  const autoFolder = { ...folder, def: { ...folder.def, placement: "auto" } };
  const result = await processStandardize(ctx, autoFolder, state, { forcedDate, bestEffortDates: true });
  if (result.status === "done") {
    const trash = await trashInputs(ctx, folder, [file], result.destName);
    ctx.notify.notify("info", `${folder.def.name}: standardized ${file} → ${result.destName}`);
    if (trash.failed.length) {
      ctx.notify.notify("warn", `${folder.def.name}: standardized, but ${trash.failed.length} source file(s) could not be moved to trash`);
    }
    return { ok: true, file, destName: result.destName, ...trash };
  }
  if (result.status === "duplicate") {
    throw httpError(409, `destination already has a standardized file named ${result.destName}; move or delete it first`);
  }
  if (result.status === "conflict") {
    throw httpError(409, result.message || "destination already has a conflicting file");
  }
  throw httpError(409, result.message || "could not standardize this file");
}

export async function approveVoiceNoteGroup(ctx, folder, { chat, date, file }) {
  if (folder.def.method !== "voicenotes") throw httpError(400, "not a voicenotes folder");
  return ctx.queue.runExclusive(folder.def.name, async () => {
    if (perFile(folder)) {
      if (!file) throw httpError(400, "file is required");
      const state = ctx.store.fileFor(folder.def.name, file);
      if (!state) throw httpError(404, "file is no longer present");
      await requireSettled(ctx.store, folder, [file]);
      if (ctx.config.dryRun) return { ok: true, dryRun: true, file };
      return approveStandardizeFile(ctx, folder, file);
    }
    const inputs = groupFiles(folder, { chat, date });
    if (!inputs.length) throw httpError(404, "no clips in this group");
    await requireSettled(ctx.store, folder, inputs);

    const destName = voiceNoteDestName(chat, date);
    const destPath = path.join(folder.def.destination, destName);
    if (ctx.config.dryRun) {
      return { ok: true, dryRun: true, destName, inputs };
    }

    const merged = await mergeGroup(ctx, folder, chat, date, inputs);
    try {
      const existingSize = await statSize(destPath);
      if (existingSize !== null) {
        const tags = await ctx.exiftool.readRaw(destPath, ["-m", "-api", "LargeFileSupport=1"]).catch(() => null);
        const existingInputs = parseSnapInputs(tags?.Inputs);
        const same = Array.isArray(existingInputs)
          && existingInputs.length === inputs.length
          && inputs.every((name) => existingInputs.includes(name));
        if (!same) {
          throw httpError(
            409,
            `a merged file already exists for ${chat || "(root)"} / ${date}; move or delete it first`,
          );
        }
        const trash = await trashInputs(ctx, folder, inputs, destName);
        ctx.log(`already merged ${inputs.length} voice note(s) → ${destName}; source clips moved to trash`);
        ctx.notify.notify("info", `${folder.def.name}: already merged → ${destName}; source clips moved to trash`);
        return { ok: true, alreadyPlaced: true, destName, inputs, ...trash };
      }

      try {
        await moveIntoPlace(merged.mergedPath, destPath);
      } catch (err) {
        if (err instanceof DestExistsError) {
          throw httpError(409, `a merged file already exists for ${chat || "(root)"} / ${date}`);
        }
        throw err;
      }
      ctx.store.invalidateDest(folder.def.name);
      const trash = await trashInputs(ctx, folder, inputs, destName);
      ctx.log(`merged ${inputs.length} voice note(s) → ${destName}`);
      ctx.notify.notify("info", `${folder.def.name}: merged ${inputs.length} clip(s) → ${destName}`);
      if (trash.failed.length) {
        ctx.notify.notify("warn", `${folder.def.name}: merged, but ${trash.failed.length} source clip(s) could not be moved to trash`);
      }
      return { ok: true, destName, inputs, ...trash };
    } finally {
      await fsp.rm(merged.jobDir, { recursive: true, force: true }).catch(() => {});
    }
  });
}

export async function deleteVoiceNoteGroup(ctx, folder, { chat, date, file }) {
  if (folder.def.method !== "voicenotes") throw httpError(400, "not a voicenotes folder");
  return ctx.queue.runExclusive(folder.def.name, async () => {
    if (perFile(folder)) {
      if (!file) throw httpError(400, "file is required");
      const state = ctx.store.fileFor(folder.def.name, file);
      if (!state) throw httpError(404, "file is no longer present");
      await requireSettled(ctx.store, folder, [file]);
      if (ctx.config.dryRun) return { ok: true, dryRun: true, deleted: [file] };
      const result = await trashInputs(ctx, folder, [file], null);
      ctx.log(`deleted ${result.trashed.length} file(s) from ${folder.def.name} into trash`);
      ctx.notify.notify("info", `${folder.def.name}: deleted ${result.trashed.length} file(s) into trash`);
      if (result.failed.length) {
        ctx.notify.notify("warn", `${folder.def.name}: ${result.failed.length} file(s) could not be moved to trash`);
      }
      return { ok: true, deleted: result.trashed, ...result };
    }
    const inputs = groupFiles(folder, { chat, date });
    if (!inputs.length) throw httpError(404, "no clips in this group");
    await requireSettled(ctx.store, folder, inputs);
    if (ctx.config.dryRun) {
      return { ok: true, dryRun: true, deleted: inputs };
    }
    const result = await trashInputs(ctx, folder, inputs, null);
    ctx.log(`deleted ${result.trashed.length} voice note(s) from ${chat || "(root)"} / ${date} into trash`);
    ctx.notify.notify("info", `${folder.def.name}: deleted ${result.trashed.length} clip(s) (${chat || "root"} / ${date}) into trash`);
    if (result.failed.length) {
      ctx.notify.notify("warn", `${folder.def.name}: ${result.failed.length} clip(s) could not be moved to trash`);
    }
    return { ok: true, deleted: result.trashed, ...result };
  });
}
