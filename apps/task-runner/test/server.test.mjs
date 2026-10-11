import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Sandboxed state dir — set BEFORE importing the module so its module-level
// STATE_DIR / askpass paths point at the sandbox.
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'bctl-'));
process.env.BACKUPCTL_STATE_DIR = path.join(SANDBOX, 'state');
process.env.BACKUPCTL_TMP_DIR = path.join(SANDBOX, 'tmp-root');

const bctl = await import('../server.mjs');

const DATA = path.join(SANDBOX, 'data');
const maindir = DATA;
const PTY_HELPER = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'pty_runner.py');

function writeConfig(name, data) {
  const p = path.join(SANDBOX, name);
  fs.writeFileSync(p, `export default ${JSON.stringify(data)};`);
  return p;
}

function makeConfig(tasks, extraValues = {}) {
  return writeConfig(`config-${Math.random().toString(36).slice(2)}.mjs`, {
    maindir,
    ...extraValues,
    groups: [{ name: 'G', tasks }],
  });
}

function task(name, fields) {
  return { name, state_dir: '{{maindir}}/State/' + name, ...fields };
}

async function bootWith(configPath) {
  await bctl.boot(configPath);
}

async function api() {
  const app = bctl.createApp();
  const srv = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const base = `http://127.0.0.1:${srv.address().port}`;
  const req = async (method, p, body, raw = false, headers = {}) => {
    const res = await fetch(base + p, {
      method,
      headers: raw
        ? { 'content-type': 'application/octet-stream', ...headers }
        : { 'content-type': 'application/json', ...headers },
      body: raw ? body : body === undefined ? undefined : JSON.stringify(body),
    });
    let json = null;
    try {
      json = await res.json();
    } catch { /* no body */ }
    return { status: res.status, json };
  };
  return { base, req, close: () => new Promise((r) => srv.close(r)) };
}

async function pollUntil(fn, timeoutMs = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('pollUntil timed out');
}

async function stage(taskName, filename, content) {
  const d = bctl.stagingDir(taskName);
  fs.writeFileSync(path.join(d, filename), content);
}

async function hasPtyTools() {
  for (const bin of ['python3', 'age', 'tar']) {
    const { rc } = await bctl.shCapture(`command -v ${bin} >/dev/null 2>&1`);
    if (rc !== 0) return false;
  }
  return true;
}

// ---- config / tokens / state / subprocess layer ----------------------------

test('loadConfig: validates groups, tasks, defaults, duplicates', async () => {
  const [local, tasks] = await bctl.loadConfig(
    writeConfig('valid.mjs', {
      maindir: '/tmp',
      groups: [{ name: 'G', tasks: [{ name: 'a', state_dir: '/tmp/a', commands: 'true' }] }],
    })
  );
  assert.equal(local.maindir, '/tmp');
  assert.equal(tasks.length, 1);
  assert.ok(local.repo_dir);
  assert.ok(local.lib.endsWith('lib.sh'));

  // defaults merge under each task, task fields win, group attached, order kept
  const [l2, t2] = await bctl.loadConfig(
    writeConfig('defs.mjs', {
      maindir: '/tmp',
      groups: [
        {
          name: 'G1',
          defaults: { uploads: true, summary_last_line: true },
          tasks: [
            { name: 'a', state_dir: '/x', commands: 'true', glob: '*.txt' },
            { name: 'b', state_dir: '/y', commands: 'true', uploads: false },
          ],
        },
        { name: 'G2', tasks: [{ name: 'c', state_dir: '/z', commands: 'true' }] },
      ],
    })
  );
  assert.equal(l2.groups, undefined);
  assert.deepEqual(t2.map((t) => t.name), ['a', 'b', 'c']);
  assert.deepEqual(t2.map((t) => t.group), ['G1', 'G1', 'G2']);
  assert.equal(t2[0].uploads, true);
  assert.equal(t2[0].summary_last_line, true);
  assert.equal(t2[1].uploads, false);
  assert.equal(t2[2].uploads, undefined);

  await assert.rejects(
    bctl.loadConfig(writeConfig('nofile.mjs', { groups: [{ name: 'G', tasks: [{ name: 'a' }] }] })),
    /needs a 'state_dir'/
  );
  await assert.rejects(
    bctl.loadConfig(writeConfig('nocmd.mjs', { groups: [{ name: 'G', tasks: [{ name: 'a', state_dir: '/x' }] }] })),
    /needs 'commands'/
  );
  await assert.rejects(
    bctl.loadConfig(writeConfig('dup.mjs', {
      groups: [
        { name: 'G', tasks: [
          { name: 'a', state_dir: '/x', commands: 'true' },
          { name: 'a', state_dir: '/y', commands: 'true' },
        ]},
      ],
    })),
    /Duplicate task name/
  );
  await assert.rejects(
    bctl.loadConfig(writeConfig('dupgroup.mjs', {
      groups: [
        { name: 'G', tasks: [] },
        { name: 'G', tasks: [] },
      ],
    })),
    /Duplicate group name/
  );
  await assert.rejects(bctl.loadConfig(path.join(SANDBOX, 'absent.mjs')), bctl.ConfigMissingError);
});

test('loadConfig: script/move/ingest shorthands normalize into commands', async () => {
  const [local, tasks] = await bctl.loadConfig(
    writeConfig('shorthand.mjs', {
      maindir: '/tmp',
      groups: [{
        name: 'G',
        tasks: [
          { name: 's', state_dir: '/x', script: 'echo one\necho two' },
          { name: 'm1', state_dir: '{{maindir}}/Dest', move: {} },
          { name: 'm2', state_dir: '{{maindir}}/Dest', move: { rename: 'bookmarks.html' } },
          { name: 'm3', state_dir: '/x', move: { dest: '{{maindir}}/Else', rename: 'r.txt' } },
          { name: 'i1', state_dir: '{{maindir}}/G', ingest: { suffix: 'jq -r ".id" actor.json' } },
        ],
      }],
    })
  );
  const lib = `'${local.lib}'`;
  assert.ok(tasks[0].commands.startsWith(`bash -c 'TMP=$(mktemp); cat > "$TMP"; bash "$TMP"; RC=$?; rm -f "$TMP"; exit $RC' <<'BASH_SCRIPT'\necho one\necho two\nBASH_SCRIPT`));
  assert.equal(tasks[0].script, undefined);
  assert.equal(bctl.resolve(tasks[1].commands, local), `bash ${lib} move --git '/tmp/Dest' {{uploads}}`);
  assert.equal(bctl.resolve(tasks[2].commands, local), `bash ${lib} move --git --rename bookmarks.html '/tmp/Dest' {{uploads}}`);
  assert.equal(bctl.resolve(tasks[3].commands, local), `bash ${lib} move --git --rename r.txt '/tmp/Else' {{uploads}}`);
  assert.equal(bctl.resolve(tasks[4].commands, local), `bash ${lib} ingest '/tmp/G' 'jq -r ".id" actor.json' {{uploads}}`);
});

