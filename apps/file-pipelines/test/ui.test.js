import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { browserAvailable, have, launchBrowser } from "@dscpln/test-kit";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Daemon } from "../src/daemon.js";

// Browser smoke test for the manual-review UI. Playwright is a devDependency
// and Chromium may not be installed everywhere, so the whole file skips unless
// a launch succeeds.

const CAN_RUN = (await browserAvailable()) && have("ffmpeg") && have("exiftool") && have("ffprobe");

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitFor(fn, timeoutMs = 30_000, intervalMs = 200) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await fn()) return true;
    await sleep(intervalMs);
  }
  return false;
}

async function makeSetup({ datePattern = "(\\d{4})-(\\d{2})-(\\d{2})", clips = 1 } = {}) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "file-pipelines-ui-"));
  const src = path.join(root, "src");
  const dest = path.join(root, "dest");
  await fsp.mkdir(path.join(src, "201301"), { recursive: true });
  await fsp.mkdir(dest, { recursive: true });
  for (let index = 1; index <= clips; index += 1) {
    execFileSync("ffmpeg", [
      "-loglevel", "error", "-y",
      "-f", "lavfi", "-i", "sine=frequency=440:duration=0.5",
      "-c:a", "libopus", path.join(src, "201301", `voice 2019-05-29 take${index}.opus`),
    ]);
  }
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
    maxAutoRetries: 3,
    stagingDir: path.join(root, "staging"),
    reviewDir: path.join(root, "review"),
    trashDir: path.join(root, "trash"),
    logDir: path.join(root, "logs"),
    syncLockFile: path.join(root, "lock.json"),
    lockHeartbeatSeconds: 60,
    lockStaleSeconds: 120,
    notifySuccess: true,
    folders: [
      {
        name: "reviewed-audio",
        source: src,
        destination: dest,
        method: "reviewed-audio",
        ...(datePattern ? { datePattern } : {}),
        placement: "manual",
        settleSeconds: 0,
      },
    ],
  };
  await fsp.writeFile(configPath, JSON.stringify(config, null, 2));
  const daemon = new Daemon(configPath, {});
  await daemon.start();
  const port = daemon.api.server.address().port;
  return { root, daemon, dest, base: `http://127.0.0.1:${port}` };
}

