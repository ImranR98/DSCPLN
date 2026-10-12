import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Daemon } from "../src/daemon.js";
import { cleanupFiles } from "../src/cleanup.js";
import { STATUS } from "../src/store.js";

function have(cmd) {
  try {
    execFileSync("which", [cmd], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const CAN_RUN = have("ffmpeg") && have("exiftool") && have("ffprobe");

function makeClip(file, seconds = 1) {
  execFileSync("ffmpeg", [
    "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", `testsrc=duration=${seconds}:size=64x64:rate=10`,
    "-f", "lavfi", "-i", `sine=frequency=440:duration=${seconds}`,
    "-pix_fmt", "yuv420p", "-shortest", file,
  ]);
}

function setTags(file, args) {
  execFileSync("exiftool", ["-m", "-q", "-overwrite_original", ...args, file]);
}

function readTags(file, ...tags) {
  const out = execFileSync("exiftool", ["-m", "-s", "-j", ...tags, file], { encoding: "utf8" });
  return JSON.parse(out)[0];
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitFor(fn, timeoutMs = 90_000, intervalMs = 250) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await fn()) return true;
    await sleep(intervalMs);
  }
  return false;
}

async function makeSetup({ paused = false, folder = {} } = {}) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "media-sync-snap-"));
  const src = path.join(root, "src");
  const dest = path.join(root, "dest");
  await fsp.mkdir(src, { recursive: true });
  await fsp.mkdir(dest, { recursive: true });
  const configPath = path.join(root, "config.json");
  const config = {
    configVersion: 1,
    bindHost: "127.0.0.1",
    port: 0,
    concurrency: 1,
    paused,
    dryRun: false,
    trashRetentionDays: 30,
    settleSeconds: 0,
    maxAutoRetries: 1,
    stagingDir: path.join(root, "staging"),
    trashDir: path.join(root, "trash"),
    logDir: path.join(root, "logs"),
    syncLockFile: path.join(root, "lock.json"),
    lockHeartbeatSeconds: 60,
    lockStaleSeconds: 120,
    ntfy: { url: "", token: "" },
    folders: [
      {
        name: "snapchat",
        source: src,
        destination: dest,
        method: "snapchat",
        filePattern: "Snapchat-*.mp4",
        groupWindowSeconds: 15,
        settleSeconds: 0,
        ...folder,
      },
    ],
  };
  await fsp.writeFile(configPath, JSON.stringify(config, null, 2));
  const daemon = new Daemon(configPath, {});
  await daemon.start();
  return { root, src, dest, daemon };
}

