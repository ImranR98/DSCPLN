#!/usr/bin/env node
/* backupctl — Express server, generic bash runner, and CLI entry, in one module.
 *
 * Tasks are bash: each task has a `commands` list (or a single string)
 * executed by the runner with process groups, secret redaction, and
 * per-task state recording. Multiple tasks can run in parallel; tasks with
 * the same `serial_key:` run one at a time. There are no automatic
 * timeouts — a run goes until it finishes or the user cancels it. Runner
 * options: `uploads:` (dropped files, available as {{uploads}}), `glob:`
 * (drop pattern, or list of patterns), `prompts:` (confirm/secret,
 * redacted), `require:`, `capture:` + `commit_dir:` (output shown in a
 * paste dialog), `root:` (availability badge), `summary_last_line:`
 * (summary = last log line). Everything service-specific (tool installs,
 * export validation, pruning) lives in the task's own bash or in lib.sh. */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import express from 'express';

export const REPO_DIR = path.dirname(new URL(import.meta.url).pathname);
export const CONFIG_FILE = process.env.BACKUPCTL_CONFIG_FILE ?? path.join(REPO_DIR, 'config.mjs');
export const LIB_PATH = path.join(REPO_DIR, 'lib.sh');
const INDEX_PATH = path.join(REPO_DIR, 'index.html');
const DAY_SECONDS = 86400;

// config ---------------------------------------------------------------------

export class ConfigMissingError extends Error {}
export class ConfigError extends Error {}

export async function loadConfig(configPath = CONFIG_FILE) {
  const p = configPath instanceof URL ? configPath : path.resolve(configPath);
  if (!fs.existsSync(p)) {
    throw new ConfigMissingError(
      `Missing config file ${p} — create it (see README.md for the schema)`
    );
  }
  let mod;
  try {
    mod = await import(pathToFileURL(p).href);
  } catch (e) {
    throw new ConfigError(`Failed to load ${p}: ${e.message}`);
  }
  const data = mod.default ?? {};
  const groups = data.groups ?? [];
  const local = { ...data };
  delete local.groups;
  local.repo_dir ??= process.env.BACKUPCTL_REPO_DIR ?? REPO_DIR;
  local.lib ??= LIB_PATH;
  if (!Array.isArray(groups)) throw new ConfigError("Config needs a 'groups' array");
  const tasks = [];
  const groupSeen = new Set();
  const taskSeen = new Set();
  for (const g of groups) {
    if (!g.name) throw new ConfigError("Every group needs a 'name'");
    if (groupSeen.has(g.name)) throw new ConfigError(`Duplicate group name: '${g.name}'`);
    groupSeen.add(g.name);
    for (const t of g.tasks ?? []) {
      const merged = { ...g.defaults, ...t, group: g.name };
      if (!merged.name) throw new ConfigError("Every task needs a 'name'");
      if (!merged.state_dir) throw new ConfigError(`Task '${merged.name}' needs a 'state_dir' for its run state`);
      if (!merged.commands) throw new ConfigError(`Task '${merged.name}' needs 'commands' (a bash string or array)`);
      if (taskSeen.has(merged.name)) throw new ConfigError(`Duplicate task name: '${merged.name}'`);
      taskSeen.add(merged.name);
      tasks.push(merged);
    }
  }
  return [local, tasks];
}

const TILDE_RE = /^~(?=[/]|$)/;

function tilde(value) {
  return String(value).replace(TILDE_RE, os.homedir());
}

export function expand(p) {
  return tilde(p).replace(/\$(\w+)|\$\{([^}]+)\}/g, (m, a, b) => process.env[a || b] ?? '');
}

const TOKEN_RE = /\{\{([a-zA-Z0-9_.]+)\}\}/g;

function lookup(key, local, extra) {
  if (extra && key in extra) return extra[key];
  let node = local;
  for (const part of key.split('.')) {
    if (node && typeof node === 'object' && part in node) node = node[part];
    else return undefined;
  }
  return node;
}

/* Replace {{a.b.c}} tokens from local (and per-run extra). Values may
 * reference other tokens, so resolution loops until stable. A template that
 * is exactly one token resolves to its typed value (dict/list/int);
 * embedded tokens are stringified. */
