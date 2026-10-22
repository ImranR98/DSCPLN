#!/usr/bin/env node
/* Task Runner — HTTP server and run orchestration.
 *
 * Tasks are bash: each task's `commands` (or shorthand) are executed by the
 * runner with process groups, redaction, serial queues and per-task state.
 * The CLI/config shapes are documented in README.md; config loading lives in
 * config-loader.mjs, templating in template.mjs, run state in state.mjs and
 * the subprocess layer in runner.mjs. Everything service-specific (tool
 * installs, export validation, pruning) lives in the task's own bash or in
 * lib.sh. */

import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import express from 'express';
import {
  authFromEnv,
  clickFor,
  createApp as createKitApp,
  isAuthorized,
  Notifier,
  normalizeSpec,
  occurrenceAfter,
  occurrenceBefore,
  Scheduler,
} from '@dscpln/server-kit';
import {
  CONFIG_FILE,
  ConfigError,
  ConfigMissingError,
  LIB_PATH,
  REPO_DIR,
  loadConfig,
  validateSchedule,
} from './config-loader.mjs';
import {
  normalizeAttributeDefinitions,
  TaskMetaError,
  taskMetaFileFor,
  writeTaskMeta,
} from './task-meta.mjs';
import { expand, resolve, shellSafe } from './template.mjs';
import {
  attachBrowserWebSocket,
  browserEnabled,
  browserPrefix,
  createBrowserHttpHandler,
} from './browser-proxy.mjs';

export { attachBrowserWebSocket };
import {
  clearRunning,
  ensureStateDir,
  loadScheduleState,
  loadTaskState,
  markRunning,
  runningMarker,
  saveTaskState,
  scheduleStore,
  slugify,
  stagingDir,
  tmpRoot,
} from './state.mjs';
import { DAY_SECONDS, humanAgo, pathFound, shellQuote, splitLines } from './util.mjs';
import { killpg, makeLogger, sh, shCapture } from './runner.mjs';
import { runWebhook } from './webhook.mjs';

// The modules above also implement the documented test surface; re-export them
// so `import * as bctl from '../server.mjs'` keeps working.
export * from './config-loader.mjs';
export * from './template.mjs';
export * from './state.mjs';
export * from './util.mjs';
export * from './runner.mjs';

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024 * 1024;

// Schedules are off by default on a second instance
// (BACKUPCTL_SCHEDULES=0); the instance that owns the cron-like work sets 1.
const SCHEDULES_ENABLED = process.env.BACKUPCTL_SCHEDULES !== '0';
const SCHEDULERS = new Map();
const NOTIFY_RELAY = String(process.env.DSCPLN_PORTAL_URL ?? '').trim();

// Fields that make a task require a person at the keyboard; such tasks cannot
// be put on a schedule. Kept in sync with config-loader's scheduled validation.
const SCHEDULE_BLOCKERS = ['uploads', 'prompts', 'require', 'browser', 'commit_dir'];

export function isSchedulable(task) {
  return !SCHEDULE_BLOCKERS.some((field) => Boolean(task[field]));
}

async function notifyTask(task, ok, summary) {
  const mode = task.notify ?? 'never';
  if (mode === 'never' || !NOTIFY_RELAY) return;
  if (ok && mode !== 'always') return;
  try {
    const notifier = new Notifier(
      {
        app: task.notify_name ?? task.name,
        relayUrl: NOTIFY_RELAY,
        notifySuccess: true,
        click: clickFor(process.env.BASE_PATH ?? ''),
      },
      (line) => console.error(line),
    );
    await notifier.notifyResult({ ok, app: task.notify_name ?? task.name, summary });
  } catch (err) {
    console.error(`notification failed: ${err.message}`);
  }
}

function clearStaging(ctx) {
  const d = stagingDir(ctx.task.name);
  fs.rmSync(d, { recursive: true, force: true });
  fs.mkdirSync(d, { recursive: true });
}

function failRun(rc) {
  return [false, `Command failed (exit ${rc})`];
}

