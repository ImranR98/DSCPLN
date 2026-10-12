import test from "node:test";
import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DirCache, classifyDestMatch, destNamesForSource, isSnapOutputName, parseSnapInputs, plausibleSameSize } from "../src/verify.js";

test("destNamesForSource matches exact, standardized and LifeTagger-renamed files", async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "file-pipelines-verify-"));
  try {
    await fsp.writeFile(path.join(dir, "2021-01-02-03-04-05-(IMG_1).jpg"), "x");
    await fsp.writeFile(path.join(dir, "2021-01-02-03-04-05-(IMG_2)-[beach, sunny].jpg"), "x");
    await fsp.writeFile(path.join(dir, "IMG_3.jpg"), "x");
    const cache = new DirCache(0);
    const one = await destNamesForSource(cache, dir, "IMG_1.jpg");
    assert.equal(one.exact, null);
    assert.deepEqual(one.fuzzy, ["2021-01-02-03-04-05-(IMG_1).jpg"]);
    const two = await destNamesForSource(cache, dir, "IMG_2.jpg");
    assert.deepEqual(two.fuzzy, ["2021-01-02-03-04-05-(IMG_2)-[beach, sunny].jpg"]);
    const three = await destNamesForSource(cache, dir, "IMG_3.jpg");
    assert.equal(three.exact, "IMG_3.jpg");
    const four = await destNamesForSource(cache, dir, "NOPE.jpg");
    assert.equal(four.exact, null);
    assert.deepEqual(four.fuzzy, []);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

test("classifyDestMatch distinguishes duplicate from conflict by size", () => {
  assert.equal(classifyDestMatch({ method: "standardize", sourceSize: 100_000, destSize: 101_000 }), "duplicate");
  assert.equal(classifyDestMatch({ method: "standardize", sourceSize: 100_000, destSize: 500_000 }), "conflict");
  assert.equal(classifyDestMatch({ method: "standardize", sourceSize: 100_000, destSize: 0 }), "conflict");
  assert.equal(classifyDestMatch({ method: "standardize", sourceSize: 100_000, destSize: null }), "place");
  assert.equal(classifyDestMatch({ method: "copy", sourceSize: 100_000, destSize: 100_000 }), "duplicate");
});

test("plausibleSameSize tolerates metadata-sized differences", () => {
  assert.equal(plausibleSameSize(1024 * 1024, 1024 * 1024 + 4096), true);
  assert.equal(plausibleSameSize(1024 * 1024, 5 * 1024 * 1024), false);
});

test("snap output detection and XMP input parsing", () => {
  assert.equal(isSnapOutputName("2021-01-02-03-04-05-(Snap_2021-01-02-030405_group1).mp4"), true);
  assert.equal(isSnapOutputName("2021-01-02-03-04-05-(Snap_x_group1)-[a, b].mp4"), true);
  assert.equal(isSnapOutputName("2021-01-02-03-04-05-(IMG_1).jpg"), false);
  assert.deepEqual(parseSnapInputs('["a.mp4","b.mp4"]'), ["a.mp4", "b.mp4"]);
  assert.deepEqual(parseSnapInputs("a.mp4, b.mp4"), ["a.mp4", "b.mp4"]);
  assert.equal(parseSnapInputs(""), null);
  assert.equal(parseSnapInputs(undefined), null);
});
