#!/usr/bin/env node
/* backupctl — Express server + generic bash runner + CLI entry.
 *
 * Tasks are bash: each task is a `command`/`commands` (usually calling
 * backupctl/lib.sh) executed by the runner with timeouts, process
 * groups, secret redaction, and per-task state recording. Runner options:
 * `uploads:` (dropped files, available as {{uploads}}), `glob:` (drop pattern,
 * or list of patterns), `prompts:` (confirm/secret, redacted), `require:`,
 * `capture:` + `commit_dir:` (output shown in a paste dialog), `args:`
 * (argv form; empty values drop their flag pair), `tool:` (download+extract
 * a CLI if missing, as {{tool_binary}}), `fresh_dir:` (validate the newest
 * export dir is non-empty and fresh), `prune:` (delete older export dirs),
 * `summary_last_line:` (summary = last log line). */

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import express from 'express';
import { minimatch } from 'minimatch';

import * as core from './core.mjs';

const STATIC_DIR = path.join(path.dirname(new URL(import.meta.url).pathname), 'static');
const DEFAULT_TIMEOUT = 600;
const DAY_SECONDS = 86400;

// run plumbing ---------------------------------------------------------------

function makeLogger() {
  const lines = [];
  const log = (line) => lines.push(line);
  log.lines = lines;
  log.text = () => lines.join('\n');
  return log;
}

function resolveTpl(template, ctx, extra = undefined) {
  return core.expand(core.resolve(template, ctx.local, extra));
}

function timeoutOf(ctx) {
  return parseInt(ctx.task.timeout ?? DEFAULT_TIMEOUT, 10);
}

function clearStaging(ctx) {
  const d = core.stagingDir(ctx.task.name);
  fs.rmSync(d, { recursive: true, force: true });
  fs.mkdirSync(d, { recursive: true });
}

function cleanupTmp(tmp) {
  fs.rmSync(tmp, { recursive: true, force: true });
}

function failRun(rc, tmp, timeout) {
  cleanupTmp(tmp);
  if (rc === core.TIMEOUT_RC) return [false, `Command timed out after ${timeout}s`];
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
  const timeout = timeoutOf(ctx);
  const tmp = path.join(core.stagingDir(task.name), `tmp_${Math.floor(Math.random() * 1_000_000)}`);
  const extra = {
    uploads: ctx.files.map((f) => core.shellQuote(String(f))).join(' '),
    tmp: String(tmp),
    node: process.execPath,
    ...Object.fromEntries(Object.entries(ctx.extra ?? {}).map(([k, v]) => [k, String(v)])),
  };
  const redact = Object.values(ctx.extra ?? {}).filter((v) => v).map(String);
  let [ok, err] = await ensureTool(ctx, extra, timeout);
  if (!ok) return [false, err];
  const output = [];
  const cwd = resolveTpl(task.cwd ?? '.', ctx);
  if ('args' in task) {
    const argv = resolveArgs(task.args, ctx, extra);
    if (!argv.length) return [false, 'Command args are empty'];
    const rc = await core.run(argv, { cwd, log: ctx.log, timeout, redact });
    if (rc !== 0) return failRun(rc, tmp, timeout);
  } else {
    for (const cmd of task.commands ?? [task.command]) {
      const resolved = core.resolve(cmd, ctx.local, extra);
      let rc;
      if (capture) {
        const { rc: r, out, err } = await core.shCapture(resolved, { cwd, timeout, redact });
        rc = r;
        const lines = out.split(/\r?\n/);
        if (lines.at(-1) === '') lines.pop();
        for (const line of lines) ctx.log(line);
        if (err.trim()) ctx.log(err.trim());
        output.push(...lines);
      } else {
        rc = await core.sh(resolved, { cwd, log: ctx.log, timeout, redact });
      }
      if (rc !== 0) return failRun(rc, tmp, timeout);
    }
  }
  if (task.uploads) clearStaging(ctx);
  else cleanupTmp(tmp);
  [ok, err] = await checkFreshDir(ctx, extra);
  if (!ok) return [false, err];
  pruneExports(ctx, extra);
  if (capture) return [true, output.join('\n')];
  if (task.summary_last_line) {
    const last = [...ctx.log.lines].reverse().find((l) => l.trim() && !l.startsWith('$ '));
    return [true, last ?? 'Completed'];
  }
  return [true, 'Completed'];
}

