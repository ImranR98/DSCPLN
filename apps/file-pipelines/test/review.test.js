import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Daemon } from "../src/daemon.js";
import { listReview, placeReview } from "../src/review.js";
import { STATUS } from "../src/store.js";
import { approveVoiceNoteGroup, deleteVoiceNoteGroup, listVoiceNoteGroups } from "../src/voicenotes-flow.js";

function have(cmd) {
  try {
    execFileSync("which", [cmd], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const CAN_RUN = have("ffmpeg") && have("exiftool") && have("ffprobe");

function makeVoiceNote(file) {
  execFileSync("mkdir", ["-p", path.dirname(file)]);
  execFileSync("ffmpeg", [
    "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", "sine=frequency=440:duration=0.5",
    "-c:a", "libopus", file,
  ]);
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(fn, timeoutMs = 60_000, intervalMs = 250) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await fn()) return true;
    await sleep(intervalMs);
  }
  return false;
}

async function makeVoiceSetup({ settleSeconds = 0, dryRun = false } = {}) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "file-pipelines-voice-"));
  const src = path.join(root, "src");
  const dest = path.join(root, "dest");
  await fsp.mkdir(path.join(src, "chat"), { recursive: true });
  await fsp.mkdir(dest, { recursive: true });
  const configPath = path.join(root, "config.json");
  await fsp.writeFile(configPath, JSON.stringify({
    configVersion: 1,
    bindHost: "127.0.0.1",
    port: 0,
    concurrency: 1,
    paused: false,
    dryRun,
    trashRetentionDays: 30,
    settleSeconds,
    maxAutoRetries: 1,
    stagingDir: path.join(root, "staging"),
    reviewDir: path.join(root, "review"),
    trashDir: path.join(root, "trash"),
    logDir: path.join(root, "logs"),
    syncLockFile: path.join(root, "lock.json"),
    lockHeartbeatSeconds: 60,
    lockStaleSeconds: 120,
    notifySuccess: false,
    folders: [{
      name: "voicenotes",
      source: src,
      destination: dest,
      method: "voicenotes",
      datePattern: "-(\\d{8})-",
      settleSeconds,
    }],
  }, null, 2));
  const daemon = new Daemon(configPath, {});
  await daemon.start();
  return { root, src, dest, daemon };
}

const DEST_NAME = "2019-05-29-00-00-00-(20190529-merged-chat).mp4";

