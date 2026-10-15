import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Daemon } from "../src/daemon.js";
import { cleanupFiles } from "../src/cleanup.js";
import { discardReview, listReview, placeReview } from "../src/review.js";
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

function makeVoiceNote(file) {
  execFileSync("mkdir", ["-p", path.dirname(file)]);
  execFileSync("ffmpeg", [
    "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", "sine=frequency=440:duration=0.5",
    "-c:a", "libopus", file,
  ]);
}

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

async function makeSetup({ autoProcess = false } = {}) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "file-pipelines-review-"));
  const src = path.join(root, "src");
  const dest = path.join(root, "dest");
  const reviewDir = path.join(root, "review");
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
    reviewDir,
    trashDir: path.join(root, "trash"),
    logDir: path.join(root, "logs"),
    syncLockFile: path.join(root, "lock.json"),
    lockHeartbeatSeconds: 60,
    lockStaleSeconds: 120,
    notifySuccess: true,
    folders: [
      {
        name: "voicenotes",
        source: src,
        destination: dest,
        method: "voicenotes",
        datePattern: "-(\\d{8})-",
        placement: "manual",
        autoProcess,
        settleSeconds: 0,
      },
    ],
  };
  await fsp.writeFile(configPath, JSON.stringify(config, null, 2));
  return { root, src, dest, reviewDir, configPath };
}

