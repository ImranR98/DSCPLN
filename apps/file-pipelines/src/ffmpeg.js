import { execFile } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const FFMPEG = process.env.MEDIA_SYNC_FFMPEG ?? "ffmpeg";
export const FFPROBE = process.env.MEDIA_SYNC_FFPROBE ?? "ffprobe";

async function run(bin, args, { timeoutMs = 60 * 60 * 1000, maxBuffer = 64 * 1024 * 1024 } = {}) {
  try {
    const { stdout, stderr } = await execFileAsync(bin, args, { timeout: timeoutMs, maxBuffer });
    return { stdout, stderr };
  } catch (err) {
    const detail = [err.stderr, err.stdout].filter(Boolean).join("\n").trim();
    const e = new Error(`${path.basename(bin)} failed: ${detail || err.message}`);
    e.cause = err;
    throw e;
  }
}

export async function probeDuration(file) {
  try {
    const { stdout } = await run(FFPROBE, [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      file,
    ], { timeoutMs: 60_000 });
    const value = Number.parseFloat(stdout.trim());
    if (Number.isFinite(value)) return value;
  } catch {
    // fall through
  }
  return 0;
}

export async function probeDurationWithExiftool(exiftool, file) {
  const { tagValueStrings } = await import("./exif.js");
  const tags = await exiftool.readRaw(file, ["-m"]);
  const raw = tagValueStrings(tags, (k) => k === "Duration").find(Boolean);
  if (!raw) return 0;
  const clock = /([0-9]+):([0-9]+):([0-9.]+)/.exec(raw);
  if (clock) return Number(clock[1]) * 3600 + Number(clock[2]) * 60 + Number(clock[3]);
  const secs = /([0-9.]+)\s*s/.exec(raw);
  if (secs) return Number(secs[1]);
  return 0;
}

export async function durationInfo(exiftool, file) {
  let value = await probeDuration(file);
  if (value > 0) return value;
  if (exiftool) {
    value = await probeDurationWithExiftool(exiftool, file);
    if (value > 0) return value;
  }
  return 0;
}

export function groupByTimeWindow(entries, windowSeconds) {
  const sorted = [...entries].sort((a, b) => a.timestamp - b.timestamp);
  const groups = [];
  let current = [];
  let last = null;
  for (const entry of sorted) {
    if (last === null || entry.timestamp - last <= windowSeconds) {
      current.push(entry);
    } else {
      groups.push(current);
      current = [entry];
    }
    last = entry.timestamp;
  }
  if (current.length > 0) groups.push(current);
  return groups;
}

export async function reencodeFile(input, output) {
  await run(FFMPEG, [
    "-nostdin", "-i", input,
    "-c:v", "libx264", "-preset", "medium", "-crf", "18",
    "-pix_fmt", "yuv420p", "-movflags", "+faststart",
    "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-strict", "experimental",
    "-y", output,
  ]);
  const stat = await fsp.stat(output).catch(() => null);
  if (!stat || stat.size === 0) {
    await fsp.copyFile(input, output);
  }
}

export async function concatenateFiles(inputs, output) {
  if (inputs.length === 1) {
    await fsp.copyFile(inputs[0], output);
    return;
  }
  const args = ["-nostdin"];
  const filterParts = [];
  inputs.forEach((input, i) => {
    args.push("-i", input);
    filterParts.push(`[${i}:v:0][${i}:a:0]`);
  });
  const filter = `${filterParts.join("")}concat=n=${inputs.length}:v=1:a=1[outv][outa]`;
  args.push(
    "-filter_complex", filter,
    "-map", "[outv]", "-map", "[outa]",
    "-c:v", "libx264", "-preset", "medium", "-crf", "18",
    "-pix_fmt", "yuv420p", "-movflags", "+faststart",
    "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-strict", "experimental",
    "-y", output,
  );
  try {
    await run(FFMPEG, args);
  } catch {
    // fall through to the alternative method
  }
  const stat = await fsp.stat(output).catch(() => null);
  if (stat && stat.size > 0) return;

  const tmpDir = path.dirname(output);
  const listFile = path.join(tmpDir, `concat-list-${Date.now()}.txt`);
  const lines = [];
  for (let i = 0; i < inputs.length; i++) {
    const tempFile = path.join(tmpDir, `concat-part-${i}-${path.basename(inputs[i])}`);
    await run(FFMPEG, [
      "-nostdin", "-i", inputs[i],
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", "128k",
      "-y", tempFile,
    ]);
    lines.push(`file '${tempFile.replace(/'/g, "'\\''")}'`);
  }
  await fsp.writeFile(listFile, lines.join("\n"));
  await run(FFMPEG, [
    "-nostdin", "-f", "concat", "-safe", "0", "-i", listFile,
    "-c:v", "libx264", "-preset", "medium", "-crf", "18",
    "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart",
    "-y", output,
  ]);
}