export async function runCommands(ctx) {
  const task = ctx.task;
  const capture = Boolean(task.capture);
  if (task.uploads && !ctx.files.length) {
    return [false, 'No files queued — drop them here first'];
  }
  for (const key of task.require ?? []) {
    if (!ctx.extra[key]) return [false, `Missing required input: ${key}`];
  }
  const extra = {
    // Each path is quoted; the joined list is already safe shell text.
    uploads: shellSafe(ctx.files.map((f) => shellQuote(String(f))).join(' ')),
    ...Object.fromEntries(Object.entries(ctx.extra).map(([k, v]) => [k, String(v)])),
  };
  const secretKeys = [...(ctx.local?.secrets ?? []), ...(task.secrets ?? [])];
  const secretValues = secretKeys
    .map((key) => resolve(`{{${key}}}`, ctx.local ?? {}))
    .filter((value) => value !== undefined && !/^\{\{[^}]+\}\}$/.test(String(value)))
    .map(String);
  const redact = [...new Set([...Object.values(ctx.extra).filter((v) => v).map(String), ...secretValues])];
  const output = [];
  const cwd = expand(resolve(task.cwd ?? '.', ctx.local));
  const groups = ctx.groups ?? new Set();
  const env = { TMPDIR: ctx.tmpdir };
  // Per-task environment values are config tokens (not prompt inputs). Keep
  // secrets in the environment instead of argv so the logged command is clean.
  for (const [key, value] of Object.entries(task.env ?? {})) {
    env[key] = String(resolve(value, ctx.local ?? {}));
  }
  // Optional per-task identity: user-data tasks run as the host owner while
  // the server stays root for backup/recovery tasks. The deployment grants
  // CAP_SETUID/CAP_SETGID only for this drop-privilege path.
  const runAs = {};
  if (task.run_as !== undefined) {
    const spec = typeof task.run_as === 'object' && task.run_as !== null ? task.run_as : { uid: task.run_as, gid: task.run_as };
    const uid = Number(resolve(spec.uid, ctx.local ?? {}));
    const gid = Number(resolve(spec.gid ?? spec.uid, ctx.local ?? {}));
    if (!Number.isInteger(uid) || uid < 0 || !Number.isInteger(gid) || gid < 0) {
      return [false, `Invalid run_as identity: uid=${spec.uid} gid=${spec.gid}`];
    }
    runAs.uid = uid;
    runAs.gid = gid;
    try {
      fs.chownSync(ctx.tmpdir, uid, gid);
      fs.chmodSync(ctx.tmpdir, 0o700);
      // Drop-zone uploads are written by the root server; hand the staged
      // tree to the task user so upload tasks can read/rename their inputs.
      for (const file of ctx.files ?? []) fs.chownSync(file, uid, gid);
      const staging = ctx.files?.length ? path.dirname(ctx.files[0]) : null;
      if (staging) {
        fs.chownSync(staging, uid, gid);
        fs.chmodSync(staging, 0o700);
      }
    } catch (err) {
      return [false, `Could not prepare task files for uid ${uid}: ${err.message}`];
    }
  }
  const cmds = task.commands === undefined ? [] : (Array.isArray(task.commands) ? task.commands : [task.commands]);
  let webhookSummary = null;
  if (task.webhook) {
    const result = await runWebhook({
      webhook: task.webhook,
      local: ctx.local,
      log: ctx.log,
      redact,
      cwd,
      runAs,
      signal: ctx.signal,
      extra: ctx.extra,
    });
    if (!result.ok) return [false, result.summary];
    webhookSummary = result.summary;
    if (capture) output.push(result.summary);
  }
  if (!cmds.length && webhookSummary !== null) {
    return [true, webhookSummary];
  }
  for (const cmd of cmds) {
    const resolved = resolve(cmd, ctx.local, extra);
    let rc;
    if (capture) {
      const { rc: r, out, err } = await shCapture(resolved, { cwd, redact, env, groups, ...runAs });
      rc = r;
      const lines = splitLines(out);
      for (const line of lines) ctx.log(line);
      if (err.trim()) ctx.log(err.trim());
      output.push(...lines);
    } else {
      rc = await sh(resolved, { cwd, log: ctx.log, redact, env, groups, ...runAs });
    }
    if (rc !== 0) return failRun(rc);
  }
  if (capture) return [true, output.join('\n')];
  if (task.summary_last_line) {
    const last = [...ctx.log.lines].reverse().find((l) => l.trim() && !l.startsWith('$ '));
    return [true, last ?? 'Completed'];
  }
  return [true, 'Completed'];
}

// task metadata + dispatcher -------------------------------------------------

/* The machine this instance represents (`pc`, `srv0`, ...). Tasks pinned with
 * `host:` only run on their machine; tasks without a pin run anywhere. */
export function instanceHost() {
  return process.env.BACKUPCTL_HOST || 'pc';
}

/* `check:` commands gate availability (e.g. a device reachable over adb).
 * Results are cached briefly so the UI's polling doesn't re-run them; the
 * first output line becomes the unavailable reason. */
const CHECK_TTL_MS = 15_000;
const CHECK_TIMEOUT_MS = 10_000;
const CHECK_CACHE = new Map(); // expanded command -> { ts, ok, reason }

