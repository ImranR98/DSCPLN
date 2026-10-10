import test from "node:test";
import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { Daemon } from "../src/daemon.js";

async function makeDaemon() {
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
  const daemon = new Daemon(configPath, {});
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
    assert.match(await page.text(), /Media Sync/);
    const css = await fetch(`${base}/style.css`);
    assert.equal(css.status, 200);
    assert.match(css.headers.get("content-type"), /text\/css/);
    const font = await fetch(`${base}/fonts/inter-latin-wght-normal.woff2`);
    assert.equal(font.status, 200);
    assert.match(font.headers.get("content-type"), /font\/woff2/);
    const shoelace = await fetch(`${base}/vendor/shoelace/shoelace.js`);
    assert.equal(shoelace.status, 200);
    assert.match(shoelace.headers.get("content-type"), /javascript/);
    const shoelaceTheme = await fetch(`${base}/vendor/shoelace/theme-light.css`);
    assert.equal(shoelaceTheme.status, 200);
    const traversal = await fetch(`${base}/../src/api.js`);
    assert.equal(traversal.status, 404);
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
    assert.equal(received[0].headers.title, "Media Sync");
    assert.match(received[0].body, /test notification/);
    assert.equal(received[0].headers.authorization, `Basic ${Buffer.from(":sekret").toString("base64")}`);

    assert.equal((await post({ url: "notaurl" })).status, 400);
    assert.equal((await post({})).status, 400);
  } finally {
    await new Promise((resolve) => fake.close(resolve));
    await daemon.stop();
    await fsp.rm(root, { recursive: true, force: true });
  }
});
