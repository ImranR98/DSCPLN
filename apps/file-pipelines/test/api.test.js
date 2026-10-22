import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Daemon } from "../src/daemon.js";
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

async function makeDaemon(options = {}) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "file-pipelines-api-"));
  const configPath = path.join(root, "config.json");
  await fsp.mkdir(path.join(root, "src"), { recursive: true });
  await fsp.mkdir(path.join(root, "dest"), { recursive: true });
  const config = {
    configVersion: 1,
    bindHost: "127.0.0.1",
    port: 0,
    concurrency: 1,
    trashRetentionDays: 30,
    settleSeconds: 60,
    maxAutoRetries: 3,
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
        source: path.join(root, "src"),
        destination: path.join(root, "dest"),
        method: "standardize",
        settleSeconds: 60,
      },
    ],
  };
  await fsp.writeFile(configPath, JSON.stringify(config, null, 2));
  const daemon = new Daemon(configPath, options);
  await daemon.start();
  const port = daemon.api.server.address().port;
  return { root, daemon, base: `http://127.0.0.1:${port}` };
}

test("api: health, state, pause, process-now, config validation", async () => {
  const { root, daemon, base } = await makeDaemon();
  try {
    const health = await (await fetch(`${base}/api/health`)).json();
    assert.deepEqual(health, { ok: true });

    const state = await (await fetch(`${base}/api/state`)).json();
    assert.equal(state.folders.length, 1);
    assert.equal(state.folders[0].name, "camera");
    assert.equal(state.paused, false);

    await fetch(`${base}/api/pause`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paused: true }),
    });
    assert.equal(daemon.config.paused, true);
    const persisted = JSON.parse(await fsp.readFile(path.join(root, "config.json"), "utf8"));
    assert.equal("paused" in persisted, false, "runtime toggles stay out of config.json");
    const runtime = JSON.parse(await fsp.readFile(path.join(root, "state.json"), "utf8"));
    assert.equal(runtime.paused, true);
    await fetch(`${base}/api/pause`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paused: false }),
    });
    assert.equal(daemon.config.paused, false);

    const processResult = await (await fetch(`${base}/api/process/camera`, { method: "POST" })).json();
    assert.equal(processResult.ok, true);

    const preview = await (await fetch(`${base}/api/cleanup/camera`)).json();
    assert.deepEqual(preview.files, []);

    const badConfig = structuredClone(daemon.config);
    badConfig.folders[0].destination = badConfig.folders[0].source;
    const bad = await fetch(`${base}/api/config`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(badConfig),
    });
    assert.equal(bad.ok, false);
    const unknown = await fetch(`${base}/api/nope`);
    assert.equal(unknown.status, 404);

    const page = await fetch(`${base}/`);
    assert.equal(page.status, 200);
    assert.match(page.headers.get("content-type"), /text\/html/);
    const html = await page.text();
    assert.match(html, /<title>D\$CPLN ⋅ File Pipelines<\/title>/);
    const asset = /src="\.\/(assets\/[^"]+\.js)"/.exec(html)?.[1];
    assert.ok(asset, "the built UI bundle must be referenced");
    assert.equal((await fetch(`${base}/${asset}`)).status, 200);
    const traversal = await fetch(`${base}/../src/api/index.js`);
    assert.equal(traversal.status, 404);
  } finally {
    await daemon.stop();
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("api: trash listing exposes files and restore moves them back", async () => {
  const { root, daemon, base } = await makeDaemon();
  try {
    const day = "2020-01-02";
    const dir = path.join(daemon.config.trashDir, day);
    await fsp.mkdir(dir, { recursive: true });
    await fsp.writeFile(path.join(dir, "photo.jpg"), "data");
    await fsp.writeFile(
      path.join(dir, ".manifest.json"),
      JSON.stringify({ files: { "photo.jpg": { originalName: "photo.jpg", sourceDir: path.join(root, "origin"), folder: "Camera" } } }),
    );

    const listing = await (await fetch(`${base}/api/trash`)).json();
    assert.equal(listing.entries.length, 1);
    assert.equal(listing.entries[0].count, 1);
    assert.equal(listing.entries[0].files[0].name, "photo.jpg");
    assert.equal(listing.entries[0].files[0].folder, "Camera");

    const restore = await (await fetch(`${base}/api/trash/restore`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ files: [{ day, name: "photo.jpg" }] }),
    })).json();
    assert.equal(restore.results[0].ok, true);
    assert.equal(await fsp.readFile(path.join(root, "origin", "photo.jpg"), "utf8"), "data");

    const after = await (await fetch(`${base}/api/trash`)).json();
    assert.deepEqual(after.entries, []);
  } finally {
    await daemon.stop();
    await fsp.rm(root, { recursive: true, force: true });
  }
});

