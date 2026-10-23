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

const CAN_RUN = have("ffmpeg") && have("exiftool");

function makeJpeg(file) {
  execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-f", "lavfi", "-i", "color=c=green:s=48x48:d=1", "-frames:v", "1", file]);
}

function setTags(file, args) {
  execFileSync("exiftool", ["-m", "-q", "-overwrite_original", ...args, file]);
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitFor(fn, timeoutMs = 75_000, intervalMs = 250) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await fn()) return true;
    await sleep(intervalMs);
  }
  return false;
}

async function makeSetup({ paused = false, settleSeconds = 0, dryRun = false } = {}) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "file-pipelines-e2e-"));
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
    dryRun,
    trashRetentionDays: 30,
    settleSeconds,
    maxAutoRetries: 2,
    stagingDir: path.join(root, "staging"),
    trashDir: path.join(root, "trash"),
    logDir: path.join(root, "logs"),
    syncLockFile: path.join(root, "lock.json"),
    lockHeartbeatSeconds: 60,
    lockStaleSeconds: 120,
    notifySuccess: true,
    folders: [
      {
        name: "camera",
        source: src,
        destination: dest,
        method: "standardize",
        settleSeconds,
      },
    ],
  };
  await fsp.writeFile(configPath, JSON.stringify(config, null, 2));
  const daemon = new Daemon(configPath, {});
  await daemon.start();
  return { root, src, dest, configPath, daemon };
}

