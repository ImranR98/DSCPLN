// Run state + staging: per-task state files, running markers (crash
// detection) and the per-run temp/staging directories.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expand, resolve } from './template.mjs';

export const STATE_DIR = process.env.BACKUPCTL_STATE_DIR ?? path.join(os.homedir(), '.backupctl');
const RUNNING_FILE = path.join(STATE_DIR, 'running.json');
const SCHEDULE_DIR = path.join(STATE_DIR, 'schedules');

export function slugify(name) {
  return String(name).replace(/[^a-zA-Z0-9_-]/g, '_');
}

// Run state is centralized under BACKUPCTL_STATE_DIR/tasks/ so it never lands
// in a data/backup tree. `state_dir` remains the task's default move/ingest
// destination and the location of legacy state files.
export function stateFileFor(task) {
  return path.join(STATE_DIR, 'tasks', `${slugify(task.name)}.json`);
}

// Pre-centralization location, read once for a seamless upgrade.
export function legacyStateFileFor(task, local) {
  const base = expand(resolve(task.state_dir, local));
  return path.join(base, `.backup-state-${slugify(task.name)}.json`);
}

export function saveTaskState(task, local, ok, summary, output = '') {
  const file = stateFileFor(task);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const data = {
    task: task.name,
    ts: Date.now() / 1000,
    ok,
    summary,
    output,
  };
  const tmp = file + '.tmp';
  // Captured output can include secrets/financial data; never world-readable.
  fs.writeFileSync(tmp, JSON.stringify(data, null, 1), { mode: 0o600 });
  fs.renameSync(tmp, file);
}

export function loadTaskState(task, local) {
  for (const file of [stateFileFor(task), legacyStateFileFor(task, local)]) {
    if (!fs.existsSync(file)) continue;
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      // try the next location
    }
  }
  return null;
}

function writeRunning(list) {
  if (list.length) fs.writeFileSync(RUNNING_FILE, JSON.stringify(list), { mode: 0o600 });
  else fs.rmSync(RUNNING_FILE, { force: true });
}

export function markRunning(taskName) {
  const list = (runningMarker() ?? []).filter((m) => m.task !== taskName);
  list.push({ task: taskName, ts: Date.now() / 1000 });
  fs.mkdirSync(STATE_DIR, { recursive: true });
  writeRunning(list);
}

export function clearRunning(taskName) {
  writeRunning((runningMarker() ?? []).filter((m) => m.task !== taskName));
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
  fs.mkdirSync(d, { recursive: true, mode: 0o700 });
  // mkdir mode only applies to new dirs; uploads wait here between stages.
  try {
    fs.chmodSync(d, 0o700);
  } catch {
    // best effort
  }
  return d;
}

/* Run commands get TMPDIR here (a per-run subdir): the real filesystem,
 * not a small/quota'd /tmp tmpfs. Each run's subdir is wiped when it ends. */
export function tmpRoot() {
  return process.env.BACKUPCTL_TMP_DIR ?? path.join(os.homedir(), 'Downloads', 'backupctl-tmp');
}

/* Schedule bookkeeping lives beside the running marker, not in a task's
 * state_dir: state_dir may be a read-only or git-tracked tree, and the
 * scheduler must still persist its catch-up marker. */
function scheduleFileFor(taskName) {
  return path.join(SCHEDULE_DIR, `${slugify(taskName)}.json`);
}

export function loadScheduleState(taskName) {
  const file = scheduleFileFor(taskName);
  if (!fs.existsSync(file)) return { lastScheduledRun: null, missed: 0 };
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return {
      lastScheduledRun: data.lastScheduledRun == null ? null : Number(data.lastScheduledRun),
      missed: Math.max(0, Number(data.missed) || 0),
    };
  } catch {
    return { lastScheduledRun: null, missed: 0 };
  }
}

export function saveScheduleState(taskName, state) {
  const file = scheduleFileFor(taskName);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const data = {
    lastScheduledRun: state.lastScheduledRun == null ? null : Number(state.lastScheduledRun),
    missed: Math.max(0, Number(state.missed) || 0),
  };
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 1), { mode: 0o600 });
  fs.renameSync(tmp, file);
}

/* Adapter for the server-kit Scheduler. */
export function scheduleStore(taskName) {
  let current = loadScheduleState(taskName);
  return {
    lastScheduledRun: () => current.lastScheduledRun,
    async setLastScheduledRun(ts) {
      current = { ...current, lastScheduledRun: ts == null ? null : Number(ts) };
      saveScheduleState(taskName, current);
    },
    async markMissed() {
      current = { ...current, missed: (current.missed ?? 0) + 1 };
      saveScheduleState(taskName, current);
    },
  };
}