test("ui: review a reviewed-audio group and merge it into the destination", { skip: !CAN_RUN }, async () => {
  const { root, daemon, dest, base } = await makeSetup({ clips: 2 });
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.goto(base);

    const card = page.locator(".folder-card", { hasText: "reviewed-audio" }).first();
    const reviewButton = card.getByRole("button", { name: /^Review/ });
    await reviewButton.waitFor({ state: "visible" });
    await reviewButton.click();

    const dialog = page.locator('[data-testid="review-dialog"]');
    const group = dialog.locator('[data-testid="review-group-reviewed-audio-20190529"]');
    await group.waitFor({ state: "visible", timeout: 30_000 });
    assert.match(await group.textContent(), /201301 · 20190529/);
    assert.match(await dialog.getByTestId("review-approve-all").textContent(), /Merge & move all \(1\)/);
    assert.equal(await group.locator("audio").count(), 2, "each clip in a group gets an audio player");
    assert.match(await group.locator("audio").first().getAttribute("src"), /review\/audio\/reviewed-audio\//);
    await group.getByRole("button", { name: "Merge & move" }).click();

    const destName = "2019-05-29-00-00-00-(20190529-merged-201301).mp4";
    const placed = await waitFor(() => fsp.stat(path.join(dest, destName)).then(() => true).catch(() => false));
    assert.equal(placed, true, "the approved merge must land in the destination");
  } finally {
    await browser.close();
    await daemon.stop();
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("ui: per-file reviewed-audio review standardizes and moves one file", { skip: !CAN_RUN }, async () => {
  const { root, daemon, dest, base } = await makeSetup({ datePattern: null });
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.goto(base);
    const card = page.locator(".folder-card", { hasText: "reviewed-audio" }).first();
    await card.getByRole("button", { name: /^Review/ }).click();
    const dialog = page.locator('[data-testid="review-dialog"]');
    const row = dialog.locator(".review-row", { hasText: "voice 2019-05-29 take1.opus" }).first();
    await row.waitFor({ state: "visible", timeout: 30_000 });
    assert.equal(await row.locator("audio").count(), 1, "per-file review gets an audio player");
    assert.match(await row.locator("audio").getAttribute("src"), /review\/audio\/reviewed-audio\//);
    await row.getByRole("button", { name: "Standardize & move" }).click();

    const placed = await waitFor(async () => (await fsp.readdir(dest)).length === 1);
    assert.equal(placed, true, "the standardized file must land in the destination");
    assert.deepEqual(await fsp.readdir(path.join(root, "src", "201301")), []);
  } finally {
    await browser.close();
    await daemon.stop();
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("ui: standardize and move all reviewed-audio files asks for confirmation", { skip: !CAN_RUN }, async () => {
  const { root, daemon, dest, base } = await makeSetup({ datePattern: null, clips: 2 });
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.goto(base);
    const card = page.locator(".folder-card", { hasText: "reviewed-audio" }).first();
    await card.getByRole("button", { name: /^Review/ }).click();
    const dialog = page.locator('[data-testid="review-dialog"]');
    const approveAll = dialog.getByTestId("review-approve-all");
    await approveAll.waitFor({ state: "visible", timeout: 30_000 });
    assert.match(await approveAll.textContent(), /Standardize & move all \(2\)/);
    await approveAll.click();

    const confirm = page.locator('[data-testid="confirm-dialog"]');
    await confirm.waitFor({ state: "visible" });
    assert.match(await confirm.textContent(), /Standardize and move all 2 files/);
    await confirm.getByRole("button", { name: "Standardize & move all" }).click();

    const moved = await waitFor(async () => (await fsp.readdir(dest)).length === 2);
    assert.equal(moved, true, "both files must land in the destination");
    assert.deepEqual(await fsp.readdir(path.join(root, "src", "201301")), []);
  } finally {
    await browser.close();
    await daemon.stop();
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("ui: delete all reviewed-audio files asks for confirmation", { skip: !CAN_RUN }, async () => {
  const { root, daemon, dest, base } = await makeSetup({ datePattern: null, clips: 2 });
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.goto(base);
    const card = page.locator(".folder-card", { hasText: "reviewed-audio" }).first();
    await card.getByRole("button", { name: /^Review/ }).click();
    const dialog = page.locator('[data-testid="review-dialog"]');
    const deleteAll = dialog.getByTestId("review-delete-all");
    await deleteAll.waitFor({ state: "visible", timeout: 30_000 });
    assert.match(await deleteAll.textContent(), /Delete all \(2\)/);
    await deleteAll.click();

    const confirm = page.locator('[data-testid="confirm-dialog"]');
    await confirm.waitFor({ state: "visible" });
    assert.match(await confirm.textContent(), /Move 2 source files from 2 reviewed audio items to trash/);
    await confirm.getByRole("button", { name: "Delete all" }).click();

    const deleted = await waitFor(async () => {
      const files = await fsp.readdir(path.join(root, "src", "201301"));
      const review = await (await fetch(`${base}/api/review`)).json();
      return files.length === 0 && review.reviewedAudio.length === 0;
    });
    assert.equal(deleted, true, "all source files must be moved to trash");
    assert.deepEqual(await fsp.readdir(dest), []);
  } finally {
    await browser.close();
    await daemon.stop();
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("ui: settings editor round-trips the new folder options", { skip: !CAN_RUN }, async () => {
  const { root, daemon, base } = await makeSetup();
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.goto(base);
    await page.locator('[title="Settings"]').click();
    const dialog = page.locator('[data-testid="settings-dialog"]');
    await dialog.waitFor({ state: "visible" });

    await dialog.getByRole("button", { name: "Add folder" }).click();
    const editor = dialog.locator(".folder-edit").last();
    await editor.waitFor({ state: "visible" });
    const setField = async (label, value) => {
      const row = editor.locator(".field", { hasText: label }).first();
      const input = row.locator("input, select").first();
      if ((await input.evaluate((el) => el.tagName)) === "SELECT") await input.selectOption(value);
      else await input.fill(value);
    };
    await setField("Name", "archive");
    await setField("Source", path.join(root, "archive-src"));
    await setField("Destination", path.join(root, "archive-dest"));
    await setField("Method", "copy");
    await editor.locator("label", { hasText: "Recursive (" }).locator("input[type=checkbox]").check();
    await editor.locator("label", { hasText: "Include hidden" }).locator("input[type=checkbox]").check();
    await editor.locator("label", { hasText: "Allow cleanup" }).locator("input[type=checkbox]").uncheck();
    await dialog.getByRole("button", { name: "Save" }).click();
    await dialog.waitFor({ state: "detached" }).catch(() => {});

    const saved = await (await fetch(`${base}/api/config`)).json();
    const archive = saved.folders.find((folder) => folder.name === "archive");
    assert.ok(archive, `archive folder must be saved: ${JSON.stringify(saved.folders.map((f) => f.name))}`);
    assert.equal(archive.method, "copy");
    assert.equal(archive.recursive, true);
    assert.equal(archive.includeHidden, true);
    assert.equal(archive.cleanup, false);
    assert.equal(archive.onChanged, "overwrite");
  } finally {
    await browser.close();
    await daemon.stop();
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("ui: delete requires confirmation and moves the source clips to trash", { skip: !CAN_RUN }, async () => {
  const { root, daemon, dest, base } = await makeSetup();
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.goto(base);
    const card = page.locator(".folder-card", { hasText: "reviewed-audio" }).first();
    await card.getByRole("button", { name: /^Review/ }).click();
    const dialog = page.locator('[data-testid="review-dialog"]');
    const group = dialog.locator('[data-testid="review-group-reviewed-audio-20190529"]');
    await group.waitFor({ state: "visible", timeout: 30_000 });

    await group.getByRole("button", { name: "Delete" }).click();
    const confirm = page.locator('[data-testid="confirm-dialog"]');
    await confirm.waitFor({ state: "visible" });
    await confirm.getByRole("button", { name: "Delete" }).click();

    const gone = await waitFor(async () => {
      const files = await fsp.readdir(path.join(root, "src", "201301"));
      const review = await (await fetch(`${base}/api/review`)).json();
      return files.length === 0 && review.reviewedAudio.length === 0;
    });
    assert.equal(gone, true, "the source clips must be moved to trash");
    assert.deepEqual(await fsp.readdir(dest), [], "delete must never write to the destination");
  } finally {
    await browser.close();
    await daemon.stop();
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("ui: archive folders (cleanup disabled) expose no Cleanup button", { skip: !CAN_RUN }, async () => {
  const { root, daemon, base } = await makeSetup();
  const browser = await launchBrowser();
  try {
    const config = await (await fetch(`${base}/api/config`)).json();
    config.reviewDir = path.join(root, "review");
    config.folders.push({
      name: "archive",
      source: path.join(root, "archive-src"),
      destination: path.join(root, "archive-dest"),
      method: "copy",
      recursive: true,
      includeHidden: true,
      cleanup: false,
      settleSeconds: 0,
    });
    await fsp.mkdir(path.join(root, "archive-src"), { recursive: true });
    const saved = await fetch(`${base}/api/config`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(config),
    });
    assert.equal(saved.ok, true);

    const page = await browser.newPage();
    await page.goto(base);
    const archiveCard = page.locator(".folder-card", { hasText: "archive" }).first();
    await archiveCard.waitFor({ state: "visible" });
    assert.equal(await archiveCard.getByRole("button", { name: /Cleanup/ }).count(), 0, "cleanup must be hidden for cleanup:false folders");
    const reviewedAudioCard = page.locator(".folder-card", { hasText: "reviewed-audio" }).first();
    assert.equal(await reviewedAudioCard.getByRole("button", { name: /^Review/ }).count(), 1, "manual folders expose Review");
  } finally {
    await browser.close();
    await daemon.stop();
    await fsp.rm(root, { recursive: true, force: true });
  }
});
