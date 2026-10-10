import fsp from "node:fs/promises";
import path from "node:path";
import {
  applyDates,
  readBackDateTimeOriginal,
  readTags,
  selectDateFromTags,
  standardNameFor,
  normalizeExifDateToEpoch,
  WRITE_ARGS,
} from "../exif.js";
import { concatenateFiles, durationInfo, groupByTimeWindow, probeDuration, reencodeFile } from "../ffmpeg.js";
import { statSize } from "../verify.js";
import { uniqueSuffix } from "../util.js";
import { DestExistsError, moveIntoPlace } from "./place.js";
import { stageCopy } from "./standardize.js";

const TIMESTAMP_TAGS = ["CreateDate", "MediaCreateDate", "TrackCreateDate", "DateTimeOriginal"];

function pad(n) {
  return String(n).padStart(2, "0");
}

function localStamp(epochSec) {
  const d = new Date(epochSec * 1000);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function localExifDate(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}:${pad(d.getMonth() + 1)}:${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function firstTagValue(tags, key) {
  const value = tags?.[key];
  if (value === undefined || value === null) return null;
  const v = Array.isArray(value) ? value[0] : value;
  const s = String(v);
  return s.trim() === "" || s.includes("0000") ? null : s;
}

export async function collectSnapEntry(ctx, folder, file) {
  const { exiftool } = ctx;
  const sourcePath = path.join(folder.def.source, file.name);
  const stat = await fsp.stat(sourcePath).catch(() => null);
  if (!stat) return null;
  const tags = await readTags(exiftool, sourcePath);
  let timestamp = null;
  for (const key of TIMESTAMP_TAGS) {
    const raw = firstTagValue(tags, key);
    if (!raw) continue;
    const epoch = normalizeExifDateToEpoch(raw);
    if (epoch !== null) {
      timestamp = epoch;
      break;
    }
  }
  if (timestamp === null) timestamp = Math.floor(stat.mtimeMs / 1000);
  const date = selectDateFromTags(tags, sourcePath) ?? localExifDate(stat.mtimeMs);
  const duration = await durationInfo(exiftool, sourcePath);
  return { name: file.name, path: sourcePath, timestamp, date, duration };
}

export async function processSnapBatch(ctx, folder, files) {
  const { exiftool, config, store, log } = ctx;
  const entries = [];
  const missing = [];
  for (const file of files) {
    const entry = await collectSnapEntry(ctx, folder, file);
    if (!entry) {
      missing.push(file.name);
      continue;
    }
    entries.push(entry);
  }

  const results = [];
  for (const name of missing) {
    results.push({ name, result: { status: "error", kind: "gone", message: "source file disappeared" } });
  }

  const groups = groupByTimeWindow(entries, folder.def.groupWindowSeconds ?? 15);
  for (let g = 0; g < groups.length; g++) {
    const group = groups[g];
    const groupNumber = g + 1;
    const inputNames = group.map((e) => e.name);
    const expected = group.reduce((sum, e) => sum + (e.duration || 0), 0);
    const snapBase = `Snap_${localStamp(group[0].timestamp)}_group${groupNumber}.mp4`;
    const firstDate = group[0].date;

    if (config.dryRun) {
      const destName = standardNameFor(snapBase, firstDate);
      for (const entry of group) {
        results.push({
          name: entry.name,
          result: { status: "pending", message: `dry run: group of ${group.length} -> ${destName}` },
        });
      }
      continue;
    }

    const jobDir = path.join(config.stagingDir, "jobs", `${folder.def.name}-${uniqueSuffix()}`);
    try {
      const stagedInputs = [];
      for (const entry of group) {
        stagedInputs.push(await stageCopy(entry.path, jobDir, entry.name));
      }
      const output = path.join(jobDir, snapBase);
      if (stagedInputs.length === 1) {
        await reencodeFile(stagedInputs[0], output);
      } else {
        await concatenateFiles(stagedInputs, output);
      }
      const outputStat = await fsp.stat(output).catch(() => null);
      if (!outputStat || outputStat.size === 0) {
        throw new Error("concatenation produced an empty file");
      }

      const actual = await probeDuration(output);
      const tolerance = 0.1 * group.length;
      if (expected > 0 && actual > 0 && Math.abs(expected - actual) > tolerance) {
        throw new Error(`duration verification failed: expected ${expected}s, got ${actual}s (tolerance ${tolerance}s)`);
      }

      await applyDates(exiftool, output, firstDate);
      await exiftool.write(
        output,
        {
          "XMP-media-sync:Inputs": JSON.stringify(inputNames),
          "XMP-media-sync:ExpectedDuration": String(expected),
        },
        { writeArgs: WRITE_ARGS },
      );

      const dto = (await readBackDateTimeOriginal(exiftool, output)) ?? firstDate;
      const destName = standardNameFor(snapBase, dto);
      const destPath = path.join(folder.def.destination, destName);
      const existingSize = await statSize(destPath);
      if (existingSize !== null) {
        store.invalidateDest(folder.def.name);
        for (const entry of group) {
          results.push({
            name: entry.name,
            result: { status: "duplicate", destName, message: "group output already exists in destination" },
          });
        }
        continue;
      }

      try {
        await moveIntoPlace(output, destPath);
      } catch (err) {
        if (err instanceof DestExistsError) {
          store.invalidateDest(folder.def.name);
          for (const entry of group) {
            results.push({
              name: entry.name,
              result: { status: "duplicate", destName, message: "group output already exists in destination" },
            });
          }
          continue;
        }
        throw err;
      }
      store.invalidateDest(folder.def.name);
      store.refreshSnapOutputs(folder).catch(() => {});
      log(`concatenated ${group.length} snap(s) -> ${destName}`);
      for (const entry of group) {
        results.push({
          name: entry.name,
          result: { status: "done", destName, message: `part of group of ${group.length}` },
        });
      }
    } catch (err) {
      for (const entry of group) {
        results.push({
          name: entry.name,
          result: { status: "error", kind: "concat", message: String(err.message ?? err) },
        });
      }
    } finally {
      await fsp.rm(jobDir, { recursive: true, force: true });
    }
  }
  return results;
}