test('script shorthand runs through the heredoc wrapper (stdin-safe)', async () => {
  const t = task('Script Task', {
    group: 'G',
    summary_last_line: true,
    script: `echo one
cat >/dev/null
echo two`,
  });
  const cfgPath = makeConfig([t]);
  const [local, tasks] = await bctl.loadConfig(cfgPath);
  const [ok, summary] = await bctl.runTask(tasks[0], local, []);
  assert.equal(ok, true, summary);
  assert.equal(summary, 'two');
});

test('move shorthand: renames the drop, commits, records state', async () => {
  const t = task('Move Shorthand', {
    group: 'G',
    uploads: true,
    glob: 'bookmarks_*.html',
    summary_last_line: true,
    state_dir: '{{maindir}}/Dest',
    move: { rename: 'bookmarks.html' },
  });
  const cfgPath = makeConfig([t]);
  const [local, tasks] = await bctl.loadConfig(cfgPath);
  await stage(t.name, 'bookmarks_2024.html', '<html>');
  const [ok, summary] = await bctl.runTask(tasks[0], local, [
    path.join(bctl.stagingDir(t.name), 'bookmarks_2024.html'),
  ]);
  assert.equal(ok, true, summary);
  assert.ok(fs.existsSync(path.join(maindir, 'Dest', 'bookmarks.html')));
});

test('resolve: nested lookup, typed values, loops, tildes', () => {
  const local = {
    repo_dir: bctl.REPO_DIR,
    maindir: '~/Main',
    scriptroot: '{{repo_dir}}/scripts',
    hosts: { bigpc: { user: 'user', port: 22 } },
    list: [1, 2],
  };
  assert.equal(bctl.resolve('{{maindir}}/Backups', local), `${os.homedir()}/Main/Backups`);
  assert.equal(bctl.resolve('{{scriptroot}}', local), `${bctl.REPO_DIR}/scripts`); // loops to stable
  assert.equal(bctl.resolve('{{hosts.bigpc.user}}', local), 'user');
  assert.equal(bctl.resolve('{{hosts.bigpc.port}}', local), 22); // typed value
  assert.equal(bctl.resolve('port={{hosts.bigpc.port}}', local), 'port=22'); // embedded: stringified
  assert.deepEqual(bctl.resolve('{{hosts.bigpc}}', local), local.hosts.bigpc); // typed
  assert.deepEqual(bctl.resolve('{{list}}', local), [1, 2]); // typed
  assert.equal(bctl.resolve('{{missing}}', local), '{{missing}}'); // unresolved literal
  assert.equal(bctl.resolve('{{missing}}/x', local), '{{missing}}/x');
  const extra = { uploads: 'a b' };
  assert.equal(bctl.resolve('{{uploads}}', local, extra), 'a b');
});

test('slugify + state file round-trip (atomic, full output preserved)', () => {
  const local = { maindir: path.join(SANDBOX, 'data') };
  const t = { name: 'Test Task!', state_dir: '{{maindir}}/Dest' };
  assert.equal(bctl.slugify('Test Task!'), 'Test_Task_');
  bctl.saveTaskState(t, local, true, 'summary', 'x'.repeat(25000));
  const rec = bctl.loadTaskState(t, local);
  assert.equal(rec.ok, true);
  assert.equal(rec.summary, 'summary');
  assert.equal(rec.output.length, 25000);
  assert.ok(fs.existsSync(path.join(SANDBOX, 'data/Dest', '.backup-state-Test_Task_.json')));
});

test('running marker + staging', () => {
  bctl.markRunning('task-x');
  assert.equal(bctl.runningMarker().find((m) => m.task === 'task-x').task, 'task-x');
  bctl.clearRunning('task-x');
  assert.equal(bctl.runningMarker(), null);
  const d = bctl.stagingDir('Task With Spaces');
  assert.ok(d.endsWith('Task_With_Spaces'));
  assert.ok(fs.existsSync(d));
});

test('run: commands see a per-run TMPDIR subdir, wiped when the run ends', async () => {
  const t = task('Tmpdir Test', { capture: true, commands: 'echo $TMPDIR' });
  const cfgPath = makeConfig([t]);
  const [local, tasks] = await bctl.loadConfig(cfgPath);
  const [ok, summary] = await bctl.runTask(tasks[0], local, []);
  assert.equal(ok, true, summary);
  const tmpdir = summary.trim();
  assert.ok(tmpdir.startsWith(process.env.BACKUPCTL_TMP_DIR + path.sep));
  assert.ok(!fs.existsSync(tmpdir)); // wiped when the run ends
});

test('heredoc tasks survive stdin-eating children (wrapper pattern)', async () => {
  const t = task('Heredoc Wrap', {
    group: 'G',
    summary_last_line: true,
    commands: `bash -c 'TMP=$(mktemp); cat > "$TMP"; bash "$TMP"; RC=$?; rm -f "$TMP"; exit $RC' <<'BASH_SCRIPT'
echo one
cat >/dev/null
echo two
BASH_SCRIPT`,
  });
  const cfgPath = makeConfig([t]);
  const [local, tasks] = await bctl.loadConfig(cfgPath);
  const [ok, summary] = await bctl.runTask(tasks[0], local, []);
  assert.equal(ok, true, summary);
  assert.equal(summary, 'two');
});

test('run: streams lines, redacts secrets, returns rc', async () => {
  const lines = [];
  const rc = await bctl.run(
    ['bash', '-c', 'echo secret123 out; echo other; exit 3'],
    { log: (l) => lines.push(l), redact: ['secret123'] }
  );
  assert.equal(rc, 3);
  assert.ok(lines.some((l) => l.includes('$ ')));
  assert.ok(lines.some((l) => l.includes('*** out')));
  assert.ok(!lines.some((l) => l.includes('secret123')));
});

