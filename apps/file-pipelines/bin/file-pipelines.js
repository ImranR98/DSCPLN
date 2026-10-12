#!/usr/bin/env node
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createExifTool, applyDates, applyDatesFromFileName, findRealExifDate, readBackDateTimeOriginal, readTags, readMediaCreateDate, standardNameFor, tagValueStrings } from "../src/exif.js";
import { concatAudio, remuxRepair } from "../src/ffmpeg.js";
import { DirCache, findExpectedDestName, verificationFor, statSize } from "../src/verify.js";
import { processSnapBatch } from "../src/processors/snapchat.js";
import { sha256File, uniqueSuffix } from "../src/util.js";
import { Daemon } from "../src/daemon.js";

const USAGE = `File Pipelines CLI

Usage:
  file-pipelines standardize [-n] [-p] [--strict] [--parallel N] <dir>
      Standardize dates and file names of media files in a directory tree.
      -n  take the date from the file name when possible (also repairs truncated MP4s)
      -p  do not rename files
  file-pipelines snapconcat [--park DIR] [--dest DIR] [--window SECONDS] <dir>
      Concatenate Snapchat-*.mp4 clips by time proximity, standardize and place them.
      --park DIR   move the raw clips aside after successful concatenation
  file-pipelines concataudio <src dir> <dest dir>
      Concatenate same-day audio files with a 0.1s tone between them.
  file-pipelines clean-synced [--delete | --trash DIR] [--force] <src dir> <dest dir>
      Remove files from src that are already present in dest.
  file-pipelines serve [--config FILE] [--port N] [--bind HOST] [--force]
      Run the watch daemon + web UI.
`;

function fail(message) {
  console.error(`file-pipelines: ${message}`);
  process.exit(2);
}

async function walkFiles(dir) {
  const out = [];
  const stack = [path.resolve(dir)];
  while (stack.length > 0) {
    const current = stack.pop();
    const entries = await fsp.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.isFile()) out.push(full);
    }
  }
  return out.sort();
}

async function runPool(items, limit, worker) {
  let index = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (index < items.length) {
      const current = items[index++];
      await worker(current);
    }
  });
  await Promise.all(workers);
}

function isClearlyNonMedia(mime) {
  return typeof mime === "string" && mime !== "" && mime !== "application/octet-stream" && !/^(image|video|audio)\//.test(mime);
}

async function standardizeCommand(args) {
  const flags = { filenameDate: false, noRename: false, strict: false, parallel: os.cpus().length };
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "-n" || arg === "--filename-date") flags.filenameDate = true;
    else if (arg === "-p" || arg === "--no-rename") flags.noRename = true;
    else if (arg === "--strict") flags.strict = true;
    else if (arg === "--parallel") flags.parallel = Number(args[++i]);
    else if (arg.startsWith("-")) fail(`unknown option ${arg}`);
    else positional.push(arg);
  }
  if (positional.length !== 1) fail("standardize requires exactly one directory");
  const target = positional[0];
  const stat = await fsp.stat(target).catch(() => null);
  if (!stat?.isDirectory()) fail(`not a directory: ${target}`);

  const exiftool = createExifTool();
  let failures = 0;
  try {
    const files = await walkFiles(target);
    await runPool(files, flags.parallel, async (file) => {
      try {
        const tags = await readTags(exiftool, file);
        const mime = tagValueStrings(tags, (k) => k === "MIMEType")[0];
        if (isClearlyNonMedia(mime)) {
          console.error(`WARN: File is not a media file: ${file}`);
          return;
        }
        if (flags.filenameDate) {
          try {
            await applyDatesFromFileName(exiftool, file);
          } catch (err) {
            if (/truncat/i.test(err.message)) {
              const repaired = `${file}.repaired-${uniqueSuffix()}`;
              await remuxRepair(file, repaired);
              await fsp.rename(repaired, file);
              await applyDatesFromFileName(exiftool, file);
            } else {
              throw err;
            }
          }
        }
        const date = await findRealExifDate(exiftool, file);
        if (!date) {
          console.error(`WARN: No date found for file: ${file}`);
          failures++;
          return;
        }
        await applyDates(exiftool, file, date);
        if (flags.noRename) return;
        let dto = await readBackDateTimeOriginal(exiftool, file);
        if (!dto && /^PXL_/i.test(path.basename(file)) && /\.mp4$/i.test(file)) {
          dto = await readMediaCreateDate(exiftool, file);
        }
        if (!dto) {
          console.error(`WARN: File not renamed: ${file}`);
          failures++;
          return;
        }
        const newName = standardNameFor(path.basename(file), dto);
        const newPath = path.join(path.dirname(file), newName);
        if (newPath !== file) {
          await fsp.rename(file, newPath);
          console.log(`Renamed to ${newPath}`);
        }
      } catch (err) {
        failures++;
        console.error(`ERRR: ${file}: ${err.message}`);
      }
    });
  } finally {
    await exiftool.end();
  }
  console.log("Done!");
  if (flags.strict && failures > 0) process.exit(1);
}

