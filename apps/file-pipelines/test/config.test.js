import test from "node:test";
import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { defaultConfig, loadConfig, normalizeConfig, validateConfig } from "../src/config.js";

test("fresh boot writes an empty config (no folders)", async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "file-pipelines-config-"));
  try {
    const file = path.join(dir, "config.json");
    const cfg = await loadConfig(file);
    assert.deepEqual(cfg.folders, []);
    const written = JSON.parse(await fsp.readFile(file, "utf8"));
    assert.deepEqual(written.folders, []);
    assert.ok(written.stagingDir);
    assert.ok(written.trashDir);
    assert.ok(written.syncLockFile.endsWith(".file-pipelines/lock.json"));
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

test("zero-folder configs are valid", () => {
  assert.doesNotThrow(() => validateConfig({ ...defaultConfig(), folders: [] }));
});

test("an existing config is loaded without being rewritten", async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "file-pipelines-config-"));
  try {
    const file = path.join(dir, "config.json");
    const custom = { configVersion: 1, folders: [], concurrency: 3, trashRetentionDays: 7 };
    await fsp.writeFile(file, JSON.stringify(custom));
    const before = await fsp.readFile(file, "utf8");
    const cfg = await loadConfig(file);
    assert.equal(cfg.concurrency, 3);
    assert.equal(cfg.trashRetentionDays, 7);
    assert.equal(await fsp.readFile(file, "utf8"), before);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

test("config: copy folders normalize their tree options", () => {
  const cfg = normalizeConfig({
    ...defaultConfig(),
    folders: [
      {
        name: "calls",
        method: "copy",
        source: "/phone/Calls",
        destination: "/backup/Calls",
        recursive: true,
        onChanged: "conflict",
        cleanup: false,
      },
    ],
  });
  validateConfig(cfg);
  const folder = cfg.folders[0];
  assert.equal(folder.method, "copy");
  assert.equal(folder.recursive, true);
  assert.equal(folder.onChanged, "conflict");
  assert.equal(folder.cleanup, false);
  assert.equal(folder.source, "/phone/Calls");
});

test("config: a source is required for every folder method", () => {
  const base = (folder) => ({ ...defaultConfig(), folders: [folder] });
  assert.throws(
    () => validateConfig(base({ name: "d", destination: "/d", method: "copy" })),
    /missing source/,
  );
  assert.throws(
    () => validateConfig(base({ name: "e", source: "/s", destination: "/d", method: "nope" })),
    /unknown method/,
  );
});