export function resolve(template, local, extra = {}) {
  if (typeof template !== 'string') return template;
  let result = template;
  for (let i = 0; i < 10; i++) {
    const next = result.replace(TOKEN_RE, (m, key) => {
      const value = lookup(key, local, extra);
      if (value === undefined) return m;
      const s = typeof value === 'string' ? tilde(value) : String(value);
      return s;
    });
    if (next === result) break;
    result = next;
  }
  const full = /^\{\{([a-zA-Z0-9_.]+)\}\}$/.exec(template);
  if (full) {
    const value = lookup(full[1], local, extra);
    if (value === undefined) return result; // unresolved token: leave the literal template
    if (typeof value !== 'string') return value;
    return result;
  }
  return result;
}

/* ~ values must expand here: inside command strings they are usually
 * quoted, so the shell's tilde expansion never sees them */

// run state + staging --------------------------------------------------------

export const STATE_DIR = process.env.BACKUPCTL_STATE_DIR ?? path.join(os.homedir(), '.backupctl');
const RUNNING_FILE = path.join(STATE_DIR, 'running.json');

export function slugify(name) {
  return String(name).replace(/[^a-zA-Z0-9_-]/g, '_');
}

export function stateFileFor(task, local) {
  const raw = task.state_dir;
  if (!raw) throw new Error(`Task '${task.name}' needs a 'state_dir' for its run state`);
  const base = expand(resolve(raw, local));
  return path.join(base, `.backup-state-${slugify(task.name)}.json`);
}

export function saveTaskState(task, local, ok, summary, output = '') {
  const file = stateFileFor(task, local);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const data = {
    task: task.name,
    ts: Date.now() / 1000,
    ok,
    summary,
    output,
  };
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 1));
  fs.renameSync(tmp, file);
}

export function loadTaskState(task, local) {
  const file = stateFileFor(task, local);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

export function markRunning(taskName) {
  const list = (runningMarker() ?? []).filter((m) => m.task !== taskName);
  list.push({ task: taskName, ts: Date.now() / 1000 });
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(RUNNING_FILE, JSON.stringify(list));
}

export function clearRunning(taskName) {
  const list = (runningMarker() ?? []).filter((m) => m.task !== taskName);
  if (list.length) fs.writeFileSync(RUNNING_FILE, JSON.stringify(list));
  else fs.rmSync(RUNNING_FILE, { force: true });
}

export function runningMarker() {
  if (!fs.existsSync(RUNNING_FILE)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(RUNNING_FILE, 'utf8'));
    return Array.isArray(data) ? data : null;
  } catch {
    return null;
  }
}

export function stagingDir(taskName) {
  const d = path.join(STATE_DIR, 'staging', slugify(taskName));
  fs.mkdirSync(d, { recursive: true });
  return d;
}

/* Run commands get TMPDIR here (a per-run subdir): the real filesystem,
 * not a small/quota'd /tmp tmpfs. Each run's subdir is wiped when it ends. */
export function tmpRoot() {
  return process.env.BACKUPCTL_TMP_DIR ?? path.join(os.homedir(), 'Downloads', 'backupctl-tmp');
}

// subprocess layer -----------------------------------------------------------

const ASKPASS_PATH = path.join(STATE_DIR, 'askpass.sh');