function stubStore() {
  return {
    invalidateDest() {},
    async refreshSnapOutputs() {},
    updateFile() {},
  };
}

async function snapconcatCommand(args) {
  const flags = { park: null, dest: null, window: null };
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--park") flags.park = args[++i];
    else if (arg === "--dest") flags.dest = args[++i];
    else if (arg === "--window") flags.window = Number(args[++i]);
    else if (arg.startsWith("-")) fail(`unknown option ${arg}`);
    else positional.push(arg);
  }
  if (positional.length !== 1) fail("snapconcat requires exactly one directory");
  const source = path.resolve(positional[0]);
  const stat = await fsp.stat(source).catch(() => null);
  if (!stat?.isDirectory()) fail(`not a directory: ${source}`);
  const destination = flags.dest ? path.resolve(flags.dest) : source;

  const entries = (await fsp.readdir(source)).filter((n) => /^Snapchat-.*\.mp4$/i.test(n)).sort();
  if (entries.length === 0) {
    console.log("No Snapchat-*.mp4 files found.");
    return;
  }

  const stagingDir = await fsp.mkdtemp(path.join(os.tmpdir(), "file-pipelines-snap-"));
  const exiftool = createExifTool();
  const folder = {
    def: {
      name: "snapconcat",
      source,
      destination,
      method: "snapchat",
      groupWindowSeconds: flags.window ?? 15,
      settleSeconds: 0,
    },
    files: new Map(),
  };
  const ctx = {
    exiftool,
    config: { dryRun: false, stagingDir },
    store: stubStore(),
    log: (msg) => console.log(msg),
    notify: { notify() {} },
  };
  try {
    const files = entries.map((name) => ({ name, status: "pending", size: 0, mtimeMs: 0 }));
    const results = await processSnapBatch(ctx, folder, files);
    let failed = 0;
    for (const { name, result } of results) {
      if (result.status === "done") console.log(`Processed ${name} -> ${result.destName}`);
      else if (result.status === "duplicate") console.log(`Already processed: ${name}`);
      else {
        failed++;
        console.error(`ERRR: ${name}: ${result.message}`);
      }
    }
    if (flags.park) {
      await fsp.mkdir(flags.park, { recursive: true });
      const okNames = new Set(results.filter((r) => r.result.status === "done" || r.result.status === "duplicate").map((r) => r.name));
      for (const name of entries) {
        if (okNames.has(name)) await fsp.rename(path.join(source, name), path.join(flags.park, name)).catch(() => {});
      }
    }
    if (failed > 0) process.exit(1);
  } finally {
    await fsp.rm(stagingDir, { recursive: true, force: true });
    await exiftool.end();
  }
}

async function concataudioCommand(args) {
  if (args.length !== 2) fail("concataudio requires <src dir> <dest dir>");
  await concatAudio(path.resolve(args[0]), path.resolve(args[1]), { log: console.log });
}