export async function remuxRepair(input, output) {
  await run(FFMPEG, ["-y", "-err_detect", "ignore_err", "-i", input, "-c", "copy", output]);
}

export async function makeTonePcm(file) {
  await run(FFMPEG, [
    "-y", "-loglevel", "panic", "-f", "lavfi",
    "-i", "sine=frequency=1000:duration=0.1",
    "-af", "volume=0dB", "-c:a", "pcm_s16le", "-ac", "2", "-ar", "48000",
    "-f", "s16le", file,
  ]);
}

export async function decodeToPcm(input, output) {
  await run(FFMPEG, [
    "-y", "-loglevel", "panic", "-i", input,
    "-c:a", "pcm_s16le", "-ac", "2", "-ar", "48000", "-f", "s16le", output,
  ]);
}

export async function encodePcmToAac(input, output) {
  await run(FFMPEG, [
    "-y", "-loglevel", "panic", "-f", "s16le", "-ac", "2", "-ar", "48000",
    "-i", input, "-c:a", "aac", "-b:a", "192K", "-ac", "2", output,
  ]);
}

export async function appendFile(source, target) {
  const read = fs.createReadStream(source);
  const write = fs.createWriteStream(target, { flags: "a" });
  await new Promise((resolve, reject) => {
    read.on("error", reject);
    write.on("error", reject);
    write.on("close", resolve);
    read.pipe(write);
  });
}

export async function findAudioDateStrings(srcDir) {
  const entries = await fsp.readdir(srcDir);
  const dates = [];
  for (const name of entries) {
    const matches = name.match(/-20[1-2][0-9][0-1][0-9][0-3][0-9]-/g);
    if (!matches) continue;
    for (const raw of matches) {
      const date = raw.slice(1, -1);
      if (dates[dates.length - 1] !== date) dates.push(date);
    }
  }
  return dates;
}

export async function concatAudio(srcDir, destDir, { log = console.log } = {}) {
  const entries = (await fsp.readdir(srcDir)).sort();
  const dates = await findAudioDateStrings(srcDir);
  await fsp.mkdir(destDir, { recursive: true });
  let count = 0;
  for (const date of dates) {
    log(`Date ${++count} of ${dates.length}: ${date}...`);
    const files = entries.filter((name) => name.includes(`-${date}-`));
    if (files.length === 0) continue;
    const tmpDir = await fsp.mkdtemp(path.join(destDir, ".file-pipelines-audio-"));
    try {
      const tonePcm = path.join(tmpDir, "tone.pcm");
      await makeTonePcm(tonePcm);
      const resultPcm = path.join(tmpDir, "result.pcm");
      await fsp.writeFile(resultPcm, "");
      for (let i = 0; i < files.length; i++) {
        const pcm = path.join(tmpDir, `part-${i}.pcm`);
        await decodeToPcm(path.join(srcDir, files[i]), pcm);
        await appendFile(pcm, resultPcm);
        if (i < files.length - 1) await appendFile(tonePcm, resultPcm);
      }
      const output = path.join(destDir, `${date}-merged.mp4`);
      await encodePcmToAac(resultPcm, output);
    } finally {
      await fsp.rm(tmpDir, { recursive: true, force: true });
    }
  }
  return count;
}
