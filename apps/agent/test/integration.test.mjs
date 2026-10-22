import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createAgentServer } from '../server.mjs';
import { loadConfig } from '../config.mjs';
import { runWebhook } from '../../task-runner/webhook.mjs';

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dscpln-agent-webhook-'));
}

test('webhook auto-generates a token, enrolls it, and downloads an archive', async () => {
  const root = tempRoot();
  const data = path.join(root, 'data');
  fs.mkdirSync(data, { recursive: true });
  fs.writeFileSync(path.join(data, 'save.txt'), 'save-data');
  const configFile = path.join(root, 'agent.json');
  fs.writeFileSync(configFile, JSON.stringify({
    stateDir: path.join(root, 'state'),
    enrollment: { allowFrom: ['127.0.0.1/32'], windowSeconds: 60 },
    jobs: {
      saves: {
        type: 'archive',
        root: data,
        exclude: ['**/*.log'],
      },
    },
  }));
  const config = loadConfig(configFile);
  const server = createAgentServer(config);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const tokenFile = path.join(root, 'agent.token');
  const archiveFile = path.join(root, 'download.tar.gz');
  const logs = [];
  try {
    const webhook = {
      url: `${base}/v1/jobs/saves/archive`,
      method: 'POST',
      headers: {},
      enrollUrl: `${base}/v1/enroll`,
      tokenFile,
      downloadTo: archiveFile,
      timeoutMs: 10_000,
      expectStatus: [200],
    };
    const result = await runWebhook({
      webhook,
      local: {},
      log: (line) => logs.push(line),
      redact: [],
      cwd: root,
    });
    assert.equal(result.ok, true, result.summary);
    assert.equal(fs.existsSync(tokenFile), true);
    assert.equal(fs.statSync(tokenFile).mode & 0o777, 0o600);
    const token = fs.readFileSync(tokenFile, 'utf8').trim();
    assert.ok(token.length >= 32);
    assert.equal(logs.some((line) => line.includes(token)), false);

    const extracted = path.join(root, 'extracted');
    fs.mkdirSync(extracted);
    const tar = spawnSync('tar', ['-xzf', archiveFile, '-C', extracted], { encoding: 'utf8' });
    assert.equal(tar.status, 0, tar.stderr);
    assert.equal(fs.readFileSync(path.join(extracted, 'save.txt'), 'utf8'), 'save-data');

    // Enrollment is idempotent on later runs with the same token.
    const again = await runWebhook({
      webhook,
      local: {},
      log: (line) => logs.push(line),
      redact: [],
      cwd: root,
    });
    assert.equal(again.ok, true, again.summary);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  }
});
