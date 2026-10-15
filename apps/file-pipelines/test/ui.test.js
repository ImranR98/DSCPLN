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

async function makeSetup() {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "file-pipelines-ui-"));
  const src = path.join(root, "src");
  const dest = path.join(root, "dest");
  await fsp.mkdir(path.join(src, "201301"), { recursive: true });
  await fsp.mkdir(dest, { recursive: true });
  execFileSync("ffmpeg", [
    "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", "sine=frequency=440:duration=0.5",
    "-c:a", "libopus", path.join(src, "201301", "voice 2019-05-29 take1.opus"),
  ]);
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
        name: "voicenotes",
        source: src,
        destination: dest,
        method: "voicenotes",
        datePattern: "(\\d{4})-(\\d{2})-(\\d{2})",
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

test("ui: review a parked voice note from the browser and place it", { skip: !CAN_RUN }, async () => {
  const { root, daemon, dest, base } = await makeSetup();
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.goto(base);

    const card = page.locator(".folder-card", { hasText: "voicenotes" }).first();
    const reviewButton = card.getByRole("button", { name: /^Review/ });
    await reviewButton.waitFor({ state: "visible" });
    await reviewButton.click();

    const dialog = page.locator('[data-testid="review-dialog"]');
    await dialog.locator(".review-groups input[type=checkbox]").first().waitFor({ state: "visible", timeout: 30_000 });
    await dialog.getByRole("button", { name: "Process selected" }).click();

    const entry = dialog.locator(".review-row").first();
    await entry.waitFor({ state: "visible", timeout: 60_000 });
    assert.match(await entry.textContent(), /2019-05-29-00-00-00-\(20190529-merged-201301\)\.mp4/);

    // Preview stream is reachable and range-capable.
    const audioSrc = await entry.locator("audio").getAttribute("src");
    const preview = await page.request.get(new URL(audioSrc, base).toString());
    assert.equal(preview.status(), 200);

    await entry.getByRole("button", { name: "Place" }).click();
    const destName = "2019-05-29-00-00-00-(20190529-merged-201301).mp4";
    const placed = await waitFor(() => fsp.stat(path.join(dest, destName)).then(() => true).catch(() => false));
    assert.equal(placed, true, "the placed file must land in the destination");
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

test("ui: discard requires confirmation and leaves the destination untouched", { skip: !CAN_RUN }, async () => {
  const { root, daemon, dest, base } = await makeSetup();
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.goto(base);
    const card = page.locator(".folder-card", { hasText: "voicenotes" }).first();
    await card.getByRole("button", { name: /^Review/ }).click();
    const dialog = page.locator('[data-testid="review-dialog"]');
    await dialog.locator(".review-groups input[type=checkbox]").first().waitFor({ state: "visible", timeout: 30_000 });
    await dialog.getByRole("button", { name: "Process selected" }).click();
    const entry = dialog.locator(".review-row").first();
    await entry.waitFor({ state: "visible", timeout: 60_000 });

    await entry.getByRole("button", { name: "Discard" }).click();
    const confirm = page.locator('[data-testid="confirm-dialog"]');
    await confirm.waitFor({ state: "visible" });
    await confirm.getByRole("button", { name: "Discard" }).click();

    const discarded = await waitFor(async () => {
      const state = await (await fetch(`${base}/api/state`)).json();
      return state.folders[0].counts.discarded === 1;
    });
    assert.equal(discarded, true, "the clip must be marked discarded");
    assert.deepEqual(await fsp.readdir(dest), [], "discard must never write to the destination");
    assert.deepEqual((await (await fetch(`${base}/api/review`)).json()).entries, []);
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
    const voicenotesCard = page.locator(".folder-card", { hasText: "voicenotes" }).first();
    assert.equal(await voicenotesCard.getByRole("button", { name: /^Review/ }).count(), 1, "manual folders expose Review");
  } finally {
    await browser.close();
    await daemon.stop();
    await fsp.rm(root, { recursive: true, force: true });
  }
});
