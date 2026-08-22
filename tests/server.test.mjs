import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'bctl-run-'));
process.env.BACKUPCTL_STATE_DIR = path.join(SANDBOX, 'state');

const core = await import('../core.mjs');
const server = await import('../server.mjs');

const DATA = path.join(SANDBOX, 'data');
const maindir = DATA;

function makeConfig(tasks, extraValues = {}) {
  const p = path.join(SANDBOX, `config-${Math.random().toString(36).slice(2)}.mjs`);
  const data = { maindir, ...extraValues, tasks };
  fs.writeFileSync(p, `export default ${JSON.stringify(data)};`);
  return p;
}

function task(name, fields) {
  return { name, state_dir: '{{maindir}}/State/' + name, timeout: 60, ...fields };
}

async function bootWith(configPath) {
  await server.boot(configPath);
}

async function api() {
  const app = server.createApp();
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
  const d = core.stagingDir(taskName);
  fs.writeFileSync(path.join(d, filename), content);
}

// ---- runner-level task suites ---------------------------------------------

test('move subcommand: renames the drop, commits, clears staging, records state', async () => {
  const t = task('Move Test', {
    group: 'G',
    uploads: true,
    glob: 'bookmarks_*.html',
    summary_last_line: true,
    command:
      "bash '{{lib}}' move --git --rename bookmarks.html '{{maindir}}/Dest' {{uploads}}",
  });
  const cfgPath = makeConfig([t]);
  const [l2, t2] = await core.loadConfig(cfgPath);
  await stage(t.name, 'bookmarks_2024.html', '<html>');
  const [ok, summary] = await server.runTask(t2[0], l2, [
    path.join(core.stagingDir(t.name), 'bookmarks_2024.html'),
  ]);
  assert.equal(ok, true, summary);
  assert.equal(summary, 'Moved 1 file(s) → ' + path.join(maindir, 'Dest'));
  assert.ok(fs.existsSync(path.join(maindir, 'Dest', 'bookmarks.html')));
  assert.deepEqual(fs.readdirSync(core.stagingDir(t.name)), []); // staging cleared
  const state = core.loadTaskState(t2[0], l2);
  assert.equal(state.ok, true);
  // git commit happened and excluded state files
  const { rc, out } = await core.shCapture(`git -C ${core.shellQuote(path.join(maindir, 'Dest'))} ls-files`);
  assert.equal(rc, 0);
  assert.ok(out.includes('bookmarks.html'));
  assert.ok(!out.includes('.backup-state'));
});

test('mappings heredoc: per-pattern renames', async () => {
  const t = task('Contacts', {
    group: 'G',
    uploads: true,
    glob: ['contacts-*.vcf', 'todo-*.ics'],
    summary_last_line: true,
    command: `bash <<'BASH_SCRIPT'
source '{{lib}}'
DEST='{{maindir}}/Dest2'
mkdir -p "$DEST"
for f in {{uploads}}; do
  case "$(basename "$f")" in
    contacts-*.vcf) mv "$f" "$DEST/My Contacts.vcf" ;;
    todo-*.ics) mv "$f" "$DEST/TODO.ics" ;;
  esac
done
bctl_git_commit "$DEST"
log "Files → $DEST"
BASH_SCRIPT`,
  });
  const cfgPath = makeConfig([t]);
  await stage(t.name, 'contacts-1.vcf', 'vcf');
  await stage(t.name, 'todo-2.ics', 'ics');
  const [local, tasks] = await core.loadConfig(cfgPath);
  const files = fs.readdirSync(core.stagingDir(t.name)).map((f) => path.join(core.stagingDir(t.name), f));
  const [ok, summary] = await server.runTask(tasks[0], local, files);
  assert.equal(ok, true, summary);
  assert.ok(fs.existsSync(path.join(maindir, 'Dest2', 'My Contacts.vcf')));
  assert.ok(fs.existsSync(path.join(maindir, 'Dest2', 'TODO.ics')));
});