test('run: progress (\r) updates and trailing partial lines are kept', async () => {
  const lines = [];
  const rc = await bctl.run(
    ['bash', '-c', `printf 'downloading 10%%\rdownloading 50%%\rdone\nno-newline-tail'`],
    { log: (l) => lines.push(l) }
  );
  assert.equal(rc, 0);
  assert.ok(lines.includes('downloading 10%'));
  assert.ok(lines.includes('downloading 50%'));
  assert.ok(lines.includes('done'));
  assert.ok(lines.includes('no-newline-tail'));
});

test('run: blank lines and stderr are preserved', async () => {
  const lines = [];
  const rc = await bctl.run(
    ['bash', '-c', `printf 'a\n\nb\n'; echo err-line >&2; echo done >&2`],
    { log: (l) => lines.push(l) }
  );
  assert.equal(rc, 0);
  assert.ok(lines.includes('a'));
  assert.ok(lines.includes(''));
  assert.ok(lines.includes('b'));
  assert.ok(lines.includes('err-line'));
  assert.ok(lines.includes('done'));
});

test('shCapture: captures output and redacts', async () => {
  const { rc, out, err } = await bctl.shCapture('echo secret99; echo oops >&2', {
    redact: ['secret99'],
  });
  assert.equal(rc, 0);
  assert.ok(out.includes('***'));
  assert.ok(err.includes('oops'));
});

test('run: nonexistent binary returns 127', async () => {
  const rc = await bctl.run(['definitely-not-a-binary-xyz'], { log: () => {} });
  assert.equal(rc, 127);
});

test('shellQuote', () => {
  assert.equal(bctl.shellQuote('plain'), 'plain');
  assert.equal(bctl.shellQuote('a b'), `'a b'`);
  assert.equal(bctl.shellQuote(`c'd`), `'c'\\''d'`);
});

test('globMatch: literal + * patterns', () => {
  const cases = [
    ['bitwarden_export_2024.json', 'bitwarden_export_*.json', true],
    ['bookmarks.html', 'bookmarks_*.html', false],
    ['archive.zip', '*.zip', true],
    ['a.tar.gz', '*.tar.gz', true],
    ['a.zip', '*.tar.gz', false],
    ['x.txt', 'example.com.txt', false],
    ['example.com.txt', 'example.com.txt', true],
    ['mydata~2.zip', 'mydata~*.zip', true],
  ];
  for (const [name, pattern, expected] of cases) {
    assert.equal(bctl.globMatch(name, pattern), expected, `${pattern} vs ${name}`);
  }
});

test('git-commit subcommand: excludes state files, tolerates empty commits', async () => {
  const dest = path.join(SANDBOX, 'gitdest');
  const commit = (msg) =>
    bctl.shCapture(`bash ${bctl.shellQuote(bctl.LIB_PATH)} git-commit ${bctl.shellQuote(dest)} ${bctl.shellQuote(msg)}`);
  assert.equal((await commit('first')).rc, 0);
  fs.writeFileSync(path.join(dest, 'a.txt'), 'hi');
  fs.writeFileSync(path.join(dest, '.backup-state-x.json'), '{"ok":true}');
  assert.equal((await commit('second')).rc, 0);
  const { rc, out } = await bctl.shCapture(`git -C ${bctl.shellQuote(dest)} ls-files`, {});
  assert.equal(rc, 0);
  assert.ok(out.includes('a.txt'));
  assert.ok(!out.includes('.backup-state-x.json'));
  // empty commit tolerated
  assert.equal((await commit('third')).rc, 0);
});

test('pathFound: globs and plain dirs', () => {
  const d = path.join(SANDBOX, 'pfound');
  fs.mkdirSync(d, { recursive: true });
  assert.equal(bctl.pathFound(d), true);
  assert.equal(bctl.pathFound(path.join(SANDBOX, 'nope')), false);
  assert.equal(bctl.pathFound(path.join(SANDBOX, 'pfo*')), true);
  assert.equal(bctl.pathFound(path.join(SANDBOX, 'z*')), false);
});

// ---- runner-level task suites ----------------------------------------------

test('move subcommand: renames the drop, commits, clears staging, records state', async () => {
  const t = task('Move Test', {
    group: 'G',
    uploads: true,
    glob: 'bookmarks_*.html',
    summary_last_line: true,
    commands:
      "bash '{{lib}}' move --git --rename bookmarks.html '{{maindir}}/Dest' {{uploads}}",
  });
  const cfgPath = makeConfig([t]);
  const [l2, t2] = await bctl.loadConfig(cfgPath);
  await stage(t.name, 'bookmarks_2024.html', '<html>');
  const [ok, summary] = await bctl.runTask(t2[0], l2, [
    path.join(bctl.stagingDir(t.name), 'bookmarks_2024.html'),
  ]);
  assert.equal(ok, true, summary);
  assert.equal(summary, 'Moved 1 file(s) → ' + path.join(maindir, 'Dest'));
  assert.ok(fs.existsSync(path.join(maindir, 'Dest', 'bookmarks.html')));
  assert.deepEqual(fs.readdirSync(bctl.stagingDir(t.name)), []); // staging cleared
  const state = bctl.loadTaskState(t2[0], l2);
  assert.equal(state.ok, true);
  // git commit happened and excluded state files
  const { rc, out } = await bctl.shCapture(`git -C ${bctl.shellQuote(path.join(maindir, 'Dest'))} ls-files`);
  assert.equal(rc, 0);
  assert.ok(out.includes('bookmarks.html'));
  assert.ok(!out.includes('.backup-state'));
});