test("e2e snapchat: concatenates clips into one standardized output with XMP mapping, then cleans up", { skip: !CAN_RUN }, async () => {
  const { root, src, dest, daemon } = await makeSetup();
  try {
    makeClip(path.join(src, "Snapchat-1.mp4"), 1);
    makeClip(path.join(src, "Snapchat-2.mp4"), 1);
    setTags(path.join(src, "Snapchat-1.mp4"), ["-CreateDate=2021:01:02 03:04:05", "-MediaCreateDate=2021:01:02 03:04:05"]);
    setTags(path.join(src, "Snapchat-2.mp4"), ["-CreateDate=2021:01:02 03:04:15", "-MediaCreateDate=2021:01:02 03:04:15"]);
    await fsp.writeFile(path.join(src, "notes.txt"), "not a snap");
    makeClip(path.join(src, "Snapchat-3.mov"), 1);

    const done = await waitFor(() => {
      const a = daemon.store.fileFor("snapchat", "Snapchat-1.mp4");
      const b = daemon.store.fileFor("snapchat", "Snapchat-2.mp4");
      return a?.status === STATUS.DONE && b?.status === STATUS.DONE;
    }, 120_000);
    assert.equal(done, true, "both clips should be processed");

    assert.equal(daemon.store.fileFor("snapchat", "notes.txt").status, STATUS.IGNORED);
    assert.equal(daemon.store.fileFor("snapchat", "Snapchat-3.mov").status, STATUS.IGNORED);

    const a = daemon.store.fileFor("snapchat", "Snapchat-1.mp4");
    const b = daemon.store.fileFor("snapchat", "Snapchat-2.mp4");
    assert.equal(a.destName, b.destName, "clips in one group share the same output");
    const destPath = path.join(dest, a.destName);
    assert.match(a.destName, /^2021-01-02-03-04-05-\(Snap_2021-01-02-030405_group1\)\.mp4$/);
    assert.equal(await fsp.stat(destPath).then(() => true).catch(() => false), true);
    assert.deepEqual((await fsp.readdir(dest)).sort(), [a.destName], "only the group output should be in dest");

    const tags = readTags(destPath, "-DateTimeOriginal", "-XMP-media-sync:Inputs", "-XMP-media-sync:ExpectedDuration");
    assert.equal(tags.DateTimeOriginal, "2021:01:02 03:04:05");
    assert.deepEqual(JSON.parse(tags.Inputs), ["Snapchat-1.mp4", "Snapchat-2.mp4"]);
    assert.equal(Number(tags.ExpectedDuration) > 0, true);

    const folder = daemon.store.getFolder("snapchat");
    const results = await cleanupFiles(daemon.ctx, folder, ["Snapchat-1.mp4", "Snapchat-2.mp4"]);
    assert.deepEqual(results.map((r) => r.ok), [true, true]);
    assert.deepEqual((await fsp.readdir(src)).sort(), ["Snapchat-3.mov", "notes.txt"]);
    assert.equal(await fsp.stat(destPath).then(() => true).catch(() => false), true, "output must survive cleanup");
  } finally {
    await daemon.stop();
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("e2e snapchat: failed clips can be re-attempted manually while paused and recover on change", { skip: !CAN_RUN }, async () => {
  const { root, src, dest, daemon } = await makeSetup({ paused: true });
  try {
    const badPath = path.join(src, "Snapchat-bad.mp4");
    await fsp.writeFile(badPath, "");

    await daemon.setPaused(false);
    const errored = await waitFor(() => daemon.store.fileFor("snapchat", "Snapchat-bad.mp4")?.status === STATUS.ERROR, 120_000);
    assert.equal(errored, true, "empty clip should fail to process");
    const firstAttempts = daemon.store.fileFor("snapchat", "Snapchat-bad.mp4").attempts;
    assert.equal(firstAttempts, 1);

    await daemon.setPaused(true);
    const result = await daemon.queue.processNow("snapchat");
    assert.equal(result.ok, true);
    const retried = await waitFor(() => (daemon.store.fileFor("snapchat", "Snapchat-bad.mp4")?.attempts ?? 0) > firstAttempts, 75_000);
    assert.equal(retried, true, "process now must re-attempt failed snaps while paused");

    makeClip(badPath, 1);
    setTags(badPath, ["-CreateDate=2021:01:02 03:04:05", "-MediaCreateDate=2021:01:02 03:04:05"]);
    await daemon.setPaused(false);
    const recovered = await waitFor(() => daemon.store.fileFor("snapchat", "Snapchat-bad.mp4")?.status === STATUS.DONE, 120_000);
    assert.equal(recovered, true, "changed file must be re-processed and succeed");
    assert.equal((await fsp.readdir(dest)).length, 1);
  } finally {
    await daemon.stop();
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("e2e snapchat: manual placement parks the concatenated group until approved", { skip: !CAN_RUN }, async () => {
  const { root, src, dest, daemon } = await makeSetup({ folder: { placement: "manual" } });
  try {
    const { listReview, placeReview } = await import("../src/review.js");
    makeClip(path.join(src, "Snapchat-1.mp4"), 1);
    makeClip(path.join(src, "Snapchat-2.mp4"), 1);
    setTags(path.join(src, "Snapchat-1.mp4"), ["-CreateDate=2021:01:02 03:04:05", "-MediaCreateDate=2021:01:02 03:04:05"]);
    setTags(path.join(src, "Snapchat-2.mp4"), ["-CreateDate=2021:01:02 03:04:15", "-MediaCreateDate=2021:01:02 03:04:15"]);
    const registered = await waitFor(() =>
      daemon.store.fileFor("snapchat", "Snapchat-1.mp4") != null && daemon.store.fileFor("snapchat", "Snapchat-2.mp4") != null);
    assert.equal(registered, true, "the watcher must register the new clips");
    assert.equal(daemon.store.fileFor("snapchat", "Snapchat-1.mp4").status, STATUS.PENDING, "manual snapchat folders must not auto-process");

    await daemon.queue.processNow("snapchat");
    const reviewed = await waitFor(() => daemon.store.fileFor("snapchat", "Snapchat-1.mp4")?.status === STATUS.REVIEW);
    assert.equal(reviewed, true);
    const entries = await listReview(daemon.ctx);
    assert.equal(entries.length, 1);
    assert.match(entries[0].destName, /^2021-01-02-03-04-05-\(Snap_2021-01-02-030405_group1\)\.mp4$/);
    assert.deepEqual(await fsp.readdir(dest), [], "nothing may be placed before approval");

    const folder = daemon.store.getFolder("snapchat");
    assert.equal((await placeReview(daemon.ctx, folder, entries[0].destName)).ok, true);
    assert.deepEqual((await fsp.readdir(dest)).sort(), [entries[0].destName]);
  } finally {
    await daemon.stop();
    await fsp.rm(root, { recursive: true, force: true });
  }
});