function ensureAskpass() {
  if (!fs.existsSync(ASKPASS_PATH)) {
    fs.mkdirSync(path.dirname(ASKPASS_PATH), { recursive: true });
    fs.writeFileSync(ASKPASS_PATH, '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  }
  return ASKPASS_PATH;
}

// Commands run with stdin closed (interactive prompts fail fast instead of
// hanging) and SSH forced to use a failing askpass (no password prompts on a
// hidden terminal).
export const SAFE_ENV = {
  ...process.env,
  SSH_ASKPASS_REQUIRE: 'force',
  SSH_ASKPASS: ensureAskpass(),
};

export function shellQuote(arg) {
  const s = String(arg);
  if (/^[\w@%+=:,./-]+$/.test(s)) return s;
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

function redactText(text, secrets) {
  for (const secret of secrets) text = text.replaceAll(secret, '***');
  return text;
}

export function killpg(pid, log = () => {}) {
  try {
    process.kill(-pid, 'SIGTERM');
  } catch { /* already gone or not permitted */ }
  setTimeout(() => {
    try {
      process.kill(-pid, 'SIGKILL');
    } catch { /* already gone */ }
  }, 1000);
  log('(killed)');
}

function spawnSafe(cmd, opts = {}) {
  const { cwd, shell = false, env = {} } = opts;
  const [file, args] = Array.isArray(cmd) ? [cmd[0], cmd.slice(1)] : [cmd, []];
  return spawn(file, args, {
    cwd,
    shell,
    detached: true,
    env: { ...SAFE_ENV, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/* Run a command (argv list or shell string). By default output lines are
 * streamed into log() and the exit code is returned; with `capture: true`
 * all output is buffered and {rc, out, err} is returned instead. Spawned
 * pids are registered in `groups` (default: a throwaway set) so a
 * per-run cancel can kill exactly this run's process groups; redact masks
 * secrets in the logged command and output. No automatic timeout — runs
 * end when the command exits or is cancelled. */
export function run(cmd, opts = {}) {
  const { shell = false, cwd, log = () => {}, redact = [], capture = false, env = {}, groups = new Set() } = opts;
  log(`$ ${redactText(shell ? cmd : cmd.map(shellQuote).join(' '), redact)}`);
  let proc;
  const outBuf = [];
  const errBuf = [];
  const done = (rc) => (capture ? { rc, out: redactText(outBuf.join(''), redact), err: redactText(errBuf.join(''), redact) } : rc);
  try {
    proc = spawnSafe(cmd, { cwd, shell, env });
  } catch (e) {
    log(`ERROR: could not start: ${e.message}`);
    return Promise.resolve(capture ? { rc: 127, out: '', err: String(e) } : 127);
  }
  proc.stdout.on('error', () => {});
  proc.stderr.on('error', () => {});
  proc.stdout.on('data', (d) => {
    if (capture) {
      outBuf.push(d);
      return;
    }
    // terminal-faithful line splitting: '\r' (progress updates) and '\n'
    // both end a line; the trailing partial line is flushed on close
    outTail += d;
    let idx;
    while ((idx = outTail.search(/[\r\n]/)) !== -1) {
      log(redactText(outTail.slice(0, idx), redact));
      const skip = outTail[idx] === '\r' && outTail[idx + 1] === '\n' ? 2 : 1;
      outTail = outTail.slice(idx + skip);
    }
  });
  proc.stderr.on('data', (d) => { errBuf.push(d); });
  groups.add(proc.pid);
  let outTail = '';
  return new Promise((resolvePromise) => {
    let settled = false;
    proc.on('error', (e) => {
      if (settled) return;
      settled = true;
      log(`ERROR: could not start: ${e.message}`);
      groups.delete(proc.pid);
      resolvePromise(capture ? { rc: 127, out: redactText(outBuf.join(''), redact), err: redactText(errBuf.join(''), redact) } : 127);
    });
    proc.on('close', (code, signal) => {
      if (settled) return;
      settled = true;
      groups.delete(proc.pid);
      const rc = code ?? (signal ? 128 + (os.constants.signals[signal] ?? 0) : 1);
      if (!capture) {
        if (outTail) log(redactText(outTail, redact));
        // stderr is buffered and flushed here (nothing is lost to the pipe race)
        const parts = redactText(errBuf.join(''), redact).split(/\r?\n/);
        if (parts.at(-1) === '') parts.pop();
        for (const line of parts) log(line);
      }
      resolvePromise(done(rc));
    });
  });
}

export function sh(cmd, opts = {}) {
  return run(cmd, { ...opts, shell: true });
}

/* Run a shell command capturing all output. Returns {rc, out, err}. */
export function shCapture(cmd, opts = {}) {
  return run(cmd, { ...opts, shell: true, capture: true });
}

export async function gitCommit(dest, message, log = () => {}) {
  fs.mkdirSync(dest, { recursive: true });
  if ((await run(['git', 'init', '-q'], { cwd: dest, log })) !== 0) {
    throw new Error(`git init failed in ${dest}`);
  }
  if ((await run(['git', 'add', '-A', '.', ':(exclude).backup-state-*'], { cwd: dest, log })) !== 0) {
    throw new Error(`git add failed in ${dest}`);
  }
  const { rc, out, err } = await shCapture(`git commit -q -m ${shellQuote(message)}`, { cwd: dest });
  if (rc !== 0 && !(out + err).includes('nothing to commit') && !(out + err).includes('nothing added to commit')) {
    throw new Error(`git commit failed in ${dest}: ${err.trim()}`);
  }
}

export function humanAgo(ts) {
  const delta = Date.now() / 1000 - ts;
  if (delta < 3600) return `${Math.floor(delta / 60)} min ago`;
  if (delta < 86400) return `${Math.floor(delta / 3600)} hr ago`;
  if (delta < 86400 * 30) return `${Math.floor(delta / 86400)} days ago`;
  if (delta < 86400 * 365) return `${Math.floor(delta / (86400 * 30))} months ago`;
  return `${Math.floor(delta / (86400 * 365))} years ago`;
}

/* Does a path pattern exist? Glob-aware, drives the availability badge. */
export function pathFound(pattern) {
  if (/[*?\[]/.test(pattern)) {
    try {
      return fs.globSync(pattern).length > 0;
    } catch {
      return false;
    }
  }
  try {
    return fs.statSync(pattern).isDirectory();
  } catch {
    return false;
  }
}

// runner ---------------------------------------------------------------------

function makeLogger() {
  const lines = [];
  const log = (line) => lines.push(line);
  log.lines = lines;
  log.text = () => lines.join('\n');
  return log;
}

function resolveTpl(template, ctx, extra = undefined) {
  return expand(resolve(template, ctx.local, extra));
}

function clearStaging(ctx) {
  const d = stagingDir(ctx.task.name);
  fs.rmSync(d, { recursive: true, force: true });
  fs.mkdirSync(d, { recursive: true });
}

function failRun(rc, tmp) {
  fs.rmSync(tmp, { recursive: true, force: true });
  return [false, `Command failed (exit ${rc})`];
}

export async function runCommands(ctx) {
  const task = ctx.task;
  const capture = Boolean(task.capture);
  if (task.uploads && !ctx.files.length) {
    return [false, 'No files queued — drop them here first'];
  }
  for (const key of task.require ?? []) {
    if (!(ctx.extra ?? {})[key]) return [false, `Missing required input: ${key}`];
  }
  const tmp = path.join(stagingDir(task.name), `tmp_${Math.floor(Math.random() * 1_000_000)}`);
  const extra = {
    uploads: ctx.files.map((f) => shellQuote(String(f))).join(' '),
    tmp: String(tmp),
    ...Object.fromEntries(Object.entries(ctx.extra ?? {}).map(([k, v]) => [k, String(v)])),
  };
  const redact = Object.values(ctx.extra ?? {}).filter((v) => v).map(String);
  const output = [];
  const cwd = resolveTpl(task.cwd ?? '.', ctx);
  const groups = ctx.groups ?? new Set();
  const env = { TMPDIR: ctx.tmpdir };
  const cmds = Array.isArray(task.commands) ? task.commands : [task.commands];
  for (const cmd of cmds) {
    const resolved = resolve(cmd, ctx.local, extra);
    let rc;
    if (capture) {
      const { rc: r, out, err } = await shCapture(resolved, { cwd, redact, env, groups });
      rc = r;
      const lines = out.split(/\r?\n/);
      if (lines.at(-1) === '') lines.pop();
      for (const line of lines) ctx.log(line);
      if (err.trim()) ctx.log(err.trim());
      output.push(...lines);
    } else {
      rc = await sh(resolved, { cwd, log: ctx.log, redact, env, groups });
    }
    if (rc !== 0) return failRun(rc, tmp);
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  if (capture) return [true, output.join('\n')];
  if (task.summary_last_line) {
    const last = [...ctx.log.lines].reverse().find((l) => l.trim() && !l.startsWith('$ '));
    return [true, last ?? 'Completed'];
  }
  return [true, 'Completed'];
}

// task metadata + dispatcher -------------------------------------------------

export function availability(task, local) {
  // tasks with a `root` (e.g. device mounts) are unavailable when missing
  const rootRaw = task.root;
  if (rootRaw) {
    const pattern = expand(resolve(rootRaw, local));
    if (!pathFound(pattern)) return [false, 'Source directory not found'];
  }
  return [true, ''];
}

export function supportsUploads(task) {
  return Boolean(task.uploads);
}

export function uploadPatterns(task, local = null) {
  const globs = task.glob ?? '*';
  let patterns = Array.isArray(globs) ? globs : [globs];
  if (local !== null) patterns = patterns.map((p) => resolve(p, local));
  return patterns;
}

export function matchScore(pattern) {
  return [...pattern].filter((c) => !'*?'.includes(c)).length;
}

/* Glob match for the simple patterns used in config (literal chars plus
 * `*`/`?`); a full glob library is not needed. */
export function globMatch(name, pattern) {
  let re = '';
  for (const ch of String(pattern)) {
    if (ch === '*') re += '.*';
    else if (ch === '?') re += '.';
    else re += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`).test(String(name));
}

export async function runTask(task, local, files, log = null, extra = null, opts = {}) {
  const lines = [];
  const sink = log ?? (() => {});
  const collectLog = (line) => {
    lines.push(line);
    sink(line);
  };
  collectLog.lines = lines;
  const groups = opts.groups ?? new Set();
  let tmpdir = opts.tmpdir;
  if (!tmpdir) {
    fs.mkdirSync(tmpRoot(), { recursive: true });
    tmpdir = fs.mkdtempSync(path.join(tmpRoot(), `${slugify(task.name)}-`));
  }
  fs.mkdirSync(tmpdir, { recursive: true });
  const ctx = { task, local, files, log: collectLog, extra: extra ?? {}, groups, tmpdir };
  let ok;
  let summary;
  try {
    [ok, summary] = await runCommands(ctx);
  } catch (e) {
    collectLog(`ERROR: ${e.message}`);
    [ok, summary] = [false, String(e.message ?? e)];
  } finally {
    if (task.uploads) clearStaging(ctx);
    fs.rmSync(tmpdir, { recursive: true, force: true });
  }
  saveTaskState(task, local, ok, summary, lines.join('\n'));
  return [ok, summary];
}

// server ---------------------------------------------------------------------

export let LOCAL = {};
export let TASK_LIST = [];
export let MISSING_CONFIG = false;
export let TASK_MAP = new Map();

export async function boot(configPath = undefined) {
  try {
    [LOCAL, TASK_LIST] = configPath
      ? await loadConfig(configPath)
      : await loadConfig();
  } catch (e) {
    if (e instanceof ConfigMissingError) {
      console.warn(`WARNING: ${e.message}`);
      MISSING_CONFIG = true;
    } else if (e instanceof ConfigError) {
      console.error(`config error: ${e.message}`);
      process.exit(1);
    } else {
      throw e;
    }
  }
  TASK_MAP = new Map(TASK_LIST.map((t) => [t.name, t]));
}

// run slots: any number of tasks can run in parallel; tasks sharing a
// `serial_key` are queued and run one at a time (FIFO per key).
export const RUNS = new Map(); // taskName -> { task, log, read, cancelled, groups: Set, ts, tmpdir }
export const DONE = []; // completed runs awaiting delivery to /api/status
const SERIAL_QUEUES = new Map(); // serial_key -> [{ taskName, payload }]

function serialKeyHeld(key) {
  if (!key) return false;
  for (const rec of RUNS.values()) {
    if (TASK_MAP.get(rec.task)?.serial_key === key) return true;
  }
  return false;
}

function drainSerialQueue(key) {
  if (!key || serialKeyHeld(key)) return;
  const next = SERIAL_QUEUES.get(key)?.shift();
  if (!next) return;
  startRun(next.taskName, next.payload);
}

export function isQueued(taskName, serialKey) {
  return Boolean(serialKey && (SERIAL_QUEUES.get(serialKey) ?? []).some((q) => q.taskName === taskName));
}

function startRun(taskName, payload = {}) {
  const task = TASK_MAP.get(taskName);
  const staging = stagingDir(taskName);
  const files = fs
    .readdirSync(staging)
    .filter((p) => !p.endsWith('.part') && fs.statSync(path.join(staging, p)).isFile())
    .map((p) => path.join(staging, p));
  const logger = makeLogger();
  const rec = {
    task: taskName,
    log: logger.lines,
    read: 0,
    cancelled: false,
    groups: new Set(),
    ts: Date.now() / 1000,
    tmpdir: path.join(tmpRoot(), `${slugify(taskName)}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`),
  };
  RUNS.set(taskName, rec);
  markRunning(taskName);

  (async () => {
    let ok = false;
    let summary = 'Internal error';
    try {
      [ok, summary] = await runTask(task, LOCAL, files, logger, payload, { groups: rec.groups, tmpdir: rec.tmpdir });
      if (rec.cancelled) {
        [ok, summary] = [false, 'Cancelled by user'];
        saveTaskState(task, LOCAL, false, summary, logger.text());
      }
    } finally {
      RUNS.delete(taskName);
      clearRunning(taskName);
      DONE.push({ task: taskName, ok, summary, paste: Boolean(task.capture) });
      drainSerialQueue(task.serial_key);
    }
  })().catch((e) => console.error('worker error:', e));
}

export function taskJson(t) {
  const [avail, reason] = availability(t, LOCAL);
  let stateJson = null;
  const marker = runningMarker()?.find((m) => m.task === t.name);
  if (marker && !RUNS.has(t.name)) {
    // a previous run was interrupted (server stopped/crashed mid-task)
    const ts = marker.ts ?? Date.now() / 1000;
    stateJson = {
      ts,
      ok: false,
      summary: 'Interrupted',
      output: '',
      last_run_text: `Interrupted · ${humanAgo(ts)}`,
    };
  } else {
    const rec = loadTaskState(t, LOCAL);
    if (rec) {
      const ok = Boolean(rec.ok);
      stateJson = {
        ts: rec.ts,
        ok,
        summary: rec.summary ?? '',
        output: rec.output ?? '',
        last_run_text: `${ok ? 'OK' : 'FAILED'} · ${humanAgo(rec.ts)}`,
      };
    }
  }
  // staleness policy: ok(<24h) > neutral(<=7d) > fail
  let pill = 'fail';
  if (stateJson && stateJson.ok) {
    const age = Date.now() / 1000 - stateJson.ts;
    pill = age < 24 * 3600 ? 'ok' : age <= 7 * DAY_SECONDS ? 'neutral' : 'fail';
  }
  const run = RUNS.get(t.name);
  const running = Boolean(run);
  const queued = isQueued(t.name, t.serial_key);
  return {
    name: t.name,
    group: t.group,
    note: t.note,
    prompts: t.prompts ?? [],
    uploads: supportsUploads(t),
    export_url: t.export_url,
    avail,
    avail_reason: reason,
    queued,
    state: stateJson,
    pill: running ? 'running' : pill,
    running,
    started: running ? run.ts : null,
    live: running && run.log.length ? run.log.at(-1).slice(0, 120) : '',
  };
}

export function createApp() {
  const app = express();

  // CSRF guard: reject cross-origin POSTs to /api/*
  app.use((req, res, next) => {
    if (req.method === 'POST' && req.url.startsWith('/api/')) {
      const origin = req.headers.origin || req.headers.referer;
      if (origin) {
        try {
          if (new URL(origin).host !== req.headers.host) {
            return res.status(403).json({ detail: 'cross-origin request blocked' });
          }
        } catch { /* malformed origin: ignore */ }
      }
    }
    next();
  });

  // uploads are parsed as raw bytes BEFORE express.json runs, so JSON
  // uploads (content-type: application/json) are never parsed into objects
  app.use('/api/upload', express.raw({ type: () => true, limit: '2gb' }));
  app.use(express.json({ limit: '1mb' }));

  // most-specific pattern wins; ties listed as `ambiguous`
  app.post('/api/detect', (req, res) => {
    const name = path.basename(String(req.query.name ?? ''));
    const candidates = [];
    for (const t of TASK_LIST) {
      if (!supportsUploads(t)) continue;
      for (const p of uploadPatterns(t, LOCAL)) {
        if (globMatch(name, p)) candidates.push({ task: t.name, score: matchScore(p) });
      }
    }
    if (!candidates.length) return res.json({ result: null });
    const best = Math.max(...candidates.map((c) => c.score));
    const tied = candidates.filter((c) => c.score === best).map((c) => c.task);
    res.json({ result: { task: tied[0], ambiguous: tied } });
  });

  app.get('/api/tasks', (req, res) => {
    const names = [...new Set(TASK_LIST.map((t) => t.group))];
    res.json({
      groups: names.map((name) => ({ name, tasks: TASK_LIST.filter((t) => t.group === name).map(taskJson) })),
      missing_config: MISSING_CONFIG,
    });
  });

  app.post('/api/upload/:taskName', (req, res) => {
    const task = TASK_MAP.get(req.params.taskName);
    if (!task || !supportsUploads(task)) return res.status(404).json({ detail: 'Unknown task' });
    const filename = path.basename(String(req.query.name ?? ''));
    const patterns = uploadPatterns(task, LOCAL);
    if (!patterns.some((p) => globMatch(filename, p))) {
      return res
        .status(400)
        .json({ detail: `${filename} does not match the expected pattern(s): ${patterns.join(', ')}` });
    }
    const staging = stagingDir(task.name);
    const finalPath = path.join(staging, filename);
    if (req.query.chunk != null) {
      const chunk = parseInt(req.query.chunk, 10);
      const total = parseInt(req.query.total, 10);
      if (!Number.isInteger(chunk) || chunk < 0 || !Number.isInteger(total) || total <= 0 || chunk >= total) {
        return res.status(400).json({ detail: 'Invalid chunk parameters' });
      }
      const partPath = finalPath + '.part';
      fs.appendFileSync(partPath, req.body);
      if (chunk === total - 1) fs.renameSync(partPath, finalPath);
      return res.json({ queued: filename });
    }
    fs.writeFileSync(finalPath, req.body);
    res.json({ queued: filename });
  });

  app.post('/api/run/:taskName', (req, res) => {
    const taskName = req.params.taskName;
    const task = TASK_MAP.get(taskName);
    if (!task) return res.status(404).json({ detail: 'Unknown task' });
    if (RUNS.has(taskName)) return res.status(409).json({ detail: 'This task is already running' });
    if (serialKeyHeld(task.serial_key)) {
      if (isQueued(taskName, task.serial_key)) return res.json({ started: true, queued: true });
      const q = SERIAL_QUEUES.get(task.serial_key) ?? [];
      q.push({ taskName, payload: req.body ?? {} });
      SERIAL_QUEUES.set(task.serial_key, q);
      return res.json({ started: true, queued: true });
    }
    const [avail, reason] = availability(task, LOCAL);
    if (!avail) return res.status(400).json({ detail: reason });
    startRun(taskName, req.body ?? {});
    res.json({ started: true });
  });

  app.get('/api/status', (req, res) => {
    const runs = [];
    for (const [taskName, rec] of RUNS) {
      const newLines = rec.log.slice(rec.read);
      rec.read = rec.log.length;
      runs.push({ task: taskName, log: newLines });
    }
    res.json({ runs, done: DONE.splice(0) });
  });

  app.post('/api/cancel', (req, res) => {
    const taskName = req.body?.task;
    if (!taskName) return res.status(409).json({ detail: 'No task specified' });
    const rec = RUNS.get(taskName);
    if (rec) {
      rec.cancelled = true;
      for (const pid of [...rec.groups]) killpg(pid);
      return res.json({ cancelled: true });
    }
    const task = TASK_MAP.get(taskName);
    const q = task?.serial_key ? SERIAL_QUEUES.get(task.serial_key) : null;
    if (q?.some((e) => e.taskName === taskName)) {
      SERIAL_QUEUES.set(task.serial_key, q.filter((e) => e.taskName !== taskName));
      return res.json({ cancelled: true, queued: true });
    }
    res.status(409).json({ detail: 'Task is not running' });
  });

  app.post('/api/paste_done/:taskName', async (req, res) => {
    const task = TASK_MAP.get(req.params.taskName);
    if (!task) return res.status(404).json({ detail: 'Unknown task' });
    const commitDir = task.commit_dir;
    if (!commitDir) return res.json({ committed: false });
    const dest = expand(resolve(commitDir, LOCAL));
    try {
      await gitCommit(dest, `${task.name} · ${new Date().toLocaleString()}`);
    } catch (e) {
      return res.status(500).json({ detail: `git commit failed: ${e.message}` });
    }
    res.json({ committed: true, dest });
  });

  app.get('/', (req, res) => {
    res.sendFile(INDEX_PATH);
  });

  return app;
}

// CLI ------------------------------------------------------------------------

export function main() {
  const args = process.argv.slice(2);
  let port = 8080;
  let host = '127.0.0.1';
  let noBrowser = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--port') port = parseInt(args[++i], 10);
    else if (args[i] === '--host') host = args[++i];
    else if (args[i] === '--no-browser') noBrowser = true;
    else if (args[i] === '--help' || args[i] === '-h') {
      console.log('usage: backupctl [--port N] [--host H] [--no-browser]');
      process.exit(0);
    }
  }

  const url = `http://${host}:${port}`;
  if (!noBrowser) {
    setTimeout(() => {
      spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
    }, 1000);
  }
  const app = createApp();
  app.listen(port, host, () => console.log(`backupctl listening on ${url}`));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await boot();
  main();
}
