#!/usr/bin/env node
/* backupctl core plumbing: config loading + {{token}} resolution, per-task
 * run-state files, upload staging, and the safe subprocess layer (process
 * groups, timeouts, redaction, fail-fast env), plus git commits and the
 * generic pty runner (node core.mjs CMD...). */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import readline from 'node:readline';
import { pathToFileURL } from 'node:url';

export const REPO_DIR = path.dirname(new URL(import.meta.url).pathname);
export const CONFIG_DIR = process.env.BACKUPCTL_CONFIG_DIR ?? path.join(REPO_DIR, 'config');
export const CONFIG_FILE = path.join(CONFIG_DIR, 'config.mjs');
export const LIB_PATH = path.join(REPO_DIR, 'lib.sh');

// config ---------------------------------------------------------------------

export class ConfigMissingError extends Error {}
export class ConfigError extends Error {}

export async function loadConfig(configPath = CONFIG_FILE) {
  const p = configPath instanceof URL ? configPath : path.resolve(configPath);
  if (!fs.existsSync(p)) {
    throw new ConfigMissingError(
      `Missing config file ${p} — create it (see ARCHITECTURE.md for the schema)`
    );
  }
  let mod;
  try {
    mod = await import(pathToFileURL(p).href);
  } catch (e) {
    throw new ConfigError(`Failed to load ${p}: ${e.message}`);
  }
  const data = mod.default ?? {};
  const tasks = data.tasks ?? [];
  const local = { ...data };
  delete local.tasks;
  local.repo_dir ??= process.env.BACKUPCTL_REPO_DIR ?? REPO_DIR;
  local.lib ??= LIB_PATH;
  const seen = new Set();
  for (const t of tasks) {
    const name = t.name;
    if (!name) throw new ConfigError("Every task needs a 'name'");
    if (!t.state_dir) throw new ConfigError(`Task '${name}' needs a 'state_dir' for its run state`);
    if (seen.has(name)) throw new ConfigError(`Duplicate task name: '${name}'`);
    seen.add(name);
  }
  return [local, tasks];
}

export function expand(p) {
  let s = String(p);
  s = s.replace(/^~(?=[/]|$)/, os.homedir());
  s = s.replace(/\$(\w+)|\$\{([^}]+)\}/g, (m, a, b) => process.env[a || b] ?? '');
  return s;
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
      const s = typeof value === 'string' ? expandUser(value) : String(value);
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

function expandUser(value) {
  // ~ values must expand here: inside the command string they are usually
  // quoted, so the shell's tilde expansion never sees them
  return value.replace(/^~(?=[/]|$)/, os.homedir());
}

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
    output: output.slice(-20000),
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
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(RUNNING_FILE, JSON.stringify({ task: taskName, ts: Date.now() / 1000 }));
}

export function clearRunning() {
  fs.rmSync(RUNNING_FILE, { force: true });
}

export function runningMarker() {
  if (!fs.existsSync(RUNNING_FILE)) return null;
  try {
    return JSON.parse(fs.readFileSync(RUNNING_FILE, 'utf8'));
  } catch {
    return null;
  }
}

export function stagingDir(taskName) {
  const d = path.join(STATE_DIR, 'staging', slugify(taskName));
  fs.mkdirSync(d, { recursive: true });
  return d;
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

export const PROC_GROUPS = new Set(); // pids of running children, for cancellation

export const TIMEOUT_RC = 124; // exit code returned when a command's deadline expires

const SIGNAL_NUMS = {
  SIGHUP: 1, SIGINT: 2, SIGQUIT: 3, SIGILL: 4, SIGTRAP: 5, SIGABRT: 6, SIGBUS: 7,
  SIGFPE: 8, SIGKILL: 9, SIGUSR1: 10, SIGSEGV: 11, SIGUSR2: 12, SIGPIPE: 13,
  SIGALRM: 14, SIGTERM: 15, SIGSTKFLT: 16, SIGCHLD: 17, SIGCONT: 18, SIGSTOP: 19,
};

export function shellQuote(arg) {
  const s = String(arg);
  if (/^[\w@%+=:,./-]+$/.test(s)) return s;
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

export function shellSplit(s) {
  const out = [];
  let cur = '';
  let quote = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote) {
      if (c === quote) quote = null;
      else if (c === '\\' && quote === '"' && '\\"$`'.includes(s[i + 1])) cur += s[++i];
      else cur += c;
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === '\\') {
      cur += s[++i] ?? '';
    } else if (/\s/.test(c)) {
      if (cur) { out.push(cur); cur = ''; }
    } else {
      cur += c;
    }
  }
  if (quote) throw new Error('Unterminated quote');
  if (cur) out.push(cur);
  return out;
}