async function makeReviewDaemon(options = {}) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "file-pipelines-api-review-"));
  const src = path.join(root, "src");
  const dest = path.join(root, "dest");
  await fsp.mkdir(path.join(src, "201301"), { recursive: true });
  await fsp.mkdir(path.join(root, "archive-src"), { recursive: true });
  await fsp.mkdir(dest, { recursive: true });
  const configPath = path.join(root, "config.json");
  const config = {
    configVersion: 1,
    bindHost: "127.0.0.1",
    port: 0,
    concurrency: 1,
    trashRetentionDays: 30,
    settleSeconds: 0,
    maxAutoRetries: 3,
    stagingDir: path.join(root, "staging"),
    reviewDir: path.join(root, "review"),
    trashDir: path.join(root, "trash"),
    logDir: path.join(root, "logs"),
    syncLockFile: path.join(root, "lock.json"),
    lockHeartbeatSeconds: 60,
    lockStaleSeconds: 120,
    notifySuccess: true,
    folders: [
      {
        name: "archive",
        source: path.join(root, "archive-src"),
        destination: path.join(root, "dest"),
        method: "copy",
        recursive: true,
        cleanup: false,
        notify: "errors",
        settleSeconds: 0,
      },
      {
        name: "reviewed-audio",
        source: path.join(root, "src"),
        destination: path.join(root, "dest"),
        method: "reviewed-audio",
        datePattern: "-(\\d{8})-",
        placement: "manual",
        settleSeconds: 0,
      },
    ],
  };
  await fsp.writeFile(configPath, JSON.stringify(config, null, 2));
  const daemon = new Daemon(configPath, options);
  await daemon.start();
  const port = daemon.api.server.address().port;
  return { root, daemon, base: `http://127.0.0.1:${port}`, src, dest };
}

async function waitFor(fn, timeoutMs = 30_000, intervalMs = 200) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await fn()) return true;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
}