test('ingest heredoc: extracts, identifies account, names the folder', async () => {
  // GitHub-style: tar.gz containing users_000001.json with a billing login
  const archiveSrc = path.join(SANDBOX, 'ingest-src');
  fs.mkdirSync(archiveSrc);
  fs.writeFileSync(
    path.join(archiveSrc, 'users_000001.json'),
    JSON.stringify([{ login: 'user', billing_plan: 'x' }, { login: 'other' }])
  );
  const { rc } = await core.shCapture(`tar czf ${core.shellQuote(path.join(SANDBOX, 'gh.tar.gz'))} -C ${core.shellQuote(archiveSrc)} .`);
  assert.equal(rc, 0);
  const t = task('GitHub Ingest', {
    group: 'G',
    uploads: true,
    glob: '*.tar.gz',
    summary_last_line: true,
    command: `bash <<'BASH_SCRIPT'
source '{{lib}}'
FILES=({{uploads}})
tmp=$(mktemp -d -t bctl_ingest.XXXXXX)
for f in "\${FILES[@]}"; do
  bctl_extract "$f" "$tmp"
done
suffix=$(cd "$tmp" && cat users_000001.json | jq "(.[] | select(.billing_plan != null)).login" | head -c -2 | tail -c +2 2>/dev/null) || true
DEST='{{maindir}}/Backups/GitHub'
[[ -n "$suffix" ]] && DEST="$DEST - $suffix"
mkdir -p "$DEST"
bctl_rsync_delete --exclude .git/ "$tmp/" "$DEST"
rm -rf "$tmp"
bctl_git_commit "$DEST"
log "Imported into $DEST"
BASH_SCRIPT`,
  });
  const cfgPath = makeConfig([t]);
  await stage(t.name, 'gh.tar.gz', fs.readFileSync(path.join(SANDBOX, 'gh.tar.gz')));
  const [local, tasks] = await core.loadConfig(cfgPath);
  const files = [path.join(core.stagingDir(t.name), 'gh.tar.gz')];
  const [ok, summary] = await server.runTask(tasks[0], local, files);
  assert.equal(ok, true, summary);
  assert.ok(fs.existsSync(path.join(maindir, 'Backups', 'GitHub - imranr', 'users_000001.json')));
});

test('copy subcommand with --git + --pre: sources synced, state excluded', async () => {
  const src1 = path.join(SANDBOX, 'src1');
  fs.mkdirSync(src1);
  fs.writeFileSync(path.join(src1, 'f.txt'), 'data');
  const pre = path.join(SANDBOX, 'pre.log');
  const t = task('Copy Test', {
    group: 'G',
    summary_last_line: true,
    command: `bash '{{lib}}' copy --git --pre 'echo pre > ${pre}' '{{maindir}}/Copied' ${src1}`,
  });
  const cfgPath = makeConfig([t]);
  const [local, tasks] = await core.loadConfig(cfgPath);
  const [ok, summary] = await server.runTask(tasks[0], local, []);
  assert.equal(ok, true, summary);
  assert.ok(fs.existsSync(path.join(maindir, 'Copied', 'src1', 'f.txt')));
  assert.equal(fs.readFileSync(pre, 'utf8').trim(), 'pre');
  const { out } = await core.shCapture(`git -C ${core.shellQuote(path.join(maindir, 'Copied', 'src1'))} ls-files`);
  assert.ok(out.includes('f.txt'));
});

test('encrypt task: age round-trip via the pty runner, passphrase redacted', { skip: !(await hasPtyTools()) }, async () => {
  const src = path.join(SANDBOX, 'secret.txt');
  fs.writeFileSync(src, 'top secret data');
  const t = task('Encrypt', {
    group: 'G',
    uploads: true,
    glob: 'secret.txt',
    require: ['password'],
    summary_last_line: true,
    command: "AGE_PASSPHRASE='{{password}}' bash '{{lib}}' encrypt '{{node}}' '{{maindir}}/Encrypted' secret.txt.age {{uploads}}",
  });
  const cfgPath = makeConfig([t]);
  await stage(t.name, 'secret.txt', fs.readFileSync(src));
  const [local, tasks] = await core.loadConfig(cfgPath);
  const files = [path.join(core.stagingDir(t.name), 'secret.txt')];
  const log = [];
  const [ok, summary] = await server.runTask(tasks[0], local, files, (l) => log.push(l), { password: 'hunter2-secret' });
  assert.equal(ok, true, `summary=${summary}; log=${log.join(' | ')}`);
  const enc = path.join(maindir, 'Encrypted', 'secret.txt.age');
  assert.ok(fs.existsSync(enc));
  // round-trip decrypt through the same pty runner (passphrase-protected
  // files are auto-detected by age)
  const coreMjs = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'core.mjs');
  const { rc } = await core.shCapture(
    `printf '%s\n%s\n' hunter2-secret hunter2-secret | node ${core.shellQuote(coreMjs)} age --decrypt -o ${core.shellQuote(path.join(SANDBOX, 'dec.txt'))} ${core.shellQuote(enc)}`
  );
  assert.equal(rc, 0);
  assert.equal(fs.readFileSync(path.join(SANDBOX, 'dec.txt'), 'utf8'), 'top secret data');
  // passphrase never appears in the log (echo + command display both redacted)
  assert.ok(!log.join('\n').includes('hunter2-secret'));
});