test('mappings heredoc: per-pattern renames + fallback preserves unknown names', async () => {
  const t = task('Contacts', {
    group: 'G',
    uploads: true,
    glob: ['*.vcf', '*.ics'],
    summary_last_line: true,
    commands: `bash <<'BASH_SCRIPT'
source '{{lib}}'
DEST='{{maindir}}/Dest2'
mkdir -p "$DEST"
for f in {{uploads}}; do
  case "$(basename "$f")" in
    contacts-*.vcf) mv "$f" "$DEST/My Contacts.vcf" ;;
    todo-*.ics) mv "$f" "$DEST/TODO.ics" ;;
    *) mv "$f" "$DEST/$(basename "$f")" ;;
  esac
done
bctl_git_commit "$DEST"
log "Files → $DEST"
BASH_SCRIPT`,
  });
  const cfgPath = makeConfig([t]);
  await stage(t.name, 'contacts-1.vcf', 'vcf');
  await stage(t.name, 'todo-2.ics', 'ics');
  await stage(t.name, 'Personal.ics', 'cal');
  const [local, tasks] = await bctl.loadConfig(cfgPath);
  const files = fs.readdirSync(bctl.stagingDir(t.name)).map((f) => path.join(bctl.stagingDir(t.name), f));
  const [ok, summary] = await bctl.runTask(tasks[0], local, files);
  assert.equal(ok, true, summary);
  assert.ok(fs.existsSync(path.join(maindir, 'Dest2', 'My Contacts.vcf')));
  assert.ok(fs.existsSync(path.join(maindir, 'Dest2', 'TODO.ics')));
  assert.ok(fs.existsSync(path.join(maindir, 'Dest2', 'Personal.ics')));
});

test('uploads: staging is cleared after a failed run too', async () => {
  const cfgPath = makeConfig([task('Fail Upload', { uploads: true, glob: '*.txt', commands: 'false' })]);
  await bootWith(cfgPath);
  const [local, tasks] = await bctl.loadConfig(cfgPath);
  await stage('Fail Upload', 'a.txt', 'x');
  const files = [path.join(bctl.stagingDir('Fail Upload'), 'a.txt')];
  const [ok] = await bctl.runTask(tasks[0], local, files);
  assert.equal(ok, false);
  assert.deepEqual(fs.readdirSync(bctl.stagingDir('Fail Upload')), []);
});

test('ingest subcommand: extracts, identifies account, names the folder', async () => {
  // GitHub-style: tar.gz containing users_000001.json with a billing login
  const archiveSrc = path.join(SANDBOX, 'ingest-src');
  fs.mkdirSync(archiveSrc);
  fs.writeFileSync(
    path.join(archiveSrc, 'users_000001.json'),
    JSON.stringify([{ login: 'user', billing_plan: 'x' }, { login: 'other' }])
  );
  const { rc } = await bctl.shCapture(`tar czf ${bctl.shellQuote(path.join(SANDBOX, 'gh.tar.gz'))} -C ${bctl.shellQuote(archiveSrc)} .`);
  assert.equal(rc, 0);
  const t = task('GitHub Ingest', {
    group: 'G',
    uploads: true,
    glob: '*.tar.gz',
    summary_last_line: true,
    commands: `bash '{{lib}}' ingest '{{maindir}}/Backups/GitHub' 'cat users_000001.json | jq "(.[] | select(.billing_plan != null)).login" | head -c -2 | tail -c +2' {{uploads}}`,
  });
  const cfgPath = makeConfig([t]);
  await stage(t.name, 'gh.tar.gz', fs.readFileSync(path.join(SANDBOX, 'gh.tar.gz')));
  const [local, tasks] = await bctl.loadConfig(cfgPath);
  const files = [path.join(bctl.stagingDir(t.name), 'gh.tar.gz')];
  const [ok, summary] = await bctl.runTask(tasks[0], local, files);
  assert.equal(ok, true, summary);
  assert.ok(fs.existsSync(path.join(maindir, 'Backups', 'GitHub', 'user', 'users_000001.json')));
});

test('ingest subcommand: awk suffix with escaped fields (Medium-style)', async () => {
  // <...><h1>UserName</h1> — suffix extraction uses $15/$2 through eval
  const archiveSrc = path.join(SANDBOX, 'medium-src');
  fs.mkdirSync(path.join(archiveSrc, 'profile'), { recursive: true });
  fs.writeFileSync(
    path.join(archiveSrc, 'profile', 'profile.html'),
    '<a><b><c><d><e><f><g><h><i><j><k><l><m><n>JohnDoe</n></m></l></k></j></i></h></g></f></e></d></c></b></a>'
  );
  const { rc } = await bctl.shCapture(`tar czf ${bctl.shellQuote(path.join(SANDBOX, 'medium.tar.gz'))} -C ${bctl.shellQuote(archiveSrc)} .`);
  assert.equal(rc, 0);
  const t = task('Medium Ingest', {
    group: 'G',
    uploads: true,
    glob: '*.tar.gz',
    summary_last_line: true,
    commands: `bash '{{lib}}' ingest '{{maindir}}/Backups/Medium' 'awk -F\\< "{ print \\$15 }" profile/profile.html | awk -F\\> "{ print \\$2 }" | awk NF | tail -c +2' {{uploads}}`,
  });
  const cfgPath = makeConfig([t]);
  await stage(t.name, 'medium.tar.gz', fs.readFileSync(path.join(SANDBOX, 'medium.tar.gz')));
  const [local, tasks] = await bctl.loadConfig(cfgPath);
  const files = [path.join(bctl.stagingDir(t.name), 'medium.tar.gz')];
  const [ok, summary] = await bctl.runTask(tasks[0], local, files);
  assert.equal(ok, true, summary);
  assert.ok(fs.existsSync(path.join(maindir, 'Backups', 'Medium', 'ohnDoe', 'profile', 'profile.html')));
});

test('ingest subcommand: empty suffix fails the run instead of syncing into DEST', async () => {
  const archiveSrc = path.join(SANDBOX, 'bad-src');
  fs.mkdirSync(archiveSrc);
  fs.writeFileSync(path.join(archiveSrc, 'user_data_tiktok.json'), JSON.stringify({ a: 1 }));
  const { rc } = await bctl.shCapture(`tar czf ${bctl.shellQuote(path.join(SANDBOX, 'bad.tar.gz'))} -C ${bctl.shellQuote(archiveSrc)} .`);
  assert.equal(rc, 0);
  const t = task('Bad Ingest', {
    group: 'G',
    uploads: true,
    glob: '*.tar.gz',
    summary_last_line: true,
    commands: `bash '{{lib}}' ingest '{{maindir}}/Backups/TikTok' "grep -oP '(?<=\\\"userName\\\": \\\")([^\\\"]+)' user_data*.json | head -1" {{uploads}}`,
  });
  const cfgPath = makeConfig([t]);
  await stage(t.name, 'bad.tar.gz', fs.readFileSync(path.join(SANDBOX, 'bad.tar.gz')));
  const [local, tasks] = await bctl.loadConfig(cfgPath);
  const files = [path.join(bctl.stagingDir(t.name), 'bad.tar.gz')];
  const [ok] = await bctl.runTask(tasks[0], local, files);
  assert.equal(ok, false);
  const state = bctl.loadTaskState(tasks[0], local);
  assert.match(state.output, /no account name/);
  assert.ok(!fs.existsSync(path.join(maindir, 'Backups', 'TikTok')), 'nothing synced into DEST');
});