test("api: state exposes the new folder options and disabled cleanup preview", async () => {
  const { root, daemon, base } = await makeReviewDaemon();
  try {
    const state = await (await fetch(`${base}/api/state`)).json();
    const archive = state.folders.find((f) => f.name === "archive");
    const reviewedAudioFolder = state.folders.find((f) => f.name === "reviewed-audio");
    assert.equal(archive.recursive, true);
    assert.equal(archive.onChanged, "overwrite");
    assert.equal(archive.cleanup, false);
    assert.equal(archive.notify, "errors");
    assert.equal(reviewedAudioFolder.method, "reviewed-audio");
    assert.equal(reviewedAudioFolder.placement, "manual");
    assert.equal(reviewedAudioFolder.recursive, true);
    assert.equal(reviewedAudioFolder.cleanup, false);
    assert.equal(reviewedAudioFolder.autoProcess, false);
    assert.equal(reviewedAudioFolder.datePattern, "-(\\d{8})-");
    assert.equal(state.config.reviewDir, daemon.config.reviewDir);

    const preview = await (await fetch(`${base}/api/cleanup/archive`)).json();
    assert.equal(preview.disabled, true);
    assert.deepEqual(preview.files, []);
  } finally {
    await daemon.stop();
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("api: reviewed audio list, approve and delete groups", { skip: !CAN_RUN }, async () => {
  const { root, daemon, base, src, dest } = await makeReviewDaemon();
  try {
    const makeClip = (day, n) => execFileSync("ffmpeg", [
      "-loglevel", "error", "-y",
      "-f", "lavfi", "-i", "sine=frequency=440:duration=0.5",
      "-c:a", "libopus", path.join(src, "201301", `PTT-201905${day}-WA000${n}.opus`),
    ]);
    makeClip("29", 1);
    makeClip("29", 2);
    await waitFor(async () => {
      const review = await (await fetch(`${base}/api/review`)).json();
      return review.reviewedAudio.length === 1 && review.reviewedAudio[0].count === 2;
    });

    const review = await (await fetch(`${base}/api/review`)).json();
    const group = review.reviewedAudio[0];
    assert.equal(group.folder, "reviewed-audio");
    assert.equal(group.chat, "201301");
    assert.equal(group.date, "20190529");
    assert.equal(group.destName, "2019-05-29-00-00-00-(20190529-merged-201301).mp4");

    const audioResponse = await fetch(`${base}/api/review/audio/reviewed-audio/${encodeURIComponent(group.files[0])}`, {
      headers: { Range: "bytes=0-15" },
    });
    assert.equal(audioResponse.status, 206);
    assert.equal(audioResponse.headers.get("content-type"), "audio/ogg");
    assert.equal(audioResponse.headers.get("accept-ranges"), "bytes");
    assert.equal((await audioResponse.arrayBuffer()).byteLength, 16);

    const badAudio = await fetch(`${base}/api/review/audio/reviewed-audio/${encodeURIComponent("../../etc/passwd")}`);
    assert.equal(badAudio.status, 404);

    const approved = await (await fetch(`${base}/api/review/reviewed-audio/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folder: "reviewed-audio", chat: group.chat, date: group.date }),
    })).json();
    assert.equal(approved.ok, true, JSON.stringify(approved));
    assert.equal(await fsp.stat(path.join(dest, group.destName)).then(() => true).catch(() => false), true);
    assert.deepEqual(await fsp.readdir(path.join(src, "201301")), [], "approved source clips move to trash");
    assert.deepEqual((await (await fetch(`${base}/api/review`)).json()).reviewedAudio, []);

    // A second group is deleted without touching the destination.
    makeClip("30", 1);
    await waitFor(async () => (await (await fetch(`${base}/api/review`)).json()).reviewedAudio.length === 1);
    const second = (await (await fetch(`${base}/api/review`)).json()).reviewedAudio[0];
    const deleted = await (await fetch(`${base}/api/review/reviewed-audio/delete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folder: "reviewed-audio", chat: second.chat, date: second.date }),
    })).json();
    assert.equal(deleted.ok, true, JSON.stringify(deleted));
    assert.deepEqual(await fsp.readdir(path.join(src, "201301")), [], "deleted source clips move to trash");
    assert.deepEqual(await fsp.readdir(dest), [group.destName], "delete must not write to the destination");

    const missing = await fetch(`${base}/api/review/reviewed-audio/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folder: "reviewed-audio", chat: "201301", date: "20990101" }),
    });
    assert.equal(missing.status, 404);
  } finally {
    await daemon.stop();
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("api: reviewed audio mutations are protected by the origin check", async () => {
  const { root, daemon, base } = await makeReviewDaemon();
  try {
    const response = await fetch(`${base}/api/review/reviewed-audio/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "http://evil.example" },
      body: JSON.stringify({ folder: "reviewed-audio", chat: "x", date: "20240101" }),
    });
    assert.equal(response.status, 403);
  } finally {
    await daemon.stop();
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("api: the app mounts under BASE_PATH with the shared kit", async () => {
  const { root, daemon, base } = await makeDaemon({ basePath: "/pipelines" });
  try {
    const page = await fetch(`${base}/pipelines`);
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.match(html, /<base href="\/pipelines\/">/);
    assert.match(html, /<title>D\$CPLN ⋅ File Pipelines<\/title>/);

    const state = await (await fetch(`${base}/pipelines/api/state`)).json();
    assert.equal(state.folders.length, 1);

    const health = await fetch(`${base}/pipelines/api/health`);
    assert.equal(health.status, 200);

    const index = await fetch(`${base}/pipelines/`);
    const indexHtml = await index.text();
    const asset = /src="\.\/(assets\/[^"]+\.js)"/.exec(indexHtml)?.[1];
    assert.ok(asset, "the built UI bundle must be referenced");
    const bundle = await fetch(`${base}/pipelines/${asset}`);
    assert.equal(bundle.status, 200);

    const crossOrigin = await fetch(`${base}/pipelines/api/pause`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "http://evil.example" },
      body: JSON.stringify({ paused: true }),
    });
    assert.equal(crossOrigin.status, 403);
  } finally {
    await daemon.stop();
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("api: cleanup-all skips folders that opt out of cleanup", async () => {
  const exists = (target) => fsp.stat(target).then(() => true).catch(() => false);
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "file-pipelines-cleanup-all-"));
  const configPath = path.join(root, "config.json");
  const enabledSrc = path.join(root, "enabled-src");
  const archiveSrc = path.join(root, "archive-src");
  const dest = path.join(root, "dest");
  await fsp.mkdir(enabledSrc, { recursive: true });
  await fsp.mkdir(archiveSrc, { recursive: true });
  await fsp.mkdir(dest, { recursive: true });
  await fsp.writeFile(path.join(enabledSrc, "one.txt"), "data");
  await fsp.writeFile(path.join(archiveSrc, "keep.txt"), "data");
  await fsp.writeFile(path.join(dest, "one.txt"), "data");
  await fsp.writeFile(path.join(dest, "keep.txt"), "data");
  await fsp.writeFile(
    configPath,
    JSON.stringify({
      configVersion: 1,
      bindHost: "127.0.0.1",
      port: 0,
      concurrency: 1,
      paused: false,
      dryRun: false,
      trashRetentionDays: 30,
      settleSeconds: 0,
      maxAutoRetries: 3,
      stagingDir: path.join(root, "staging"),
      reviewDir: path.join(root, "review"),
      trashDir: path.join(root, "trash"),
      logDir: path.join(root, "logs"),
      syncLockFile: path.join(root, "lock.json"),
      lockHeartbeatSeconds: 60,
      lockStaleSeconds: 120,
      notifySuccess: true,
      folders: [
        { name: "enabled", source: enabledSrc, destination: dest, method: "copy", settleSeconds: 0 },
        { name: "archive", source: archiveSrc, destination: dest, method: "copy", cleanup: false, settleSeconds: 0 },
      ],
    }),
  );
  const daemon = new Daemon(configPath, { port: 0 });
  await daemon.start();
  try {
    await daemon.store.scanFolder("enabled");
    await daemon.store.scanFolder("archive");
    daemon.store.getFolder("enabled").files.get("one.txt").status = STATUS.DONE;
    daemon.store.getFolder("archive").files.get("keep.txt").status = STATUS.DONE;

    const base = `http://127.0.0.1:${daemon.api.server.address().port}`;
    const res = await fetch(`${base}/api/cleanup-all`, { method: "POST" });
    assert.equal(res.status, 200);
    const { results } = await res.json();
    assert.deepEqual(Object.keys(results), ["enabled"], "disabled folders are skipped entirely");
    assert.equal(results.enabled[0].ok, true);
    assert.equal(await exists(path.join(enabledSrc, "one.txt")), false, "enabled folder original was cleaned");
    assert.equal(await exists(path.join(archiveSrc, "keep.txt")), true, "archive original stays");
  } finally {
    await daemon.stop();
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("api: legacy ntfy config is dropped and notifySuccess migrates", async () => {
  const { daemon, base, root } = await makeDaemon();
  try {
    const initial = await (await fetch(`${base}/api/state`)).json();
    assert.equal(initial.config.ntfy, undefined, "legacy ntfy section is gone");
    assert.equal(initial.config.notifySuccess, true);

    const body = { ...initial.config, ntfy: { url: "https://ntfy.example", token: "secret-token", notifySuccess: false } };
    delete body.notifySuccess;
    const saved = await fetch(`${base}/api/config`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    assert.equal(saved.status, 200);
    const next = await saved.json();
    assert.equal(next.ntfy, undefined);
    assert.equal(next.notifySuccess, false, "the pre-upgrade notifySuccess choice is kept");

    const masked = await (await fetch(`${base}/api/config`)).json();
    assert.equal(masked.ntfy, undefined);
    assert.equal(daemon.config.notifySuccess, false);
  } finally {
    await daemon.stop();
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("api: trash restore only targets configured source/destination trees", async () => {
  const { daemon, base, root } = await makeDaemon();
  try {
    const bad = await fetch(`${base}/api/trash/restore`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ files: [], targetDir: path.join(root, "..", "elsewhere") }),
    });
    assert.equal(bad.status, 400);

    const good = await fetch(`${base}/api/trash/restore`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ files: [], targetDir: path.join(root, "dest", "sub") }),
    });
    assert.equal(good.status, 200);
    assert.deepEqual((await good.json()).results, []);

    const traversal = await fetch(`${base}/api/trash/restore`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ files: [], targetDir: path.join(root, "dest", "..", "..") }),
    });
    assert.equal(traversal.status, 400);
  } finally {
    await daemon.stop();
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("api: oversized bodies are rejected with 413", async () => {
  const { daemon, base, root } = await makeDaemon();
  try {
    const res = await fetch(`${base}/api/config`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: `{"pad":"${"x".repeat(1024 * 1024 + 16)}"}`,
    });
    assert.equal(res.status, 413);
  } finally {
    await daemon.stop();
    await fsp.rm(root, { recursive: true, force: true });
  }
});
