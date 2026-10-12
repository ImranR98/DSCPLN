import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(HERE, "..", "bin", "media-sync.js");
// Optional: point MEDIA_SYNC_BASH_STANDARDIZE at an existing standardize
// implementation to compare outputs; the suite is skipped without it.
const BASH_SCRIPT = process.env.MEDIA_SYNC_BASH_STANDARDIZE ?? null;

function have(cmd) {
  try {
    execFileSync("which", [cmd], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const BASH_AVAILABLE = BASH_SCRIPT
  ? await fsp.access(BASH_SCRIPT).then(() => true).catch(() => false)
  : false;
const CAN_RUN = have("ffmpeg") && have("exiftool") && BASH_AVAILABLE;
const FIXED_MTIME = new Date("2022-08-09T10:11:12Z");

function makeJpeg(file) {
  execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-f", "lavfi", "-i", "color=c=blue:s=48x48:d=1", "-frames:v", "1", file]);
}

function makeMp4(file) {
  execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc=duration=1:size=48x48:rate=10", "-pix_fmt", "yuv420p", file]);
}

function setTags(file, args) {
  execFileSync("exiftool", ["-m", "-q", "-overwrite_original", ...args, file]);
}

async function fixtureDir(name, { jpeg = false } = {}) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), `media-sync-${name}-`));
  return dir;
}

async function standardizeWithBash(sourceDir, extra = []) {
  execFileSync("bash", [BASH_SCRIPT, ...extra, sourceDir], { stdio: "pipe" });
}

async function standardizeWithCli(sourceDir, extra = []) {
  execFileSync("node", [CLI, "standardize", ...extra, sourceDir], { stdio: "pipe" });
}

async function finalNames(dir) {
  const names = await fsp.readdir(dir);
  return names.filter((n) => /^\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}-\(/.test(n)).sort();
}

test("parity: standardize produces identical names to the bash script (synthetic fixtures)", { skip: !CAN_RUN }, async (t) => {
  const root = await fixtureDir("parity");
  const mine = path.join(root, "mine");
  const bash = path.join(root, "bash");
  await fsp.mkdir(mine);
  await fsp.mkdir(bash);
  try {
    const base = path.join(root, "base");
    await fsp.mkdir(base);

    makeJpeg(path.join(base, "dated.jpg"));
    setTags(path.join(base, "dated.jpg"), ["-DateTimeOriginal=2019:04:02 10:20:30", "-CreateDate=2019:04:02 10:20:30"]);

    makeJpeg(path.join(base, "plain.jpg"));

    makeMp4(path.join(base, "PXL_20200101.mp4"));
    setTags(path.join(base, "PXL_20200101.mp4"), ["-MediaCreateDate=2020:05:06 07:08:09"]);

    makeJpeg(path.join(base, "gps.jpg"));
    setTags(path.join(base, "gps.jpg"), ["-GPSDateStamp=2018:03:04"]);

    for (const name of await fsp.readdir(base)) {
      for (const dir of [mine, bash]) {
        const dest = path.join(dir, name);
        await fsp.copyFile(path.join(base, name), dest);
        await fsp.utimes(dest, FIXED_MTIME, FIXED_MTIME);
      }
    }

    await standardizeWithCli(mine);
    await standardizeWithBash(bash);

    const mineNames = await finalNames(mine);
    const bashNames = await finalNames(bash);
    assert.deepEqual(mineNames, bashNames);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("parity: filename-date mode (-n) matches the bash script", { skip: !CAN_RUN }, async () => {
  const root = await fixtureDir("parity-n");
  const mine = path.join(root, "mine");
  const bash = path.join(root, "bash");
  await fsp.mkdir(mine);
  await fsp.mkdir(bash);
  try {
    const base = path.join(root, "base");
    await fsp.mkdir(base);
    makeJpeg(path.join(base, "20190304_123 photo.jpg"));
    makeJpeg(path.join(base, "20210506_930 another.jpg"));
    for (const name of await fsp.readdir(base)) {
      for (const dir of [mine, bash]) {
        const dest = path.join(dir, name);
        await fsp.copyFile(path.join(base, name), dest);
        await fsp.utimes(dest, FIXED_MTIME, FIXED_MTIME);
      }
    }
    await standardizeWithCli(mine, ["-n"]);
    await standardizeWithBash(bash, ["-n"]);
    assert.deepEqual(await finalNames(mine), await finalNames(bash));
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});
