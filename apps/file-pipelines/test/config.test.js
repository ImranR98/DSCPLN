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

test("config: command folders carry a runner and a schedule", () => {
  const cfg = normalizeConfig({
    ...defaultConfig(),
    folders: [
      {
        name: "wine",
        source: "/home/imranr/Games/Installs/Synced",
        destination: "/home/imranr/Main/Backups/Game Save Files",
        method: "command",
        command: "rsync -a {{source}}/ {{destination}}/",
        runner: { node: "bigpc" },
        schedule: { enabled: true, days: [1, 3], at: "4:30" },
      },
    ],
  });
  validateConfig(cfg);
  assert.equal(cfg.folders[0].command, "rsync -a {{source}}/ {{destination}}/");
  assert.deepEqual(cfg.folders[0].runner, { node: "bigpc" });
  assert.deepEqual(cfg.folders[0].schedule, { enabled: true, days: [1, 3], at: "04:30", catchUp: true });
  assert.equal(cfg.pipelineStagingClaim, "file-pipelines-staging");
  assert.ok(cfg.pipelineStagingDir.endsWith(".file-pipelines/pipeline-staging"));
});

test("config: command folders need a command and runners are command-only", () => {
  const base = (folder) => ({ ...defaultConfig(), folders: [folder] });
  assert.throws(
    () => validateConfig(base({ name: "a", source: "/s", destination: "/d", method: "command" })),
    /need a command/,
  );
  assert.throws(
    () =>
      validateConfig(
        base({ name: "b", source: "/s", destination: "/d", method: "copy", runner: { node: "bigpc" } }),
      ),
    /only supported for command pipelines/,
  );
});