test("voicenotes: approve merges, standardizes, moves and trashes the group", { skip: !CAN_RUN }, async () => {
  const { root, src, dest, daemon } = await makeVoiceSetup();
  try {
    makeVoiceNote(path.join(src, "chat", "PTT-20190529-WA0001.opus"));
    makeVoiceNote(path.join(src, "chat", "PTT-20190529-WA0002.opus"));
    await daemon.store.scanFolder("voicenotes");
    const folder = daemon.store.getFolder("voicenotes");

    const groups = await listVoiceNoteGroups(daemon.ctx);
    assert.equal(groups.length, 1);
    assert.equal(groups[0].chat, "chat");
    assert.equal(groups[0].date, "20190529");
    assert.equal(groups[0].count, 2);
    assert.equal(groups[0].destExists, false);

    const result = await approveVoiceNoteGroup(daemon.ctx, folder, { chat: "chat", date: "20190529" });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.destName, DEST_NAME);
    assert.deepEqual(result.trashed, [
      "chat/PTT-20190529-WA0001.opus",
      "chat/PTT-20190529-WA0002.opus",
    ]);
    assert.deepEqual(await fsp.readdir(dest), [DEST_NAME]);
    assert.deepEqual(await fsp.readdir(path.join(src, "chat")), []);
    assert.deepEqual((await listVoiceNoteGroups(daemon.ctx)), []);

    const tags = await daemon.exiftool.readRaw(path.join(dest, DEST_NAME), ["-m"]);
    assert.match(String(tags.Inputs), /PTT-20190529-WA0001\.opus/);
    assert.match(String(tags.Inputs), /PTT-20190529-WA0002\.opus/);
  } finally {
    await daemon.stop();
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("voicenotes: delete trashes the group without writing the destination", { skip: !CAN_RUN }, async () => {
  const { root, src, dest, daemon } = await makeVoiceSetup();
  try {
    makeVoiceNote(path.join(src, "chat", "PTT-20190529-WA0001.opus"));
    await daemon.store.scanFolder("voicenotes");
    const folder = daemon.store.getFolder("voicenotes");

    const result = await deleteVoiceNoteGroup(daemon.ctx, folder, { chat: "chat", date: "20190529" });
    assert.equal(result.ok, true);
    assert.deepEqual(result.deleted, ["chat/PTT-20190529-WA0001.opus"]);
    assert.deepEqual(await fsp.readdir(path.join(src, "chat")), []);
    assert.deepEqual(await fsp.readdir(dest), []);
  } finally {
    await daemon.stop();
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("voicenotes: approve is idempotent when the destination merge already lists the inputs", { skip: !CAN_RUN }, async () => {
  const { root, src, dest, daemon } = await makeVoiceSetup();
  try {
    const name = "chat/PTT-20190529-WA0001.opus";
    makeVoiceNote(path.join(src, name));
    await daemon.store.scanFolder("voicenotes");
    const folder = daemon.store.getFolder("voicenotes");
    assert.equal((await approveVoiceNoteGroup(daemon.ctx, folder, { chat: "chat", date: "20190529" })).ok, true);

    // Simulate a crash between placing the output and trashing the sources:
    // re-create the same clip and approve again.
    makeVoiceNote(path.join(src, name));
    await daemon.store.scanFolder("voicenotes");
    const again = await approveVoiceNoteGroup(daemon.ctx, folder, { chat: "chat", date: "20190529" });
    assert.equal(again.ok, true);
    assert.equal(again.alreadyPlaced, true);
    assert.deepEqual(await fsp.readdir(path.join(src, "chat")), []);
    assert.deepEqual(await fsp.readdir(dest), [DEST_NAME]);
  } finally {
    await daemon.stop();
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("voicenotes: a different destination file blocks approval and keeps the sources", { skip: !CAN_RUN }, async () => {
  const { root, src, dest, daemon } = await makeVoiceSetup();
  try {
    makeVoiceNote(path.join(src, "chat", "PTT-20190529-WA0001.opus"));
    await fsp.writeFile(path.join(dest, DEST_NAME), "not an earlier merge");
    await daemon.store.scanFolder("voicenotes");
    const folder = daemon.store.getFolder("voicenotes");

    await assert.rejects(
      () => approveVoiceNoteGroup(daemon.ctx, folder, { chat: "chat", date: "20190529" }),
      /already exists/,
    );
    assert.equal(await fsp.stat(path.join(src, "chat", "PTT-20190529-WA0001.opus")).then(() => true).catch(() => false), true);
  } finally {
    await daemon.stop();
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("voicenotes: a late clip after approval becomes a group that needs a decision", { skip: !CAN_RUN }, async () => {
  const { root, src, daemon } = await makeVoiceSetup();
  try {
    makeVoiceNote(path.join(src, "chat", "PTT-20190529-WA0001.opus"));
    await daemon.store.scanFolder("voicenotes");
    const folder = daemon.store.getFolder("voicenotes");
    assert.equal((await approveVoiceNoteGroup(daemon.ctx, folder, { chat: "chat", date: "20190529" })).ok, true);

    makeVoiceNote(path.join(src, "chat", "PTT-20190529-WA0002.opus"));
    await daemon.store.scanFolder("voicenotes");
    const groups = await listVoiceNoteGroups(daemon.ctx);
    assert.equal(groups.length, 1);
    assert.equal(groups[0].count, 1);
    assert.equal(groups[0].destExists, true);
    await assert.rejects(
      () => approveVoiceNoteGroup(daemon.ctx, folder, { chat: "chat", date: "20190529" }),
      /already exists/,
    );
    const deleted = await deleteVoiceNoteGroup(daemon.ctx, folder, { chat: "chat", date: "20190529" });
    assert.equal(deleted.ok, true);
    assert.deepEqual(await fsp.readdir(path.join(src, "chat")), []);
  } finally {
    await daemon.stop();
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("voicenotes: settling groups cannot be approved yet", { skip: !CAN_RUN }, async () => {
  const { root, src, daemon } = await makeVoiceSetup({ settleSeconds: 60 });
  try {
    makeVoiceNote(path.join(src, "chat", "PTT-20190529-WA0001.opus"));
    await daemon.store.scanFolder("voicenotes");
    const folder = daemon.store.getFolder("voicenotes");
    const groups = await listVoiceNoteGroups(daemon.ctx);
    assert.equal(groups[0].settling, true);
    await assert.rejects(
      () => approveVoiceNoteGroup(daemon.ctx, folder, { chat: "chat", date: "20190529" }),
      /settle/,
    );
  } finally {
    await daemon.stop();
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("voicenotes: dry-run reports the plan without writing or trashing", { skip: !CAN_RUN }, async () => {
  const { root, src, dest, daemon } = await makeVoiceSetup({ dryRun: true });
  try {
    makeVoiceNote(path.join(src, "chat", "PTT-20190529-WA0001.opus"));
    await daemon.store.scanFolder("voicenotes");
    const folder = daemon.store.getFolder("voicenotes");
    const result = await approveVoiceNoteGroup(daemon.ctx, folder, { chat: "chat", date: "20190529" });
    assert.equal(result.dryRun, true);
    assert.deepEqual(await fsp.readdir(dest), []);
    assert.equal(await fsp.stat(path.join(src, "chat", "PTT-20190529-WA0001.opus")).then(() => true).catch(() => false), true);
  } finally {
    await daemon.stop();
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("standardize: manual placement still parks processed photos until approved", { skip: !CAN_RUN }, async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "file-pipelines-manual-std-"));
  const src = path.join(root, "src");
  const dest = path.join(root, "dest");
  await fsp.mkdir(src, { recursive: true });
  await fsp.mkdir(dest, { recursive: true });
  const configPath = path.join(root, "config.json");
  await fsp.writeFile(configPath, JSON.stringify({
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
    notifySuccess: true,
    folders: [{ name: "photos", source: src, destination: dest, method: "standardize", placement: "manual", settleSeconds: 0 }],
  }));
  const daemon = new Daemon(configPath, {});
  try {
    const file = path.join(src, "dated.jpg");
    execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-f", "lavfi", "-i", "color=c=green:s=48x48:d=1", "-frames:v", "1", file]);
    execFileSync("exiftool", ["-m", "-q", "-overwrite_original", "-DateTimeOriginal=2019:04:02 10:20:30", "-CreateDate=2019:04:02 10:20:30", file]);
    await daemon.start();
    await sleep(1500);
    assert.equal(daemon.store.fileFor("photos", "dated.jpg").status, STATUS.PENDING);

    await daemon.queue.processNow("photos");
    assert.equal(await waitFor(() => daemon.store.fileFor("photos", "dated.jpg")?.status === STATUS.REVIEW), true);
    const entries = await listReview(daemon.ctx);
    assert.equal(entries[0].destName, "2019-04-02-10-20-30-(dated).jpg");
    assert.deepEqual(await fsp.readdir(dest), []);

    const folder = daemon.store.getFolder("photos");
    assert.equal((await placeReview(daemon.ctx, folder, entries[0].destName)).ok, true);
    assert.equal(await fsp.stat(path.join(dest, entries[0].destName)).then(() => true).catch(() => false), true);
  } finally {
    await daemon.stop();
    await fsp.rm(root, { recursive: true, force: true });
  }
});