async function cleanSyncedCommand(args) {
  const flags = { mode: "trash", trashDir: path.join(os.homedir(), ".file-pipelines", "trash"), force: false };
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--delete") flags.mode = "delete";
    else if (arg === "--trash") {
      flags.mode = "trash";
      flags.trashDir = path.resolve(args[++i]);
    } else if (arg === "--force") flags.force = true;
    else if (arg.startsWith("-")) fail(`unknown option ${arg}`);
    else positional.push(arg);
  }
  if (positional.length !== 2) fail("clean-synced requires <src dir> <dest dir>");
  const src = path.resolve(positional[0]);
  const dest = path.resolve(positional[1]);
  if (!(await fsp.stat(src).catch(() => null))?.isDirectory()) fail(`not a directory: ${src}`);
  if (!(await fsp.stat(dest).catch(() => null))?.isDirectory()) fail(`not a directory: ${dest}`);

  const exiftool = createExifTool();
  const cache = new DirCache(0);
  let deleted = 0;
  let skipped = 0;
  try {
    const names = (await fsp.readdir(src)).filter((n) => !n.startsWith(".") && !n.endsWith(".tmp") && !n.includes("!sync"));
    for (const name of names) {
      const sourcePath = path.join(src, name);
      const stat = await fsp.stat(sourcePath).catch(() => null);
      if (!stat?.isFile()) continue;
      const names = await cache.list(dest);
      let destName = names.includes(name) ? name : null;
      if (!destName) {
        const date = await findRealExifDate(exiftool, sourcePath).catch(() => null);
        if (date) destName = findExpectedDestName(names, standardNameFor(name, date));
      }
      const destPath = destName ? path.join(dest, destName) : null;
      if (!destPath) {
        console.log(`Not synced: ${name}`);
        skipped++;
        continue;
      }
      if (!flags.force) {
        const size = await statSize(destPath);
        if (size === null || size === 0) {
          console.log(`Not synced (destination invalid): ${name}`);
          skipped++;
          continue;
        }
        if (destName === name) {
          const [a, b] = await Promise.all([sha256File(sourcePath), sha256File(destPath)]);
          if (a !== b) {
            console.error(`ERRR: ${name}: destination copy differs (hash mismatch); not removing`);
            skipped++;
            continue;
          }
        } else {
          const verify = await verificationFor({ method: "standardize", sourcePath, destPath, exiftool });
          if (!verify.ok) {
            console.error(`ERRR: ${name}: destination copy failed verification (${verify.reason}); not removing`);
            skipped++;
            continue;
          }
        }
      }
      if (flags.mode === "delete") {
        await fsp.unlink(sourcePath);
      } else {
        const day = new Date().toISOString().slice(0, 10);
        const dir = path.join(flags.trashDir, day);
        await fsp.mkdir(dir, { recursive: true });
        let target = path.join(dir, name);
        try {
          await fsp.rename(sourcePath, target);
        } catch (err) {
          if (err.code !== "EXDEV") throw err;
          await fsp.copyFile(sourcePath, target);
          const [a, b] = await Promise.all([sha256File(sourcePath), sha256File(target)]);
          if (a !== b) {
            await fsp.rm(target, { force: true });
            throw new Error("trash copy failed hash verification");
          }
          await fsp.unlink(sourcePath);
        }
      }
      console.log(`Removed: ${name} (in destination as ${destName})`);
      deleted++;
    }
  } finally {
    await exiftool.end();
  }
  console.log(`Done. Removed ${deleted} file(s); left ${skipped} file(s) in place.`);
}

async function serveCommand(args) {
  const options = { config: path.resolve("config.json"), force: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--config") options.config = path.resolve(args[++i]);
    else if (arg === "--port") options.port = Number(args[++i]);
    else if (arg === "--bind") options.bind = args[++i];
    else if (arg === "--force") options.force = true;
    else fail(`unknown option ${arg}`);
  }
  const daemon = new Daemon(options.config, options);
  await daemon.start();
  const shutdown = async (signal) => {
    console.log(`received ${signal}, shutting down...`);
    await daemon.stop();
    process.exit(0);
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  await new Promise(() => {});
}

const [command, ...rest] = process.argv.slice(2);
try {
  switch (command) {
    case "standardize":
      await standardizeCommand(rest);
      break;
    case "snapconcat":
      await snapconcatCommand(rest);
      break;
    case "concataudio":
      await concataudioCommand(rest);
      break;
    case "clean-synced":
      await cleanSyncedCommand(rest);
      break;
    case "serve":
      await serveCommand(rest);
      break;
    case undefined:
    case "--help":
    case "-h":
    case "help":
      console.log(USAGE);
      break;
    default:
      fail(`unknown command: ${command}\n\n${USAGE}`);
  }
} catch (err) {
  fail(err.stack ?? err.message);
}
