// Run state + staging: per-task state files, running markers (crash
// detection) and the per-run temp/staging directories.

import { spawnSync } from 'node:child_process';
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

const RUNTIME_DIRS = ['.cache', '.venvs', '.android', 'tmp'];

function assertTaskUserAccess(target, flag = '-x') {
  if (process.getuid?.() !== 0 || OWNER_UID === 0) return;
  const result = spawnSync('test', [flag, target], {
    uid: OWNER_UID,
    gid: OWNER_GID,
    stdio: 'ignore',
  });
  if (result.error) {
    throw new Error(`Could not verify ${target} as ${OWNER_UID}:${OWNER_GID}: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const verb = flag === '-w' ? 'writable' : 'accessible';
    throw new Error(`${target} is not ${verb} by task user ${OWNER_UID}:${OWNER_GID}`);
  }
}

// The whole state layout is created at boot, not lazily on the first upload.
// This also makes a fresh container or config checkout deterministic.
export function ensureStateTree() {
  ensureStateDir();
  ensureStateDir(path.join(STATE_DIR, 'tasks'));
  ensureStateDir(path.join(STATE_DIR, 'schedules'));
  ensureStateDir(path.join(STATE_DIR, 'staging'));
  assertTaskUserAccess(STATE_DIR);
  assertTaskUserAccess(path.join(STATE_DIR, 'staging'));
}

// Runtime directories used directly by run_as tasks (venvs, caches, adb,
// temp files). The deployment init container normalizes HOME itself; this
// keeps local/container runs working and verifies the result.
export function ensureRuntimeDirs(home = os.homedir()) {
  if (process.getuid?.() === 0 && process.env.BACKUPCTL_STATE_UID) {
    handToOwner(home, 0o755);
  }
  assertTaskUserAccess(home, '-w');
  for (const name of RUNTIME_DIRS) {
    const dir = path.join(home, name);
    ensureStateDir(dir);
    assertTaskUserAccess(dir, '-w');
  }
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
  // The shared parent needs to be traversable by run_as task users too. It
  // may predate this helper or have been created by root during an upgrade.
  ensureStateDir(path.join(STATE_DIR, 'staging'));
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