export async function ensureTool(ctx, extra, timeout) {
  // download+extract the task's `tool:` if its binary is missing
  const tool = ctx.task.tool;
  if (!tool) return [true, ''];
  let binary = resolveTpl(tool.binary, ctx, extra);
  if (!path.isAbsolute(binary)) binary = path.join(resolveTpl(tool.dir, ctx, extra), binary);
  if (fs.existsSync(binary)) {
    extra.tool_binary = binary;
    return [true, ''];
  }
  ctx.log(`Downloading ${path.basename(binary)}...`);
  const toolDir = resolveTpl(tool.dir, ctx, extra);
  fs.mkdirSync(toolDir, { recursive: true });
  const archive = path.join(toolDir, 'tool.tar.gz');
  const steps = [`wget -q ${tool.url} -O ${core.shellQuote(archive)}`];
  if (tool.extract) {
    steps.push(
      `tar xf ${core.shellQuote(archive)} -C ${core.shellQuote(toolDir)}`,
      `rm ${core.shellQuote(archive)}`
    );
  }
  if (tool.chmod) steps.push(`chmod +x ${core.shellQuote(binary)}`);
  if ((await core.sh(steps.join(' && '), { log: ctx.log, timeout })) !== 0) {
    return [false, `Failed to install ${path.basename(binary)}`];
  }
  extra.tool_binary = binary;
  return [true, ''];
}

export function resolveArgs(args, ctx, extra) {
  // entries resolving empty (or to an unresolved token) are dropped along
  // with the flag preceding them (so optional `-t {{totp}}` pairs work)
  const resolved = [];
  for (const arg of args) {
    const value = core.resolve(arg, ctx.local, extra);
    if (typeof value === 'string' && (!value.trim() || value.includes('{{'))) {
      resolved.pop();
      continue;
    }
    resolved.push(String(value));
  }
  return resolved;
}

export async function checkFreshDir(ctx, extra) {
  const template = ctx.task.fresh_dir;
  if (!template) return [true, ''];
  const root = resolveTpl(template, ctx, extra);
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    return [false, `No export directory found at ${root}`];
  }
  const dirs = sortedExportDirs(root);
  if (!dirs.length) return [false, 'Export produced no backup directory'];
  const newest = dirs.at(-1);
  const maxAge = parseInt(ctx.task.fresh_max_age_seconds ?? DAY_SECONDS, 10);
  const items = fs.readdirSync(newest).length;
  if (!items || Date.now() / 1000 - fs.statSync(newest).mtimeMs / 1000 > maxAge) {
    return [false, `Export directory ${path.basename(newest)} is empty or stale — the export did not complete`];
  }
  ctx.log(`Validated export: ${path.basename(newest)} (${items} items)`);
  return [true, ''];
}

export function pruneExports(ctx, extra) {
  const cfg = ctx.task.prune;
  if (!cfg) return;
  const root = resolveTpl(cfg.dir, ctx, extra);
  const dirs = sortedExportDirs(root);
  if (dirs.length < 2) return;
  const newestCount = fs.readdirSync(dirs.at(-1)).length;
  for (const d of dirs.slice(0, -1)) {
    const count = fs.readdirSync(d).length;
    if (cfg.keep_newer && count > newestCount) {
      ctx.log(`WARNING: previous backup '${path.basename(d)}' has MORE files (${count}) than the newest (${newestCount}). NOT deleted.`);
    } else {
      fs.rmSync(d, { recursive: true, force: true });
      ctx.log(`Deleted old export ${path.basename(d)}`);
    }
  }
}

export function sortedExportDirs(root) {
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => path.join(root, e.name))
    .sort((a, b) => path.basename(a).localeCompare(path.basename(b), undefined, { numeric: true }));
}

// task metadata + dispatcher -------------------------------------------------

export function availability(task, local) {
  // tasks with a `root` (e.g. device mounts) are unavailable when missing
  const rootRaw = task.root;
  if (rootRaw) {
    const pattern = core.expand(core.resolve(rootRaw, local));
    if (!core.pathFound(pattern)) return [false, 'Source directory not found'];
  }
  return [true, ''];
}