test("e2e: watches, standardizes, copies to destination, and cleans up to trash", { skip: !CAN_RUN }, async () => {
  const { root, src, dest, daemon } = await makeSetup();
  try {
    const notifications = [];
    daemon.ctx.notify.notify = async (level, message) => {
      notifications.push({ level, message });
    };
    const file = path.join(src, "dated.jpg");
    makeJpeg(file);
    setTags(file, ["-DateTimeOriginal=2019:04:02 10:20:30", "-CreateDate=2019:04:02 10:20:30"]);

    const done = await waitFor(() => daemon.store.fileFor("camera", "dated.jpg")?.status === STATUS.DONE, 75_000);
    assert.equal(done, true, "file should be processed");
    assert.equal(
      notifications.some((n) => n.level === "info" && n.message.includes("dated.jpg") && n.message.includes("2019-04-02-10-20-30-(dated).jpg")),
      true,
      `expected a success notification, got: ${JSON.stringify(notifications)}`,
    );

    const expected = "2019-04-02-10-20-30-(dated).jpg";
    const destFile = path.join(dest, expected);
    assert.equal(await fsp.stat(destFile).then(() => true).catch(() => false), true, "destination file should exist");
    assert.equal(await fsp.stat(file).then(() => true).catch(() => false), true, "original must still exist before cleanup");

    const folder = daemon.store.getFolder("camera");
    const results = await cleanupFiles(daemon.ctx, folder, ["dated.jpg"]);
    assert.deepEqual(results.map((r) => r.ok), [true]);
    assert.equal(await fsp.stat(file).then(() => true).catch(() => false), false, "original should be gone after cleanup");
    const trashEntries = await fsp.readdir(daemon.ctx.config.trashDir);
    assert.equal(trashEntries.length, 1, "trash should have a day dir");
    const trashed = (await fsp.readdir(path.join(daemon.ctx.config.trashDir, trashEntries[0]))).filter((n) => !n.startsWith("."));
    assert.deepEqual(trashed, ["dated.jpg"]);
    assert.equal(await fsp.stat(destFile).then(() => true).catch(() => false), true, "destination must survive cleanup");
  } finally {
    await daemon.stop();
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("e2e: cleanup is blocked when the destination copy is missing", { skip: !CAN_RUN }, async () => {
  const { root, src, dest, daemon } = await makeSetup();
  try {
    const file = path.join(src, "dated.jpg");
    makeJpeg(file);
    setTags(file, ["-DateTimeOriginal=2019:04:02 10:20:30", "-CreateDate=2019:04:02 10:20:30"]);
    const done = await waitFor(() => daemon.store.fileFor("camera", "dated.jpg")?.status === STATUS.DONE, 75_000);
    assert.equal(done, true);

    await fsp.rm(path.join(dest, "2019-04-02-10-20-30-(dated).jpg"));
    const folder = daemon.store.getFolder("camera");
    const results = await cleanupFiles(daemon.ctx, folder, ["dated.jpg"]);
    assert.equal(results[0].ok, false);
    assert.equal(await fsp.stat(file).then(() => true).catch(() => false), true, "original must be kept");
    assert.equal(daemon.store.fileFor("camera", "dated.jpg").status, STATUS.CONFLICT);
  } finally {
    await daemon.stop();
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("e2e: pause stops automatic processing but manual actions still work", { skip: !CAN_RUN }, async () => {
  const { root, src, daemon } = await makeSetup({ paused: true });
  try {
    const file = path.join(src, "dated.jpg");
    const undated = path.join(src, "broken.jpg");
    makeJpeg(file);
    await fsp.writeFile(undated, "");
    setTags(file, ["-DateTimeOriginal=2019:04:02 10:20:30", "-CreateDate=2019:04:02 10:20:30"]);
    const registered = await waitFor(
      () => daemon.store.fileFor("camera", "dated.jpg") != null && daemon.store.fileFor("camera", "broken.jpg") != null,
    );
    assert.equal(registered, true, "the watcher must register both new files");
    assert.equal(daemon.store.fileFor("camera", "dated.jpg").status, STATUS.PENDING, "must stay pending while paused");
    assert.equal(daemon.store.fileFor("camera", "broken.jpg").status, STATUS.PENDING, "must stay pending while paused");

    const result = await daemon.queue.processNow("camera");
    assert.equal(result.ok, true);
    const done = await waitFor(() => daemon.store.fileFor("camera", "dated.jpg")?.status === STATUS.DONE, 75_000);
    assert.equal(done, true, "process now must work while paused");
    const errored = await waitFor(() => daemon.store.fileFor("camera", "broken.jpg")?.status === STATUS.ERROR, 75_000);
    assert.equal(errored, true, "unreadable file should error");

    const { runAction } = await import("../src/actions.js");
    const retry = await runAction(daemon.ctx, daemon.queue, "camera", "broken.jpg", "retry");
    assert.equal(retry.ok, true);
    const retried = await waitFor(() => daemon.store.fileFor("camera", "broken.jpg")?.status === STATUS.ERROR, 75_000);
    assert.equal(retried, true, "retry must work while paused");
  } finally {
    await daemon.stop();
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("e2e: cleanup accepts a LifeTagger-style tagged destination file", { skip: !CAN_RUN }, async () => {
  const { root, src, dest, daemon } = await makeSetup();
  try {
    const file = path.join(src, "dated.jpg");
    makeJpeg(file);
    setTags(file, ["-DateTimeOriginal=2019:04:02 10:20:30", "-CreateDate=2019:04:02 10:20:30"]);
    const done = await waitFor(() => daemon.store.fileFor("camera", "dated.jpg")?.status === STATUS.DONE, 75_000);
    assert.equal(done, true);

    const expected = "2019-04-02-10-20-30-(dated).jpg";
    const tagged = "2019-04-02-10-20-30-(dated)-[beach, sunny].jpg";
    await fsp.rename(path.join(dest, expected), path.join(dest, tagged));

    const folder = daemon.store.getFolder("camera");
    const results = await cleanupFiles(daemon.ctx, folder, ["dated.jpg"]);
    assert.deepEqual(results.map((r) => r.ok), [true], JSON.stringify(results));
    assert.equal(await fsp.stat(file).then(() => true).catch(() => false), false, "original should be cleaned");
    assert.equal(await fsp.stat(path.join(dest, tagged)).then(() => true).catch(() => false), true);
  } finally {
    await daemon.stop();
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("e2e: cleanup is blocked when the destination name does not match the source expectation", { skip: !CAN_RUN }, async () => {
  const { root, src, dest, daemon } = await makeSetup();
  try {
    const file = path.join(src, "dated.jpg");
    makeJpeg(file);
    setTags(file, ["-DateTimeOriginal=2019:04:02 10:20:30", "-CreateDate=2019:04:02 10:20:30"]);
    const done = await waitFor(() => daemon.store.fileFor("camera", "dated.jpg")?.status === STATUS.DONE, 75_000);
    assert.equal(done, true);

    const expected = "2019-04-02-10-20-30-(dated).jpg";
    await fsp.rename(path.join(dest, expected), path.join(dest, "2018-01-01-00-00-00-(dated).jpg"));

    const folder = daemon.store.getFolder("camera");
    const results = await cleanupFiles(daemon.ctx, folder, ["dated.jpg"]);
    assert.equal(results[0].ok, false);
    assert.equal(await fsp.stat(file).then(() => true).catch(() => false), true, "original must be kept");
    assert.equal(daemon.store.fileFor("camera", "dated.jpg").status, STATUS.CONFLICT);
  } finally {
    await daemon.stop();
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("e2e: cleanup is blocked when the destination date disagrees with its file name", { skip: !CAN_RUN }, async () => {
  const { root, src, dest, daemon } = await makeSetup();
  try {
    const file = path.join(src, "dated.jpg");
    makeJpeg(file);
    setTags(file, ["-DateTimeOriginal=2019:04:02 10:20:30", "-CreateDate=2019:04:02 10:20:30"]);
    const done = await waitFor(() => daemon.store.fileFor("camera", "dated.jpg")?.status === STATUS.DONE, 75_000);
    assert.equal(done, true);

    const expected = "2019-04-02-10-20-30-(dated).jpg";
    setTags(path.join(dest, expected), ["-DateTimeOriginal=2018:01:01 00:00:00"]);

    const folder = daemon.store.getFolder("camera");
    const results = await cleanupFiles(daemon.ctx, folder, ["dated.jpg"]);
    assert.equal(results[0].ok, false);
    assert.match(results[0].reason, /differs/);
    assert.equal(await fsp.stat(file).then(() => true).catch(() => false), true, "original must be kept");
  } finally {
    await daemon.stop();
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("e2e: dry run reports the plan without writing anything", { skip: !CAN_RUN }, async () => {
  const { root, src, dest, daemon } = await makeSetup({ dryRun: true });
  try {
    const file = path.join(src, "dated.jpg");
    makeJpeg(file);
    setTags(file, ["-DateTimeOriginal=2019:04:02 10:20:30", "-CreateDate=2019:04:02 10:20:30"]);
    const reported = await waitFor(() => (daemon.store.fileFor("camera", "dated.jpg")?.message ?? "").includes("dry run:"), 75_000);
    assert.equal(reported, true, "dry run should report a plan");
    assert.equal(daemon.store.fileFor("camera", "dated.jpg").status, STATUS.PENDING);
    assert.deepEqual(await fsp.readdir(dest), [], "destination must stay empty in dry-run mode");
    assert.equal(await fsp.stat(file).then(() => true).catch(() => false), true);
  } finally {
    await daemon.stop();
    await fsp.rm(root, { recursive: true, force: true });
  }
});