async function hasPtyTools() {
  for (const bin of ['python3', 'age', 'tar']) {
    const { rc } = await core.shCapture(`command -v ${bin} >/dev/null 2>&1`);
    if (rc !== 0) return false;
  }
  return true;
}

test('uploads with no files fails fast', async () => {
  const t = task('Empty Uploads', { group: 'G', uploads: true, glob: '*.txt', command: 'true' });
  const [ok, summary] = await server.runTask(t, { maindir }, []);
  assert.equal(ok, false);
  assert.equal(summary, 'No files queued — drop them here first');
});

test('require: missing input fails', async () => {
  const t = task('Req', { group: 'G', require: ['confirmed'], command: 'true' });
  const [ok, summary] = await server.runTask(t, { maindir }, []);
  assert.equal(ok, false);
  assert.equal(summary, 'Missing required input: confirmed');
  const [ok2] = await server.runTask(t, { maindir }, [], null, { confirmed: 'yes' });
  assert.equal(ok2, true);
});

test('capture: output becomes the summary; paste_done commits', async () => {
  const t = task('Capture', {
    group: 'G',
    capture: true,
    commit_dir: '{{maindir}}/CapDest',
    commands: ['echo line1', 'echo line2'],
  });
  const [ok, summary] = await server.runTask(t, { maindir }, []);
  assert.equal(ok, true);
  assert.equal(summary, 'line1\nline2');
  // paste done via gitCommit path
  await core.gitCommit(path.join(maindir, 'CapDest'), 'test');
});

test('summary_last_line: last non-command log line', async () => {
  const t = task('SumLast', {
    group: 'G',
    summary_last_line: true,
    command: 'echo first; echo lastline',
  });
  const [ok, summary] = await server.runTask(t, { maindir }, []);
  assert.equal(ok, true);
  assert.equal(summary, 'lastline');
});

test('timeout: hangs are killed and reported', async () => {
  const t = task('Slow', { group: 'G', timeout: 1, command: 'sleep 100' });
  const [ok, summary] = await server.runTask(t, { maindir }, []);
  assert.equal(ok, false);
  assert.equal(summary, 'Command timed out after 1s');
});

test('redaction: secret in command output is masked, state output too', async () => {
  const t = task('Redact', {
    group: 'G',
    command: "echo 'my-super-secret-token'",
  });
  const log = [];
  const [ok, summary] = await server.runTask(t, { maindir }, [], (l) => log.push(l), { password: 'my-super-secret-token' });
  assert.equal(ok, true);
  assert.ok(!log.join('\n').includes('my-super-secret-token'));
  const state = core.loadTaskState(t, { maindir });
  assert.ok(!state.output.includes('my-super-secret-token'));
  assert.ok(state.output.includes('***'));
});

test('args: empty values drop their flag pair; tool installs from a local server', async () => {
  // serve a tiny "cli" tarball
  const toolDir = path.join(SANDBOX, 'toolbuild');
  fs.mkdirSync(toolDir);
  fs.writeFileSync(path.join(toolDir, 'mycli'), '#!/bin/sh\necho "ran $@"\n');
  fs.chmodSync(path.join(toolDir, 'mycli'), 0o755);
  await core.shCapture(`tar czf ${core.shellQuote(path.join(SANDBOX, 'tool.tar.gz'))} -C ${core.shellQuote(toolDir)} mycli`);
  const httpSrv = http.createServer((req, res) => {
    res.end(fs.readFileSync(path.join(SANDBOX, 'tool.tar.gz')));
  });
  await new Promise((r) => httpSrv.listen(0, '127.0.0.1', r));
  const toolUrl = `http://127.0.0.1:${httpSrv.address().port}/tool.tar.gz`;
  const outFile = path.join(SANDBOX, 'args-out.txt');
  const t = task('Tool Args', {
    group: 'G',
    tool: { url: toolUrl, dir: path.join(SANDBOX, 'tools'), binary: 'mycli', extract: true, chmod: true },
    args: ['{{tool_binary}}', '-k', '-p', '{{password}}', '-t', '{{totp}}'],
    command: 'true',
  });
  const log = [];
  const [ok, summary] = await server.runTask(t, { maindir }, [], (l) => log.push(l), { password: 'pw1' });
  assert.equal(ok, true, summary);
  const joined = log.join('\n');
  assert.ok(joined.includes('ran -k -p ***'), `password masked and pair kept; got: ${joined}`);
  assert.ok(!joined.includes('-t'), `empty {{totp}} pair must be dropped; got: ${joined}`);
  httpSrv.close();
});

