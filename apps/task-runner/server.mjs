#!/usr/bin/env node
/* Task Runner (formerly backupctl) — HTTP server and run orchestration.
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
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import express from 'express';
import { createApp as createKitApp } from '@dscpln/server-kit';
import {
  CONFIG_FILE,
  ConfigError,
  ConfigMissingError,
  LIB_PATH,
  REPO_DIR,
  loadConfig,
} from './config-loader.mjs';
import { expand, resolve } from './template.mjs';
import {
  clearRunning,
  loadTaskState,
  markRunning,
  runningMarker,
  saveTaskState,
  slugify,
  stagingDir,
  tmpRoot,
} from './state.mjs';
import { DAY_SECONDS, humanAgo, pathFound, shellQuote, splitLines } from './util.mjs';
import { killpg, makeLogger, sh, shCapture } from './runner.mjs';

// The modules above also implement the documented test surface; re-export them
// so `import * as bctl from '../server.mjs'` keeps working.
export * from './config-loader.mjs';
export * from './template.mjs';
export * from './state.mjs';
export * from './util.mjs';
export * from './runner.mjs';

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024 * 1024;

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
    uploads: ctx.files.map((f) => shellQuote(String(f))).join(' '),
    ...Object.fromEntries(Object.entries(ctx.extra).map(([k, v]) => [k, String(v)])),
  };
  const redact = Object.values(ctx.extra).filter((v) => v).map(String);
  const output = [];
  const cwd = expand(resolve(task.cwd ?? '.', ctx.local));
  const groups = ctx.groups ?? new Set();
  const env = { TMPDIR: ctx.tmpdir };
  const cmds = Array.isArray(task.commands) ? task.commands : [task.commands];
  for (const cmd of cmds) {
    const resolved = resolve(cmd, ctx.local, extra);
    let rc;
    if (capture) {
      const { rc: r, out, err } = await shCapture(resolved, { cwd, redact, env, groups });
      rc = r;
      const lines = splitLines(out);
      for (const line of lines) ctx.log(line);
      if (err.trim()) ctx.log(err.trim());
      output.push(...lines);
    } else {
      rc = await sh(resolved, { cwd, log: ctx.log, redact, env, groups });
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
    [LOCAL, TASK_LIST] = await loadConfig(configPath);
    LOCAL.host = instanceHost();
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
  // staleness policy: ok(<24h) > neutral(<=7d) > fail
  let pill = 'fail';
  if (stateJson && stateJson.ok) {
    const age = Date.now() / 1000 - stateJson.ts;
    pill = age < DAY_SECONDS ? 'ok' : age <= 7 * DAY_SECONDS ? 'neutral' : 'fail';
  }
  const run = RUNS.get(t.name);
  const running = Boolean(run);
  const queued = isQueued(t.name, t.serial_key);
  return {
    name: t.name,
    group: t.group,
    note: t.note,
    host: t.host,
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

export function createApp(options = {}) {
  const basePath = options.basePath ?? process.env.BASE_PATH ?? ''
  const app = createKitApp({
    title: 'Task Runner',
    basePath,
    staticDir: REPO_DIR,
    jsonBody: false, // /api/upload streams raw bytes, JSON-typed uploads included
    healthExtra: () => ({ tasks: TASK_LIST.length, missingConfig: MISSING_CONFIG }),
    routes: (router) => {
      // JSON body parsing only for the endpoints that need it; /api/upload
      // streams raw bytes straight to disk (JSON-typed uploads included).
      router.use(['/api/run', '/api/cancel', '/api/paste_done'], express.json({ limit: '1mb' }))

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

      router.get('/api/tasks', (req, res) => {
        const names = [...new Set(TASK_LIST.map((t) => t.group))]
        res.json({
          groups: names.map((name) => ({ name, tasks: TASK_LIST.filter((t) => t.group === name).map(taskJson) })),
          missing_config: MISSING_CONFIG,
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

      router.get('/api/status', (req, res) => {
        const runs = []
        for (const [taskName, rec] of RUNS) {
          const newLines = rec.log.slice(rec.read)
          rec.read = rec.log.length
          runs.push({ task: taskName, log: newLines })
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
    console.log('usage: backupctl [--port N] [--host H] [--no-browser]');
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
  app.listen(port, values.host, () => console.log(`backupctl listening on ${url}`));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await boot();
  main();
}