export function supportsUploads(task) {
  return Boolean(task.uploads);
}

export function uploadPatterns(task, local = null) {
  const globs = task.glob ?? '*';
  let patterns = Array.isArray(globs) ? globs : [globs];
  if (local !== null) patterns = patterns.map((p) => core.resolve(p, local));
  return patterns;
}

export function matchScore(pattern) {
  return [...pattern].filter((c) => !'*?'.includes(c)).length;
}

export async function runTask(task, local, files, log = null, extra = null) {
  const lines = [];
  const sink = log ?? (() => {});
  const collectLog = (line) => {
    lines.push(line);
    sink(line);
  };
  collectLog.lines = lines;
  const ctx = { task, local, files, log: collectLog, extra: extra ?? {} };
  let ok;
  let summary;
  try {
    [ok, summary] = await runCommands(ctx);
  } catch (e) {
    collectLog(`ERROR: ${e.message}`);
    [ok, summary] = [false, String(e.message ?? e)];
  }
  core.saveTaskState(task, local, ok, summary, lines.join('\n'));
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
      ? await core.loadConfig(configPath)
      : await core.loadConfig();
  } catch (e) {
    if (e instanceof core.ConfigMissingError) {
      console.warn(`WARNING: ${e.message}`);
      MISSING_CONFIG = true;
    } else if (e instanceof core.ConfigError) {
      console.error(`config error: ${e.message}`);
      process.exit(1);
    } else {
      throw e;
    }
  }
  TASK_MAP = new Map(TASK_LIST.map((t) => [t.name, t]));
}

// run slot: single task at a time
export const CURRENT = { name: null, log: [], read: 0, done: null, cancelled: false };

export function queuedCount(name) {
  try {
    return fs.readdirSync(core.stagingDir(name)).filter((p) => {
      try {
        return fs.statSync(path.join(core.stagingDir(name), p)).isFile();
      } catch {
        return false;
      }
    }).length;
  } catch {
    return 0;
  }
}

