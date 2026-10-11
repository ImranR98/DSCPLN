import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fsp from "node:fs/promises";
import http from "node:http";
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
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "media-sync-api-"));
  const configPath = path.join(root, "config.json");
  await fsp.mkdir(path.join(root, "src"), { recursive: true });
  await fsp.mkdir(path.join(root, "dest"), { recursive: true });
  const config = {
    configVersion: 1,
    bindHost: "127.0.0.1",
    port: 0,
    concurrency: 1,
    paused: false,
    dryRun: false,
    trashRetentionDays: 30,
    settleSeconds: 60,
    maxAutoRetries: 3,
    stagingDir: path.join(root, "staging"),
    trashDir: path.join(root, "trash"),
    logDir: path.join(root, "logs"),
    syncLockFile: path.join(root, "lock.json"),
    lockHeartbeatSeconds: 60,
    lockStaleSeconds: 120,
    ntfy: { url: "", token: "" },
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
    assert.match(await page.text(), /D\$CPLN . Media Sync/);
    // The UI is styled entirely by the shared kit (no per-app stylesheet).
    const css = await fetch(`${base}/ui/style.css`);
    assert.equal(css.status, 200);
    assert.match(css.headers.get("content-type"), /text\/css/);
    const font = await fetch(`${base}/ui/fonts/inter-latin-wght-normal.woff2`);
    assert.equal(font.status, 200);
    assert.match(font.headers.get("content-type"), /font\/woff2/);
    const shoelace = await fetch(`${base}/ui/vendor/shoelace/shoelace.js`);
    assert.equal(shoelace.status, 200);
    assert.match(shoelace.headers.get("content-type"), /javascript/);
    const shoelaceTheme = await fetch(`${base}/ui/vendor/shoelace/theme-light.css`);
    assert.equal(shoelaceTheme.status, 200);
    const traversal = await fetch(`${base}/../src/api.js`);
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

test("api: ntfy test endpoint posts to the supplied URL", async () => {
  const { root, daemon, base } = await makeDaemon();
  const received = [];
  const fake = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      received.push({ method: req.method, headers: req.headers, body });
      res.writeHead(200);
      res.end("ok");
    });
  });
  await new Promise((resolve) => fake.listen(0, "127.0.0.1", resolve));
  const port = fake.address().port;
  const post = (body) => fetch(`${base}/api/ntfy-test`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  try {
    const ok = await post({ url: `http://127.0.0.1:${port}/topic`, token: "sekret" });
    assert.equal(ok.status, 200);
    assert.equal(received.length, 1);
    assert.equal(received[0].method, "POST");
    assert.equal(received[0].headers.title, "D$CPLN - Media Sync");
    assert.match(received[0].body, /test notification/);
    assert.equal(received[0].headers.authorization, "Bearer sekret");

    assert.equal((await post({ url: "notaurl" })).status, 400);
    assert.equal((await post({})).status, 400);
  } finally {
    await new Promise((resolve) => fake.close(resolve));
    await daemon.stop();
    await fsp.rm(root, { recursive: true, force: true });
  }
});