function display(cmd, shell) {
  return typeof cmd === 'string' && shell ? cmd : cmd.map(shellQuote).join(' ');
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
  const { cwd, shell = false } = opts;
  const [file, args] = Array.isArray(cmd) ? [cmd[0], cmd.slice(1)] : [cmd, []];
  return spawn(file, args, {
    cwd,
    shell,
    detached: true,
    env: SAFE_ENV,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/* Run a command (list or shell string), streaming output lines into log().
 * Returns exit code; timeout kills the process group and returns TIMEOUT_RC;
 * redact masks secrets in the logged command and output. */
export function run(cmd, opts = {}) {
  const { shell = false, cwd, log = () => {}, timeout, redact = [] } = opts;
  const args = typeof cmd === 'string' ? (shell ? cmd : shellSplit(cmd)) : cmd;
  log(`$ ${redactText(display(args, shell), redact)}`);
  let proc;
  try {
    proc = spawnSafe(args, { cwd, shell });
    proc.stderr.pipe(proc.stdout);
  } catch (e) {
    log(`ERROR: could not start: ${e.message}`);
    return Promise.resolve(127);
  }
  PROC_GROUPS.add(proc.pid);
  return new Promise((resolvePromise) => {
    const rl = readline.createInterface({ input: proc.stdout });
    rl.on('line', (line) => log(redactText(line, redact)));
    let settled = false;
    let timedOut = false;
    let killer = null;
    if (timeout) {
      killer = setTimeout(() => {
        timedOut = true;
        killpg(proc.pid, log);
        log('TIMEOUT: command killed');
      }, timeout * 1000);
    }
    proc.on('error', (e) => {
      if (settled) return;
      settled = true;
      log(`ERROR: could not start: ${e.message}`);
      if (killer) clearTimeout(killer);
      rl.close();
      PROC_GROUPS.delete(proc.pid);
      resolvePromise(127);
    });
    proc.on('close', (code, signal) => {
      if (settled) return;
      settled = true;
      if (killer) clearTimeout(killer);
      rl.close();
      PROC_GROUPS.delete(proc.pid);
      if (timedOut) return resolvePromise(TIMEOUT_RC);
      resolvePromise(code ?? (signal ? 128 + (SIGNAL_NUMS[signal] ?? 0) : 1));
    });
  });
}

export function sh(cmd, opts = {}) {
  return run(cmd, { ...opts, shell: true });
}

/* Run a shell command capturing all output. Returns {rc, out, err}. */
export function shCapture(cmd, opts = {}) {
  const { cwd, timeout, redact = [] } = opts;
  let proc;
  try {
    proc = spawnSafe(cmd, { cwd, shell: true });
  } catch (e) {
    return Promise.resolve({ rc: 127, out: '', err: String(e) });
  }
  PROC_GROUPS.add(proc.pid);
  return new Promise((resolvePromise) => {
    let out = '';
    let err = '';
    let timedOut = false;
    let killer = null;
    let settled = false;
    if (timeout) {
      killer = setTimeout(() => {
        timedOut = true;
        killpg(proc.pid);
      }, timeout * 1000);
    }
    proc.on('error', (e) => {
      if (settled) return;
      settled = true;
      if (killer) clearTimeout(killer);
      PROC_GROUPS.delete(proc.pid);
      resolvePromise({ rc: 127, out, err: String(e) });
    });
    proc.stdout.on('data', (d) => { out += d; });
    proc.stderr.on('data', (d) => { err += d; });
    proc.on('close', (code) => {
      if (settled) return;
      settled = true;
      if (killer) clearTimeout(killer);
      PROC_GROUPS.delete(proc.pid);
      out = redactText(out, redact);
      err = redactText(err, redact);
      if (timedOut) return resolvePromise({ rc: TIMEOUT_RC, out, err });
      resolvePromise({ rc: code ?? 1, out, err });
    });
  });
}

export function rsync(src, dst, opts = {}) {
  const { delete: del = false, excludes = [], ssh, log, timeout } = opts;
  const args = ['rsync', '-aq'];
  if (del) args.push('--delete');
  for (const e of excludes) args.push('--exclude', e);
  if (ssh) args.push('-e', ssh);
  let s = String(src);
  try {
    if (fs.statSync(s).isDirectory() && !s.endsWith('/')) s += '/';
  } catch { /* source missing; rsync will report it */ }
  args.push(s, String(dst));
  return run(args, { log, timeout });
}

export function cancelAll() {
  for (const pid of [...PROC_GROUPS]) killpg(pid);
  PROC_GROUPS.clear();
}

const GIT_TIMEOUT = 300;

export async function gitCommit(dest, message, log = () => {}) {
  fs.mkdirSync(dest, { recursive: true });
  if ((await run(['git', 'init', '-q'], { cwd: dest, log, timeout: GIT_TIMEOUT })) !== 0) {
    throw new Error(`git init failed in ${dest}`);
  }
  if ((await run(['git', 'add', '-A', '.', ':(exclude).backup-state-*'], { cwd: dest, log, timeout: GIT_TIMEOUT })) !== 0) {
    throw new Error(`git add failed in ${dest}`);
  }
  const { rc, out, err } = await shCapture(`git commit -q -m ${shellQuote(message)}`, { cwd: dest, timeout: GIT_TIMEOUT });
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

// pty runner -----------------------------------------------------------------

const PTY_HELPER = path.join(REPO_DIR, 'pty_runner.py');

/* Run a command in a pseudo-terminal, forwarding piped stdin to it.
 *
 * For tools that refuse non-TTY input (e.g. `age --passphrase`). Node has no
 * stdlib pty API and native addons are off the table, so the runner delegates
 * to a small stdlib-only Python helper (pty_runner.py) — python3 is already a
 * system dependency of the personal scripts. Output streams to stdout
 * (terminal control sequences stripped); exit code is the child's. Secrets
 * stay off argv by piping them in (e.g. from an env var), never passing them
 * as arguments.
 *
 * Usage: printf 'pw\npw\n' | node core.mjs CMD [ARGS...] */
export function ptyMain() {
  const argv = process.argv.slice(2);
  if (!argv.length) {
    console.error('usage: node core.mjs CMD [ARGS...]');
    process.exit(2);
  }
  let child;
  try {
    child = spawn('python3', [PTY_HELPER, ...argv], {
      env: SAFE_ENV,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (e) {
    console.error(`ERROR: could not start: ${e.message}`);
    process.exit(127);
  }
  child.on('error', () => {
    console.error(
      'ERROR: python3 is required for tools that need a terminal (e.g. age --passphrase);\n' +
      'the pty runner uses its stdlib pty module (pty_runner.py).'
    );
    process.exit(127);
  });
  process.stdin.pipe(child.stdin);
  child.stdout.pipe(process.stdout);
  child.stderr.pipe(process.stderr);
  child.on('close', (code, signal) => {
    process.exit(code ?? (signal ? 128 + (SIGNAL_NUMS[signal] ?? 0) : 1));
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  ptyMain();
}
