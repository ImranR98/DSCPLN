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

test("config: snapshot copies carry sources, runner and schedule", () => {
  const cfg = normalizeConfig({
    ...defaultConfig(),
    folders: [
      {
        name: "wine",
        method: "copy",
        snapshot: true,
        sources: ["/home/imranr/Games/Installs/Synced", "/home/imranr/Games/Installs/Unsynced"],
        destination: "/home/imranr/Main/Backups/Game Save Files",
        subdir: "drive_c/users/steamuser",
        nameSuffix: " (Wine prefix home dir)",
        touch: "lastBackedUp.txt",
        runner: { node: "bigpc" },
        schedule: { enabled: true, days: [1, 3], at: "4:30" },
      },
    ],
  });
  validateConfig(cfg);
  const folder = cfg.folders[0];
  assert.equal(folder.method, "copy");
  assert.equal(folder.snapshot, true);
  assert.deepEqual(folder.sources, [
    "/home/imranr/Games/Installs/Synced",
    "/home/imranr/Games/Installs/Unsynced",
  ]);
  assert.equal(folder.source, "/home/imranr/Games/Installs/Synced");
  assert.equal(folder.subdir, "drive_c/users/steamuser");
  assert.equal(folder.nameSuffix, " (Wine prefix home dir)");
  assert.equal(folder.touch, "lastBackedUp.txt");
  assert.equal(folder.cleanup, false);
  assert.deepEqual(folder.runner, { node: "bigpc" });
  assert.deepEqual(folder.schedule, { enabled: true, days: [1, 3], at: "04:30", catchUp: true });
  assert.equal(cfg.pipelineStagingClaim, "file-pipelines-staging");
  assert.ok(cfg.pipelineStagingDir.endsWith(".file-pipelines/pipeline-staging"));
});

test("config: legacy command folders migrate to snapshot copies", () => {
  const cfg = normalizeConfig({
    ...defaultConfig(),
    folders: [
      {
        name: "wine",
        source: "/srv/games",
        destination: "/backup/games",
        method: "command",
        command: "rsync -a {{source}}/ {{destination}}/",
      },
    ],
  });
  validateConfig(cfg);
  const folder = cfg.folders[0];
  assert.equal(folder.method, "copy");
  assert.equal(folder.snapshot, true);
  assert.equal(folder.command, "rsync -a {{source}}/ {{destination}}/");
  assert.deepEqual(folder.sources, ["/srv/games"]);
});

test("config: snapshot fields are validated", () => {
  const base = (folder) => ({ ...defaultConfig(), folders: [folder] });
  assert.throws(
    () => validateConfig(base({ name: "a", source: "/s", destination: "/d", method: "copy", runner: { node: "bigpc" } })),
    /only supported for snapshot copies/,
  );
  assert.throws(
    () => validateConfig(base({ name: "b", sources: ["/s1", "/s2"], destination: "/d", method: "copy" })),
    /multiple sources require a snapshot copy/,
  );
  assert.throws(
    () => validateConfig(base({ name: "c", source: "/s", destination: "/d", method: "standardize", snapshot: true })),
    /snapshot is only supported for copy folders/,
  );
  assert.throws(
    () => validateConfig(base({ name: "d", destination: "/d", method: "copy", snapshot: true })),
    /missing source/,
  );
});
