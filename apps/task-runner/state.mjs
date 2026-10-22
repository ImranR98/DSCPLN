// Run state + staging: per-task state files, running markers (crash
// detection) and the per-run temp/staging directories.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expand, resolve } from './template.mjs';

export const STATE_DIR = process.env.BACKUPCTL_STATE_DIR ?? path.join(os.homedir(), '.backupctl');
const RUNNING_FILE = path.join(STATE_DIR, 'running.json');
const SCHEDULE_DIR = path.join(STATE_DIR, 'schedules');
const OWNER_UID = Number(process.env.BACKUPCTL_STATE_UID ?? 1000);
const OWNER_GID = Number(process.env.BACKUPCTL_STATE_GID ?? OWNER_UID);

export function slugify(name) {
  return String(name).replace(/[^a-zA-Z0-9_-]/g, '_');
}

// The server runs as root but the state folder lives in the config repo owned
// by the login user. Give files back to that owner so Syncthing and editors
// can keep writing; local/test runs without chown permission are unaffected.
function handToOwner(target, mode) {
  try {
    fs.chmodSync(target, mode);
    fs.chownSync(target, OWNER_UID, OWNER_GID);
  } catch {
    // best effort
  }
}

export function ensureStateDir(dir = STATE_DIR) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  handToOwner(dir, 0o700);
}

// Run state is centralized under BACKUPCTL_STATE_DIR/tasks/ so it never lands
// in a data/backup tree. `state_dir` remains the task's default move/ingest
// destination and the location of legacy state files. Action runs append a
// suffix so they never overwrite the task's normal last-run state.
export function stateFileFor(task) {
  const suffix = task.state_suffix ? `.${slugify(task.state_suffix)}` : '';
  return path.join(STATE_DIR, 'tasks', `${slugify(task.name)}${suffix}.json`);
}

// Pre-centralization location, read once for a seamless upgrade.
export function legacyStateFileFor(task, local) {
  const base = expand(resolve(task.state_dir, local));
  return path.join(base, `.backup-state-${slugify(task.name)}.json`);
}

export function saveTaskState(task, local, ok, summary, output = '') {
  const file = stateFileFor(task);
  ensureStateDir(path.dirname(file));
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
  handToOwner(file, 0o600);
}

export function loadTaskState(task, local) {
  const files = [stateFileFor(task)];
  if (!task.state_suffix) files.push(legacyStateFileFor(task, local));
  for (const file of files) {
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
  ensureStateDir();
  if (list.length) {
    fs.writeFileSync(RUNNING_FILE, JSON.stringify(list), { mode: 0o600 });
    handToOwner(RUNNING_FILE, 0o600);
  } else {
    fs.rmSync(RUNNING_FILE, { force: true });
  }
}

export function markRunning(taskName) {
  const list = (runningMarker() ?? []).filter((m) => m.task !== taskName);
  list.push({ task: taskName, ts: Date.now() / 1000 });
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
  ensureStateDir();
  const d = path.join(STATE_DIR, 'staging', slugify(taskName));
  fs.mkdirSync(d, { recursive: true, mode: 0o700 });
  // mkdir mode only applies to new dirs; uploads wait here between stages.
  handToOwner(d, 0o700);
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
  ensureStateDir(path.dirname(file));
  const data = {
    lastScheduledRun: state.lastScheduledRun == null ? null : Number(state.lastScheduledRun),
    missed: Math.max(0, Number(state.missed) || 0),
  };
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 1), { mode: 0o600 });
  fs.renameSync(tmp, file);
  handToOwner(file, 0o600);
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