export function runAvailabilityCheck(command) {
  const cached = CHECK_CACHE.get(command);
  const now = Date.now();
  if (cached && now - cached.ts < CHECK_TTL_MS) return cached;
  const res = spawnSync('bash', ['-c', command], {
    encoding: 'utf8',
    timeout: CHECK_TIMEOUT_MS,
    killSignal: 'SIGKILL',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const ok = res.status === 0;
  let reason = '';
  if (!ok) {
    const lines = `${res.stdout ?? ''}\n${res.stderr ?? ''}`
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    reason = (lines[0] ?? `check failed (${res.error?.code ?? `exit ${res.status}`})`).slice(0, 160);
  }
  const entry = { ts: now, ok, reason };
  CHECK_CACHE.set(command, entry);
  return entry;
}

export function availability(task, local) {
  const host = task.host ?? 'any';
  const here = local?.host ?? instanceHost();
  if (host !== 'any' && host !== here) return [false, `Pinned to ${host}`];
  // tasks with a `root` (e.g. device mounts) are unavailable when missing
  const rootRaw = task.root;
  if (rootRaw) {
    const pattern = expand(resolve(rootRaw, local));
    if (!pathFound(pattern)) return [false, 'Source directory not found'];
  }
  if (task.check) {
    const command = expand(resolve(task.check, local));
    const { ok, reason } = runAvailabilityCheck(command);
    if (!ok) return [false, `Unavailable: ${reason}`];
  }
  return [true, ''];
}

export function supportsUploads(task) {
  return Boolean(task.uploads);
}

export function uploadPatterns(task, local) {
  const globs = task.glob ?? '*';
  const patterns = Array.isArray(globs) ? globs : [globs];
  return local === undefined ? patterns : patterns.map((p) => resolve(p, local));
}

export function matchScore(pattern) {
  return pattern.replace(/[*?]/g, '').length;
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
  const ctx = { task, local, files, log: collectLog, extra: extra ?? {}, groups, tmpdir, signal: opts.signal };
  let ok;
  let summary;
  try {
    [ok, summary] = await runCommands(ctx);
  } catch (e) {
    collectLog(`ERROR: ${e.message}`);
    [ok, summary] = [false, String(e.message ?? e)];
  } finally {
    if (task.uploads) clearStaging(ctx);
    // The per-run temp dir may still be held by a child process or a network
    // filesystem; failing to delete it must not lose the run result.
    try {
      fs.rmSync(tmpdir, { recursive: true, force: true });
    } catch (err) {
      collectLog(`WARNING: could not remove per-run temp dir ${tmpdir}: ${err.message}`);
    }
  }
  saveTaskState(task, local, ok, summary, lines.join('\n'));
  return [ok, summary];
}

// A card action is a small, person-triggered command attached to a task
// (test auth, pair a device, discover collections). It inherits the task's
// identity, environment and host pin but its result is stored under a suffixed
// state file so it never overwrites the task's last-run status.
export function actionTaskFor(task, action) {
  return {
    ...task,
    commands: action.commands,
    prompts: action.prompts ?? [],
    require: action.require ?? [],
    uploads: false,
    browser: false,
    capture: false,
    commit_dir: undefined,
    summary_last_line: action.summary_last_line !== false,
    notify: 'never',
    state_suffix: `action-${action.key}`,
    actions: [],
    schedule: null,
  }
}

function taskMeta() {
  const meta = LOCAL.task_meta ?? {}
  meta.version ??= 1
  meta.attributes = LOCAL.attributes ?? []
  meta.default_group_by = LOCAL.default_group_by ?? LOCAL.attributes?.[0]?.name ?? 'Category'
  meta.tasks ??= {}
  return meta
}

function persistTaskMeta() {
  writeTaskMeta(TASK_META_FILE, taskMeta())
}

function cleanTaskAttributes(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new TaskMetaError('attributes must be an object')
  }
  const definitions = new Map((LOCAL.attributes ?? []).map((attribute) => [attribute.name, new Set(attribute.values)]))
  const clean = {}
  for (const [name, value] of Object.entries(raw)) {
    if (!definitions.has(name)) throw new TaskMetaError(`Unknown attribute: '${name}'`)
    if (value == null || value === '') continue
    if (typeof value !== 'string') throw new TaskMetaError(`Attribute '${name}' must be a string`)
    if (!definitions.get(name).has(value)) {
      throw new TaskMetaError(`Attribute '${name}' has no value '${value}'`)
    }
    clean[name] = value
  }
  return clean
}

// server ---------------------------------------------------------------------

export let LOCAL = {};
export let TASK_LIST = [];
export let MISSING_CONFIG = false;
export let TASK_MAP = new Map();
export let TASK_META_FILE = taskMetaFileFor(CONFIG_FILE);

export async function boot(configPath = undefined) {
  TASK_META_FILE = taskMetaFileFor(configPath ?? CONFIG_FILE);
  try {
    [LOCAL, TASK_LIST] = await loadConfig(configPath);
    LOCAL.host = instanceHost();
    ensureStateDir();
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
const DONE_LIMIT = 200; // bound memory if no UI is polling /api/status
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

function startRun(taskName, payload = {}, trigger = 'manual', actionKey = null) {
  const baseTask = TASK_MAP.get(taskName);
  const action = actionKey ? (baseTask.actions ?? []).find((entry) => entry.key === actionKey) : null;
  if (actionKey && !action) throw new Error(`Unknown action '${actionKey}' for ${taskName}`);
  const task = action ? actionTaskFor(baseTask, action) : baseTask;
  const staging = stagingDir(taskName);
  const files = action
    ? []
    : fs
      .readdirSync(staging)
      .filter((p) => !p.endsWith('.part') && fs.statSync(path.join(staging, p)).isFile())
      .map((p) => path.join(staging, p));
  const logger = makeLogger();
  const rec = {
    task: taskName,
    action: action?.key ?? null,
    action_label: action?.label ?? null,
    log: logger.lines,
    read: 0,
    cancelled: false,
    groups: new Set(),
    trigger,
    ts: Date.now() / 1000,
    tmpdir: path.join(tmpRoot(), `${slugify(taskName)}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`),
    abort: new AbortController(),
  };
  RUNS.set(taskName, rec);
  markRunning(taskName);

  (async () => {
    let ok = false;
    let summary = 'Internal error';
    try {
      [ok, summary] = await runTask(task, LOCAL, files, logger, payload, { groups: rec.groups, tmpdir: rec.tmpdir, signal: rec.abort.signal });
      if (rec.cancelled) {
        [ok, summary] = [false, 'Cancelled by user'];
        saveTaskState(task, LOCAL, false, summary, logger.text());
      }
    } finally {
      RUNS.delete(taskName);
      clearRunning(taskName);
      // Pairing/auth actions can change whether the task itself is available.
      if (action) CHECK_CACHE.clear()
      DONE.push({
        task: taskName,
        action: action?.key ?? null,
        action_label: action?.label ?? null,
        ok,
        summary,
        paste: Boolean(task.capture),
        trigger,
      });
      if (DONE.length > DONE_LIMIT) DONE.splice(0, DONE.length - DONE_LIMIT);
      drainSerialQueue(task.serial_key);
      notifyTask(task, ok, summary).catch((err) => console.error(`notification failed: ${err.message}`));
    }
  })().catch((e) => console.error('worker error:', e));
}

/* Scheduler-side entry point: never queues behind a serial key, and never
 * throws into the Scheduler tick. A busy/unavailable task counts as missed. */
function runScheduledTask(task) {
  if (RUNS.has(task.name) || isQueued(task.name, task.serial_key) || serialKeyHeld(task.serial_key)) {
    console.warn(`[schedule] ${task.name} skipped: already running`);
    return;
  }
  const [avail, reason] = availability(task, LOCAL);
  if (!avail) {
    console.warn(`[schedule] ${task.name} skipped: ${reason}`);
    scheduleStore(task.name).markMissed();
    return;
  }
  startRun(task.name, {}, 'schedule');
}

export function startSchedulerForTask(task) {
  stopSchedulerForTask(task.name);
  if (!SCHEDULES_ENABLED) return false;
  const schedule = task.schedule ? normalizeSpec(task.schedule) : null;
  if (!schedule?.enabled) return false;
  if (task.host !== 'any' && task.host !== instanceHost()) return false;
  const store = scheduleStore(task.name);
  const scheduler = new Scheduler({
    getSpec: () => task.schedule,
    onDue: () => runScheduledTask(task),
    isBusy: () => RUNS.has(task.name) || isQueued(task.name, task.serial_key) || serialKeyHeld(task.serial_key),
    onMissed: () => store.markMissed(),
    store,
    log: (line) => console.log(`[schedule] ${task.name}: ${line}`),
  });
  scheduler.start();
  SCHEDULERS.set(task.name, scheduler);
  return true;
}

export function stopSchedulerForTask(taskName) {
  const scheduler = SCHEDULERS.get(taskName);
  if (!scheduler) return false;
  scheduler.stop();
  SCHEDULERS.delete(taskName);
  return true;
}

export function startSchedulers() {
  if (!SCHEDULES_ENABLED) return [];
  const started = [];
  for (const task of TASK_LIST) {
    if (startSchedulerForTask(task)) started.push(task.name);
  }
  if (started.length) console.log(`Schedules enabled: ${started.join(', ')}`);
  return started;
}

export function stopSchedulers() {
  for (const scheduler of SCHEDULERS.values()) scheduler.stop();
  SCHEDULERS.clear();
}

function actionJson(task, action) {
  const rec = loadTaskState(actionTaskFor(task, action), LOCAL)
  return {
    key: action.key,
    label: action.label,
    prompts: action.prompts ?? [],
    require: action.require ?? [],
    state: rec
      ? {
          ts: rec.ts,
          ok: Boolean(rec.ok),
          summary: rec.summary ?? '',
          last_run_text: `${rec.ok ? 'OK' : 'FAILED'} · ${humanAgo(rec.ts)}`,
        }
      : null,
  }
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
        last_run_text: `${ok ? 'OK' : 'FAILED'} · ${humanAgo(rec.ts)}`,
      };
    }
  }
  // A successful run turns neutral once it is a day old and stays neutral
  // after that: red is reserved for real failures, matching the portal's
  // attention count. Staleness is still visible in the last-run text.
  let pill = 'fail';
  if (stateJson && stateJson.ok) {
    const age = Date.now() / 1000 - stateJson.ts;
    pill = age < DAY_SECONDS ? 'ok' : 'neutral';
  }
  const run = RUNS.get(t.name);
  const running = Boolean(run);
  const queued = isQueued(t.name, t.serial_key);
  const schedule = t.schedule ? normalizeSpec(t.schedule) : null;
  const scheduleState = schedule ? loadScheduleState(t.name) : null;
  return {
    name: t.name,
    group: t.group,
    note: t.note,
    host: t.host,
    browser: Boolean(t.browser),
    prompts: t.prompts ?? [],
    uploads: supportsUploads(t),
    export_url: t.export_url,
    avail,
    avail_reason: reason,
    schedulable: isSchedulable(t),
    queued,
    state: stateJson,
    pill: running ? 'running' : pill,
    running,
    started: running ? run.ts : null,
    live: running && run.log.length ? run.log.at(-1).slice(0, 120) : '',
    schedule,
    next_run: schedule?.enabled ? occurrenceAfter(schedule, new Date()) : null,
    schedule_missed: scheduleState?.missed ?? 0,
    last_scheduled_run: scheduleState?.lastScheduledRun ?? null,
    notify: t.notify ?? 'never',
    attributes: { ...(t.attributes ?? {}) },
    actions: (t.actions ?? []).map((action) => actionJson(t, action)),
  };
}