test('copy subcommand with --git + --pre: sources synced, state excluded', async () => {
  const src1 = path.join(SANDBOX, 'src1');
  fs.mkdirSync(src1);
  fs.writeFileSync(path.join(src1, 'f.txt'), 'data');
  const pre = path.join(SANDBOX, 'pre.log');
  const t = task('Copy Test', {
    group: 'G',
    summary_last_line: true,
    commands: `bash '{{lib}}' copy --git --pre 'echo pre > ${pre}' '{{maindir}}/Copied' ${src1}`,
  });
  const cfgPath = makeConfig([t]);
  const [local, tasks] = await bctl.loadConfig(cfgPath);
  const [ok, summary] = await bctl.runTask(tasks[0], local, []);
  assert.equal(ok, true, summary);
  assert.ok(fs.existsSync(path.join(maindir, 'Copied', 'src1', 'f.txt')));
  assert.equal(fs.readFileSync(pre, 'utf8').trim(), 'pre');
  const { out } = await bctl.shCapture(`git -C ${bctl.shellQuote(path.join(maindir, 'Copied', 'src1'))} ls-files`);
  assert.ok(out.includes('f.txt'));
});

test('encrypt task: age round-trip via pty_runner.py, passphrase redacted', { skip: !(await hasPtyTools()) }, async () => {
  const src = path.join(SANDBOX, 'secret.txt');
  fs.writeFileSync(src, 'top secret data');
  const t = task('Encrypt', {
    group: 'G',
    uploads: true,
    glob: 'secret.txt',
    require: ['password'],
    summary_last_line: true,
    commands: "AGE_PASSPHRASE='{{password}}' bash '{{lib}}' encrypt '{{maindir}}/Encrypted' secret.txt.age {{uploads}}",
  });
  const cfgPath = makeConfig([t]);
  await stage(t.name, 'secret.txt', fs.readFileSync(src));
  const [local, tasks] = await bctl.loadConfig(cfgPath);
  const files = [path.join(bctl.stagingDir(t.name), 'secret.txt')];
  const log = [];
  const [ok, summary] = await bctl.runTask(tasks[0], local, files, (l) => log.push(l), { password: 'hunter2-secret' });
  assert.equal(ok, true, `summary=${summary}; log=${log.join(' | ')}`);
  const enc = path.join(maindir, 'Encrypted', 'secret.txt.age');
  assert.ok(fs.existsSync(enc));
  // round-trip decrypt through the pty runner (passphrase-protected
  // files are auto-detected by age)
  const { rc } = await bctl.shCapture(
    `printf '%s\\n%s\\n' hunter2-secret hunter2-secret | python3 ${bctl.shellQuote(PTY_HELPER)} age --decrypt -o ${bctl.shellQuote(path.join(SANDBOX, 'dec.txt'))} ${bctl.shellQuote(enc)}`
  );
  assert.equal(rc, 0);
  assert.equal(fs.readFileSync(path.join(SANDBOX, 'dec.txt'), 'utf8'), 'top secret data');
  // passphrase never appears in the log (echo + command display both redacted)
  assert.ok(!log.join('\n').includes('hunter2-secret'));
});

test('uploads with no files fails fast', async () => {
  const t = task('Empty Uploads', { group: 'G', uploads: true, glob: '*.txt', commands: 'true' });
  const [ok, summary] = await bctl.runTask(t, { maindir }, []);
  assert.equal(ok, false);
  assert.equal(summary, 'No files queued — drop them here first');
});

test('require: missing input fails', async () => {
  const t = task('Req', { group: 'G', require: ['confirmed'], commands: 'true' });
  const [ok, summary] = await bctl.runTask(t, { maindir }, []);
  assert.equal(ok, false);
  assert.equal(summary, 'Missing required input: confirmed');
  const [ok2] = await bctl.runTask(t, { maindir }, [], null, { confirmed: 'yes' });
  assert.equal(ok2, true);
});

test('capture: output becomes the summary; paste_done commits', async () => {
  const t = task('Capture', {
    group: 'G',
    capture: true,
    commit_dir: '{{maindir}}/CapDest',
    commands: ['echo line1', 'echo line2'],
  });
  const [ok, summary] = await bctl.runTask(t, { maindir }, []);
  assert.equal(ok, true);
  assert.equal(summary, 'line1\nline2');
  // paste done via the lib.sh git-commit subcommand
  const { rc } = await bctl.shCapture(
    `bash ${bctl.shellQuote(bctl.LIB_PATH)} git-commit ${bctl.shellQuote(path.join(maindir, 'CapDest'))} test`
  );
  assert.equal(rc, 0);
});

test('summary_last_line: last non-command log line', async () => {
  const t = task('SumLast', {
    group: 'G',
    summary_last_line: true,
    commands: 'echo first; echo lastline',
  });
  const [ok, summary] = await bctl.runTask(t, { maindir }, []);
  assert.equal(ok, true);
  assert.equal(summary, 'lastline');
});

test('redaction: secret in command output is masked, state output too', async () => {
  const t = task('Redact', {
    group: 'G',
    commands: "echo 'my-super-secret-token'",
  });
  const log = [];
  const [ok, summary] = await bctl.runTask(t, { maindir }, [], (l) => log.push(l), { password: 'my-super-secret-token' });
  assert.equal(ok, true);
  assert.ok(!log.join('\n').includes('my-super-secret-token'));
  const state = bctl.loadTaskState(t, { maindir });
  assert.ok(!state.output.includes('my-super-secret-token'));
  assert.ok(state.output.includes('***'));
});