async function makeReviewDaemon(options = {}) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "media-sync-api-review-"));
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
    ntfy: { url: "", token: "" },
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
        name: "voicenotes",
        source: path.join(root, "src"),
        destination: path.join(root, "dest"),
        method: "voicenotes",
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
    const voicenotes = state.folders.find((f) => f.name === "voicenotes");
    assert.equal(archive.recursive, true);
    assert.equal(archive.onChanged, "overwrite");
    assert.equal(archive.cleanup, false);
    assert.equal(archive.notify, "errors");
    assert.equal(voicenotes.method, "voicenotes");
    assert.equal(voicenotes.placement, "manual");
    assert.equal(voicenotes.recursive, true);
    assert.equal(voicenotes.datePattern, "-(\\d{8})-");
    assert.equal(state.config.reviewDir, daemon.config.reviewDir);

    const preview = await (await fetch(`${base}/api/cleanup/archive`)).json();
    assert.equal(preview.disabled, true);
    assert.deepEqual(preview.files, []);
  } finally {
    await daemon.stop();
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("api: review list, range-served preview, selective process, place and discard", { skip: !CAN_RUN }, async () => {
  const { root, daemon, base, src, dest } = await makeReviewDaemon();
  try {
    execFileSync("ffmpeg", [
      "-loglevel", "error", "-y",
      "-f", "lavfi", "-i", "sine=frequency=440:duration=0.5",
      "-c:a", "libopus", path.join(src, "201301", "PTT-20190529-WA0001.opus"),
    ]);
    await waitFor(() => daemon.store.fileFor("voicenotes", "201301/PTT-20190529-WA0001.opus")?.status === STATUS.PENDING);

    const processed = await (await fetch(`${base}/api/process/voicenotes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ files: ["201301/PTT-20190529-WA0001.opus"] }),
    })).json();
    assert.equal(processed.ok, true);
    assert.equal(processed.processed, 1);
    await waitFor(() => daemon.store.fileFor("voicenotes", "201301/PTT-20190529-WA0001.opus")?.status === STATUS.REVIEW);

    const review = await (await fetch(`${base}/api/review`)).json();
    assert.equal(review.entries.length, 1);
    const entry = review.entries[0];
    assert.equal(entry.folder, "voicenotes");
    assert.match(entry.destName, /^2019-05-29-00-00-00-\(20190529-merged-201301\)\.mp4$/);

    const full = await fetch(`${base}/api/review/file/voicenotes/${encodeURIComponent(entry.destName)}`);
    assert.equal(full.status, 200);
    assert.equal(full.headers.get("accept-ranges"), "bytes");
    const fullBytes = new Uint8Array(await full.arrayBuffer());
    assert.equal(fullBytes.length, entry.size);

    const ranged = await fetch(`${base}/api/review/file/voicenotes/${encodeURIComponent(entry.destName)}`, {
      headers: { Range: "bytes=0-9" },
    });
    assert.equal(ranged.status, 206);
    assert.equal(ranged.headers.get("content-range"), `bytes 0-9/${entry.size}`);
    const rangedBytes = new Uint8Array(await ranged.arrayBuffer());
    assert.equal(rangedBytes.length, 10);
    assert.deepEqual(rangedBytes, fullBytes.slice(0, 10));

    const placed = await (await fetch(`${base}/api/review/place`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folder: "voicenotes", id: entry.destName }),
    })).json();
    assert.equal(placed.results[0].ok, true);
    assert.equal(await fsp.stat(path.join(dest, entry.destName)).then(() => true).catch(() => false), true);
    assert.deepEqual((await (await fetch(`${base}/api/review`)).json()).entries, []);

    // Discard flow on a second clip.
    execFileSync("ffmpeg", [
      "-loglevel", "error", "-y",
      "-f", "lavfi", "-i", "sine=frequency=440:duration=0.5",
      "-c:a", "libopus", path.join(src, "201301", "PTT-20190530-WA0001.opus"),
    ]);
    await waitFor(() => daemon.store.fileFor("voicenotes", "201301/PTT-20190530-WA0001.opus")?.status === STATUS.PENDING);
    await fetch(`${base}/api/process/voicenotes`, { method: "POST" });
    await waitFor(() => daemon.store.fileFor("voicenotes", "201301/PTT-20190530-WA0001.opus")?.status === STATUS.REVIEW);
    const second = (await (await fetch(`${base}/api/review`)).json()).entries[0];
    const discarded = await (await fetch(`${base}/api/review/discard`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folder: "voicenotes", ids: [second.destName] }),
    })).json();
    assert.equal(discarded.results[0].ok, true);
    assert.equal(daemon.store.fileFor("voicenotes", "201301/PTT-20190530-WA0001.opus").status, STATUS.DISCARDED);
    assert.equal(await fsp.stat(path.join(dest, second.destName)).then(() => true).catch(() => false), false);

    const missing = await fetch(`${base}/api/review/file/voicenotes/nope.mp4`);
    assert.equal(missing.status, 404);
    const badPlace = await (await fetch(`${base}/api/review/place`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folder: "voicenotes" }),
    })).json();
    assert.equal(badPlace.error, "id or ids required");
  } finally {
    await daemon.stop();
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("api: review mutations are protected by the origin check", async () => {
  const { root, daemon, base } = await makeReviewDaemon();
  try {
    const response = await fetch(`${base}/api/review/discard`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "http://evil.example" },
      body: JSON.stringify({ folder: "voicenotes", id: "x" }),
    });
    assert.equal(response.status, 403);
  } finally {
    await daemon.stop();
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("api: place-all moves every parked entry at once", { skip: !CAN_RUN }, async () => {
  const { root, daemon, base, src, dest } = await makeReviewDaemon();
  try {
    for (const day of ["29", "30"]) {
      execFileSync("ffmpeg", [
        "-loglevel", "error", "-y",
        "-f", "lavfi", "-i", "sine=frequency=440:duration=0.5",
        "-c:a", "libopus", path.join(src, "201301", `PTT-201905${day}-WA0001.opus`),
      ]);
    }
    await waitFor(() => daemon.store.fileFor("voicenotes", "201301/PTT-20190529-WA0001.opus")?.status === STATUS.PENDING
      && daemon.store.fileFor("voicenotes", "201301/PTT-20190530-WA0001.opus")?.status === STATUS.PENDING);
    await fetch(`${base}/api/process/voicenotes`, { method: "POST" });
    await waitFor(async () => (await (await fetch(`${base}/api/review`)).json()).entries.length === 2);

    const result = await (await fetch(`${base}/api/review/place-all`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folder: "voicenotes" }),
    })).json();
    assert.equal(result.results.length, 2);
    assert.equal(result.results.every((entry) => entry.ok), true, JSON.stringify(result.results));
    assert.equal((await fsp.readdir(dest)).length, 2);
    assert.deepEqual((await (await fetch(`${base}/api/review`)).json()).entries, []);
  } finally {
    await daemon.stop();
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("api: discard-all clears every parked entry without touching the destination", { skip: !CAN_RUN }, async () => {
  const { root, daemon, base, src, dest } = await makeReviewDaemon();
  try {
    for (const day of ["29", "30"]) {
      execFileSync("ffmpeg", [
        "-loglevel", "error", "-y",
        "-f", "lavfi", "-i", "sine=frequency=440:duration=0.5",
        "-c:a", "libopus", path.join(src, "201301", `PTT-201905${day}-WA0001.opus`),
      ]);
    }
    await waitFor(() => daemon.store.fileFor("voicenotes", "201301/PTT-20190529-WA0001.opus")?.status === STATUS.PENDING
      && daemon.store.fileFor("voicenotes", "201301/PTT-20190530-WA0001.opus")?.status === STATUS.PENDING);
    await fetch(`${base}/api/process/voicenotes`, { method: "POST" });
    await waitFor(async () => (await (await fetch(`${base}/api/review`)).json()).entries.length === 2);

    const result = await (await fetch(`${base}/api/review/discard-all`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folder: "voicenotes" }),
    })).json();
    assert.equal(result.results.length, 2);
    assert.equal(result.results.every((entry) => entry.ok), true, JSON.stringify(result.results));
    assert.deepEqual((await (await fetch(`${base}/api/review`)).json()).entries, []);
    assert.deepEqual(await fsp.readdir(dest), []);
    assert.equal(daemon.store.fileFor("voicenotes", "201301/PTT-20190529-WA0001.opus").status, STATUS.DISCARDED);
    assert.equal(daemon.store.fileFor("voicenotes", "201301/PTT-20190530-WA0001.opus").status, STATUS.DISCARDED);
  } finally {
    await daemon.stop();
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("api: the app mounts under BASE_PATH with the shared kit", async () => {
  const { root, daemon, base } = await makeDaemon({ basePath: "/media" });
  try {
    const page = await fetch(`${base}/media`);
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.match(html, /<base href="\/media\/">/);
    assert.match(html, /<title>D\$CPLN . Media Sync<\/title>/);

    const state = await (await fetch(`${base}/media/api/state`)).json();
    assert.equal(state.folders.length, 1);

    const health = await fetch(`${base}/media/api/health`);
    assert.equal(health.status, 200);

    const ui = await fetch(`${base}/media/ui/core.js`);
    assert.equal(ui.status, 200);

    const crossOrigin = await fetch(`${base}/media/api/pause`, {
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
