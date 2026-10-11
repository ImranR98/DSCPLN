import fsp from "node:fs/promises";
import path from "node:path";
import {
  applyDates,
  readBackDateTimeOriginal,
  standardNameFor,
  WRITE_ARGS,
} from "../exif.js";
import {
  appendFile,
  decodeToPcm,
  durationInfo,
  encodePcmToAac,
  makeTonePcm,
  probeDuration,
} from "../ffmpeg.js";
import { parkOutput } from "../review.js";
import { STATUS } from "../store.js";
import { uniqueSuffix } from "../util.js";
import { statSize } from "../verify.js";
import { sanitizeChat, voiceNoteGroupOf } from "../voicenotes.js";
import { DestExistsError, moveIntoPlace } from "./place.js";
import { classifyExistingDest } from "./existingDest.js";

// Concatenates one voice-note group (all same-day clips in one chat folder)
// into a single standardized MP4, exactly like the old WhatsApp voice-note
// flow. With `placement: "manual"` the result is parked for review instead of
// being written to the destination.
export async function processVoiceNoteGroup(ctx, folder, group, files) {
  const { exiftool, config, store, log } = ctx;
  const { chat, date } = group;
  // Re-processing a group (e.g. a late clip arrived for the same chat/day)
  // must merge every clip currently in the source, not just the new ones.
  const groupFiles = [];
  const folderState = store.getFolder(folder.def.name);
  for (const file of folderState?.files.values() ?? []) {
    if (file.status === STATUS.IGNORED || file.status === STATUS.CLEANED) continue;
    const fileGroup = voiceNoteGroupOf(file.name, folder.def.datePattern);
    if (fileGroup && fileGroup.chat === chat && fileGroup.date === date) groupFiles.push(file.name);
  }
  const inputs = (groupFiles.length > 0 ? groupFiles : files.map((file) => file.name)).sort();
  const base = `${date}-merged${sanitizeChat(chat) ? `-${sanitizeChat(chat)}` : ""}`;

  if (config.dryRun) {
    return files.map((file) => ({
      name: file.name,
      result: { status: STATUS.PENDING, message: `dry run: would merge ${inputs.length} clip(s) into ${base}.mp4` },
    }));
  }

  const jobDir = path.join(config.stagingDir, "jobs", `${folder.def.name}-${uniqueSuffix()}`);
  await fsp.mkdir(jobDir, { recursive: true });
  try {
    const entries = [];
    const missing = [];
    for (const input of inputs) {
      const file = store.fileFor(folder.def.name, input);
      const sourcePath = path.join(folder.def.source, ...input.split("/"));
      const stat = await fsp.stat(sourcePath).catch(() => null);
      if (!file || !stat) {
        missing.push(input);
        continue;
      }
      entries.push({
        name: input,
        path: sourcePath,
        duration: await durationInfo(exiftool, sourcePath).catch(() => null),
      });
    }
    const results = missing.map((name) => ({
      name,
      result: { status: STATUS.ERROR, kind: "gone", message: "source file disappeared" },
    }));
    if (entries.length === 0) return results;

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

    if (folder.def.placement === "manual") {
      await parkOutput(
        ctx,
        folder,
        { destName, chat, date, inputs, expectedDuration: expected },
        mergedPath,
      );
      for (const entry of entries) {
        results.push({
          name: entry.name,
          result: { status: STATUS.REVIEW, destName, message: "awaiting review" },
        });
      }
      return results;
    }

    const destPath = path.join(folder.def.destination, destName);
    const existingSize = await statSize(destPath);
    if (existingSize !== null) {
      store.invalidateDest(folder.def.name);
      const verdict = await classifyExistingDest(store, folder, destPath, outputStat.size, "voicenotes");
      for (const entry of entries) {
        results.push({ name: entry.name, result: { ...verdict, destName } });
      }
      return results;
    }
    try {
      await moveIntoPlace(mergedPath, destPath);
    } catch (err) {
      if (err instanceof DestExistsError) {
        const verdict = await classifyExistingDest(store, folder, destPath, outputStat.size, "voicenotes");
        store.invalidateDest(folder.def.name);
        for (const entry of entries) {
          results.push({ name: entry.name, result: { ...verdict, destName } });
        }
        return results;
      }
      throw err;
    }
    store.invalidateDest(folder.def.name);
    log(`merged ${entries.length} voice note(s) (${destName})`);
    for (const entry of entries) {
      results.push({ name: entry.name, result: { status: STATUS.DONE, destName } });
    }
    return results;
  } finally {
    await fsp.rm(jobDir, { recursive: true, force: true });
  }
}