test('validate-fresh + prune-exports: stale check, old exports pruned, keep-newer respected', async () => {
  const exportRoot = path.join(SANDBOX, 'exports');
  // pre-existing export dirs: 01 (1 file), 02 (2 files), 03 (stale)
  fs.mkdirSync(path.join(exportRoot, '2024-01'), { recursive: true });
  fs.writeFileSync(path.join(exportRoot, '2024-01', 'f'), '1');
  fs.mkdirSync(path.join(exportRoot, '2024-02'), { recursive: true });
  fs.writeFileSync(path.join(exportRoot, '2024-02', 'a'), '1');
  fs.writeFileSync(path.join(exportRoot, '2024-02', 'b'), '2');
  fs.mkdirSync(path.join(exportRoot, '2024-03'), { recursive: true });
  fs.writeFileSync(path.join(exportRoot, '2024-03', 'f'), '1');
  const old = new Date(Date.now() - 1000 * 86400);
  fs.utimesSync(path.join(exportRoot, '2024-03'), old, old);

  const t = task('FreshPrune', {
    group: 'G',
    commands: [
      `mkdir -p ${exportRoot}/2024-04 && echo x > ${exportRoot}/2024-04/f.txt`,
      `bash '{{lib}}' validate-fresh ${exportRoot}`,
      `bash '{{lib}}' prune-exports ${exportRoot} --keep-newer`,
    ],
  });
  const cfgPath = makeConfig([t]);
  const [local, tasks] = await bctl.loadConfig(cfgPath);
  const log = [];
  const [ok, summary] = await bctl.runTask(tasks[0], local, [], (l) => log.push(l));
  assert.equal(ok, true, summary);
  const remaining = fs.readdirSync(exportRoot);
  assert.ok(remaining.includes('2024-04'), 'newest export kept');
  assert.ok(remaining.includes('2024-02'), 'keep_newer keeps bigger dirs');
  assert.ok(!remaining.includes('2024-01'), 'older smaller dir pruned');
  assert.ok(!remaining.includes('2024-03'), 'older dir pruned');
  assert.ok(log.join('\n').includes('MORE files'));
  assert.ok(log.join('\n').includes('Validated export: 2024-04'));
});

test('validate-fresh: empty newest export fails the run', async () => {
  const exportRoot = path.join(SANDBOX, 'exports2');
  const t = task('FreshEmpty', {
    group: 'G',
    commands: [
      `mkdir -p ${exportRoot}/backup`,
      `bash '{{lib}}' validate-fresh ${exportRoot}`,
    ],
  });
  const cfgPath = makeConfig([t]);
  const [local, tasks] = await bctl.loadConfig(cfgPath);
  const log = [];
  const [ok, summary] = await bctl.runTask(tasks[0], local, [], (l) => log.push(l));
  assert.equal(ok, false);
  assert.match(summary, /Command failed/);
  assert.ok(log.join('\n').includes('empty or stale'));
});

test('validate-fresh: stale newest export fails the run', async () => {
  const exportRoot = path.join(SANDBOX, 'exports3');
  fs.mkdirSync(path.join(exportRoot, 'backup'), { recursive: true });
  fs.writeFileSync(path.join(exportRoot, 'backup', 'f'), '1');
  const old = new Date(Date.now() - 2000 * 86400);
  fs.utimesSync(path.join(exportRoot, 'backup'), old, old);
  const t = task('FreshStale', {
    group: 'G',
    commands: [`bash '{{lib}}' validate-fresh ${exportRoot}`],
  });
  const cfgPath = makeConfig([t]);
  const [local, tasks] = await bctl.loadConfig(cfgPath);
  const log = [];
  const [ok, summary] = await bctl.runTask(tasks[0], local, [], (l) => log.push(l));
  assert.equal(ok, false);
  assert.ok(log.join('\n').includes('empty or stale'));
});

// ---- API-level suites ------------------------------------------------------

test('API: /api/tasks returns groups in config order', async () => {
  await bootWith(writeConfig('groups-order.mjs', {
    maindir,
    groups: [
      { name: 'Z Group', tasks: [task('Z1', { commands: 'true' })] },
      { name: 'A Group', tasks: [task('A1', { commands: 'true' }), task('A2', { commands: 'true' })] },
    ],
  }));
  const { req, close } = await api();
  const res = await req('GET', '/api/tasks');
  assert.deepEqual(res.json.groups.map((g) => g.name), ['Z Group', 'A Group']);
  assert.deepEqual(res.json.groups[1].tasks.map((t) => t.name), ['A1', 'A2']);
  assert.equal(res.json.missing_config, false);
  await close();
});

test('API: upload validation, detect scoring + ambiguity, CSRF guard', async () => {
  const t1 = task('Detect A', { group: 'G', uploads: true, glob: 'takeout-*.zip', commands: 'true' });
  const t2 = task('Detect B', { group: 'G', uploads: true, glob: '*.zip', commands: 'true' });
  await bootWith(makeConfig([t1, t2]));
  const { base, req, close } = await api();

  let res = await req('POST', '/api/detect?name=takeout-2024.zip');
  assert.equal(res.status, 200);
  assert.equal(res.json.result.task, 'Detect A');
  assert.deepEqual(res.json.result.ambiguous, ['Detect A']);

  res = await req('POST', '/api/detect?name=other.zip');
  assert.equal(res.json.result.task, 'Detect B');

  res = await req('POST', '/api/detect?name=no-match.txt');
  assert.equal(res.json.result, null);

  res = await req('POST', '/api/upload/Detect%20A?name=takeout-2024.zip', 'zipdata', true);
  assert.equal(res.status, 200);
  assert.equal(res.json.queued, 'takeout-2024.zip');

  res = await req('POST', '/api/upload/Detect%20A?name=wrong.txt', 'x', true);
  assert.equal(res.status, 400);

  res = await req('POST', '/api/upload/No%20Such%20Task?name=x.zip', 'x', true);
  assert.equal(res.status, 404);

  res = await req('POST', '/api/run/Detect%20A', {});
  assert.equal(res.status, 200);
  // wait for run to finish, then GET tasks shows state
  await pollUntil(() => !bctl.RUNS.has('Detect A'));
  res = await req('GET', '/api/tasks');
  const ta = res.json.groups[0].tasks.find((x) => x.name === 'Detect A');
  assert.equal(ta.state.ok, true);

  // CSRF: cross-origin POST blocked; same-origin allowed
  res = await req('POST', '/api/run/Detect%20A', {}, false, { origin: 'https://evil.example' });
  assert.equal(res.status, 403);
  res = await req('POST', '/api/run/Detect%20A', {}, false, { origin: base });
  assert.equal(res.status, 200);
  await pollUntil(() => !bctl.RUNS.has('Detect A'));
  await close();
});

