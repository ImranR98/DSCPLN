import test from "node:test";
import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { matchesPattern, isSyncOrTempName, shouldSkipName } from "../src/util.js";
import { DestExistsError, moveIntoPlace, replaceIntoPlace } from "../src/processors/place.js";
import { defaultConfig, normalizeConfig, validateConfig } from "../src/config.js";
import { sanitizeChat, reviewedAudioDestName, reviewedAudioGroupOf } from "../src/reviewed-audio.js";

test("matchesPattern handles *, ? and literals", () => {
  assert.equal(matchesPattern("Snapchat-20260101.mp4", "Snapchat-*.mp4"), true);
  assert.equal(matchesPattern("Snapchat-20260101.MP4", "Snapchat-*.mp4"), false);
  assert.equal(matchesPattern("notes.txt", "Snapchat-*.mp4"), false);
  assert.equal(matchesPattern("IMG-1.jpg", "IMG-?.jpg"), true);
  assert.equal(matchesPattern("IMG-12.jpg", "IMG-?.jpg"), false);
  assert.equal(matchesPattern("a+b.jpg", "a+b.*"), true);
  assert.equal(matchesPattern("anything", null), true);
});

test("moveIntoPlace refuses to overwrite an existing destination", async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "file-pipelines-place-"));
  try {
    const src = path.join(dir, "src.txt");
    const dest = path.join(dir, "dest.txt");
    await fsp.writeFile(src, "new content");
    await fsp.writeFile(dest, "existing content");
    await assert.rejects(() => moveIntoPlace(src, dest), (err) => {
      assert.equal(err instanceof DestExistsError, true);
      return true;
    });
    assert.equal(await fsp.readFile(dest, "utf8"), "existing content");
    assert.equal(await fsp.readFile(src, "utf8"), "new content");
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

test("moveIntoPlace places a file when the destination is free", async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "file-pipelines-place2-"));
  try {
    const src = path.join(dir, "src.txt");
    const dest = path.join(dir, "dest.txt");
    await fsp.writeFile(src, "content");
    await moveIntoPlace(src, dest);
    assert.equal(await fsp.readFile(dest, "utf8"), "content");
    assert.equal(await fsp.stat(src).then(() => true).catch(() => false), false);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

test("default config ships no personal paths or folders", () => {
  const cfg = defaultConfig();
  assert.deepEqual(cfg.folders, []);
  assert.ok(cfg.stagingDir.startsWith("~/.file-pipelines/"));
  assert.ok(cfg.syncLockFile.startsWith("~/.file-pipelines/"));
});

test("replaceIntoPlace replaces atomically and leaves no temp files", async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "file-pipelines-replace-"));
  try {
    const src = path.join(dir, "staged.txt");
    const dest = path.join(dir, "dest.txt");
    await fsp.writeFile(src, "version two");
    await fsp.writeFile(dest, "version one");
    const how = await replaceIntoPlace(src, dest);
    assert.equal(how, "replace");
    assert.equal(await fsp.readFile(dest, "utf8"), "version two");
    assert.equal(await fsp.stat(src).then(() => true).catch(() => false), false, "staged source must be consumed");
    assert.deepEqual(await fsp.readdir(dir), ["dest.txt"], "no temp or staged files may be left behind");
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

test("replaceIntoPlace creates the destination directory", async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "file-pipelines-replace2-"));
  try {
    const src = path.join(dir, "staged.txt");
    const dest = path.join(dir, "nested", "deeper", "dest.txt");
    await fsp.writeFile(src, "content");
    await replaceIntoPlace(src, dest);
    assert.equal(await fsp.readFile(dest, "utf8"), "content");
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

test("replaceIntoPlace cleans up its temp file when the destination is unusable", async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "file-pipelines-replace3-"));
  try {
    const src = path.join(dir, "staged.txt");
    const dest = path.join(dir, "dest-dir");
    await fsp.writeFile(src, "content");
    await fsp.mkdir(dest);
    await assert.rejects(() => replaceIntoPlace(src, dest));
    assert.equal(await fsp.stat(src).then(() => true).catch(() => false), true, "staged file must survive a failed replace");
    const leftovers = (await fsp.readdir(dir)).filter((name) => name.includes(".file-pipelines-"));
    assert.deepEqual(leftovers, [], "failed replaces must not leave temp files");
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

test("skip-name helpers protect sync artifacts and honor includeHidden", () => {
  assert.equal(shouldSkipName(".nomedia", false), true);
  assert.equal(shouldSkipName(".nomedia", true), false);
  assert.equal(shouldSkipName(".stfolder", true), true);
  assert.equal(shouldSkipName(".stversions", true), true);
  assert.equal(shouldSkipName(".stignore", true), true);
  assert.equal(shouldSkipName(".syncthing.foo", true), true);
  assert.equal(shouldSkipName(".file-pipelines-staging", true), true);
  assert.equal(shouldSkipName("file.tmp", true), true);
  assert.equal(shouldSkipName("file.tmp.chck", true), true);
  assert.equal(shouldSkipName("file!sync", true), true);
  assert.equal(shouldSkipName("normal.jpg", true), false);
  assert.equal(isSyncOrTempName(".stfolder"), true);
  assert.equal(isSyncOrTempName("song.mp3"), false);
});

test("reviewed audio helpers use the folder's datePattern and name deterministically", () => {
  const whatsapp = "-(\\d{8})-";
  assert.deepEqual(reviewedAudioGroupOf("201301/PTT-20190529-WA0001.opus", whatsapp), { chat: "201301", date: "20190529" });
  assert.deepEqual(reviewedAudioGroupOf("PTT-20190529-WA0001.opus", whatsapp), { chat: "", date: "20190529" });
  assert.equal(reviewedAudioGroupOf("chat/notes.txt", whatsapp), null);
  assert.equal(reviewedAudioGroupOf("chat/PTT-19-WA0001.opus", whatsapp), null);

  // A user-supplied pattern may capture separators; non-digits are stripped.
  const custom = "(\\d{4})-(\\d{2})-(\\d{2})";
  assert.deepEqual(reviewedAudioGroupOf("voice/rec 2019-05-29 take1.opus", custom), { chat: "voice", date: "20190529" });
  // Without a capturing group the whole match is normalized.
  assert.deepEqual(reviewedAudioGroupOf("a/2019.05.29.aac", "\\d{4}\\.\\d{2}\\.\\d{2}"), { chat: "a", date: "20190529" });

  assert.equal(sanitizeChat("Family Group!"), "Family Group_");
  assert.equal(reviewedAudioDestName("201301", "20190529"), "2019-05-29-00-00-00-(20190529-merged-201301).mp4");
  assert.equal(reviewedAudioDestName("", "20190529"), "2019-05-29-00-00-00-(20190529-merged).mp4");
});

test("config normalization applies safe defaults for the new folder options", () => {
  const cfg = normalizeConfig({
    stagingDir: "/tmp/s",
    reviewDir: "/tmp/r",
    trashDir: "/tmp/t",
    logDir: "/tmp/l",
    folders: [
      { name: "copy", source: "/tmp/a", destination: "/tmp/b", method: "copy" },
      { name: "vn", source: "/tmp/c", destination: "/tmp/d", method: "reviewed-audio", datePattern: "-(\\d{8})-" },
      { name: "vnFile", source: "/tmp/g", destination: "/tmp/h", method: "reviewed-audio" },
      { name: "std", source: "/tmp/e", destination: "/tmp/f", method: "standardize", placement: "manual" },
    ],
  });
  const [copy, vn, vnFile, std] = cfg.folders;
  assert.equal(copy.recursive, false);
  assert.equal(copy.includeHidden, false);
  assert.equal(copy.onChanged, "overwrite");
  assert.equal(copy.cleanup, true);
  assert.equal(copy.placement, "auto");
  assert.equal(copy.notify, "all");
  assert.equal(copy.datePattern, null, "datePattern only applies to reviewed audio folders");
  assert.equal(vn.recursive, true, "reviewed audio folders are always recursive");
  assert.equal(vn.filePattern, null, "no source-format assumptions are baked in");
  assert.equal(vn.datePattern, "-(\\d{8})-");
  assert.equal(vn.placement, "manual", "reviewed audio is approval-only");
  assert.equal(vn.cleanup, false, "reviewed audio files are trashed by approval/delete");
  assert.equal(vn.autoProcess, false);
  assert.equal(vn.concat, true, "reviewed audio concatenates by default");
  assert.equal(vnFile.datePattern, null, "reviewed audio without a datePattern standardizes per file");
  assert.equal(vnFile.cleanup, false);
  assert.equal(std.placement, "manual");
  const conflict = normalizeConfig({
    stagingDir: "/tmp/s",
    reviewDir: "/tmp/r",
    trashDir: "/tmp/t",
    logDir: "/tmp/l",
    folders: [{ name: "copy", source: "/tmp/a", destination: "/tmp/b", method: "copy", onChanged: "conflict", cleanup: false, notify: "errors" }],
  });
  assert.equal(conflict.folders[0].onChanged, "conflict");
  assert.equal(conflict.folders[0].cleanup, false);
  assert.equal(conflict.folders[0].notify, "errors");
});

test("legacy voicenotes configs normalize to reviewed-audio", () => {
  const cfg = normalizeConfig({
    stagingDir: "/tmp/s",
    reviewDir: "/tmp/r",
    trashDir: "/tmp/t",
    logDir: "/tmp/l",
    folders: [{ name: "legacy", source: "/tmp/a", destination: "/tmp/b", method: "voicenotes", datePattern: "-(\\d{8})-" }],
  });
  assert.equal(cfg.folders[0].method, "reviewed-audio");
  assert.equal(cfg.folders[0].concat, true);
  assert.doesNotThrow(() => validateConfig(cfg));
});

test("config validation allows reviewed audio without a datePattern but rejects a bad one", () => {
  const base = { stagingDir: "/tmp/s", reviewDir: "/tmp/r", trashDir: "/tmp/t", logDir: "/tmp/l" };
  assert.doesNotThrow(
    () => validateConfig(normalizeConfig({ ...base, folders: [{ name: "vn", source: "/tmp/c", destination: "/tmp/d", method: "reviewed-audio" }] })),
  );
  assert.throws(
    () => validateConfig(normalizeConfig({ ...base, folders: [{ name: "vn", source: "/tmp/c", destination: "/tmp/d", method: "reviewed-audio", datePattern: "([unclosed" }] })),
    /invalid datePattern/,
  );
  assert.doesNotThrow(() =>
    validateConfig(normalizeConfig({ ...base, folders: [{ name: "vn", source: "/tmp/c", destination: "/tmp/d", method: "reviewed-audio", datePattern: "-(\\d{8})-" }] })),
  );
});
