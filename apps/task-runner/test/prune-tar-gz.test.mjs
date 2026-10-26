import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pruneTarGz } from '../ui/src/lib/prune-tar-gz.js';

const makeExport = (format = 'gnu') => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'bctl-prune-'));
  const src = path.join(work, 'src');
  fs.mkdirSync(src);
  fs.writeFileSync(path.join(src, 'users_000001.json'), '[]\n');
  fs.writeFileSync(path.join(src, 'issues_000001.json'), '[]\n');
  const longName = `issues_${'x'.repeat(140)}.json`;
  fs.writeFileSync(path.join(src, longName), '[]\n');
  for (const [dir, name, bytes] of [
    ['repositories', 'repo.git/objects/pack.pack', 1024 * 1024],
    ['releases', 'asset.bin', 128 * 1024],
    ['attachments', 'attachment.bin', 64 * 1024],
    ['repository_files', '1/app-release.zip', 256 * 1024],
  ]) {
    fs.mkdirSync(path.join(src, dir, path.dirname(name)), { recursive: true });
    fs.writeFileSync(path.join(src, dir, name), crypto.randomBytes(bytes));
  }
  const archive = path.join(work, 'export.tar.gz');
  execFileSync('tar', ['--format', format, '-czf', archive, '-C', src, '.']);
  return { work, archive, longName };
};

test('pruneTarGz: keeps user data and long names, drops archive bulk', async () => {
  const { work, archive, longName } = makeExport();
  try {
    const source = new File([fs.readFileSync(archive)], 'export.tar.gz', { type: 'application/gzip' });
    const pruned = await pruneTarGz(source, {
      drop: ['repositories', 'releases', 'attachments', 'repository_files'],
    });
    assert.ok(pruned.size < source.size / 4, `${pruned.size} vs ${source.size}`);

    const out = path.join(work, 'out');
    fs.mkdirSync(out);
    fs.writeFileSync(path.join(work, 'pruned.tar.gz'), Buffer.from(await pruned.arrayBuffer()));
    execFileSync('tar', ['-xzf', path.join(work, 'pruned.tar.gz'), '-C', out]);

    assert.equal(fs.readFileSync(path.join(out, 'users_000001.json'), 'utf8'), '[]\n');
    assert.equal(fs.readFileSync(path.join(out, 'issues_000001.json'), 'utf8'), '[]\n');
    assert.ok(fs.existsSync(path.join(out, longName)));
    for (const dir of ['repositories', 'releases', 'attachments', 'repository_files']) {
      assert.equal(fs.existsSync(path.join(out, dir)), false, dir);
    }
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
});

test('pruneTarGz: handles PAX long names', async () => {
  const { work, archive, longName } = makeExport('pax');
  try {
    const source = new File([fs.readFileSync(archive)], 'export.tar.gz', { type: 'application/gzip' });
    const pruned = await pruneTarGz(source, {
      drop: ['repositories', 'releases', 'attachments', 'repository_files'],
    });
    const out = path.join(work, 'out');
    fs.mkdirSync(out);
    fs.writeFileSync(path.join(work, 'pruned.tar.gz'), Buffer.from(await pruned.arrayBuffer()));
    execFileSync('tar', ['-xzf', path.join(work, 'pruned.tar.gz'), '-C', out]);
    assert.ok(fs.existsSync(path.join(out, 'users_000001.json')));
    assert.ok(fs.existsSync(path.join(out, longName)));
    assert.equal(fs.existsSync(path.join(out, 'repositories')), false);
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
});

test('pruneTarGz: rejects archives without the GitHub user record', async () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'bctl-prune-bad-'));
  try {
    const src = path.join(work, 'src');
    fs.mkdirSync(src);
    fs.writeFileSync(path.join(src, 'data.json'), '[]\n');
    const archive = path.join(work, 'bad.tar.gz');
    execFileSync('tar', ['-czf', archive, '-C', src, '.']);
    const source = new File([fs.readFileSync(archive)], 'bad.tar.gz', { type: 'application/gzip' });
    await assert.rejects(
      pruneTarGz(source, { drop: ['repositories'] }),
      /users_000001\.json missing/
    );
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
});
