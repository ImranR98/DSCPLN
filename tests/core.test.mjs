import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Sandboxed state dir — set BEFORE importing core so its module-level
// STATE_DIR / askpass paths point at the sandbox.
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'bctl-core-'));
process.env.BACKUPCTL_STATE_DIR = path.join(SANDBOX, 'state');

const core = await import('../core.mjs');

function writeConfig(name, data) {
  const p = path.join(SANDBOX, name);
  fs.writeFileSync(p, `export default ${JSON.stringify(data)};`);
  return p;
}

test('loadConfig: validates names, state_dir, duplicates', async () => {
  const [local, tasks] = await core.loadConfig(
    writeConfig('valid.mjs', {
      maindir: '/tmp',
      tasks: [{ name: 'a', state_dir: '/tmp/a' }],
    })
  );
  assert.equal(local.maindir, '/tmp');
  assert.equal(tasks.length, 1);
  assert.ok(local.repo_dir);
  assert.ok(local.lib.endsWith('lib.sh'));

  await assert.rejects(
    core.loadConfig(writeConfig('nofile.mjs', { tasks: [{ name: 'a' }] })),
    core.ConfigError
  );
  await assert.rejects(
    core.loadConfig(writeConfig('dup.mjs', {
      tasks: [
        { name: 'a', state_dir: '/x' },
        { name: 'a', state_dir: '/y' },
      ],
    })),
    /Duplicate task name/
  );
  await assert.rejects(core.loadConfig(path.join(SANDBOX, 'absent.mjs')), core.ConfigMissingError);
});

test('resolve: nested lookup, typed values, loops, tildes', () => {
  const local = {
    repo_dir: core.REPO_DIR,
    maindir: '~/Main',
    scriptroot: '{{repo_dir}}/scripts',
    hosts: { bigpc: { user: 'user', port: 22 } },
    list: [1, 2],
  };
  assert.equal(core.resolve('{{maindir}}/Backups', local), `${os.homedir()}/Main/Backups`);
  assert.equal(core.resolve('{{scriptroot}}', local), `${core.REPO_DIR}/scripts`); // loops to stable
  assert.equal(core.resolve('{{hosts.bigpc.user}}', local), 'user');
  assert.equal(core.resolve('{{hosts.bigpc.port}}', local), 22); // typed value
  assert.equal(core.resolve('port={{hosts.bigpc.port}}', local), 'port=22'); // embedded: stringified
  assert.deepEqual(core.resolve('{{hosts.bigpc}}', local), local.hosts.bigpc); // typed
  assert.deepEqual(core.resolve('{{list}}', local), [1, 2]); // typed
  assert.equal(core.resolve('{{missing}}', local), '{{missing}}'); // unresolved literal
  assert.equal(core.resolve('{{missing}}/x', local), '{{missing}}/x');
  const extra = { uploads: 'a b' };
  assert.equal(core.resolve('{{uploads}}', local, extra), 'a b');
});

test('slugify + state file round-trip (atomic, capped output)', () => {
  const local = { maindir: path.join(SANDBOX, 'data') };
  const task = { name: 'Test Task!', state_dir: '{{maindir}}/Dest' };
  assert.equal(core.slugify('Test Task!'), 'Test_Task_');
  core.saveTaskState(task, local, true, 'summary', 'x'.repeat(25000));
  const rec = core.loadTaskState(task, local);
  assert.equal(rec.ok, true);
  assert.equal(rec.summary, 'summary');
  assert.equal(rec.output.length, 20000);
  assert.ok(fs.existsSync(path.join(SANDBOX, 'data/Dest', '.backup-state-Test_Task_.json')));
});

test('running marker + staging', () => {
  core.markRunning('task-x');
  assert.equal(core.runningMarker().task, 'task-x');
  core.clearRunning();
  assert.equal(core.runningMarker(), null);
  const d = core.stagingDir('Task With Spaces');
  assert.ok(d.endsWith('Task_With_Spaces'));
  assert.ok(fs.existsSync(d));
});

test('run: streams lines, redacts secrets, returns rc', async () => {
  const lines = [];
  const rc = await core.run(
    ['bash', '-c', 'echo secret123 out; echo other; exit 3'],
    { log: (l) => lines.push(l), redact: ['secret123'] }
  );
  assert.equal(rc, 3);
  assert.ok(lines.some((l) => l.includes('$ ')));
  assert.ok(lines.some((l) => l.includes('*** out')));
  assert.ok(!lines.some((l) => l.includes('secret123')));
});

test('run: timeout kills the process group and returns 124', async () => {
  const lines = [];
  const rc = await core.run(['bash', '-c', 'sleep 100'], {
    log: (l) => lines.push(l),
    timeout: 1,
  });
  assert.equal(rc, core.TIMEOUT_RC);
  assert.ok(lines.some((l) => l.includes('TIMEOUT: command killed')));
});

test('shCapture: captures output and redacts', async () => {
  const { rc, out, err } = await core.shCapture('echo secret99; echo oops >&2', {
    redact: ['secret99'],
  });
  assert.equal(rc, 0);
  assert.ok(out.includes('***'));
  assert.ok(err.includes('oops'));
});

test('run: nonexistent binary returns 127', async () => {
  const rc = await core.run(['definitely-not-a-binary-xyz'], { log: () => {} });
  assert.equal(rc, 127);
});

test('shellQuote/shellSplit round-trip', () => {
  const args = ['a b', "c'd", 'e', '', '~x/y', '$HOME'];
  assert.deepEqual(core.shellSplit(args.map(core.shellQuote).join(' ')), [
    'a b',
    "c'd",
    'e',
    '~x/y',
    '$HOME',
  ]);
});

test('gitCommit: excludes state files, tolerates empty commits', async () => {
  const dest = path.join(SANDBOX, 'gitdest');
  await core.gitCommit(dest, 'first');
  fs.writeFileSync(path.join(dest, 'a.txt'), 'hi');
  fs.writeFileSync(path.join(dest, '.backup-state-x.json'), '{"ok":true}');
  await core.gitCommit(dest, 'second');
  const { rc, out } = await core.shCapture(`git -C ${core.shellQuote(dest)} ls-files`, {});
  assert.equal(rc, 0);
  assert.ok(out.includes('a.txt'));
  assert.ok(!out.includes('.backup-state-x.json'));
  // empty commit tolerated
  await core.gitCommit(dest, 'third');
});

test('rsync: builds args, handles dir slash', async () => {
  const src = path.join(SANDBOX, 'rsrc');
  const dst = path.join(SANDBOX, 'rdst');
  fs.mkdirSync(src, { recursive: true });
  fs.mkdirSync(path.join(src, 'sub'), { recursive: true });
  fs.writeFileSync(path.join(src, 'sub', 'f.txt'), 'x');
  const lines = [];
  const rc = await core.rsync(src, dst, { log: (l) => lines.push(l) });
  assert.equal(rc, 0);
  assert.ok(fs.existsSync(path.join(dst, 'sub', 'f.txt')));
  assert.ok(lines[0].includes(`${src}/`));
});

test('pathFound: globs and plain dirs', () => {
  assert.equal(core.pathFound(path.join(SANDBOX, 'rsrc')), true);
  assert.equal(core.pathFound(path.join(SANDBOX, 'nope')), false);
  assert.equal(core.pathFound(path.join(SANDBOX, 'r*')), true);
  assert.equal(core.pathFound(path.join(SANDBOX, 'z*')), false);
});
