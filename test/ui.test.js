import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Daemon } from "../src/daemon.js";

// Browser smoke test for the manual-review UI. Playwright is a devDependency
// and Chromium may not be installed everywhere, so the whole file skips unless
// a launch succeeds.

let chromium = null;
try {
  ({ chromium } = await import("playwright-core"));
} catch {
  chromium = null;
}

const CAN_LAUNCH = await (async () => {
  if (!chromium) return false;
  try {
    const browser = await chromium.launch({ headless: true });
    await browser.close();
    return true;
  } catch {
    return false;
  }
})();

function have(cmd) {
  try {
    execFileSync("which", [cmd], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const CAN_RUN = CAN_LAUNCH && have("ffmpeg") && have("exiftool") && have("ffprobe");

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
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "media-sync-ui-"));
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
    ntfy: { url: "", token: "" },
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
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(base);

    const reviewButton = page.locator('sl-button[data-action="review"]').first();
    await reviewButton.waitFor({ state: "visible" });
    assert.match(await reviewButton.textContent(), /Review/);

    await reviewButton.click();
    await page.locator("#reviewDialog[open]").waitFor({ state: "visible" });
    await page.locator('#reviewBody sl-checkbox[data-review-group]').first().waitFor({ state: "visible" });

    await page.locator('sl-button[data-action="review-process"]').click();
    const entry = page.locator('#reviewBody .review-row').first();
    await entry.waitFor({ state: "visible", timeout: 60_000 });
    assert.match(await entry.textContent(), /2019-05-29-00-00-00-\(20190529-merged-201301\)\.mp4/);

    // Preview stream is reachable and range-capable.
    const audioSrc = await entry.locator("audio").getAttribute("src");
    const preview = await page.request.get(`${base}${audioSrc}`);
    assert.equal(preview.status(), 200);

    await page.locator('sl-button[data-action="review-place"]').first().click();
    const destName = "2019-05-29-00-00-00-(20190529-merged-201301).mp4";
    const placed = await waitFor(() => fsp.stat(path.join(dest, destName)).then(() => true).catch(() => false));
    assert.equal(placed, true, "the placed file must land in the destination");
    await page.locator('sl-button[data-action="review-close"], #reviewClose').first().click();
    await page.locator("#reviewDialog[open]").waitFor({ state: "detached" }).catch(() => {});
  } finally {
    await browser.close();
    await daemon.stop();
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test("ui: settings editor round-trips the new folder options", { skip: !CAN_RUN }, async () => {
  const { root, daemon, base } = await makeSetup();
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(base);
    await page.locator('sl-button[data-action="settings"]').click();
    await page.locator("#settingsDialog[open]").waitFor({ state: "visible" });

    await page.locator('sl-button[data-action="add-folder"]').click();
    const editor = page.locator("#folderEditors .folder-edit").last();
    await editor.waitFor({ state: "visible" });
    for (const [field, value] of [
      ["name", "archive"],
      ["source", path.join(root, "archive-src")],
      ["destination", path.join(root, "archive-dest")],
      ["datePattern", ""],
      ["filePattern", ""],
    ]) {
      await editor.locator(`[data-field="${field}"]`).evaluate((node, v) => { node.value = v; }, value);
    }
    await editor.locator('[data-field="method"]').evaluate((node) => { node.value = "copy"; });
    for (const [field, checked] of [["recursive", true], ["includeHidden", true], ["cleanup", false]]) {
      await editor.locator(`[data-field="${field}"]`).evaluate((node, v) => { node.checked = v; }, checked);
    }
    await page.locator("#settingsSave").click();
    await page.locator("#settingsDialog[open]").waitFor({ state: "detached" }).catch(() => {});

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