test('API: upload with JSON content-type stores raw bytes, not a parsed object', async () => {
  const t = task('Json Upload', { uploads: true, glob: '*.json', commands: 'true' });
  await bootWith(makeConfig([t]));
  const { req, close } = await api();
  const body = '{"items": [1, 2, 3]}';
  const res = await req('POST', '/api/upload/Json%20Upload?name=export.json', body, true, {
    'content-type': 'application/json',
  });
  assert.equal(res.status, 200);
  assert.equal(res.json.queued, 'export.json');
  const staged = fs.readFileSync(path.join(bctl.stagingDir('Json Upload'), 'export.json'), 'utf8');
  assert.equal(staged, body);
  await close();
});

test('API: uploads stream to disk; leftover .part files are never picked up', async () => {
  const t = task('Stream Upload', { uploads: true, glob: '*.zip', commands: 'true' });
  await bootWith(makeConfig([t]));
  const { req, close } = await api();

  let res = await req('POST', '/api/upload/Stream%20Upload?name=big.zip', 'AAABBBCCC', true);
  assert.equal(res.status, 200);
  assert.equal(res.json.queued, 'big.zip');
  assert.equal(fs.readFileSync(path.join(bctl.stagingDir('Stream Upload'), 'big.zip'), 'utf8'), 'AAABBBCCC');
  assert.ok(!fs.existsSync(path.join(bctl.stagingDir('Stream Upload'), 'big.zip.part')));

  // a leftover .part file is never picked up by a run
  fs.writeFileSync(path.join(bctl.stagingDir('Stream Upload'), 'other.zip.part'), 'junk');
  res = await req('POST', '/api/run/Stream%20Upload', {});
  assert.equal(res.status, 200);
  await pollUntil(() => !bctl.RUNS.has('Stream Upload'));
  res = await req('GET', '/api/tasks');
  const tj = res.json.groups[0].tasks.find((x) => x.name === 'Stream Upload');
  assert.equal(tj.state.ok, true);
  await close();
});

test('API: run/cancel flow kills the task', async () => {
  const t = task('Cancel Me', { group: 'G', commands: 'sleep 100' });
  await bootWith(makeConfig([t]));
  const { req, close } = await api();
  let res = await req('POST', '/api/run/Cancel%20Me', {});
  assert.equal(res.status, 200);
  assert.ok(bctl.RUNS.has('Cancel Me'));
  // concurrent same-task run refused
  res = await req('POST', '/api/run/Cancel%20Me', {});
  assert.equal(res.status, 409);
  // cancel
  bctl.DONE.length = 0;
  res = await req('POST', '/api/cancel', { task: 'Cancel Me' });
  assert.equal(res.status, 200);
  await pollUntil(() => !bctl.RUNS.has('Cancel Me'), 8000);
  const done = bctl.DONE.splice(0);
  assert.equal(done.length, 1);
  assert.equal(done[0].ok, false);
  assert.equal(done[0].summary, 'Cancelled by user');
  await close();
});

test('API: distinct tasks run in parallel', async () => {
  const t1 = task('Para A', { group: 'G', commands: 'sleep 2' });
  const t2 = task('Para B', { group: 'G', commands: 'sleep 2' });
  await bootWith(makeConfig([t1, t2]));
  const { req, close } = await api();
  bctl.DONE.length = 0;
  let res = await req('POST', '/api/run/Para%20A', {});
  assert.equal(res.status, 200);
  res = await req('POST', '/api/run/Para%20B', {});
  assert.equal(res.status, 200);
  assert.ok(bctl.RUNS.has('Para A'));
  assert.ok(bctl.RUNS.has('Para B'));
  await pollUntil(() => !bctl.RUNS.has('Para A') && !bctl.RUNS.has('Para B'), 8000);
  assert.equal(bctl.DONE.splice(0).length, 2);
  await close();
});

test('API: cancel kills only the targeted run', async () => {
  const t1 = task('Kill A', { group: 'G', commands: 'sleep 30' });
  const t2 = task('Kill B', { group: 'G', commands: 'sleep 2' });
  await bootWith(makeConfig([t1, t2]));
  const { req, close } = await api();
  bctl.DONE.length = 0;
  await req('POST', '/api/run/Kill%20A', {});
  await req('POST', '/api/run/Kill%20B', {});
  let res = await req('POST', '/api/cancel', { task: 'Kill A' });
  assert.equal(res.status, 200);
  await pollUntil(() => !bctl.RUNS.has('Kill A'), 8000);
  assert.ok(bctl.RUNS.has('Kill B')); // the other run is untouched
  await pollUntil(() => !bctl.RUNS.has('Kill B'), 8000);
  const done = bctl.DONE.splice(0);
  assert.equal(done.find((d) => d.task === 'Kill A').summary, 'Cancelled by user');
  assert.equal(done.find((d) => d.task === 'Kill B').ok, true);
  await close();
});

test('API: same serial_key tasks run sequentially', async () => {
  const t1 = task('Serial A', { group: 'G', serial_key: 'shared', commands: 'sleep 1' });
  const t2 = task('Serial B', { group: 'G', serial_key: 'shared', commands: 'sleep 1' });
  await bootWith(makeConfig([t1, t2]));
  const { req, close } = await api();
  bctl.DONE.length = 0;
  let res = await req('POST', '/api/run/Serial%20A', {});
  assert.equal(res.status, 200);
  assert.equal(res.json.queued, undefined);
  res = await req('POST', '/api/run/Serial%20B', {});
  assert.equal(res.status, 200);
  assert.equal(res.json.queued, true);
  assert.ok(!bctl.RUNS.has('Serial B')); // queued, not running
  // B starts only after A finishes; B's done arrives after
  await pollUntil(() => !bctl.RUNS.has('Serial A'), 8000);
  await pollUntil(() => bctl.RUNS.has('Serial B'), 8000);
  await pollUntil(() => !bctl.RUNS.has('Serial B'), 8000);
  assert.equal(bctl.DONE.splice(0).length, 2);
  await close();
});

test('running marker: multiple in-flight tasks, per-task clearing', async () => {
  bctl.markRunning('m1');
  bctl.markRunning('m2');
  bctl.markRunning('m1');
  assert.deepEqual(bctl.runningMarker().map((m) => m.task), ['m2', 'm1']);
  bctl.clearRunning('m1');
  assert.deepEqual(bctl.runningMarker().map((m) => m.task), ['m2']);
  bctl.clearRunning('m2');
  assert.equal(bctl.runningMarker(), null);
});