export function taskJson(t) {
  const [avail, reason] = availability(t, LOCAL);
  let stateJson = null;
  const marker = core.runningMarker();
  if (marker && marker.task === t.name) {
    // a previous run was interrupted (server stopped/crashed mid-task)
    const ts = marker.ts ?? Date.now() / 1000;
    stateJson = {
      ts,
      ok: false,
      summary: 'Interrupted',
      output: '',
      last_run_text: `Interrupted · ${core.humanAgo(ts)}`,
    };
  } else {
    const rec = core.loadTaskState(t, LOCAL);
    if (rec) {
      const ok = Boolean(rec.ok);
      stateJson = {
        ts: rec.ts,
        ok,
        summary: rec.summary ?? '',
        output: rec.output ?? '',
        last_run_text: `${ok ? 'OK' : 'FAILED'} · ${core.humanAgo(rec.ts)}`,
      };
    }
  }
  // staleness policy: ok(<24h) > neutral(<=7d) > fail
  let pill = 'fail';
  if (stateJson && stateJson.ok) {
    const age = Date.now() / 1000 - stateJson.ts;
    pill = age < 24 * 3600 ? 'ok' : age <= 7 * 86400 ? 'neutral' : 'fail';
  }
  const running = CURRENT.name === t.name;
  return {
    name: t.name,
    group: t.group,
    note: t.note,
    prompts: t.prompts ?? [],
    uploads: supportsUploads(t),
    export_url: t.export_url,
    avail,
    avail_reason: reason,
    queued: queuedCount(t.name),
    state: stateJson,
    pill: running ? 'running' : pill,
    running,
    live: running && CURRENT.log.length ? CURRENT.log.at(-1).slice(0, 120) : '',
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

  app.use(express.json({ limit: '1mb' }));

  // most-specific pattern wins; ties listed as `ambiguous`
  app.post('/api/detect', (req, res) => {
    const name = path.basename(String(req.query.name ?? ''));
    const candidates = [];
    for (const t of TASK_LIST) {
      if (!supportsUploads(t)) continue;
      for (const p of uploadPatterns(t, LOCAL)) {
        if (minimatch(name, p)) candidates.push({ task: t.name, score: matchScore(p) });
      }
    }
    if (!candidates.length) return res.json({ result: null });
    const best = Math.max(...candidates.map((c) => c.score));
    const tied = candidates.filter((c) => c.score === best).map((c) => c.task);
    res.json({ result: { task: tied[0], ambiguous: tied } });
  });

  app.get('/api/tasks', (req, res) => {
    res.json({ tasks: TASK_LIST.map(taskJson), missing_config: MISSING_CONFIG });
  });

  app.post(
    '/api/upload/:taskName',
    express.raw({ type: () => true, limit: '2gb' }),
    (req, res) => {
      const task = TASK_MAP.get(req.params.taskName);
      if (!task || !supportsUploads(task)) return res.status(404).json({ detail: 'Unknown task' });
      const filename = path.basename(String(req.query.name ?? ''));
      const patterns = uploadPatterns(task, LOCAL);
      if (!patterns.some((p) => minimatch(filename, p))) {
        return res
          .status(400)
          .json({ detail: `${filename} does not match the expected pattern(s): ${patterns.join(', ')}` });
      }
      const staging = core.stagingDir(task.name);
      fs.writeFileSync(path.join(staging, filename), req.body);
      res.json({ queued: filename, count: queuedCount(task.name) });
    }
  );

  app.post('/api/run/:taskName', (req, res) => {
    const taskName = req.params.taskName;
    const task = TASK_MAP.get(taskName);
    if (!task) return res.status(404).json({ detail: 'Unknown task' });
    if (CURRENT.name) return res.status(409).json({ detail: 'Another task is already running' });
    const [avail, reason] = availability(task, LOCAL);
    if (!avail) return res.status(400).json({ detail: reason });
    const staging = core.stagingDir(taskName);
    const files = fs
      .readdirSync(staging)
      .filter((p) => fs.statSync(path.join(staging, p)).isFile())
      .map((p) => path.join(staging, p));
    const payload = req.body ?? {};
    const logger = makeLogger();
    CURRENT.name = taskName;
    CURRENT.log = logger.lines;
    CURRENT.read = 0;
    CURRENT.done = null;
    CURRENT.cancelled = false;
    core.markRunning(taskName);

    (async () => {
      let ok = false;
      let summary = 'Internal error';
      try {
        [ok, summary] = await runTask(task, LOCAL, files, logger, payload);
        if (CURRENT.cancelled) {
          [ok, summary] = [false, 'Cancelled by user'];
          core.saveTaskState(task, LOCAL, false, summary, logger.text());
        }
      } finally {
        CURRENT.done = {
          task: taskName,
          ok,
          summary,
          paste: Boolean(task.capture),
        };
        CURRENT.name = null;
        CURRENT.cancelled = false;
        core.clearRunning();
      }
    })().catch((e) => console.error('worker error:', e));
    res.json({ started: true });
  });

  app.get('/api/status', (req, res) => {
    const log = CURRENT.log;
    const newLines = log.slice(CURRENT.read);
    CURRENT.read = log.length;
    const done = CURRENT.done;
    CURRENT.done = null;
    res.json({ running: CURRENT.name, log: newLines, done });
  });

  app.post('/api/cancel', (req, res) => {
    if (!CURRENT.name) return res.status(409).json({ detail: 'No task is running' });
    CURRENT.cancelled = true;
    core.cancelAll();
    res.json({ cancelled: true });
  });

  app.post('/api/paste_done/:taskName', async (req, res) => {
    const task = TASK_MAP.get(req.params.taskName);
    if (!task) return res.status(404).json({ detail: 'Unknown task' });
    const commitDir = task.commit_dir;
    if (!commitDir) return res.json({ committed: false });
    const dest = core.expand(core.resolve(commitDir, LOCAL));
    try {
      await core.gitCommit(dest, `${task.name} · ${new Date().toLocaleString()}`);
    } catch (e) {
      return res.status(500).json({ detail: `git commit failed: ${e.message}` });
    }
    res.json({ committed: true, dest });
  });

  app.get('/', (req, res) => {
    res.sendFile(path.join(STATIC_DIR, 'index.html'));
  });
  app.use('/static', express.static(STATIC_DIR));

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
