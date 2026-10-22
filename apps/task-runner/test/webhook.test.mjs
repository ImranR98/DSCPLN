import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from '../config-loader.mjs';
import { ensureTokenFile, runWebhook } from '../webhook.mjs';

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dscpln-webhook-'));
}

async function localServer(handler) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    base: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

test('webhook auto-generates a token and sends it in the Authorization header', async () => {
  const root = tempRoot();
  let authorization = '';
  let body = '';
  const server = await localServer((req, res) => {
    authorization = req.headers.authorization ?? '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ summary: 'webhook-ok', received: body }));
    });
  });
  const tokenFile = path.join(root, 'token');
  const logs = [];
  try {
    const result = await runWebhook({
      webhook: {
        url: `${server.base}/hook`,
        method: 'POST',
        headers: {},
        body: { hello: 'world' },
        tokenFile,
        timeoutMs: 10_000,
      },
      local: {},
      log: (line) => logs.push(line),
      redact: [],
      cwd: root,
    });
    assert.equal(result.ok, true, result.summary);
    assert.equal(result.summary, 'webhook-ok');
    const token = fs.readFileSync(tokenFile, 'utf8').trim();
    assert.equal(authorization, `Bearer ${token}`);
    assert.deepEqual(JSON.parse(body), { hello: 'world' });
    assert.equal(logs.some((line) => line.includes(token)), false);
    assert.equal(fs.statSync(tokenFile).mode & 0o777, 0o600);
  } finally {
    await server.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('webhook downloads a binary response', async () => {
  const root = tempRoot();
  const payload = Buffer.from('binary-payload');
  const server = await localServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/gzip' });
    res.end(payload);
  });
  const destination = path.join(root, 'artifact.bin');
  try {
    const result = await runWebhook({
      webhook: {
        url: `${server.base}/artifact`,
        method: 'POST',
        headers: {},
        downloadTo: destination,
        timeoutMs: 10_000,
      },
      local: {},
      log: () => {},
      redact: [],
      cwd: root,
    });
    assert.equal(result.ok, true, result.summary);
    assert.deepEqual(fs.readFileSync(destination), payload);
    assert.equal(fs.readFileSync(destination).length, payload.length);
  } finally {
    await server.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('ensureTokenFile reuses an existing token', () => {
  const root = tempRoot();
  try {
    const file = path.join(root, 'nested', 'token');
    const first = ensureTokenFile(file);
    const second = ensureTokenFile(file);
    assert.equal(first.generated, true);
    assert.equal(second.generated, false);
    assert.equal(first.token, second.token);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('config loader accepts webhook tasks and rejects webhook+script', async () => {
  const root = tempRoot();
  try {
    const file = path.join(root, 'config.mjs');
    fs.writeFileSync(file, `
      export default {
        groups: [{
          name: 'Remote',
          tasks: [{
            name: 'Remote archive',
            state_dir: '${root.replaceAll("'", "\\'")}',
            webhook: {
              url: 'https://agent.example/v1/jobs/example/archive',
              enrollUrl: 'https://agent.example/v1/enroll',
              tokenFile: '${path.join(root, 'token').replaceAll("'", "\\'")}',
              downloadTo: '${path.join(root, 'out.tar.gz').replaceAll("'", "\\'")}',
            },
          }],
        }],
      };
    `);
    const [, tasks] = await loadConfig(file);
    assert.equal(tasks[0].webhook.url, 'https://agent.example/v1/jobs/example/archive');
    assert.deepEqual(tasks[0].commands, []);

    const bad = path.join(root, 'bad.mjs');
    fs.writeFileSync(bad, `
      export default {
        groups: [{
          name: 'Remote',
          tasks: [{
            name: 'Bad',
            state_dir: '${root.replaceAll("'", "\\'")}',
            script: 'true',
            webhook: { url: 'https://agent.example/v1/jobs/example/archive' },
          }],
        }],
      };
    `);
    await assert.rejects(() => loadConfig(bad), /cannot be combined/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
