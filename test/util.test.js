import test from "node:test";
import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { matchesPattern } from "../src/util.js";
import { DestExistsError, moveIntoPlace } from "../src/processors/place.js";
import { defaultConfig } from "../src/config.js";

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
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "media-sync-place-"));
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
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "media-sync-place2-"));
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

test("default config uses the PC screenrecs path", () => {
  const cfg = defaultConfig();
  const screenrecs = cfg.folders.find((f) => f.name === "Screen Recs");
  assert.ok(screenrecs.source.endsWith("deviceSync/ScreenRecs"), `unexpected: ${screenrecs.source}`);
});
