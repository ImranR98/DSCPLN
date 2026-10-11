// Task config loading: find the monorepo root, import the user's config.mjs,
// merge group defaults and normalize the script/move/ingest shorthands.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { shellQuote } from './util.mjs';

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
      tasks.push(merged);
    }
  }
  return [local, tasks];
}
