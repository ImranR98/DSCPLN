// Task config loading: find the monorepo root, import the user's config.mjs,
// merge group defaults and normalize the script/move/ingest shorthands.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { normalizeSpec, specValid } from '@dscpln/server-kit';
import { shellQuote } from './util.mjs';
import {
  attributeDefinitions,
  defaultGroupBy,
  readTaskMeta,
  taskMetaFileFor,
  TaskMetaError,
} from './task-meta.mjs';

export const REPO_DIR = path.dirname(fileURLToPath(import.meta.url));
export const CONFIG_FILE = process.env.BACKUPCTL_CONFIG_FILE ?? path.join(REPO_DIR, 'config.mjs');
export const LIB_PATH = path.join(REPO_DIR, 'lib.sh');

/* The monorepo root: walk up from this app to the nearest package.json with a
 * `workspaces` field. Used when BACKUPCTL_REPO_DIR is not set, so
 * `node apps/task-runner/server.mjs` resolves {{repo_dir}} correctly. */
export function findRepoRoot(startDir = REPO_DIR) {
  let dir = startDir;
  for (let i = 0; i < 8; i++) {
    const pkgFile = path.join(dir, 'package.json');
    if (fs.existsSync(pkgFile)) {
      try {
        if (JSON.parse(fs.readFileSync(pkgFile, 'utf8')).workspaces) return dir;
      } catch { /* unreadable package.json: keep walking */ }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return startDir;
}

// config ---------------------------------------------------------------------

export class ConfigMissingError extends Error {}
export class ConfigError extends Error {}

const HEREDOC_WRAP = `bash -c 'TMP=$(mktemp); cat > "$TMP"; bash "$TMP"; RC=$?; rm -f "$TMP"; exit $RC' <<'BASH_SCRIPT'`;

/* Task shorthands, normalized into `commands` at load: `script:` is a bash
 * body wrapped in a temp-file heredoc (children can't eat the script from
 * stdin); `move:`/`ingest:` are the common "file this drop into a
 * destination dir and git-commit it" flows, with `dest` defaulting to the
 * task's state_dir. */
function shorthandCommands(t) {
  if (t.script) {
    const body = String(t.script).replace(/\n+$/, '');
    return `${HEREDOC_WRAP}\n${body}\nBASH_SCRIPT`;
  }
  if (t.move) {
    const { rename, dest = t.state_dir } = t.move;
    const flags = rename ? ` --rename ${shellQuote(rename)}` : '';
    return `bash '{{lib}}' move --git${flags} ${shellQuote(dest)} {{uploads}}`;
  }
  if (t.ingest) {
    const { suffix, dest = t.state_dir } = t.ingest;
    return `bash '{{lib}}' ingest ${shellQuote(dest)} ${shellQuote(suffix)} {{uploads}}`;
  }
  return null;
}

const NOTIFY_MODES = new Set(['never', 'errors', 'always']);

function validateSecrets(value, label) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((key) => typeof key !== 'string' || !key.trim())) {
    throw new ConfigError(`${label} must be a list of token names`);
  }
  return value.map((key) => key.trim());
}

function validateEnv(value, label) {
  if (value === undefined) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ConfigError(`${label} must be an object of environment variables`);
  }
  for (const [key, entry] of Object.entries(value)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      throw new ConfigError(`${label}.${key} is not a valid environment variable name`);
    }
    if (entry == null || (typeof entry !== 'string' && typeof entry !== 'number' && typeof entry !== 'boolean')) {
      throw new ConfigError(`${label}.${key} must be a string, number or boolean`);
    }
  }
  return value;
}

function validatePrompts(value, label) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new ConfigError(`${label} must be a list`);
  const seen = new Set();
  return value.map((prompt, index) => {
    if (!prompt || typeof prompt !== 'object' || Array.isArray(prompt)) {
      throw new ConfigError(`${label}[${index}] must be an object`);
    }
    const key = String(prompt.key ?? '').trim();
    if (!key) throw new ConfigError(`${label}[${index}].key is required`);
    if (seen.has(key)) throw new ConfigError(`${label} has duplicate key '${key}'`);
    seen.add(key);
    if (prompt.type !== undefined && !['confirm', 'secret'].includes(prompt.type)) {
      throw new ConfigError(`${label}.${key}: type must be confirm or secret`);
    }
    return { ...prompt, key, label: String(prompt.label ?? key) };
  });
}

