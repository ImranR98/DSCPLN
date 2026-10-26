import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launchBrowser } from '@dscpln/test-kit';

// Sandboxed state dir — set BEFORE importing the module so its module-level
// STATE_DIR / askpass paths point at the sandbox.
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'bctl-ui-'));
process.env.BACKUPCTL_STATE_DIR = path.join(SANDBOX, 'state');
process.env.BACKUPCTL_TMP_DIR = path.join(SANDBOX, 'tmp-root');

const bctl = await import('../server.mjs');


const writeConfig = (data) => {
  const dir = fs.mkdtempSync(path.join(SANDBOX, 'ui-cfg-'));
  const p = path.join(dir, 'config.mjs');
  fs.writeFileSync(p, `export default ${JSON.stringify(data)};`);
  return p;
};

const writeMeta = (configPath, meta) => {
  fs.writeFileSync(path.join(path.dirname(configPath), 'task-meta.json'), JSON.stringify(meta, null, 2));
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
    writeMeta(configPath, {
      version: 1,
      attributes: [
        { name: 'Category', values: ['Everyday'] },
        { name: 'Best run from', values: ['Phone', 'PC'] },
      ],
      default_group_by: 'Best run from',
      tasks: {
        'Plain Task': { attributes: { Category: 'Everyday', 'Best run from': 'PC' } },
        'Drop Task': { attributes: { Category: 'Everyday', 'Best run from': 'Phone' } },
      },
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
      assert.equal(await page.locator('[data-testid="group-Phone"]').count(), 1);
      assert.equal(await page.locator('[data-testid="task-Plain Task"] [data-attribute="Category"]').count(), 1);
      await page.selectOption('[data-testid="group-by"]', 'Category');
      await page.waitForTimeout(100);
      assert.equal(await page.locator('[data-testid="group-Everyday"]').count(), 1);
      await page.locator('[data-testid="task-Plain Task"] button', { hasText: 'Settings' }).click();
      await page.waitForSelector('dialog[open]');
      assert.match(await page.textContent('dialog[open] h2'), /Settings: Plain Task/);
      await page.locator('dialog[open] button', { hasText: 'Cancel' }).click();
      await page.waitForTimeout(100);
      await page.click('[data-testid="manage-attributes"]');
      await page.waitForSelector('dialog[open]');
      assert.match(await page.textContent('dialog[open] h2'), /Manage attributes/);
      await page.locator('dialog[open] button', { hasText: 'Cancel' }).click();
      await page.click('#refreshButton');
      await page.waitForTimeout(300);

      // The global drop zone queues and runs in one flow. The detected batch
      // must be passed straight into the run instead of reading stale state.
      const uploadRequest = page.waitForRequest((request) =>
        request.method() === 'POST' && request.url().includes('/api/upload/Drop%20Task')
      );
      const runRequest = page.waitForRequest((request) =>
        request.method() === 'POST' && request.url().includes('/api/run/Drop%20Task')
      );
      await page.setInputFiles('#global-dropzone input[type="file"]', {
        name: 'a.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('hello'),
      });
      await page.waitForSelector('dialog[open]');
      await page.locator('dialog[open] button', { hasText: 'Run' }).click();
      await uploadRequest;
      await runRequest;
      assert.deepEqual(errors, []);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  } finally {
    await browser.close();
  }
});
