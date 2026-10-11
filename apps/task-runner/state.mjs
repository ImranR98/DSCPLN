// Run state + staging: per-task state files, running markers (crash
// detection) and the per-run temp/staging directories.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expand, resolve } from './template.mjs';

export const STATE_DIR = process.env.BACKUPCTL_STATE_DIR ?? path.join(os.homedir(), '.backupctl');
const RUNNING_FILE = path.join(STATE_DIR, 'running.json');

export function slugify(name) {
  return String(name).replace(/[^a-zA-Z0-9_-]/g, '_');
}

export function stateFileFor(task, local) {
  const base = expand(resolve(task.state_dir, local));
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

function writeRunning(list) {
  if (list.length) fs.writeFileSync(RUNNING_FILE, JSON.stringify(list));
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
  fs.mkdirSync(d, { recursive: true });
  return d;
}

/* Run commands get TMPDIR here (a per-run subdir): the real filesystem,
 * not a small/quota'd /tmp tmpfs. Each run's subdir is wiped when it ends. */
export function tmpRoot() {
  return process.env.BACKUPCTL_TMP_DIR ?? path.join(os.homedir(), 'Downloads', 'backupctl-tmp');
}
