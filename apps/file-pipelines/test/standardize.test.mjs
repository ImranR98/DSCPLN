import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Daemon } from "../src/daemon.js";
import { cleanupFiles } from "../src/cleanup.js";
import { Store, STATUS } from "../src/store.js";
import { stageCopy } from "../src/processors/standardize.js";

function have(cmd) {
  try {
    execFileSync("which", [cmd], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const CAN_RUN = have("ffmpeg") && have("exiftool") && have("ffprobe");

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitFor(fn, timeoutMs = 60_000, intervalMs = 250) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await fn()) return true;
    await sleep(intervalMs);
  }
  return false;
}

test("stageCopy preserves the source mtime (dateless files need a stable date)", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "file-pipelines-stage-"));
  try {
    const source = path.join(root, "photo.jpg");
    await fsp.writeFile(source, "not-really-a-jpeg");
    const when = new Date(2026, 9, 10, 14, 10, 54);
    await fsp.utimes(source, when, when);

    const staged = await stageCopy(source, path.join(root, "staging"), "photo.jpg");
    const stat = await fsp.stat(staged);
    assert.equal(
      Math.floor(stat.mtimeMs / 1000),
      Math.floor(when.getTime() / 1000),
      "the staged copy must carry the source mtime, or the derived date (and destination name) changes every run",
    );
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("dateless files standardize to their source mtime and clean up (no duplicate copies)", { skip: !CAN_RUN }, async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "file-pipelines-dateless-"));
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
    paused: false,
    dryRun: false,
    trashRetentionDays: 30,
    settleSeconds: 0,
    maxAutoRetries: 1,
    stagingDir: path.join(root, "staging"),
    reviewDir: path.join(root, "review"),
    trashDir: path.join(root, "trash"),
    logDir: path.join(root, "logs"),
    syncLockFile: path.join(root, "lock.json"),
    lockHeartbeatSeconds: 60,
    lockStaleSeconds: 120,
    ntfy: { url: "", token: "" },
    folders: [{ name: "photos", source: src, destination: dest, method: "standardize", settleSeconds: 0 }],
  };
  await fsp.writeFile(configPath, JSON.stringify(config, null, 2));
  const daemon = new Daemon(configPath, {});
  try {
    const file = path.join(src, "dateless.jpg");
    execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-f", "lavfi", "-i", "color=c=blue:s=48x48:d=1", "-frames:v", "1", file]);
    // WhatsApp-style file: a real date on the file system but none in the media.
    const when = new Date(2026, 9, 10, 14, 10, 54);
    await fsp.utimes(file, when, when);

    await daemon.start();
    await daemon.queue.processNow("photos");
    const done = await waitFor(() => daemon.store.fileFor("photos", "dateless.jpg")?.status === STATUS.DONE);
    assert.equal(done, true);

    const expected = "2026-10-10-14-10-54-(dateless).jpg";
    assert.deepEqual(await fsp.readdir(dest), [expected], "the destination name must come from the source mtime");

    // A restart rebuilds the store from disk; the existing copy must be adopted
    // as a duplicate, not re-processed into another copy.
    const restarted = new Store(daemon.config, daemon.exiftool);
    await restarted.scanFolder("photos");
    assert.equal(restarted.fileFor("photos", "dateless.jpg").status, STATUS.DUPLICATE);

    // Cleanup verifies the destination name and only then removes the source.
    const folder = daemon.store.getFolder("photos");
    const results = await cleanupFiles(daemon.ctx, folder, ["dateless.jpg"]);
    assert.equal(results[0].ok, true, results[0].reason);
    assert.deepEqual(await fsp.readdir(src), [], "the source is removed after a verified cleanup");
    assert.deepEqual(await fsp.readdir(dest), [expected], "no extra copy was created");
  } finally {
    await daemon.stop();
    await fsp.rm(root, { recursive: true, force: true });
  }
});