test('API: paste_done commits the capture dir', async () => {
  const commitDir = path.join(SANDBOX, 'paste-dest');
  const t = task('Paste', { group: 'G', capture: true, commit_dir: commitDir, commands: 'true' });
  await bootWith(makeConfig([t]));
  const { req, close } = await api();
  let res = await req('POST', '/api/run/Paste', {});
  await pollUntil(() => !bctl.RUNS.has('Paste'));
  fs.mkdirSync(commitDir, { recursive: true });
  fs.writeFileSync(path.join(commitDir, 'data.txt'), 'x');
  res = await req('POST', '/api/paste_done/Paste', {});
  assert.equal(res.status, 200);
  assert.equal(res.json.committed, true);
  const { out } = await bctl.shCapture(`git -C ${bctl.shellQuote(commitDir)} ls-files`);
  assert.ok(out.includes('data.txt'));
  await close();
});

test('API: /api/log returns the last run output', async () => {
  const t = task('Log Task', { group: 'G', commands: 'echo hello-log' });
  await bootWith(makeConfig([t]));
  const { req, close } = await api();
  let res = await req('POST', '/api/run/Log%20Task', {});
  await pollUntil(() => !bctl.RUNS.has('Log Task'));
  res = await req('GET', '/api/log/Log%20Task');
  assert.equal(res.status, 200);
  assert.match(res.json.output, /hello-log/);
  res = await req('GET', '/api/log/No%20Such%20Task');
  assert.equal(res.status, 404);
  await close();
});

test('availability: host pins gate tasks to the matching instance', () => {
  const previous = process.env.BACKUPCTL_HOST;
  try {
    process.env.BACKUPCTL_HOST = 'srv0';
    assert.equal(bctl.instanceHost(), 'srv0');
    assert.deepEqual(bctl.availability({ host: 'any' }, { host: 'srv0' }), [true, '']);
    assert.deepEqual(bctl.availability({}, { host: 'srv0' }), [true, '']);
    assert.deepEqual(bctl.availability({ host: 'srv0' }, { host: 'srv0' }), [true, '']);
    assert.deepEqual(bctl.availability({ host: 'pc' }, { host: 'srv0' }), [false, 'Pinned to pc']);
    assert.deepEqual(bctl.availability({ host: 'pc' }, { host: 'pc' }), [true, '']);
    // falls back to the instance identity when no local host is given
    assert.deepEqual(bctl.availability({ host: 'srv0' }, {}), [true, '']);
    delete process.env.BACKUPCTL_HOST;
    assert.equal(bctl.instanceHost(), 'pc');
  } finally {
    if (previous === undefined) delete process.env.BACKUPCTL_HOST;
    else process.env.BACKUPCTL_HOST = previous;
  }
});

test('API: host-pinned tasks are unavailable with a reason on the wrong instance', async () => {
  const previous = process.env.BACKUPCTL_HOST;
  try {
    process.env.BACKUPCTL_HOST = 'srv0';
    await bootWith(makeConfig([
      task('Anywhere', { commands: 'true' }),
      task('Pc Only', { host: 'pc', commands: 'true' }),
      task('Server Only', { host: 'srv0', commands: 'true' }),
    ]));
    const { req, close } = await api();
    const res = await req('GET', '/api/tasks');
    const byName = Object.fromEntries(res.json.groups[0].tasks.map((t) => [t.name, t]));
    assert.equal(byName['Anywhere'].avail, true);
    assert.equal(byName['Pc Only'].avail, false);
    assert.equal(byName['Pc Only'].avail_reason, 'Pinned to pc');
    assert.equal(byName['Server Only'].avail, true);
    await close();
  } finally {
    if (previous === undefined) delete process.env.BACKUPCTL_HOST;
    else process.env.BACKUPCTL_HOST = previous;
  }
});

test('config: host must be a machine name string', async () => {
  await assert.rejects(
    () => bctl.loadConfig(makeConfig([task('Bad Host', { host: 42, commands: 'true' })])),
    /host must be a machine name/,
  );
  const [local, tasks] = await bctl.loadConfig(makeConfig([task('Ok Host', { commands: 'true' })]));
  assert.equal(tasks[0].host, 'any');
  assert.equal(typeof local.host, 'undefined', 'local.host is set at boot, not by loadConfig');
});

test('base path: the app mounts under BASE_PATH with the shared kit', async () => {
  await bootWith(makeConfig([task('Prefixed', { commands: 'true' })]));
  const app = bctl.createApp({ basePath: '/tasks' });
  const srv = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  try {
    const base = `http://127.0.0.1:${srv.address().port}`;

    const page = await fetch(`${base}/tasks`);
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.match(html, /<base href="\/tasks\/">/)
    assert.match(html, /<title>D\$CPLN ⋅ Task Runner<\/title>/)

    const tasks = await (await fetch(`${base}/tasks/api/tasks`)).json();
    assert.equal(tasks.groups[0].tasks[0].name, 'Prefixed');

    const health = await (await fetch(`${base}/tasks/api/health`)).json();
    assert.equal(health.ok, true);
    assert.equal(health.basePath, '/tasks');

    const asset = /src="\.\/(assets\/[^"]+\.js)"/.exec(html)?.[1];
    assert.ok(asset, 'the built UI bundle must be referenced');
    assert.equal((await fetch(`${base}/tasks/${asset}`)).status, 200);

    const crossOrigin = await fetch(`${base}/tasks/api/run/Prefixed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://evil.example' },
      body: '{}',
    });
    assert.equal(crossOrigin.status, 403);
  } finally {
    await new Promise((r) => srv.close(r));
  }
});

test('API: empty uploads are rejected and leave no .part file', async () => {
  const t = task('Empty Upload', { uploads: true, glob: '*.zip', commands: 'true' });
  await bootWith(makeConfig([t]));
  const { req, close } = await api();

  const res = await req('POST', '/api/upload/Empty%20Upload?name=empty.zip', '', true);
  assert.equal(res.status, 400);
  assert.match(res.json.detail, /empty/);
  const staging = bctl.stagingDir('Empty Upload');
  assert.deepEqual(fs.readdirSync(staging), [], 'no .part file is left behind');
  await close();
});
