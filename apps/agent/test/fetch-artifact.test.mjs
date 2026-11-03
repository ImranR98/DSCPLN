import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('../fetch-artifact.sh', import.meta.url));

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dscpln-fetch-artifact-'));
}

function makeRelease(root, version) {
  const dir = path.join(root, `release-${version}`);
  fs.mkdirSync(dir, { recursive: true });
  const binary = path.join(dir, 'ludusavi');
  fs.writeFileSync(binary, `#!/bin/sh\necho "ludusavi ${version}"\n`, { mode: 0o755 });
  const tar = path.join(root, `release-${version}.tar.gz`);
  const result = spawnSync('tar', ['-czf', tar, '-C', dir, 'ludusavi'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return tar;
}

function fakeCurl(root) {
  const dir = path.join(root, 'bin');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'curl'), `#!/bin/sh
set -eu
out=
while [ $# -gt 0 ]; do
  case "$1" in
    -o) out=$2; shift 2;;
    *) shift;;
  esac
done
[ -n "$out" ]
[ -n "\${FAKE_RELEASE:-}" ]
cp "$FAKE_RELEASE" "$out"
`, { mode: 0o755 });
  return dir;
}

test('fetch-artifact caches by version, replaces on change, and prunes old copies', () => {
  const root = tempRoot();
  try {
    const binDir = fakeCurl(root);
    const dest = path.join(root, 'artifacts', 'ludusavi');
    const stamp = path.join(root, 'artifacts', '.version');
    const oldCopy = path.join(root, 'artifacts', 'ludusavi-1.0.0');
    const baseEnv = {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH}`,
      ARTIFACT_URL: 'https://example.invalid/ludusavi.tar.gz',
      ARTIFACT_DEST: dest,
      ARTIFACT_MEMBER: 'ludusavi',
      ARTIFACT_CHECK_ARGS: '--version',
    };

    const release1 = makeRelease(root, '1.0.0');
    const first = spawnSync('sh', [SCRIPT], {
      env: { ...baseEnv, FAKE_RELEASE: release1, ARTIFACT_VERSION: '1.0.0' },
      encoding: 'utf8',
    });
    assert.equal(first.status, 0, first.stderr);
    assert.equal(fs.readFileSync(stamp, 'utf8').trim(), '1.0.0');
    assert.match(spawnSync(dest, ['--version'], { encoding: 'utf8' }).stdout, /1\.0\.0/);

    // A missing source proves the cached version is not downloaded again.
    const cached = spawnSync('sh', [SCRIPT], {
      env: { ...baseEnv, FAKE_RELEASE: path.join(root, 'missing.tar.gz'), ARTIFACT_VERSION: '1.0.0' },
      encoding: 'utf8',
    });
    assert.equal(cached.status, 0, cached.stderr);
    assert.match(cached.stdout, /already installed/);

    const release2 = makeRelease(root, '2.0.0');
    fs.writeFileSync(oldCopy, 'old', { mode: 0o755 });
    const second = spawnSync('sh', [SCRIPT], {
      env: { ...baseEnv, FAKE_RELEASE: release2, ARTIFACT_VERSION: '2.0.0' },
      encoding: 'utf8',
    });
    assert.equal(second.status, 0, second.stderr);
    assert.equal(fs.readFileSync(stamp, 'utf8').trim(), '2.0.0');
    assert.match(spawnSync(dest, ['--version'], { encoding: 'utf8' }).stdout, /2\.0\.0/);
    assert.equal(fs.existsSync(oldCopy), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