function normalizeActions(value, taskName) {
  if (value === undefined) return [];
  const list = Array.isArray(value)
    ? value
    : value && typeof value === 'object'
      ? Object.entries(value).map(([key, action]) => ({ key, ...action }))
      : null;
  if (!list) throw new ConfigError(`Task '${taskName}': actions must be a list or object`);
  const seen = new Set();
  return list.map((action, index) => {
    if (!action || typeof action !== 'object' || Array.isArray(action)) {
      throw new ConfigError(`Task '${taskName}': actions[${index}] must be an object`);
    }
    const key = String(action.key ?? '').trim();
    if (!key) throw new ConfigError(`Task '${taskName}': actions[${index}].key is required`);
    if (seen.has(key)) throw new ConfigError(`Task '${taskName}': duplicate action '${key}'`);
    seen.add(key);
    if (!action.commands) {
      throw new ConfigError(`Task '${taskName}': action '${key}' needs 'commands'`);
    }
    const require = action.require ?? [];
    if (!Array.isArray(require) || require.some((item) => typeof item !== 'string' || !item.trim())) {
      throw new ConfigError(`Task '${taskName}': action '${key}' require must be a list of prompt keys`);
    }
    return {
      key,
      label: String(action.label ?? key),
      commands: action.commands,
      prompts: validatePrompts(action.prompts, `Task '${taskName}': action '${key}' prompts`),
      require: require.map((item) => item.trim()),
      summary_last_line: action.summary_last_line !== false,
    };
  });
}

export function validateSchedule(task, schedule) {
  if (schedule === undefined || schedule === null) return null;
  if (typeof schedule !== 'object' || Array.isArray(schedule)) {
    throw new ConfigError(`Task '${task.name}': schedule must be an object`);
  }
  const normalized = normalizeSpec(schedule);
  if (!specValid(normalized)) {
    throw new ConfigError(`Task '${task.name}': schedule needs a valid time (HH:MM)`);
  }
  // Scheduled runs are unattended: anything that needs a person at the
  // keyboard is rejected at load time instead of failing at 04:00.
  for (const field of ['uploads', 'prompts', 'require', 'browser', 'commit_dir']) {
    if (task[field]) {
      throw new ConfigError(`Task '${task.name}': scheduled tasks cannot use '${field}'`);
    }
  }
  return normalized;
}

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
  local.repo_dir ??= process.env.BACKUPCTL_REPO_DIR ?? findRepoRoot(REPO_DIR);
  local.lib ??= LIB_PATH;
  local.secrets = validateSecrets(local.secrets, "Config 'secrets'");
  if (!Array.isArray(groups)) throw new ConfigError("Config needs a 'groups' array");
  const metaFile = taskMetaFileFor(p);
  let meta;
  try {
    meta = readTaskMeta(metaFile);
  } catch (err) {
    if (err instanceof TaskMetaError) throw new ConfigError(err.message);
    throw err;
  }
  const attributes = attributeDefinitions(meta?.attributes, groups.map((group) => group.name));
  local.attributes = attributes;
  local.default_group_by = defaultGroupBy(meta, attributes);
  local.meta_file = metaFile;
  local.task_meta = meta ?? { version: 1, attributes: [], default_group_by: local.default_group_by, tasks: {} };
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
      merged.commands ??= shorthandCommands(merged);
      delete merged.script;
      delete merged.move;
      delete merged.ingest;
      if (!merged.commands) {
        throw new ConfigError(`Task '${merged.name}' needs 'commands' (or 'script'/'move'/'ingest')`);
      }
      if (taskSeen.has(merged.name)) throw new ConfigError(`Duplicate task name: '${merged.name}'`);
      taskSeen.add(merged.name);
      if (merged.host !== undefined && (typeof merged.host !== 'string' || !merged.host.trim())) {
        throw new ConfigError(`Task '${merged.name}': host must be a machine name`);
      }
      merged.host ??= 'any';
      merged.env = validateEnv(merged.env, `Task '${merged.name}': env`);
      merged.secrets = validateSecrets(merged.secrets, `Task '${merged.name}': secrets`);
      merged.actions = normalizeActions(merged.actions, merged.name);
      const entry = meta?.tasks?.[merged.name];
      merged.attributes = { ...(entry?.attributes ?? {}) };
      // New tasks and hand-written entries without a Category fall back to the
      // config group, so the default Category view is never empty.
      if (!merged.attributes.Category) merged.attributes.Category = merged.group;
      if (entry && Object.prototype.hasOwnProperty.call(entry, 'schedule')) {
        merged.schedule = entry.schedule;
      }
      merged.schedule = validateSchedule(merged, merged.schedule);
      merged.notify = merged.notify ?? (merged.schedule ? 'errors' : 'never');
      if (!NOTIFY_MODES.has(merged.notify)) {
        throw new ConfigError(`Task '${merged.name}': notify must be never, errors or always`);
      }
      merged.notify_name ??= merged.name;
      tasks.push(merged);
    }
  }
  return [local, tasks];
}
