import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createAgentServer } from '../server.mjs';
import { loadConfig } from '../config.mjs';

const TOKEN = 'test-token-0123456789abcdefghijklmnopqrstuvwxyz';

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dscpln-agent-process-'));
}

function writeBinary(root, name, games) {
  const file = path.join(root, name);
  fs.writeFileSync(file, `#!/bin/sh
set -eu
config=
output=
while [ $# -gt 0 ]; do
  case "$1" in
    --config) config=$2; shift 2;;
    --output) output=$2; shift 2;;
    *) shift;;
  esac
done
[ -f "$config/config.yaml" ]
[ "$(cat "$config/config.yaml")" = "hello: world" ]
mkdir -p "$output"
printf 'save\\n' > "$output/save.dat"
printf '{"overall":{"processedGames":${games},"processedBytes":123}}\\n'
`, { mode: 0o755 });
  return file;
}

function writeConfig(root, overrides = {}) {
  const file = path.join(root, 'agent.json');
  const config = {
    stateDir: path.join(root, 'state'),
    enrollment: { allowFrom: ['127.0.0.1/32'], windowSeconds: 60 },
    jobs: {
      tool: {
        type: 'process',
        binary: writeBinary(root, 'tool', 2),
        args: ['--config', '{configDir}', '--output', '{outputDir}'],
        configDir: path.join(root, 'config'),
        configFile: 'config.yaml',
        outputDir: path.join(root, 'out'),
        home: root,
        timeoutSeconds: 30,
        result: {
          json: 'overall',
          summary: 'tool: {processedGames} games',
          require: { processedGames: 1 },
        },
        ...overrides,
      },
    },
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
  return {
    base: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

function post(base, pathname, token, init = {}) {
  return fetch(`${base}${pathname}`, {
    ...init,
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
  });
}

test('process job writes the config, runs the binary, and returns the result summary', async () => {
  const root = tempRoot();
  const { file } = writeConfig(root);
  const { base, close } = await startServer(loadConfig(file));
  try {
    assert.equal((await post(base, '/v1/enroll', TOKEN)).status, 204);
    const response = await post(base, '/v1/jobs/tool/run', TOKEN, {
      headers: { 'Content-Type': 'application/x-yaml' },
      body: 'hello: world\n',
    });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.ok, true);
    assert.equal(payload.summary, 'tool: 2 games');
    assert.equal(fs.readFileSync(path.join(root, 'config', 'config.yaml'), 'utf8'), 'hello: world\n');
    assert.equal(fs.readFileSync(path.join(root, 'out', 'save.dat'), 'utf8'), 'save\n');

    const missing = await post(base, '/v1/jobs/tool/run', TOKEN);
    assert.equal(missing.status, 400);
  } finally {
    await close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('process job fails when the result requirement is not met', async () => {
  const root = tempRoot();
  const { file } = writeConfig(root, { binary: writeBinary(root, 'tool-empty', 0) });
  const { base, close } = await startServer(loadConfig(file));
  try {
    assert.equal((await post(base, '/v1/enroll', TOKEN)).status, 204);
    const response = await post(base, '/v1/jobs/tool/run', TOKEN, {
      headers: { 'Content-Type': 'application/x-yaml' },
      body: 'hello: world\n',
    });
    assert.equal(response.status, 500);
    assert.match((await response.json()).error, /result check failed/);
  } finally {
    await close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('process config rejects relative binaries and unresolved placeholders', () => {
  const root = tempRoot();
  try {
    const relative = path.join(root, 'relative.json');
    fs.writeFileSync(relative, JSON.stringify({
      stateDir: path.join(root, 'state'),
      jobs: {
        tool: {
          type: 'process',
          binary: 'tool',
          configDir: path.join(root, 'config'),
          configFile: 'config.yaml',
        },
      },
    }));
    assert.throws(() => loadConfig(relative), /binary must be an absolute path/);

    const placeholder = path.join(root, 'placeholder.json');
    fs.writeFileSync(placeholder, JSON.stringify({
      stateDir: path.join(root, 'state'),
      jobs: {
        tool: {
          type: 'process',
          binary: path.join(root, 'tool'),
          args: ['--output', '{outputDir}'],
          configDir: path.join(root, 'config'),
          configFile: 'config.yaml',
        },
      },
    }));
    assert.throws(() => loadConfig(placeholder), /outputDir is not set/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