test("voicenotes: manual review flow parks, places flat, and cleans up verified", { skip: !CAN_RUN }, async () => {
  const { root, src, dest, configPath } = await makeSetup();
  const daemon = new Daemon(configPath, {});
  try {
    makeVoiceNote(path.join(src, "201301", "PTT-20190529-WA0001.opus"));
    makeVoiceNote(path.join(src, "201301", "PTT-20190529-WA0002.opus"));
    await daemon.start();

    // Manual folders must not process on their own.
    await sleep(2000);
    assert.equal(daemon.store.fileFor("voicenotes", "201301/PTT-20190529-WA0001.opus").status, STATUS.PENDING);

    const queued = await daemon.queue.processNow("voicenotes", {
      files: ["201301/PTT-20190529-WA0001.opus", "201301/PTT-20190529-WA0002.opus"],
    });
    assert.equal(queued.ok, true);
    const reviewed = await waitFor(() =>
      daemon.store.fileFor("voicenotes", "201301/PTT-20190529-WA0001.opus")?.status === STATUS.REVIEW,
    );
    assert.equal(reviewed, true, "processed group must be parked for review");

    const destName = "2019-05-29-00-00-00-(20190529-merged-201301).mp4";
    const parked = await listReview(daemon.ctx);
    assert.equal(parked.length, 1);
    assert.equal(parked[0].destName, destName);
    assert.deepEqual(parked[0].inputs.sort(), ["201301/PTT-20190529-WA0001.opus", "201301/PTT-20190529-WA0002.opus"]);
    assert.deepEqual(await fsp.readdir(dest), [], "nothing must reach the destination before approval");

    const folder = daemon.store.getFolder("voicenotes");
    const placed = await placeReview(daemon.ctx, folder, destName);
    assert.equal(placed.ok, true);
    assert.equal(await fsp.stat(path.join(dest, destName)).then(() => true).catch(() => false), true);
    assert.deepEqual(await listReview(daemon.ctx), []);
    assert.equal(daemon.store.fileFor("voicenotes", "201301/PTT-20190529-WA0001.opus").status, STATUS.DONE);

    const results = await cleanupFiles(daemon.ctx, folder, ["201301/PTT-20190529-WA0001.opus", "201301/PTT-20190529-WA0002.opus"]);
    assert.deepEqual(results.map((r) => r.ok), [true, true], JSON.stringify(results));
    assert.equal(await fsp.stat(path.join(dest, destName)).then(() => true).catch(() => false), true, "merged output must survive cleanup");
  } finally {
    await daemon.stop();
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("voicenotes: discard keeps sources out of the destination and restarts rehydrate review state", { skip: !CAN_RUN }, async () => {
  const { root, src, dest, configPath } = await makeSetup();
  let daemon = new Daemon(configPath, {});
  try {
    makeVoiceNote(path.join(src, "201301", "PTT-20190530-WA0001.opus"));
    await daemon.start();
    await daemon.queue.processNow("voicenotes");
    const reviewed = await waitFor(() =>
      daemon.store.fileFor("voicenotes", "201301/PTT-20190530-WA0001.opus")?.status === STATUS.REVIEW,
    );
    assert.equal(reviewed, true);

    // Restart: parked entries must rehydrate to review without reprocessing.
    await daemon.stop();
    daemon = new Daemon(configPath, {});
    await daemon.start();
    const rehydrated = await waitFor(() =>
      daemon.store.fileFor("voicenotes", "201301/PTT-20190530-WA0001.opus")?.status === STATUS.REVIEW,
    );
    assert.equal(rehydrated, true, "parked entries must rehydrate on restart");

    const folder = daemon.store.getFolder("voicenotes");
    const entry = (await listReview(daemon.ctx))[0];
    const discarded = await discardReview(daemon.ctx, folder, entry.destName);
    assert.equal(discarded.ok, true);
    assert.equal(daemon.store.fileFor("voicenotes", "201301/PTT-20190530-WA0001.opus").status, STATUS.DISCARDED);
    assert.deepEqual(await fsp.readdir(dest), [], "discarded groups must never reach the destination");
    assert.deepEqual(await listReview(daemon.ctx), []);
  } finally {
    await daemon.stop();
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("voicenotes: autoProcess prepares groups continuously without placing them", { skip: !CAN_RUN }, async () => {
  const { root, src, dest, configPath } = await makeSetup({ autoProcess: true });
  const daemon = new Daemon(configPath, {});
  try {
    makeVoiceNote(path.join(src, "202641", "PTT-20201010-WA0001.opus"));
    await daemon.start();
    const reviewed = await waitFor(() =>
      daemon.store.fileFor("voicenotes", "202641/PTT-20201010-WA0001.opus")?.status === STATUS.REVIEW,
    );
    assert.equal(reviewed, true, "autoProcess must prepare new groups for review");
    assert.equal((await listReview(daemon.ctx)).length, 1);
    assert.deepEqual(await fsp.readdir(dest), []);
  } finally {
    await daemon.stop();
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("voicenotes: a late clip re-processes the whole group and replaces the parked entry", { skip: !CAN_RUN }, async () => {
  const { root, src, dest, configPath } = await makeSetup();
  const daemon = new Daemon(configPath, {});
  try {
    const first = path.join(src, "201301", "PTT-20190529-WA0001.opus");
    makeVoiceNote(first);
    await daemon.start();
    await daemon.queue.processNow("voicenotes", { files: ["201301/PTT-20190529-WA0001.opus"] });
    const reviewed = await waitFor(() =>
      daemon.store.fileFor("voicenotes", "201301/PTT-20190529-WA0001.opus")?.status === STATUS.REVIEW,
    );
    assert.equal(reviewed, true);

    const second = path.join(src, "201301", "PTT-20190529-WA0002.opus");
    makeVoiceNote(second);
    await waitFor(() => daemon.store.fileFor("voicenotes", "201301/PTT-20190529-WA0002.opus")?.status === STATUS.PENDING);
    await daemon.queue.processNow("voicenotes", { files: ["201301/PTT-20190529-WA0002.opus"] });
    const reReviewed = await waitFor(() =>
      daemon.store.fileFor("voicenotes", "201301/PTT-20190529-WA0002.opus")?.status === STATUS.REVIEW,
    );
    assert.equal(reReviewed, true);

    const entries = await listReview(daemon.ctx);
    assert.equal(entries.length, 1, "late clips must replace the group's parked entry, not add another");
    assert.deepEqual(entries[0].inputs.sort(), ["201301/PTT-20190529-WA0001.opus", "201301/PTT-20190529-WA0002.opus"]);
    assert.deepEqual(await fsp.readdir(dest), []);
  } finally {
    await daemon.stop();
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("voicenotes: placing refuses to clobber a different destination file and keeps the park", { skip: !CAN_RUN }, async () => {
  const { root, src, dest, configPath } = await makeSetup();
  const daemon = new Daemon(configPath, {});
  try {
    makeVoiceNote(path.join(src, "201301", "PTT-20190529-WA0001.opus"));
    await daemon.start();
    await daemon.queue.processNow("voicenotes");
    const reviewed = await waitFor(() =>
      daemon.store.fileFor("voicenotes", "201301/PTT-20190529-WA0001.opus")?.status === STATUS.REVIEW,
    );
    assert.equal(reviewed, true);

    const destName = "2019-05-29-00-00-00-(20190529-merged-201301).mp4";
    await fsp.writeFile(path.join(dest, destName), "a different file with the same name");
    const folder = daemon.store.getFolder("voicenotes");
    const refused = await placeReview(daemon.ctx, folder, destName);
    assert.equal(refused.ok, false);
    assert.match(refused.reason, /different file/);
    assert.equal(await fsp.readFile(path.join(dest, destName), "utf8"), "a different file with the same name");
    assert.equal((await listReview(daemon.ctx)).length, 1, "the park entry must survive a refused place");
    assert.equal(daemon.store.fileFor("voicenotes", "201301/PTT-20190529-WA0001.opus").status, STATUS.REVIEW);

    await fsp.rm(path.join(dest, destName));
    const placed = await placeReview(daemon.ctx, folder, destName);
    assert.equal(placed.ok, true);
  } finally {
    await daemon.stop();
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("voicenotes: placing recognizes a byte-identical file already in the destination", { skip: !CAN_RUN }, async () => {
  const { root, src, dest, configPath } = await makeSetup();
  const daemon = new Daemon(configPath, {});
  try {
    makeVoiceNote(path.join(src, "201301", "PTT-20190529-WA0001.opus"));
    await daemon.start();
    await daemon.queue.processNow("voicenotes");
    const reviewed = await waitFor(() =>
      daemon.store.fileFor("voicenotes", "201301/PTT-20190529-WA0001.opus")?.status === STATUS.REVIEW,
    );
    assert.equal(reviewed, true);

    const entry = (await listReview(daemon.ctx))[0];
    const parkPath = path.join(root, "review", "voicenotes", entry.destName);
    await fsp.copyFile(parkPath, path.join(dest, entry.destName));
    const folder = daemon.store.getFolder("voicenotes");
    const placed = await placeReview(daemon.ctx, folder, entry.destName);
    assert.equal(placed.ok, true);
    assert.equal(placed.alreadyPlaced, true);
    assert.equal(daemon.store.fileFor("voicenotes", "201301/PTT-20190529-WA0001.opus").status, STATUS.DONE);
    assert.deepEqual(await listReview(daemon.ctx), []);
  } finally {
    await daemon.stop();
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("voicenotes: discarded clips can be explicitly re-processed", { skip: !CAN_RUN }, async () => {
  const { root, src, configPath } = await makeSetup();
  const daemon = new Daemon(configPath, {});
  try {
    makeVoiceNote(path.join(src, "201301", "PTT-20190529-WA0001.opus"));
    await daemon.start();
    await daemon.queue.processNow("voicenotes");
    await waitFor(() => daemon.store.fileFor("voicenotes", "201301/PTT-20190529-WA0001.opus")?.status === STATUS.REVIEW);
    const folder = daemon.store.getFolder("voicenotes");
    const entry = (await listReview(daemon.ctx))[0];
    await discardReview(daemon.ctx, folder, entry.destName);
    assert.equal(daemon.store.fileFor("voicenotes", "201301/PTT-20190529-WA0001.opus").status, STATUS.DISCARDED);

    const queued = await daemon.queue.processNow("voicenotes", { files: ["201301/PTT-20190529-WA0001.opus"] });
    assert.equal(queued.ok, true);
    assert.equal(queued.processed, 1, "explicitly re-processing a discarded clip must be allowed");
    const reviewed = await waitFor(() =>
      daemon.store.fileFor("voicenotes", "201301/PTT-20190529-WA0001.opus")?.status === STATUS.REVIEW,
    );
    assert.equal(reviewed, true);
  } finally {
    await daemon.stop();
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("voicenotes: two chats on the same day produce two flat, collision-free outputs", { skip: !CAN_RUN }, async () => {
  const { root, src, dest, configPath } = await makeSetup();
  const daemon = new Daemon(configPath, {});
  try {
    makeVoiceNote(path.join(src, "201301", "PTT-20190529-WA0001.opus"));
    makeVoiceNote(path.join(src, "202641", "PTT-20190529-WA0001.opus"));
    await daemon.start();
    await daemon.queue.processNow("voicenotes");
    const ready = await waitFor(async () => (await listReview(daemon.ctx)).length === 2);
    assert.equal(ready, true);
    const names = (await listReview(daemon.ctx)).map((entry) => entry.destName).sort();
    assert.deepEqual(names, [
      "2019-05-29-00-00-00-(20190529-merged-201301).mp4",
      "2019-05-29-00-00-00-(20190529-merged-202641).mp4",
    ]);
    const folder = daemon.store.getFolder("voicenotes");
    for (const name of names) {
      assert.equal((await placeReview(daemon.ctx, folder, name)).ok, true);
    }
    assert.deepEqual((await fsp.readdir(dest)).sort(), names);
  } finally {
    await daemon.stop();
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("voicenotes: dry-run reports a plan without parking or writing", { skip: !CAN_RUN }, async () => {
  const { root, src, dest, configPath } = await makeSetup();
  const config = JSON.parse(await fsp.readFile(configPath, "utf8"));
  config.dryRun = true;
  await fsp.writeFile(configPath, JSON.stringify(config));
  const daemon = new Daemon(configPath, {});
  try {
    makeVoiceNote(path.join(src, "201301", "PTT-20190529-WA0001.opus"));
    await daemon.start();
    await daemon.queue.processNow("voicenotes");
    const planned = await waitFor(() =>
      (daemon.store.fileFor("voicenotes", "201301/PTT-20190529-WA0001.opus")?.message ?? "").includes("dry run:"),
    );
    assert.equal(planned, true);
    assert.equal(daemon.store.fileFor("voicenotes", "201301/PTT-20190529-WA0001.opus").status, STATUS.PENDING);
    assert.deepEqual(await fsp.readdir(dest), []);
    assert.deepEqual(await listReview(daemon.ctx), []);
  } finally {
    await daemon.stop();
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("voicenotes: a corrupt park manifest is ignored instead of crashing", { skip: !CAN_RUN }, async () => {
  const { root, src, configPath } = await makeSetup();
  let daemon = new Daemon(configPath, {});
  try {
    makeVoiceNote(path.join(src, "201301", "PTT-20190529-WA0001.opus"));
    await daemon.start();
    await daemon.queue.processNow("voicenotes");
    await waitFor(() => daemon.store.fileFor("voicenotes", "201301/PTT-20190529-WA0001.opus")?.status === STATUS.REVIEW);
    const entry = (await listReview(daemon.ctx))[0];
    const manifestPath = path.join(root, "review", "voicenotes", `${entry.destName}.json`);
    await fsp.writeFile(manifestPath, "{ not json");
    assert.deepEqual(await listReview(daemon.ctx), [], "corrupt manifests are skipped");

    await daemon.stop();
    daemon = new Daemon(configPath, {});
    await daemon.start();
    assert.equal(daemon.started, true, "a corrupt manifest must not block startup");
  } finally {
    await daemon.stop();
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("voicenotes: cleanup is blocked when the merged output cannot be verified", { skip: !CAN_RUN }, async () => {
  const { root, src, dest, configPath } = await makeSetup();
  const daemon = new Daemon(configPath, {});
  try {
    makeVoiceNote(path.join(src, "201301", "PTT-20190529-WA0001.opus"));
    await daemon.start();
    await daemon.queue.processNow("voicenotes");
    await waitFor(() => daemon.store.fileFor("voicenotes", "201301/PTT-20190529-WA0001.opus")?.status === STATUS.REVIEW);
    const folder = daemon.store.getFolder("voicenotes");
    const entry = (await listReview(daemon.ctx))[0];
    await placeReview(daemon.ctx, folder, entry.destName);
    await fsp.rm(path.join(dest, entry.destName));

    const results = await cleanupFiles(daemon.ctx, folder, ["201301/PTT-20190529-WA0001.opus"]);
    assert.equal(results[0].ok, false, "cleanup must be blocked when the merged output is missing");
    assert.equal(await fsp.stat(path.join(src, "201301", "PTT-20190529-WA0001.opus")).then(() => true).catch(() => false), true);
    assert.equal(daemon.store.fileFor("voicenotes", "201301/PTT-20190529-WA0001.opus").status, STATUS.CONFLICT);
  } finally {
    await daemon.stop();
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("voicenotes: cleanup can be disabled for a folder", { skip: !CAN_RUN }, async () => {
  const { root, src, configPath } = await makeSetup();
  const config = JSON.parse(await fsp.readFile(configPath, "utf8"));
  config.folders[0].cleanup = false;
  await fsp.writeFile(configPath, JSON.stringify(config));
  const daemon = new Daemon(configPath, {});
  try {
    makeVoiceNote(path.join(src, "201301", "PTT-20190529-WA0001.opus"));
    await daemon.start();
    await daemon.queue.processNow("voicenotes");
    await waitFor(() => daemon.store.fileFor("voicenotes", "201301/PTT-20190529-WA0001.opus")?.status === STATUS.REVIEW);
    const folder = daemon.store.getFolder("voicenotes");
    const results = await cleanupFiles(daemon.ctx, folder, ["201301/PTT-20190529-WA0001.opus"]);
    assert.equal(results[0].ok, false);
    assert.match(results[0].reason, /disabled/);
    assert.equal(await fsp.stat(path.join(src, "201301", "PTT-20190529-WA0001.opus")).then(() => true).catch(() => false), true);
  } finally {
    await daemon.stop();
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("standardize: manual placement parks processed photos until approved", { skip: !CAN_RUN }, async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "file-pipelines-manual-std-"));
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
    notifySuccess: true,
    folders: [{ name: "photos", source: src, destination: dest, method: "standardize", placement: "manual", settleSeconds: 0 }],
  };
  await fsp.writeFile(configPath, JSON.stringify(config, null, 2));
  const daemon = new Daemon(configPath, {});
  try {
    const file = path.join(src, "dated.jpg");
    execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-f", "lavfi", "-i", "color=c=green:s=48x48:d=1", "-frames:v", "1", file]);
    execFileSync("exiftool", ["-m", "-q", "-overwrite_original", "-DateTimeOriginal=2019:04:02 10:20:30", "-CreateDate=2019:04:02 10:20:30", file]);
    await daemon.start();
    await sleep(1500);
    assert.equal(daemon.store.fileFor("photos", "dated.jpg").status, STATUS.PENDING, "manual folders must not auto-process");

    await daemon.queue.processNow("photos");
    const reviewed = await waitFor(() => daemon.store.fileFor("photos", "dated.jpg")?.status === STATUS.REVIEW);
    assert.equal(reviewed, true);
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

test("voicenotes: a parked group stays placeable after the phone deletes the clips", { skip: !CAN_RUN }, async () => {
  const { root, src, dest, configPath } = await makeSetup();
  const daemon = new Daemon(configPath, {});
  try {
    const clip = path.join(src, "201301", "PTT-20190529-WA0001.opus");
    makeVoiceNote(clip);
    await daemon.start();
    await daemon.queue.processNow("voicenotes");
    await waitFor(() => daemon.store.fileFor("voicenotes", "201301/PTT-20190529-WA0001.opus")?.status === STATUS.REVIEW);

    await fsp.rm(clip);
    const forgotten = await waitFor(() => daemon.store.fileFor("voicenotes", "201301/PTT-20190529-WA0001.opus") === null);
    assert.equal(forgotten, true);
    const entries = await listReview(daemon.ctx);
    assert.equal(entries.length, 1, "the parked merge is the only remaining copy and must stay listed");
    assert.deepEqual(entries[0].missingInputs, ["201301/PTT-20190529-WA0001.opus"]);

    const folder = daemon.store.getFolder("voicenotes");
    const placed = await placeReview(daemon.ctx, folder, entries[0].destName);
    assert.equal(placed.ok, true, "placing must not depend on the source clips still existing");
    assert.equal(await fsp.stat(path.join(dest, entries[0].destName)).then(() => true).catch(() => false), true);
  } finally {
    await daemon.stop();
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("voicenotes: files that do not match datePattern are ignored, not left pending", async () => {
  const { root, src, configPath } = await makeSetup();
  const daemon = new Daemon(configPath, {});
  try {
    await fsp.writeFile(path.join(src, "201301", "PTT-20190529-WA0001.opus"), "clip").catch(async () => {
      await fsp.mkdir(path.join(src, "201301"), { recursive: true });
      await fsp.writeFile(path.join(src, "201301", "PTT-20190529-WA0001.opus"), "clip");
    });
    await fsp.writeFile(path.join(src, "201301", "notes.txt"), "no date here");
    await fsp.writeFile(path.join(src, "201301", "PTT-19-WA0001.opus"), "bad date");
    await daemon.start();
    const ignored = await waitFor(() =>
      daemon.store.fileFor("voicenotes", "201301/notes.txt")?.status === STATUS.IGNORED
      && daemon.store.fileFor("voicenotes", "201301/PTT-19-WA0001.opus")?.status === STATUS.IGNORED,
    );
    assert.equal(ignored, true);
    assert.match(daemon.store.fileFor("voicenotes", "201301/notes.txt").message, /datePattern/);
    assert.equal(daemon.store.fileFor("voicenotes", "201301/PTT-20190529-WA0001.opus").status, STATUS.PENDING);
  } finally {
    await daemon.stop();
    await fsp.rm(root, { recursive: true, force: true });
  }
});

function readInputs(file) {
  const out = execFileSync("exiftool", ["-m", "-s", "-j", "-XMP-media-sync:Inputs", file], { encoding: "utf8" });
  const raw = JSON.parse(out)[0]?.Inputs ?? null;
  return raw ? JSON.parse(raw) : null;
}

test("voicenotes: a late clip offers a verified replace of the earlier merge", { skip: !CAN_RUN }, async () => {
  const { root, src, dest, configPath } = await makeSetup();
  const daemon = new Daemon(configPath, {});
  try {
    makeVoiceNote(path.join(src, "201301", "PTT-20190529-WA0001.opus"));
    await daemon.start();
    await daemon.queue.processNow("voicenotes");
    await waitFor(() => daemon.store.fileFor("voicenotes", "201301/PTT-20190529-WA0001.opus")?.status === STATUS.REVIEW);
    const folder = daemon.store.getFolder("voicenotes");
    const first = (await listReview(daemon.ctx))[0];
    assert.equal((await placeReview(daemon.ctx, folder, first.destName)).ok, true);
    assert.deepEqual(readInputs(path.join(dest, first.destName)), ["201301/PTT-20190529-WA0001.opus"]);

    makeVoiceNote(path.join(src, "201301", "PTT-20190529-WA0002.opus"));
    await waitFor(() => daemon.store.fileFor("voicenotes", "201301/PTT-20190529-WA0002.opus")?.status === STATUS.PENDING);
    await daemon.queue.processNow("voicenotes", { files: ["201301/PTT-20190529-WA0002.opus"] });
    await waitFor(async () => (await listReview(daemon.ctx)).length === 1);

    const refused = await placeReview(daemon.ctx, folder, first.destName);
    assert.equal(refused.ok, false);
    assert.equal(refused.canReplace, true, "an earlier merge of the same group is a verified replace candidate");
    assert.deepEqual(readInputs(path.join(dest, first.destName)), ["201301/PTT-20190529-WA0001.opus"], "destination must be untouched before the replace is confirmed");

    const replaced = await placeReview(daemon.ctx, folder, first.destName, { replace: true });
    assert.equal(replaced.ok, true);
    assert.equal(replaced.replaced, true);
    assert.deepEqual(
      readInputs(path.join(dest, first.destName)).sort(),
      ["201301/PTT-20190529-WA0001.opus", "201301/PTT-20190529-WA0002.opus"],
      "the replacement merge must contain every clip",
    );
    assert.deepEqual(await listReview(daemon.ctx), []);

    const cleaned = await cleanupFiles(daemon.ctx, folder, [
      "201301/PTT-20190529-WA0001.opus",
      "201301/PTT-20190529-WA0002.opus",
    ]);
    assert.deepEqual(cleaned.map((r) => r.ok), [true, true], JSON.stringify(cleaned));
  } finally {
    await daemon.stop();
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("voicenotes: replace is refused for a destination file that is not an earlier merge", { skip: !CAN_RUN }, async () => {
  const { root, src, dest, configPath } = await makeSetup();
  const daemon = new Daemon(configPath, {});
  try {
    makeVoiceNote(path.join(src, "201301", "PTT-20190529-WA0001.opus"));
    await daemon.start();
    await daemon.queue.processNow("voicenotes");
    await waitFor(() => daemon.store.fileFor("voicenotes", "201301/PTT-20190529-WA0001.opus")?.status === STATUS.REVIEW);
    const folder = daemon.store.getFolder("voicenotes");
    const entry = (await listReview(daemon.ctx))[0];
    await fsp.writeFile(path.join(dest, entry.destName), "not one of ours");
    const refused = await placeReview(daemon.ctx, folder, entry.destName, { replace: true });
    assert.equal(refused.ok, false);
    assert.equal(refused.canReplace, false);
    assert.equal(await fsp.readFile(path.join(dest, entry.destName), "utf8"), "not one of ours");
  } finally {
    await daemon.stop();
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("voicenotes: an undecodable clip fails its group without parking or deleting anything", { skip: !CAN_RUN }, async () => {
  const { root, src, dest, configPath } = await makeSetup();
  const daemon = new Daemon(configPath, {});
  try {
    const bad = path.join(src, "201301", "PTT-20190529-WA0001.opus");
    const good = path.join(src, "201301", "PTT-20190529-WA0002.opus");
    await fsp.mkdir(path.dirname(bad), { recursive: true });
    await fsp.writeFile(bad, "definitely not audio");
    makeVoiceNote(good);
    await daemon.start();
    await daemon.queue.processNow("voicenotes");
    const errored = await waitFor(() =>
      daemon.store.fileFor("voicenotes", "201301/PTT-20190529-WA0001.opus")?.status === STATUS.ERROR
      && daemon.store.fileFor("voicenotes", "201301/PTT-20190529-WA0002.opus")?.status === STATUS.ERROR,
    );
    assert.equal(errored, true, "a group with a corrupt clip must error as a whole");
    assert.deepEqual(await listReview(daemon.ctx), [], "nothing may be parked when the merge fails");
    assert.deepEqual(await fsp.readdir(dest), [], "nothing may reach the destination when the merge fails");
    assert.equal(await fsp.readFile(bad, "utf8"), "definitely not audio", "source clips must be untouched");
    assert.equal(await fsp.stat(good).then((s) => s.size > 0).catch(() => false), true);
  } finally {
    await daemon.stop();
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("voicenotes: a tampered parked file is refused at place time", { skip: !CAN_RUN }, async () => {
  const { root, src, configPath } = await makeSetup();
  const daemon = new Daemon(configPath, {});
  try {
    makeVoiceNote(path.join(src, "201301", "PTT-20190529-WA0001.opus"));
    await daemon.start();
    await daemon.queue.processNow("voicenotes");
    await waitFor(() => daemon.store.fileFor("voicenotes", "201301/PTT-20190529-WA0001.opus")?.status === STATUS.REVIEW);
    const folder = daemon.store.getFolder("voicenotes");
    const entry = (await listReview(daemon.ctx))[0];
    await fsp.appendFile(path.join(root, "review", "voicenotes", entry.destName), "extra bytes");
    const refused = await placeReview(daemon.ctx, folder, entry.destName);
    assert.equal(refused.ok, false);
    assert.match(refused.reason, /changed since it was prepared/);
    assert.equal(daemon.store.fileFor("voicenotes", "201301/PTT-20190529-WA0001.opus").status, STATUS.REVIEW);
  } finally {
    await daemon.stop();
    await fsp.rm(root, { recursive: true, force: true });
  }
});
