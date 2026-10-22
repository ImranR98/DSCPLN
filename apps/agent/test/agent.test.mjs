import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createAgentServer } from '../server.mjs';
import { loadConfig } from '../config.mjs';
import { tokenHashFile } from '../auth.mjs';

const TOKEN = 'test-token-0123456789abcdefghijklmnopqrstuvwxyz';

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dscpln-agent-'));
}

function writeConfig(root, overrides = {}) {
  const file = path.join(root, 'agent.json');
  const config = {
    stateDir: path.join(root, 'state'),
    enrollment: { allowFrom: ['127.0.0.1/32'], windowSeconds: 60 },
    jobs: {
      example: {
        type: 'archive',
        root: path.join(root, 'data'),
        exclude: ['**/*.log'],
      },
    },
    ...overrides,
  };
  fs.writeFileSync(file, JSON.stringify(config));
  return { file, config };
}

async function startServer(config) {
  const server = createAgentServer(config);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    base,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

function post(base, pathname, token, init = {}) {
  return fetch(`${base}${pathname}`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    ...init,
  });
}

test('agent enrolls a client token and archives only the configured root', async () => {
  const root = tempRoot();
  const data = path.join(root, 'data');
  fs.mkdirSync(path.join(data, 'sub'), { recursive: true });
  fs.writeFileSync(path.join(data, 'a.txt'), 'alpha');
  fs.writeFileSync(path.join(data, 'sub', 'b.txt'), 'beta');
  fs.writeFileSync(path.join(data, 'ignored.log'), 'nope');
  const { file, config } = writeConfig(root);
  const loaded = loadConfig(file);
  const { base, close } = await startServer(loaded);
  try {
    assert.equal((await fetch(`${base}/healthz`)).status, 200);

    assert.equal((await post(base, '/v1/jobs/example/archive', TOKEN)).status, 401);
    assert.equal((await post(base, '/v1/enroll', TOKEN)).status, 204);

    const hashFile = tokenHashFile(config.stateDir);
    assert.equal(fs.existsSync(hashFile), true);
    assert.equal(fs.statSync(hashFile).mode & 0o777, 0o600);
    assert.notEqual(fs.readFileSync(hashFile, 'utf8').trim(), TOKEN);

    const response = await post(base, '/v1/jobs/example/archive', TOKEN);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /application\/gzip/);
    assert.match(response.headers.get('x-dscpln-sha256'), /^[0-9a-f]{64}$/);
    const archive = path.join(root, 'out.tar.gz');
    fs.writeFileSync(archive, Buffer.from(await response.arrayBuffer()));
    const extracted = path.join(root, 'extracted');
    fs.mkdirSync(extracted);
    const tar = spawnSync('tar', ['-xzf', archive, '-C', extracted], { encoding: 'utf8' });
    assert.equal(tar.status, 0, tar.stderr);
    assert.equal(fs.readFileSync(path.join(extracted, 'a.txt'), 'utf8'), 'alpha');
    assert.equal(fs.readFileSync(path.join(extracted, 'sub', 'b.txt'), 'utf8'), 'beta');
    assert.equal(fs.existsSync(path.join(extracted, 'ignored.log')), false);

    assert.equal((await post(base, '/v1/jobs/example/archive', 'wrong-token-0123456789abcdefghijklmnopqrstuvwxyz')).status, 401);
    assert.equal((await post(base, '/v1/jobs/nope/archive', TOKEN)).status, 404);
  } finally {
    await close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('agent refuses enrollment from a source outside allowFrom', async () => {
  const root = tempRoot();
  const data = path.join(root, 'data');
  fs.mkdirSync(data, { recursive: true });
  fs.writeFileSync(path.join(data, 'a.txt'), 'alpha');
  const { file } = writeConfig(root, {
    enrollment: { allowFrom: ['10.0.0.0/8'], windowSeconds: 60 },
  });
  const { base, close } = await startServer(loadConfig(file));
  try {
    const response = await post(base, '/v1/enroll', TOKEN);
    assert.equal(response.status, 403);
    assert.equal((await post(base, '/v1/jobs/example/archive', TOKEN)).status, 401);
  } finally {
    await close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('agent archives only include-matched paths when include is configured', async () => {
  const root = tempRoot();
  const data = path.join(root, 'data');
  const saves = path.join(data, 'Synced', 'Game', 'drive_c', 'users', 'steamuser');
  fs.mkdirSync(saves, { recursive: true });
  fs.writeFileSync(path.join(saves, 'save.dat'), 'save');
  fs.writeFileSync(path.join(data, 'Synced', 'Game', 'other.bin'), 'other');
  const configFile = path.join(root, 'agent.json');
  fs.writeFileSync(configFile, JSON.stringify({
    stateDir: path.join(root, 'state'),
    enrollment: { allowFrom: ['127.0.0.1/32'], windowSeconds: 60 },
    jobs: {
      saves: {
        type: 'archive',
        root: data,
        include: ['Synced/*/drive_c/users/steamuser'],
      },
    },
  }));
  const { base, close } = await startServer(loadConfig(configFile));
  try {
    assert.equal((await post(base, '/v1/enroll', TOKEN)).status, 204);
    const response = await post(base, '/v1/jobs/saves/archive', TOKEN);
    assert.equal(response.status, 200);
    const archive = path.join(root, 'included.tar.gz');
    fs.writeFileSync(archive, Buffer.from(await response.arrayBuffer()));
    const extracted = path.join(root, 'extracted');
    fs.mkdirSync(extracted);
    const tar = spawnSync('tar', ['-xzf', archive, '-C', extracted], { encoding: 'utf8' });
    assert.equal(tar.status, 0, tar.stderr);
    assert.equal(fs.readFileSync(path.join(extracted, 'Synced/Game/drive_c/users/steamuser/save.dat'), 'utf8'), 'save');
    assert.equal(fs.existsSync(path.join(extracted, 'Synced/Game/other.bin')), false);
  } finally {
    await close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('config rejects relative roots and unsupported job types', () => {
  const root = tempRoot();
  try {
    const badRoot = path.join(root, 'bad-root.json');
    fs.writeFileSync(badRoot, JSON.stringify({
      stateDir: path.join(root, 'state'),
      jobs: { example: { type: 'archive', root: 'relative/path' } },
    }));
    assert.throws(() => loadConfig(badRoot), /absolute path/);

    const badType = path.join(root, 'bad-type.json');
    fs.writeFileSync(badType, JSON.stringify({
      stateDir: path.join(root, 'state'),
      jobs: { example: { type: 'command', root: root } },
    }));
    assert.throws(() => loadConfig(badType), /unsupported type/);

    const badInclude = path.join(root, 'bad-include.json');
    fs.writeFileSync(badInclude, JSON.stringify({
      stateDir: path.join(root, 'state'),
      jobs: { example: { type: 'archive', root, include: ['../outside'] } },
    }));
    assert.throws(() => loadConfig(badInclude), /relative and contain no/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('agent rejects an archive larger than maxBytes', async () => {
  const root = tempRoot();
  const data = path.join(root, 'data');
  fs.mkdirSync(data, { recursive: true });
  fs.writeFileSync(path.join(data, 'large.txt'), 'x'.repeat(4096));
  const { file } = writeConfig(root);
  const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
  cfg.jobs.example.maxBytes = 32;
  fs.writeFileSync(file, JSON.stringify(cfg));
  const loaded = loadConfig(file);
  const { base, close } = await startServer(loaded);
  try {
    assert.equal((await post(base, '/v1/enroll', TOKEN)).status, 204);
    assert.equal((await post(base, '/v1/jobs/example/archive', TOKEN)).status, 413);
  } finally {
    await close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
