import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Sandboxed state dir — set BEFORE importing the module so its module-level
// STATE_DIR / askpass paths point at the sandbox.
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'bctl-ui-'));
process.env.BACKUPCTL_STATE_DIR = path.join(SANDBOX, 'state');
process.env.BACKUPCTL_TMP_DIR = path.join(SANDBOX, 'tmp-root');

const bctl = await import('../server.mjs');

let chromium = null;
try {
  ({ chromium } = await import('playwright-core'));
} catch {
  chromium = null;
}

async function launchBrowser() {
  if (!chromium) return null;
  try {
    return await chromium.launch({ headless: true });
  } catch {
    return null;
  }
}

const writeConfig = (data) => {
  const p = path.join(SANDBOX, `ui-config-${Math.random().toString(36).slice(2)}.mjs`);
  fs.writeFileSync(p, `export default ${JSON.stringify(data)};`);
  return p;
};

test('ui: header, groups and task cards render on the shared kit', async () => {
  const browser = await launchBrowser();
  if (!browser) {
    test.skip('chromium not available (playwright browsers missing)');
    return;
  }
  try {
    const configPath = writeConfig({
      maindir: path.join(SANDBOX, 'ui-data'),
      groups: [{
        name: 'Everyday',
        tasks: [
          { name: 'Plain Task', state_dir: '{{maindir}}/State/plain', commands: 'true' },
          { name: 'Drop Task', state_dir: '{{maindir}}/State/drop', uploads: true, glob: '*.txt', commands: 'true' },
        ],
      }],
    });
    await bctl.boot(configPath);
    const app = bctl.createApp();
    const server = await new Promise((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
      const page = await browser.newPage();
      const errors = [];
      page.on('pageerror', (err) => errors.push(err.message));
      page.on('console', (msg) => {
        if (msg.type() === 'error') errors.push(msg.text());
      });
      await page.goto(base);
      await page.waitForSelector('[data-testid^="task-"]');
      assert.equal(await page.title(), 'D$CPLN ⋅ Task Runner');
      assert.match(await page.textContent('h1'), /Task Runner/);
      const names = await page.$$eval('[data-testid^="task-"] h2', (els) => els.map((e) => e.textContent));
      assert.deepEqual(names.sort(), ['Drop Task', 'Plain Task']);
      assert.equal(await page.locator('[data-testid="task-Drop Task"] input[type="file"]').count(), 1);
      assert.equal(await page.locator('#global-dropzone').count(), 1);
      assert.equal(await page.locator('[data-testid="task-Plain Task"] button', { hasText: 'Run' }).count(), 1);
      await page.click('#refreshButton');
      await page.waitForTimeout(300);
      assert.deepEqual(errors, []);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  } finally {
    await browser.close();
  }
});
