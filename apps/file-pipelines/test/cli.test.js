import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { standardNameFor } from "../src/exif.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(HERE, "..", "bin", "file-pipelines.js");

function have(cmd) {
  try {
    execFileSync("which", [cmd], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const CAN_RUN = have("ffmpeg") && have("exiftool");

test("cli clean-synced verifies the standardized destination name before removing", { skip: !CAN_RUN }, async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "file-pipelines-cli-"));
  const src = path.join(root, "src");
  const dest = path.join(root, "dest");
  const trash = path.join(root, "trash");
  await fsp.mkdir(src, { recursive: true });
  await fsp.mkdir(dest, { recursive: true });
  try {
    const source = path.join(src, "dated.jpg");
    execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-f", "lavfi", "-i", "color=c=red:s=32x32:d=1", "-frames:v", "1", source]);
    execFileSync("exiftool", ["-m", "-q", "-overwrite_original", "-DateTimeOriginal=2019:04:02 10:20:30", source]);
    const expected = standardNameFor("dated.jpg", "2019:04:02 10:20:30");
    await fsp.copyFile(source, path.join(dest, expected));

    const out = execFileSync("node", [CLI, "clean-synced", "--trash", trash, src, dest], { encoding: "utf8" });
    assert.match(out, /Removed: dated\.jpg/);
    assert.deepEqual(await fsp.readdir(src), []);
    const days = await fsp.readdir(trash);
    assert.deepEqual(await fsp.readdir(path.join(trash, days[0])), ["dated.jpg"]);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("cli clean-synced leaves sources alone when the destination name does not match", { skip: !CAN_RUN }, async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "file-pipelines-cli2-"));
  const src = path.join(root, "src");
  const dest = path.join(root, "dest");
  const trash = path.join(root, "trash");
  await fsp.mkdir(src, { recursive: true });
  await fsp.mkdir(dest, { recursive: true });
  try {
    const source = path.join(src, "dated.jpg");
    execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-f", "lavfi", "-i", "color=c=red:s=32x32:d=1", "-frames:v", "1", source]);
    execFileSync("exiftool", ["-m", "-q", "-overwrite_original", "-DateTimeOriginal=2019:04:02 10:20:30", source]);
    await fsp.copyFile(source, path.join(dest, "2000-01-01-00-00-00-(dated).jpg"));

    const out = execFileSync("node", [CLI, "clean-synced", "--trash", trash, src, dest], { encoding: "utf8" });
    assert.match(out, /Not synced: dated\.jpg/);
    assert.deepEqual(await fsp.readdir(src), ["dated.jpg"]);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});
