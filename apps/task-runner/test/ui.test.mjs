import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
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

      // The per-card picker clears its input immediately after selection.
      // Snapshot the FileList first so the queue is not left empty.
      await page.setInputFiles('[data-testid="task-Drop Task"] input[type="file"]', {
        name: 'card.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('hello from the card'),
      });
      await page.waitForFunction(() =>
        [...document.querySelectorAll('[data-testid="task-Drop Task"] .queue-name')]
          .some((node) => node.textContent === 'card.txt'))
      assert.deepEqual(errors, []);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  } finally {
    await browser.close();
  }
});

test('ui: archives with client_prune upload only the retained files', async () => {
  const browser = await launchBrowser();
  if (!browser) {
    test.skip('chromium not available (playwright browsers missing)');
    return;
  }
  try {
    const work = fs.mkdtempSync(path.join(SANDBOX, 'prune-ui-'));
    const src = path.join(work, 'src');
    fs.mkdirSync(path.join(src, 'big'), { recursive: true });
    fs.writeFileSync(path.join(src, 'users_000001.json'), '[]\n');
    fs.writeFileSync(path.join(src, 'big', 'blob.bin'), crypto.randomBytes(2 * 1024 * 1024));
    const archive = path.join(work, 'github-export.tar.gz');
    execFileSync('tar', ['-czf', archive, '-C', src, '.']);
    const source = fs.readFileSync(archive);

    const configPath = writeConfig({
      maindir: path.join(SANDBOX, 'prune-data'),
      groups: [{
        name: 'Everyday',
        tasks: [{
          name: 'Prune Task',
          state_dir: '{{maindir}}/State/prune',
          uploads: true,
          glob: '*.tar.gz',
          client_prune: ['big'],
          commands: 'true',
        }],
      }],
    });
    await bctl.boot(configPath);
    const app = bctl.createApp();
    const server = await new Promise((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    const uploadSizes = [];
    server.on('request', (req) => {
      if (req.method === 'POST' && req.url.includes('/api/upload/Prune%20Task')) {
        uploadSizes.push(Number(req.headers['content-length']));
      }
    });
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
      const page = await browser.newPage();
      await page.goto(base);
      await page.waitForSelector('[data-testid="task-Prune Task"]');
      await page.setInputFiles('[data-testid="task-Prune Task"] input[type="file"]', {
        name: 'github-export.tar.gz',
        mimeType: 'application/gzip',
        buffer: source,
      });
      await page.waitForFunction(() =>
        document.querySelector('[data-testid="task-Prune Task"] .queue-name')?.textContent === 'github-export.tar.gz');

      const upload = page.waitForRequest((request) =>
        request.method() === 'POST' && request.url().includes('/api/upload/Prune%20Task'));
      const run = page.waitForRequest((request) =>
        request.method() === 'POST' && request.url().includes('/api/run/Prune%20Task'));
      await page.locator('[data-testid="task-Prune Task"] button', { hasText: 'Run' }).click();
      await upload;
      await run;
      assert.equal(uploadSizes.length, 1);
      assert.ok(uploadSizes[0] > 0, 'upload did not send a content length');
      assert.ok(uploadSizes[0] < source.length / 4, `${uploadSizes[0]} vs ${source.length}`);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  } finally {
    await browser.close();
  }
});

test('ui: long chips and filenames do not widen mobile cards', async () => {
  const browser = await launchBrowser();
  if (!browser) {
    test.skip('chromium not available (playwright browsers missing)');
    return;
  }
  try {
    const longValue = 'Anywhere (manual, but only when the desktop is awake and on the same network)';
    const longName = `drop_${'x'.repeat(180)}.txt`;
    const configPath = writeConfig({
      maindir: path.join(SANDBOX, 'mobile-data'),
      groups: [{
        name: 'Everyday',
        tasks: [
          { name: 'Long Drop Task', state_dir: '{{maindir}}/State/long', uploads: true, glob: '*.txt', commands: 'true' },
        ],
      }],
    });
    writeMeta(configPath, {
      version: 1,
      attributes: [
        { name: 'Category', values: ['Everyday'] },
        { name: 'Best run from', values: [longValue] },
      ],
      default_group_by: 'Best run from',
      tasks: {
        'Long Drop Task': { attributes: { Category: 'Everyday', 'Best run from': longValue } },
      },
    });
    await bctl.boot(configPath);
    const app = bctl.createApp();
    const server = await new Promise((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
      await page.goto(base);
      await page.waitForSelector('[data-testid="task-Long Drop Task"]');

      const layout = () => page.evaluate(() => {
        const vw = document.documentElement.clientWidth;
        const overflowing = [...document.querySelectorAll('body *')]
          .filter((el) => el.getBoundingClientRect().right > vw + 0.5)
          .map((el) => el.className?.toString() || el.tagName);
        return { vw, scrollWidth: document.documentElement.scrollWidth, overflowing };
      });
      assert.deepEqual(await layout(), { vw: 390, scrollWidth: 390, overflowing: [] });

      await page.setInputFiles('[data-testid="task-Long Drop Task"] input[type="file"]', {
        name: longName,
        mimeType: 'text/plain',
        buffer: Buffer.from('hello'),
      });
      await page.waitForFunction((name) =>
        document.querySelector('[data-testid="task-Long Drop Task"] .queue-name')?.textContent === name, longName);
      assert.deepEqual(await layout(), { vw: 390, scrollWidth: 390, overflowing: [] });

      // Toasts are viewport-fixed; a card must never push them below or
      // beside the visible area on a phone.
      await page.evaluate(() => {
        const toast = document.createElement('div');
        toast.className = 'toast toast--error';
        toast.textContent = 'A long error message that still has to stay inside the phone viewport.';
        document.querySelector('.toasts').appendChild(toast);
      });
      const toast = await page.locator('.toast').boundingBox();
      assert.ok(toast.x >= 0 && toast.x + toast.width <= 390, JSON.stringify(toast));
      assert.ok(toast.y >= 0 && toast.y + toast.height <= 844, JSON.stringify(toast));
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  } finally {
    await browser.close();
  }
});
