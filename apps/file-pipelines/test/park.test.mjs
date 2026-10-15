import test from "node:test";
import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Daemon } from "../src/daemon.js";
import { parkPathFor } from "../src/park.js";

test("parkPathFor keeps ids inside the folder's park directory", () => {
  const config = { reviewDir: "/tmp/review" };
  assert.equal(parkPathFor(config, "photos", "file.mp4"), path.join("/tmp/review", "photos", "file.mp4"));
  assert.throws(() => parkPathFor(config, "photos", "../escape"), /invalid park path/);
  assert.throws(() => parkPathFor(config, "photos", "a/../../escape"), /invalid park path/);
  assert.throws(() => parkPathFor(config, "photos", "/etc/passwd"), /invalid park path/);
});

test("review file API rejects traversal ids with 404", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "file-pipelines-traversal-"));
  const configPath = path.join(root, "config.json");
  await fsp.mkdir(path.join(root, "src"), { recursive: true });
  await fsp.mkdir(path.join(root, "dest"), { recursive: true });
  await fsp.writeFile(configPath, JSON.stringify({
    configVersion: 1,
    bindHost: "127.0.0.1",
    port: 0,
    concurrency: 1,
    stagingDir: path.join(root, "staging"),
    reviewDir: path.join(root, "review"),
    trashDir: path.join(root, "trash"),
    logDir: path.join(root, "logs"),
    syncLockFile: path.join(root, "lock.json"),
    lockHeartbeatSeconds: 60,
    lockStaleSeconds: 120,
    notifySuccess: true,
    folders: [{ name: "photos", source: path.join(root, "src"), destination: path.join(root, "dest"), method: "standardize", settleSeconds: 0 }],
  }, null, 2));
  const daemon = new Daemon(configPath, {});
  await daemon.start();
  try {
    const base = `http://127.0.0.1:${daemon.api.server.address().port}`;
    for (const id of ["..%2F..%2F..%2Fetc%2Fpasswd", "%2e%2e%2fsecret.txt"]) {
      const res = await fetch(`${base}/api/review/file/photos/${id}`);
      assert.equal(res.status, 404, `traversal id ${id} must 404`);
    }
    const place = await fetch(`${base}/api/review/place`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folder: "photos", ids: ["../escape"] }),
    });
    assert.equal(place.status, 200);
    const results = (await place.json()).results;
    assert.equal(results[0].ok, false, "traversal ids must not place anything");
  } finally {
    await daemon.stop();
    await fsp.rm(root, { recursive: true, force: true });
  }
});