const metricEscape = (value) => String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')

// Prometheus text format for the scheduled-task dead-man switch. Keep this
// dependency-free: the values already exist in taskJson/state.
export function metricsText() {
  const lines = [
    '# HELP task_runner_configured_tasks Number of tasks loaded from config.mjs',
    '# TYPE task_runner_configured_tasks gauge',
    `task_runner_configured_tasks ${TASK_LIST.length}`,
    '# HELP task_runner_schedules_enabled Whether this instance fires schedules',
    '# TYPE task_runner_schedules_enabled gauge',
    `task_runner_schedules_enabled ${SCHEDULES_ENABLED ? 1 : 0}`,
    '# HELP task_runner_task_last_run_timestamp_seconds Unix timestamp of the last completed run',
    '# TYPE task_runner_task_last_run_timestamp_seconds gauge',
    '# HELP task_runner_task_last_run_ok Whether the last completed run succeeded',
    '# TYPE task_runner_task_last_run_ok gauge',
    '# HELP task_runner_task_next_run_timestamp_seconds Unix timestamp of the next scheduled run',
    '# TYPE task_runner_task_next_run_timestamp_seconds gauge',
    '# HELP task_runner_task_schedule_enabled Whether the task has an enabled schedule',
    '# TYPE task_runner_task_schedule_enabled gauge',
    '# HELP task_runner_task_missed Number of missed scheduled occurrences',
    '# TYPE task_runner_task_missed gauge',
    '# HELP task_runner_task_running Whether the task is currently running',
    '# TYPE task_runner_task_running gauge',
    '# HELP task_runner_task_available Whether the task is available on this instance',
    '# TYPE task_runner_task_available gauge',
  ]
  for (const task of TASK_LIST) {
    const t = taskJson(task)
    const labels = `task="${metricEscape(t.name)}",group="${metricEscape(t.group ?? '')}"`
    lines.push(`task_runner_task_last_run_timestamp_seconds{${labels}} ${t.state?.ts ?? 0}`)
    lines.push(`task_runner_task_last_run_ok{${labels}} ${t.state?.ok ? 1 : 0}`)
    lines.push(`task_runner_task_next_run_timestamp_seconds{${labels}} ${t.next_run ?? 0}`)
    lines.push(`task_runner_task_schedule_enabled{${labels}} ${t.schedule?.enabled ? 1 : 0}`)
    lines.push(`task_runner_task_missed{${labels}} ${t.schedule_missed ?? 0}`)
    lines.push(`task_runner_task_running{${labels}} ${t.running ? 1 : 0}`)
    lines.push(`task_runner_task_available{${labels}} ${t.avail ? 1 : 0}`)
  }
  return `${lines.join('\n')}\n`
}