test('fresh_dir + prune: stale check, old exports pruned, keep_newer respected', async () => {
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
    fresh_dir: exportRoot,
    prune: { dir: exportRoot, keep_newer: true },
    command: `mkdir -p ${exportRoot}/2024-04 && echo x > ${exportRoot}/2024-04/f.txt`,
  });
  const log = [];
  const [ok, summary] = await server.runTask(t, { maindir }, [], (l) => log.push(l));
  assert.equal(ok, true, summary);
  const remaining = fs.readdirSync(exportRoot);
  assert.ok(remaining.includes('2024-04'), 'newest export kept');
  assert.ok(remaining.includes('2024-02'), 'keep_newer keeps bigger dirs');
  assert.ok(!remaining.includes('2024-01'), 'older smaller dir pruned');
  assert.ok(!remaining.includes('2024-03'), 'stale dir pruned');
  assert.ok(log.join('\n').includes('MORE files'));
});

test('fresh_dir: empty newest export fails the run', async () => {
  const exportRoot = path.join(SANDBOX, 'exports2');
  const t = task('FreshEmpty', {
    group: 'G',
    fresh_dir: exportRoot,
    command: `mkdir -p ${exportRoot}/backup`,
  });
  const [ok, summary] = await server.runTask(t, { maindir }, []);
  assert.equal(ok, false);
  assert.match(summary, /empty or stale/);
});

// ---- API-level suites ------------------------------------------------------

test('API: upload validation, detect scoring + ambiguity, CSRF guard', async () => {
  const t1 = task('Detect A', { group: 'G', uploads: true, glob: 'takeout-*.zip', command: 'true' });
  const t2 = task('Detect B', { group: 'G', uploads: true, glob: '*.zip', command: 'true' });
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
  await pollUntil(() => !server.CURRENT.name);
  res = await req('GET', '/api/tasks');
  const ta = res.json.tasks.find((x) => x.name === 'Detect A');
  assert.equal(ta.state.ok, true);

  // CSRF: cross-origin POST blocked; same-origin allowed
  res = await req('POST', '/api/run/Detect%20A', {}, false, { origin: 'https://evil.example' });
  assert.equal(res.status, 403);
  res = await req('POST', '/api/run/Detect%20A', {}, false, { origin: base });
  assert.equal(res.status, 200);
  await pollUntil(() => !server.CURRENT.name);
  await close();
});

test('API: run/cancel flow kills the task', async () => {
  const t = task('Cancel Me', { group: 'G', timeout: 300, command: 'sleep 100' });
  await bootWith(makeConfig([t]));
  const { req, close } = await api();
  let res = await req('POST', '/api/run/Cancel%20Me', {});
  assert.equal(res.status, 200);
  assert.equal(server.CURRENT.name, 'Cancel Me');
  // concurrent run refused
  res = await req('POST', '/api/run/Cancel%20Me', {});
  assert.equal(res.status, 409);
  // cancel
  res = await req('POST', '/api/cancel');
  assert.equal(res.status, 200);
  await pollUntil(() => server.CURRENT.done !== null, 8000);
  assert.equal(server.CURRENT.done.ok, false);
  assert.equal(server.CURRENT.done.summary, 'Cancelled by user');
  await close();
});

test('API: paste_done commits the capture dir', async () => {
  const commitDir = path.join(SANDBOX, 'paste-dest');
  const t = task('Paste', { group: 'G', capture: true, commit_dir: commitDir, command: 'true' });
  await bootWith(makeConfig([t]));
  const { req, close } = await api();
  let res = await req('POST', '/api/run/Paste', {});
  await pollUntil(() => server.CURRENT.done !== null);
  fs.mkdirSync(commitDir, { recursive: true });
  fs.writeFileSync(path.join(commitDir, 'data.txt'), 'x');
  res = await req('POST', '/api/paste_done/Paste', {});
  assert.equal(res.status, 200);
  assert.equal(res.json.committed, true);
  const { out } = await core.shCapture(`git -C ${core.shellQuote(commitDir)} ls-files`);
  assert.ok(out.includes('data.txt'));
  await close();
});
