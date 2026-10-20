# Task Runner

A small web app that runs config-driven backup/export workflows. Tasks are
bash commands declared in a config file; the app gives them a card with a drop
zone, prompts, live logs, cancel and per-task run state. It lives in the
D$CPLN monorepo (`apps/task-runner`).

## Usage

From the monorepo root:

```sh
npm install
cp apps/task-runner/config.example.mjs apps/task-runner/config.mjs   # edit it
npm run task-runner    # = BACKUPCTL_REPO_DIR=$PWD node apps/task-runner/server.mjs --no-browser
```

This starts a local server (http://127.0.0.1:8080) and opens your browser.
`--no-browser` skips the browser, `--port 8081` changes the port (`--help`
shows the options).

In a container, point the app at a mounted config and state dir:

```sh
BACKUPCTL_CONFIG_FILE=/config/config.mjs \
BACKUPCTL_STATE_DIR=/data/state \
node server.mjs --host 0.0.0.0 --port 8085 --no-browser
```

Multiple instances can share one config: the `host:` field pins a task to a
machine and `BACKUPCTL_HOST` names the instance (default `pc`). Tasks with
`host: 'any'` run anywhere; others show as unavailable elsewhere.

## What you see

A **drop zone at the top** detects which task a dropped file belongs to from
its filename (per-task `glob:` patterns) and asks before running it; ambiguous
matches open a picker. Task cards are grouped by their group name and each has:

- a **drop zone** to stage files for that task; staged files live in browser
  memory until you press Run
- a **Run** button (disabled while the task is unavailable, e.g. its `root:`
  directory is missing) that becomes **Stop** while running
- a **Log** button (last run's output; the live line streams under the title)
- a **Generate Export** link when the task sets `export_url:`
- a status line (last run time/result) stored in `BACKUPCTL_STATE_DIR/tasks/<slug>.json`

There are no automatic timeouts — a run goes until it finishes or you stop it.
Any number of tasks run in parallel; tasks sharing a `serial_key` are queued
and run one at a time. Runs interrupted by a server crash show as
"Interrupted" instead of a false success.

## Scheduled tasks

Add `schedule: {enabled, days, at, catchUp}` to a task and the Task Runner
becomes its scheduler: `days` uses JS weekdays (0 = Sunday, empty = daily),
`at` is local `HH:MM`, and `catchUp` runs an occurrence missed while the
instance was down. Schedules persist their last handled occurrence and missed
count under `BACKUPCTL_STATE_DIR/schedules/`; the card shows the next run and
the portal sees the task through `/api/tasks`.

Scheduled runs are unattended, so the loader rejects `uploads`, `prompts`,
`require`, `browser` and `commit_dir` on scheduled tasks. A task that is
already running, unavailable (host/root/check), or blocked by its `serial_key`
is counted as missed rather than queued. Set `BACKUPCTL_SCHEDULES=0` on a
second instance so only one machine fires shared schedules. Notifications go
through the portal (`DSCPLN_PORTAL_URL`) with `notify: never|errors|always`
(default `errors` for scheduled tasks) and `notify_name` for the title.

Secrets belong in `env` or in config tokens listed under `secrets`; both are
redacted from the logged command and output. Prefer `env` over argv:

```js
{
  name: 'Nightly export',
  state_dir: '{{maindir}}/.tasks',
  schedule: { enabled: true, days: [], at: '02:00', catchUp: true },
  secrets: ['api_token'],
  env: { API_TOKEN: '{{api_token}}' },
  commands: [`backup-tool --token "$API_TOKEN" '{{maindir}}/export'`],
  summary_last_line: true,
  notify: 'errors',
}
```

## Configuration

Copy `config.example.mjs` to `config.mjs` (gitignored) and edit it. It exports
machine values plus a `groups:` array; groups and tasks render in array order
and a group's `defaults` merge under its tasks. `secrets` is a top-level list
of config tokens that should never appear in a logged command/output.

`{{token}}` placeholders are resolved from the file's values at run time
(values may reference other tokens; resolution loops until stable). Built-in
tokens: `{{repo_dir}}` (repo root, override with `BACKUPCTL_REPO_DIR`) and
`{{lib}}` (the packaged `lib.sh`). `~` and env vars expand on resolved paths.
Every task needs `state_dir:` — it is the default `move`/`ingest` destination. Run state itself is centralized under `BACKUPCTL_STATE_DIR/tasks/`.

If you keep your own helper scripts, place them somewhere on the machine or
mount them into the container and reference them from the config (for example
`scriptroot: '/path/to/scripts'` + `bash '{{scriptroot}}/parse.py'`).

### Task fields

Common: `name`, `note` (help text in the drop zone), `state_dir` (required),
`serial_key` (tasks sharing a key run one at a time), `host` (`any`, or the
instance name), `prompts`, `export_url`, `schedule`, `env`, `secrets`,
`run_as` (optional `{ uid, gid }`; user-data tasks run as the host owner),
`notify` (`never|errors|always`) and `notify_name`.

Runner: exactly one of `commands` (bash string or list), `script:`, `move:`,
or `ingest:`. Optional: `cwd`, `uploads: true` + `glob` (drop zone; a string
or list of patterns), `require: [key...]` (fail unless each prompt key has a
value), `capture: true` + `commit_dir` (output becomes the summary, shown in a
copy/paste dialog whose Done button git-commits `commit_dir`), `root:` (source
directory the card requires; glob-aware), `check:` (bash gate: the task is
unavailable while it exits non-zero, with its first output line as the card's
badge; results are cached ~15s), `browser: true` (the card gets an embedded
login-browser section; it auto-opens when the task starts), `summary_last_line:
true` (summary = last non-command log line). `run_as: { uid: '{{app_uid}}', gid:
'{{app_gid}}' }` drops the task shell to the host data owner; leave it unset for
tasks that need root (PV backups, SSH keys).

- `script: 'bash body'` — wrapped in a temp-file heredoc so inner processes
  can't consume the rest of the script from stdin.
- `move: { rename?, dest? }` — file a drop into `dest` (default `state_dir`)
  via `lib.sh move --git`; good for one-shot exports with a fixed name.
- `ingest: { suffix, dest? }` — extract archives into a temp dir, derive an
  account name with `suffix` (a shell snippet run inside the temp dir), sync
  into `dest/<name>` (default `state_dir`), and git-commit.

Per-run tokens: `{{uploads}}` (shell-quoted staged file paths) plus one
`{{key}}` per prompt value. Both are substituted as shell-quoted literals —
never write quotes around a prompt token in `commands`, and a value can never
inject shell syntax or expand `{{...}}`/`$VAR` (config tokens are trusted and
still resolve recursively). Every command runs with a fresh per-run `$TMPDIR`,
wiped when the run ends. `prompts: [{key, label, type: confirm|secret}]` are
rendered generically; secret values are redacted from the command display and
output.

### Login browser sidecar

When `BROWSER_REMOTE` points at a noVNC endpoint (e.g.
`http://localhost:7900`, the Selenium container's viewer), the server proxies
it at `<basePath>/browser/` on the same origin and reports `browser: true`
in `/api/tasks` and `/api/health`. Task cards with `browser: true` get an
embedded iframe (`<basePath>/browser/?autoconnect=1&resize=scale`) and an
auto-open when the run starts, so a scraper can wait for a manual sign-in or
2FA while the user watches. The WebSocket (`websockify`) is bridged by the
same proxy, including the half-close teardown.

Scraper tools connect WebDriver to `SELENIUM_REMOTE_URL` when set (and fall
back to a local Chrome otherwise, so they still work off-server);
`SELENIUM_PROFILE_DIR` overrides the Chrome profile directory (in the
container the tools default it under `/home/seluser/.config`, which a volume
can persist). Runs that drive the browser use a shared `serial_key` so only
one session is active at a time.

### Balance import

`examples/balance-import.mjs` bridges any scraper that prints tab-separated
transaction rows to the Balance XLSX app: it extracts the trailing rows, asks
the Balance XLSX external API which ones the workbook already has, and imports
only the missing ones. A scrape where **nothing** matched the workbook warns
that the scrape may not reach back far enough, prints the date to check
manually from, and (when a relay is configured) pushes that warning.

```js
{
  name: 'Balance import',
  state_dir: '{{maindir}}/.tasks',
  serial_key: 'balance-import',
  browser: true,
  secrets: ['balance_token'],
  env: { BALANCE_TOKEN: '{{balance_token}}' },
  commands: [
    `your-scraper > "$TMPDIR/transactions.txt"`,
    `node '{{scriptroot}}/balance-import.mjs' --input "$TMPDIR/transactions.txt" ` +
      `--balance-url '{{balance_url}}' --balance-token "$BALANCE_TOKEN" --notify-url '{{portal_url}}'`,
  ],
  summary_last_line: true,
}
```

- `--input` — the scraper output (a file, or `-` for stdin).
- The tool ships with the image; reference it as
  `'{{repo_dir}}/apps/task-runner/examples/balance-import.mjs'` unless your
  `scriptroot` already points at the bundled `examples/` folder.
- `--balance-url` / `--balance-token` — the Balance XLSX external API base
  path (`/balance`) and the bearer token from its Settings page. Pass it via
  `env` (or the `BALANCE_TOKEN` variable) and list it in `secrets` so it is
  redacted from logs, rather than putting it directly in `commands`.
- `--notify-url` (optional) — the portal relay (`http://portal:8080`) or
  `DSCPLN_PORTAL_URL`; the zero-duplicate warning is pushed there (priority
  high, `warning` tag).
- `--after <regex>` (optional) — only consider lines after the last line
  matching the regex, e.g. `--after 'Scraped \d+ transactions'`; by default
  every import-shaped TSV line is taken.
- `--dry-run` — check and report without writing anything.

The scraper's optional `Scraped N transactions` report is pre-filter (it counts
everything it saw, not just the printed rows), so fewer extracted lines than N
is normal; more than N fails the run. A fully-overlapping scrape reports
"Nothing new"; a partial overlap reports the imported/skipped counts.

## Adding your own tools and tasks

1. **Write the tool.** Anything executable works — bash, `python3`, `node`.
   The image already provides `bash`, `python3`, `node`, `rsync`, `git`,
   `age`, `jq`, `unzip`/`tar`, `wget`, `restic` and `kubectl`, and the app tree is writable, so a
   task can    `apt-get`/`pip`/`npm` install more at run time. Give it a shebang
   and the executable bit. A bundled example lives in
   `apps/task-runner/examples/hello-tool.sh`; the Balance import tool
   (`examples/balance-import.mjs`, see above) is a fuller Node one.

2. **Make it visible to the app.**
   - Local runs: keep it anywhere on disk and reference it by absolute path.
   - Container: mount your tool folder read-only (for example
     `-v ~/my-tools:/tools:ro`) and point `scriptroot` at it, or bake the tool
     into a custom image.
   - The bundled example is copied into the image, so
     `scriptroot: '{{repo_dir}}/apps/task-runner/examples'` works both locally
     and in the container — that is what `config.example.mjs` uses.

3. **Set `scriptroot`** in your config and call the tool from a task:

   ```js
   export default {
     maindir: '~/Backups',
     scriptroot: '/tools',
     groups: [{
       name: 'Everyday',
       tasks: [{
         name: 'Manifest dropped files',
         note: 'Drop files to write a manifest next to them.',
         state_dir: '{{maindir}}/.tasks',
         uploads: true,
         glob: '*',
         script: `bash '{{scriptroot}}/hello-tool.sh' '{{maindir}}' {{uploads}}`,
         summary_last_line: true,
       }],
     }],
   }
   ```

4. **Wire the card.** Copy a task from `config.example.mjs` and change the
   fields: `state_dir` is required; `uploads: true` + `glob` adds a drop zone
   (the files are validated and staged, then shell-quoted into `{{uploads}}`);
   `prompts` adds inputs (secrets are redacted from logs); `serial_key`
   serializes tasks that touch the same destination; `capture: true` shows the
   output in a copy/paste dialog instead of the log (add `commit_dir` to
   git-commit it when you press Done); `root:` gates the card on a directory
   existing; `host:` pins it to one instance. `commands:` is the general form
   (a bash string or list of strings); `script:`, `move:` and `ingest:` are
   shorthands that generate the command for you.

5. **Tokens** resolve inside commands and paths: your config's own values
   (`{{maindir}}`, `{{hosts.desktop.ssh}}`, ...), the built-ins `{{repo_dir}}`
   and `{{lib}}` (the packaged `lib.sh`), `{{scriptroot}}` once set, and
   per-run `{{uploads}}` plus one `{{key}}` per prompt value.

## How tasks work

Every task is a list of bash commands executed in order by the runner with
process-group cancellation, secret redaction and per-task state recording. The
repo ships a generic bash library, `lib.sh`, callable as a subcommand:

```sh
bash '{{lib}}' move --git --rename bookmarks.html '{{maindir}}/Manual' {{uploads}}
```

or sourced inside a `script:` for anything with logic. Subcommands:
`move`, `copy`, `ingest`, `encrypt`, `git-commit`, `validate-fresh`,
`prune-exports`, `remote-subdirs`, `python-venv`; sourceable helpers:
`bctl_extract`, `bctl_rsync`, `bctl_git_commit`, `bctl_standardize_into`,
`bctl_import_pair`, `bctl_remote_subdirs`, `bctl_python_venv`,
`bctl_first_glob`, `bctl_export_dirs` (see `lib.sh` for the full list).

Service-specific concerns (installing a CLI, validating an export is fresh,
pruning old exports) are plain bash in the task's `commands`.

## Server (`server.mjs`)

Config loading/tokens live in `config-loader.mjs`/`template.mjs`, run state in
`state.mjs`, the subprocess layer in `runner.mjs`, and the HTTP server + run
orchestration in `server.mjs` (config loads once at boot; restart to reload).

**API**: `GET /api/tasks` (groups in config order, availability + reason,
last-run state or *Interrupted*, `running`/`live`/`pill`, `schedule`,
`next_run`, `schedule_missed`, `last_scheduled_run`, `missing_config`);
`POST /api/detect?name=` (most-specific pattern wins; ties are `ambiguous`);
`POST /api/upload/{task}?name=` (body streamed to a `.part` file, renamed on
completion after glob validation); `POST /api/run/{task}` (JSON `extra`; 409
when already running, 400 when unavailable; queues when the task's
`serial_key` is held); `GET /api/status` (new log lines + one-shot `done`);
`GET /api/log/{task}`; `POST /api/cancel` (kills only that run's process
groups, or dequeues it); `POST /api/paste_done/{task}` (git-commits the task's
`commit_dir`). Mutating `/api/*` requests are CSRF-checked.

Run state is recorded exactly once, on success and failure; the command loop
stops at the first failure, which keeps trailing `validate-fresh` checks
honest.

**Process safety**: each command gets its own process group (`detached`), and
Stop kills exactly that run's pids (`SIGTERM` then `SIGKILL`). `stdin:
'ignore'` makes interactive prompts fail fast; `SSH_ASKPASS_REQUIRE=force`
with a failing askpass means ssh can never prompt; prompt values are redacted
from the logged command and output. Output is streamed terminal-faithfully
(`\r` and `\n` end lines; stderr is flushed at close). `pty_runner.py` (stdlib
only) gives tools that refuse non-TTY stdin a pseudo-terminal when
`lib.sh encrypt` needs one.

### State

- `<BACKUPCTL_STATE_DIR>/tasks/<slug>.json` — `{task, ts, ok, summary, output}`; legacy `<state_dir>/.backup-state-<slug>.json` is read once during the upgrade
  written atomically.
- `bctl_git_commit` stages with `git add -A . ':(exclude).backup-state-*'`, so
  state files never churn backup repos.
- `running.json` (in `BACKUPCTL_STATE_DIR`, default `~/.backupctl`) marks an
  in-flight task; after a crash it shows as `Interrupted`.
- `schedules/<task>.json` (same directory) stores the last scheduled occurrence
  and missed count for catch-up across restarts.
- `staging/<task>/` is transient scratch space, cleared when a run ends; run
  commands get a per-run `TMPDIR` (under `BACKUPCTL_TMP_DIR`, default
  `~/Downloads/backupctl-tmp`) so large extractions don't fill `/tmp`.

## Frontend

`ui/` is a React + Vite app (built into `static/`, served by the node
server): group/card grid, global drop zone with server-side detection, staged
queues, generic prompt dialog, XHR upload progress, live logs via `/api/status`
polling, paste dialog for `capture:` tasks, and toasts. Built with
`npm run build:ui --workspace dscpln-task-runner` (or `npm run ui` at the
root); `npm test` builds first.

## Failure & honesty guarantees

- Commands can't orphan: Stop kills that run's process groups; a crash leaves
  `running.json` → red "Interrupted".
- Exit 0 without real work fails: commands are rc-checked and upload tasks
  refuse zero files.
- No silent data loss: heredoc flows delete originals only after every step
  succeeded (`set -e`).
- Secrets stay out of logs: prompt values are redacted; passphrases travel in
  env, never argv.

## Dependencies

- Node.js 22+ (npm dependency: `express` only)
- System tools tasks commonly use: `bash`, `rsync`, `ssh`, `unzip`/`tar`,
  `git`, `age`, `jq`, `wget`, `restic`, `kubectl`, ImageMagick — whatever your
  tasks need. The image ships restic and kubectl for scheduled backup tasks.
- `python3` (stdlib only) for `lib.sh encrypt` via `pty_runner.py`

## Structure

- `server.mjs` — HTTP server + run orchestration
- `config-loader.mjs` / `template.mjs` — config loading, `script:`/`move:`/
  `ingest:` normalization, token resolution
- `state.mjs` — run state, running markers, staging/tmp dirs
- `runner.mjs` / `util.mjs` — subprocess layer (groups, streaming, redaction)
- `lib.sh` / `pty_runner.py` — bash helpers + pty helper
- `ui/` — React frontend; `static/` — its build output (gitignored)
- `config.example.mjs` — documented starting point (`config.mjs` is ignored)
- `test/` — `node:test` sandbox suites (`npm test`)