export function createApp(options = {}) {
  const basePath = options.basePath ?? process.env.BASE_PATH ?? ''
  const browserRemote = options.browserUpstream ?? process.env.BROWSER_REMOTE
  const app = createKitApp({
    title: 'Task Runner',
    basePath,
    staticDir: path.join(REPO_DIR, 'static'),
    jsonBody: false, // /api/upload streams raw bytes, JSON-typed uploads included
    healthExtra: () => ({
      tasks: TASK_LIST.length,
      missingConfig: MISSING_CONFIG,
      browser: Boolean(browserRemote),
      schedules: SCHEDULERS.size,
      schedulesEnabled: SCHEDULES_ENABLED,
    }),
    routes: (router) => {
      // Login-browser viewer (the Selenium sidecar's noVNC) on the same origin.
      // The kit mounts this router at basePath, so the path is base-relative;
      // the WebSocket bridge (attachBrowserWebSocket) works on the raw server
      // and uses the full prefix instead.
      if (browserRemote) router.use(browserPrefix(''), createBrowserHttpHandler(browserRemote))

      // JSON body parsing only for the endpoints that need it; /api/upload
      // streams raw bytes straight to disk (JSON-typed uploads included).
      router.use(
        ['/api/run', '/api/cancel', '/api/paste_done', '/api/tasks', '/api/attributes', '/api/actions'],
        express.json({ limit: '1mb' }),
      )

      // most-specific pattern wins; ties listed as `ambiguous`
      router.post('/api/detect', (req, res) => {
        const name = path.basename(String(req.query.name ?? ''))
        const candidates = []
        for (const t of TASK_LIST) {
          if (!supportsUploads(t)) continue
          for (const p of uploadPatterns(t, LOCAL)) {
            if (globMatch(name, p)) candidates.push({ task: t.name, score: matchScore(p) })
          }
        }
        if (!candidates.length) return res.json({ result: null })
        const best = Math.max(...candidates.map((c) => c.score))
        const tied = candidates.filter((c) => c.score === best).map((c) => c.task)
        res.json({ result: { task: tied[0], ambiguous: tied } })
      })

      router.put('/api/tasks/:taskName/settings', async (req, res) => {
        const task = TASK_MAP.get(req.params.taskName)
        if (!task) return res.status(404).json({ detail: 'Unknown task' })
        const raw = req.body && typeof req.body === 'object' ? req.body : {}
        try {
          let spec = task.schedule ? normalizeSpec(task.schedule) : null
          if (raw.schedule !== undefined) {
            if (!isSchedulable(task)) {
              return res.status(400).json({ detail: 'This task needs manual input or browser interaction and cannot be scheduled' })
            }
            spec = normalizeSpec({
              enabled: raw.schedule?.enabled === true,
              days: raw.schedule?.days,
              at: raw.schedule?.at,
              catchUp: raw.schedule?.catchUp !== false,
            })
            if (spec.enabled && !spec.at) {
              return res.status(400).json({ detail: 'A time (HH:MM) is required when the schedule is enabled' })
            }
            spec = validateSchedule(task, spec)
          }
          let attributes = task.attributes ?? {}
          if (raw.attributes !== undefined) attributes = cleanTaskAttributes(raw.attributes)

          const meta = taskMeta()
          meta.tasks[task.name] ??= {}
          if (raw.schedule !== undefined) meta.tasks[task.name].schedule = spec
          if (raw.attributes !== undefined) meta.tasks[task.name].attributes = attributes
          persistTaskMeta()

          task.attributes = attributes
          let scheduled = SCHEDULERS.has(task.name)
          if (raw.schedule !== undefined) {
            task.schedule = spec
            // Do not replay occurrences from before the edit. The next new
            // occurrence after the chosen time is the first one that fires.
            if (spec?.enabled) {
              const latest = occurrenceBefore(spec, new Date())
              if (latest != null) await scheduleStore(task.name).setLastScheduledRun(latest)
            }
            stopSchedulerForTask(task.name)
            scheduled = startSchedulerForTask(task)
            console.log(`[schedule] ${task.name}: ${spec?.enabled ? 'enabled' : 'disabled'}${spec?.at ? ` at ${spec.at}` : ''}`)
          }
          res.json({
            schedule: spec,
            attributes,
            next_run: spec?.enabled ? occurrenceAfter(spec, new Date()) : null,
            scheduled,
            task: taskJson(task),
          })
        } catch (err) {
          const status = err instanceof TaskMetaError || err instanceof ConfigError ? 400 : 500
          res.status(status).json({ detail: err.message })
        }
      })

      router.put('/api/attributes', (req, res) => {
        const raw = req.body && typeof req.body === 'object' ? req.body : {}
        try {
          const definitions = normalizeAttributeDefinitions(raw.attributes)
          if (!definitions.some((attribute) => attribute.name === 'Category')) {
            throw new TaskMetaError("The built-in 'Category' attribute is required")
          }
          const defaultBy = String(raw.default_group_by ?? LOCAL.default_group_by ?? '').trim()
          if (!definitions.some((attribute) => attribute.name === defaultBy)) {
            throw new TaskMetaError(`Default grouping attribute '${defaultBy}' does not exist`)
          }

          const valid = new Map(definitions.map((attribute) => [attribute.name, new Set(attribute.values)]))
          const prune = (values) => {
            const clean = {}
            for (const [name, value] of Object.entries(values ?? {})) {
              if (valid.get(name)?.has(value)) clean[name] = value
            }
            return clean
          }

          const meta = taskMeta()
          meta.attributes = definitions
          meta.default_group_by = defaultBy
          for (const entry of Object.values(meta.tasks)) {
            if (entry.attributes) entry.attributes = prune(entry.attributes)
          }
          for (const task of TASK_LIST) task.attributes = prune(task.attributes)
          LOCAL.attributes = definitions
          LOCAL.default_group_by = defaultBy
          persistTaskMeta()
          res.json({ attributes: definitions, default_group_by: defaultBy })
        } catch (err) {
          const status = err instanceof TaskMetaError ? 400 : 500
          res.status(status).json({ detail: err.message })
        }
      })

      router.get('/api/metrics', (req, res) => {
        res.type('text/plain; version=0.0.4; charset=utf-8')
        res.send(metricsText())
      })

      router.get('/api/tasks', (req, res) => {
        const names = [...new Set(TASK_LIST.map((t) => t.group))]
        const tasks = TASK_LIST.map(taskJson)
        res.json({
          groups: names.map((name) => ({
            name,
            tasks: tasks.filter((task) => task.group === name),
          })),
          tasks,
          attributes: LOCAL.attributes ?? [],
          default_group_by: LOCAL.default_group_by ?? 'Category',
          missing_config: MISSING_CONFIG,
          browser: Boolean(browserRemote),
        })
      })

      // The body is streamed into a .part file and renamed on completion, so a
      // half-written upload is never picked up by a run (runs skip .part files).
      // A very generous cap (50 GB — GitHub/Google archives are huge) keeps a
      // runaway upload from filling the home volume.
      router.post('/api/upload/:taskName', async (req, res) => {
        const task = TASK_MAP.get(req.params.taskName)
        if (!task || !supportsUploads(task)) return res.status(404).json({ detail: 'Unknown task' })
        const filename = path.basename(String(req.query.name ?? ''))
        const patterns = uploadPatterns(task, LOCAL)
        if (!patterns.some((p) => globMatch(filename, p))) {
          return res
            .status(400)
            .json({ detail: `${filename} does not match the expected pattern(s): ${patterns.join(', ')}` })
        }
        const partPath = path.join(stagingDir(task.name), filename + '.part')
        const finalPath = partPath.slice(0, -'.part'.length)
        const ws = fs.createWriteStream(partPath)
        let size = 0
        let tooLarge = false
        req.on('data', (chunk) => {
          size += chunk.length
          if (size > MAX_UPLOAD_BYTES && !tooLarge) {
            tooLarge = true
            req.unpipe(ws)
            ws.destroy()
            req.resume()
          }
        })
        try {
          await new Promise((resolve, reject) => {
            ws.on('finish', resolve)
            ws.on('close', resolve)
            ws.on('error', reject)
            req.on('error', reject)
            req.pipe(ws)
          })
        } catch {
          fs.rmSync(partPath, { force: true })
          if (!res.headersSent) res.status(500).json({ detail: 'Upload failed' })
          return
        }
        if (tooLarge) {
          fs.rmSync(partPath, { force: true })
          return res.status(413).json({ detail: `upload exceeds the ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024 / 1024)} GB limit` })
        }
        if (size === 0) {
          fs.rmSync(partPath, { force: true })
          return res.status(400).json({ detail: 'upload is empty' })
        }
        fs.renameSync(partPath, finalPath)
        res.json({ queued: filename })
      })

      router.post('/api/run/:taskName', (req, res) => {
        const taskName = req.params.taskName
        const task = TASK_MAP.get(taskName)
        if (!task) return res.status(404).json({ detail: 'Unknown task' })
        if (RUNS.has(taskName)) return res.status(409).json({ detail: 'This task is already running' })
        if (serialKeyHeld(task.serial_key)) {
          if (isQueued(taskName, task.serial_key)) return res.json({ started: true, queued: true })
          const q = SERIAL_QUEUES.get(task.serial_key) ?? []
          q.push({ taskName, payload: req.body ?? {} })
          SERIAL_QUEUES.set(task.serial_key, q)
          return res.json({ started: true, queued: true })
        }
        const [avail, reason] = availability(task, LOCAL)
        if (!avail) return res.status(400).json({ detail: reason })
        startRun(taskName, req.body ?? {})
        res.json({ started: true })
      })

      // Card actions deliberately bypass `check:` (pairing exists to fix an
      // unavailable device) but still respect host pinning and busy tasks.
      router.post('/api/actions/:taskName/:actionKey', (req, res) => {
        const task = TASK_MAP.get(req.params.taskName)
        if (!task) return res.status(404).json({ detail: 'Unknown task' })
        const action = (task.actions ?? []).find((entry) => entry.key === req.params.actionKey)
        if (!action) return res.status(404).json({ detail: 'Unknown action' })
        if (task.host !== 'any' && task.host !== instanceHost()) {
          return res.status(400).json({ detail: `Pinned to ${task.host}` })
        }
        if (RUNS.has(task.name)) return res.status(409).json({ detail: 'This task is already running' })
        if (serialKeyHeld(task.serial_key)) {
          return res.status(409).json({ detail: 'Another task sharing this destination is running' })
        }
        const extra = req.body && typeof req.body === 'object' ? req.body : {}
        for (const key of action.require ?? []) {
          if (!extra[key]) return res.status(400).json({ detail: `Missing required input: ${key}` })
        }
        startRun(task.name, extra, 'action', action.key)
        res.json({ started: true })
      })

      router.get('/api/status', (req, res) => {
        const runs = []
        for (const [taskName, rec] of RUNS) {
          const newLines = rec.log.slice(rec.read)
          rec.read = rec.log.length
          runs.push({ task: taskName, action: rec.action, action_label: rec.action_label, log: newLines })
        }
        res.json({ runs, done: DONE.splice(0) })
      })

      // last run's full log, fetched lazily by the Log dialog
      router.get('/api/log/:taskName', (req, res) => {
        const task = TASK_MAP.get(req.params.taskName)
        if (!task) return res.status(404).json({ detail: 'Unknown task' })
        res.json({ output: loadTaskState(task, LOCAL)?.output ?? '' })
      })

      router.post('/api/cancel', (req, res) => {
        const taskName = req.body?.task
        if (!taskName) return res.status(409).json({ detail: 'No task specified' })
        const rec = RUNS.get(taskName)
        if (rec) {
          rec.cancelled = true
          rec.abort?.abort()
          for (const pid of [...rec.groups]) killpg(pid)
          return res.json({ cancelled: true })
        }
        const task = TASK_MAP.get(taskName)
        const q = task?.serial_key ? SERIAL_QUEUES.get(task.serial_key) : null
        if (q?.some((e) => e.taskName === taskName)) {
          SERIAL_QUEUES.set(task.serial_key, q.filter((e) => e.taskName !== taskName))
          return res.json({ cancelled: true, queued: true })
        }
        res.status(409).json({ detail: 'Task is not running' })
      })

      router.post('/api/paste_done/:taskName', async (req, res) => {
        const task = TASK_MAP.get(req.params.taskName)
        if (!task) return res.status(404).json({ detail: 'Unknown task' })
        const commitDir = task.commit_dir
        if (!commitDir) return res.json({ committed: false })
        const dest = expand(resolve(commitDir, LOCAL))
        const message = shellQuote(`${task.name} · ${new Date().toLocaleString()}`)
        const { rc, err } = await shCapture(`bash ${shellQuote(LIB_PATH)} git-commit ${shellQuote(dest)} ${message}`)
        if (rc !== 0) {
          return res.status(500).json({ detail: `git commit failed: ${err.trim()}` })
        }
        res.json({ committed: true, dest })
      })
    },
  })

  return app
}

// CLI ------------------------------------------------------------------------

export function main() {
  const { values } = parseArgs({
    options: {
      port: { type: 'string', default: '8080' },
      host: { type: 'string', default: '127.0.0.1' },
      'no-browser': { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });
  if (values.help) {
    console.log('usage: task-runner [--port N] [--host H] [--no-browser]');
    process.exit(0);
  }
  const port = parseInt(values.port, 10);
  const url = `http://${values.host}:${port}`;
  if (!values['no-browser']) {
    setTimeout(() => {
      spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
    }, 1000);
  }
  const app = createApp();
  const server = app.listen(port, values.host, () => console.log(`Task Runner listening on ${url}`));
  if (browserEnabled()) {
    const authConfig = authFromEnv();
    attachBrowserWebSocket(server, process.env.BASE_PATH ?? '', process.env.BROWSER_REMOTE, {
      isAuthorized: authConfig ? (req) => isAuthorized(req, authConfig) : null,
    });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await boot();
  startSchedulers();
  main();
}
