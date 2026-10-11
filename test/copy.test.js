import test from "node:test";
import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Daemon } from "../src/daemon.js";
import { STATUS } from "../src/store.js";
import { normalizeConfig, validateConfig } from "../src/config.js";

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitFor(fn, timeoutMs = 30_000, intervalMs = 150) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await fn()) return true;
    await sleep(intervalMs);
  }
  return false;
}

const FIXED = new Date("2024-03-04T05:06:07Z");

async function writeFile(file, content, mtime = FIXED) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, content);
  await fsp.utimes(file, mtime, mtime);
}

async function makeSetup(folderOverrides = {}, configOverrides = {}) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "media-sync-copy-"));
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
    folders: [
      {
        name: "mirror",
        source: src,
        destination: dest,
        method: "copy",
        recursive: true,
        settleSeconds: 0,
        ...folderOverrides,
      },
    ],
    ...configOverrides,
  };
  await fsp.writeFile(configPath, JSON.stringify(config, null, 2));
  return { root, src, dest, configPath, config };
}

test("copy e2e: adopts matching mirror files, copies new ones, never deletes", async () => {
  const { root, src, dest, configPath } = await makeSetup();
  const daemon = new Daemon(configPath, {});
  try {
    await writeFile(path.join(src, "a.txt"), "same");
    await writeFile(path.join(dest, "a.txt"), "same");
    await writeFile(path.join(src, "sub", "b.txt"), "new file");

    await daemon.start();
    const adopted = await waitFor(() => daemon.store.fileFor("mirror", "a.txt")?.status === STATUS.DUPLICATE);
    assert.equal(adopted, true, "same size+mtime destination must be adopted without copying");
    const copied = await waitFor(() => daemon.store.fileFor("mirror", "sub/b.txt")?.status === STATUS.DONE);
    assert.equal(copied, true, "new nested file must be mirrored");
    assert.equal(await fsp.readFile(path.join(dest, "sub", "b.txt"), "utf8"), "new file");

    await fsp.rm(path.join(src, "a.txt"));
    const forgotten = await waitFor(() => daemon.store.fileFor("mirror", "a.txt") === null);
    assert.equal(forgotten, true, "deleted source must drop out of the store");
    assert.equal(await fsp.stat(path.join(dest, "a.txt")).then(() => true).catch(() => false), true, "destination must keep deleted source files");
  } finally {
    await daemon.stop();
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("copy e2e: overwrite mode replaces changed destination files atomically", async () => {
  const { root, src, dest, configPath } = await makeSetup();
  const daemon = new Daemon(configPath, {});
  try {
    await writeFile(path.join(src, "a.txt"), "version two");
    await writeFile(path.join(dest, "a.txt"), "version one", new Date("2020-01-01T00:00:00Z"));

    await daemon.start();
    const done = await waitFor(() => daemon.store.fileFor("mirror", "a.txt")?.status === STATUS.DONE);
    assert.equal(done, true, "changed source must be copied over");
    assert.equal(await fsp.readFile(path.join(dest, "a.txt"), "utf8"), "version two");
  } finally {
    await daemon.stop();
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("copy e2e: conflict mode flags changed files and leaves the destination alone", async () => {
  const { root, src, dest, configPath } = await makeSetup({ onChanged: "conflict" });
  const daemon = new Daemon(configPath, {});
  try {
    await writeFile(path.join(src, "a.txt"), "version two");
    await writeFile(path.join(dest, "a.txt"), "version one", new Date("2020-01-01T00:00:00Z"));

    await daemon.start();
    const conflicted = await waitFor(() => daemon.store.fileFor("mirror", "a.txt")?.status === STATUS.CONFLICT);
    assert.equal(conflicted, true, "conflict mode must surface the change");
    assert.equal(await fsp.readFile(path.join(dest, "a.txt"), "utf8"), "version one");
  } finally {
    await daemon.stop();
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("copy e2e: includeHidden mirrors dot-files but never sync artifacts", async () => {
  const { root, src, dest, configPath } = await makeSetup({ includeHidden: true });
  const daemon = new Daemon(configPath, {});
  try {
    await writeFile(path.join(src, ".nomedia"), "");
    await writeFile(path.join(src, ".stfolder", "marker"), "sync internal");
    await writeFile(path.join(src, "chat", ".nomedia"), "");

    await daemon.start();
    const copied = await waitFor(() => daemon.store.fileFor("mirror", ".nomedia")?.status === STATUS.DONE);
    assert.equal(copied, true, "hidden files must be mirrored when includeHidden is on");
    assert.equal(await fsp.stat(path.join(dest, ".nomedia")).then(() => true).catch(() => false), true);
    assert.equal(daemon.store.fileFor("mirror", ".stfolder/marker"), null, "sync internals must always be skipped");
  } finally {
    await daemon.stop();
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("copy e2e: overwrite survives a restart by adopting on size+mtime", async () => {
  const { root, src, dest, configPath } = await makeSetup();
  let daemon = new Daemon(configPath, {});
  try {
    await writeFile(path.join(src, "a.txt"), "version two");
    await writeFile(path.join(dest, "a.txt"), "version one", new Date("2020-01-01T00:00:00Z"));
    await daemon.start();
    const done = await waitFor(() => daemon.store.fileFor("mirror", "a.txt")?.status === STATUS.DONE);
    assert.equal(done, true);
    await daemon.stop();

    daemon = new Daemon(configPath, {});
    await daemon.start();
    const adopted = await waitFor(() => daemon.store.fileFor("mirror", "a.txt")?.status === STATUS.DUPLICATE);
    assert.equal(adopted, true, "a replaced file must be adopted on restart instead of recopied");
    assert.equal(await fsp.readFile(path.join(dest, "a.txt"), "utf8"), "version two");
    const leftovers = (await fsp.readdir(dest)).filter((name) => name.includes(".media-sync-"));
    assert.deepEqual(leftovers, [], "atomic replaces must not leave temp files in the destination");
  } finally {
    await daemon.stop();
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("copy e2e: deep trees mirror directory-for-directory", async () => {
  const { root, src, dest, configPath } = await makeSetup();
  const daemon = new Daemon(configPath, {});
  try {
    await writeFile(path.join(src, "Media", "WhatsApp Voice Notes", "201301", "PTT-1.opus"), "a");
    await writeFile(path.join(src, "Media", "WhatsApp Images", "IMG-1.jpg"), "b");
    await writeFile(path.join(src, "Databases", "msgstore.db"), "c");
    await daemon.start();
    const copied = await waitFor(() =>
      daemon.store.fileFor("mirror", "Media/WhatsApp Voice Notes/201301/PTT-1.opus")?.status === STATUS.DONE
      && daemon.store.fileFor("mirror", "Databases/msgstore.db")?.status === STATUS.DONE,
    );
    assert.equal(copied, true);
    assert.equal(await fsp.readFile(path.join(dest, "Media", "WhatsApp Voice Notes", "201301", "PTT-1.opus"), "utf8"), "a");
    assert.equal(await fsp.readFile(path.join(dest, "Databases", "msgstore.db"), "utf8"), "c");
  } finally {
    await daemon.stop();
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("copy e2e: non-recursive copy stays flat and ignores subdirectories", async () => {
  const { root, src, dest, configPath } = await makeSetup({ recursive: false });
  const daemon = new Daemon(configPath, {});
  try {
    await writeFile(path.join(src, "flat.txt"), "flat");
    await writeFile(path.join(src, "nested", "deep.txt"), "deep");
    await daemon.start();
    const copied = await waitFor(() => daemon.store.fileFor("mirror", "flat.txt")?.status === STATUS.DONE);
    assert.equal(copied, true);
    assert.equal(daemon.store.fileFor("mirror", "nested/deep.txt"), null, "subdirectories are out of scope without recursive");
    assert.equal(await fsp.stat(path.join(dest, "nested", "deep.txt")).then(() => true).catch(() => false), false);
  } finally {
    await daemon.stop();
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("copy e2e: overwrite recovers when the source changes after a restart", async () => {
  const { root, src, dest, configPath } = await makeSetup();
  let daemon = new Daemon(configPath, {});
  try {
    await writeFile(path.join(src, "a.txt"), "first");
    await daemon.start();
    const first = await waitFor(() => daemon.store.fileFor("mirror", "a.txt")?.status === STATUS.DONE);
    assert.equal(first, true);
    await daemon.stop();

    await sleep(1100);
    await writeFile(path.join(src, "a.txt"), "second and longer");
    daemon = new Daemon(configPath, {});
    await daemon.start();
    const replaced = await waitFor(() => {
      const file = daemon.store.fileFor("mirror", "a.txt");
      return file?.status === STATUS.DONE && file?.message?.includes("updated");
    });
    assert.equal(replaced, true, "changed source must trigger an overwrite after restart");
    assert.equal(await fsp.readFile(path.join(dest, "a.txt"), "utf8"), "second and longer");
  } finally {
    await daemon.stop();
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("config: manual placement is rejected for copy folders", () => {
  assert.throws(() => {
    validateConfig(
      normalizeConfig({
        stagingDir: "/tmp/staging",
        reviewDir: "/tmp/review",
        trashDir: "/tmp/trash",
        logDir: "/tmp/logs",
        folders: [
          {
            name: "bad",
            source: "/tmp/src",
            destination: "/tmp/dest",
            method: "copy",
            placement: "manual",
          },
        ],
      }),
    );
  }, /manual placement/);
});

test("copy e2e: the live watcher picks up new nested files and keeps deleted ones", async () => {
  const { root, src, dest, configPath } = await makeSetup();
  const daemon = new Daemon(configPath, {});
  try {
    await daemon.start();
    const live = path.join(src, "live", "chat1");
    await writeFile(path.join(live, "new.txt"), "appeared later");
    const copied = await waitFor(() => daemon.store.fileFor("mirror", "live/chat1/new.txt")?.status === STATUS.DONE, 40_000);
    assert.equal(copied, true, "a directory created after startup must be mirrored live");
    assert.equal(await fsp.readFile(path.join(dest, "live", "chat1", "new.txt"), "utf8"), "appeared later");

    await fsp.rm(live, { recursive: true, force: true });
    const forgotten = await waitFor(() => daemon.store.fileFor("mirror", "live/chat1/new.txt") === null, 40_000);
    assert.equal(forgotten, true);
    assert.equal(
      await fsp.stat(path.join(dest, "live", "chat1", "new.txt")).then(() => true).catch(() => false),
      true,
      "removing the source must never remove the archive copy",
    );
  } finally {
    await daemon.stop();
    await fsp.rm(root, { recursive: true, force: true });
  }
});
