# Task Runner

**Run scheduled and on-demand tasks from a web UI.**

Task Runner turns Bash commands from a config file into cards. Each card can
have a drop zone, prompts, live logs, a schedule and its own run history. Use it
for backups, exports, sync jobs and other repeatable commands that are easier to
run from a page than from a terminal.

## At a glance

| | |
|---|---|
| Runs at | `/tasks` (or port `8085` locally) |
| Config | `BACKUPCTL_CONFIG_FILE`, a `config.mjs` file |
| State | `BACKUPCTL_STATE_DIR`, default `~/.backupctl` |
| Schedules | Per task, with optional catch-up after downtime |
| Tasks | Bash commands, uploads, prompts, webhooks and helper scripts |

## Quick start

From the D$CPLN repository root:

```sh
npm install
cp apps/task-runner/config.example.mjs apps/task-runner/config.mjs
npm run task-runner
```

This starts the server at <http://127.0.0.1:8080> and opens the browser.
`--no-browser` skips the browser, and `--port 8081` changes the port; `--help`
shows the options.

To run it in a container, mount the config and a writable state directory:

```sh
BACKUPCTL_CONFIG_FILE=/config/config.mjs \
BACKUPCTL_STATE_DIR=/data/state \
node server.mjs --host 0.0.0.0 --port 8085 --no-browser
```

Keep the config out of the public source tree. For a multi-app deployment, use
the private [config template](../../config-template/README.md).

## Core ideas

- **Task:** one card with a name, commands and optional inputs.
- **Group:** a section that organizes cards and supplies defaults.
- **Run:** one execution of a task. Runs are recorded once, on success or
  failure.
- **Schedule:** an optional unattended run specification on a task.
- **Instance:** a Task Runner server. `host:` pins a task to one instance.

Any number of tasks can run in parallel. Tasks sharing a `serial_key` run one at
a time. There are no automatic timeouts: a run continues until it finishes or
you press Stop.

## Using the UI

A **drop zone at the top** detects which task a dropped file belongs to from its
filename (per-task `glob:` patterns) and asks before running it. Ambiguous
matches open a picker. Above the cards, choose the **Group by** attribute
(default **Best run from**) and optionally filter to one value.

Cards show chips for every non-grouping attribute, plus:

- a **drop zone** to stage files for that task; staged files live in browser
  memory until you press Run;
- a **Run** button that becomes **Stop** while running;
- a **Settings** button for the schedule and attribute values;
- optional **card actions** such as Test auth or Discover, with their own
  prompts and last-result status;
- a **Log** button with the last run's output; the live line streams under the
  title;
- a **Generate Export** link when the task sets `export_url:`;
- a status line with the last run time and result.

A run interrupted by a server crash shows as **Interrupted**, not as a false
success.

## Scheduled tasks

Add a schedule to a task:

```js
schedule: { enabled: true, days: [], at: '02:00', catchUp: true }
```

- `days` uses JavaScript weekdays (`0` = Sunday); an empty list means daily.
- `at` is local `HH:MM`.
- `catchUp` runs an occurrence missed while the instance was down.

Schedules persist their last handled occurrence and missed count under
`BACKUPCTL_STATE_DIR/schedules/`. The card shows the next run, and the Portal
reads it through `/api/tasks`.

Every task that can run unattended has a **Settings** dialog for its schedule
and attributes. Changes are written to `task-meta.json` next to `config.mjs` and
take effect immediately. A metadata entry overrides a fallback schedule in
`config.mjs`.

Scheduled runs are unattended, so the loader rejects `uploads`, `prompts`,
`require`, `browser` and `commit_dir` on scheduled tasks. A task that is
already running, unavailable, or blocked by its `serial_key` is counted as
missed rather than queued. Set `BACKUPCTL_SCHEDULES=0` on a second instance so
only one machine fires shared schedules.

Notifications go through the Portal (`DSCPLN_PORTAL_URL`) with
`notify: never|errors|always`. The default for scheduled tasks is `errors`;
`notify_name` overrides the notification title.

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

Copy `config.example.mjs` to `config.mjs` and edit it. It exports machine values
plus a `groups:` array; a group's `defaults` merge under its tasks. The UI
renders grouping and order from `task-meta.json`, not from the config array.
`secrets` is a top-level list of config tokens that should never appear in a
logged command or output.

`{{token}}` placeholders are resolved from the file's values at run time;
values may reference other tokens and resolution repeats until stable. Built-in
tokens: `{{repo_dir}}` (repo root, override with `BACKUPCTL_REPO_DIR`) and
`{{lib}}` (the packaged `lib.sh`). `~` and environment variables expand on
resolved paths.

Every task needs `state_dir:`; it is the default `move`/`ingest` destination.
Run state itself is centralized under `BACKUPCTL_STATE_DIR/tasks/`.

If you keep helper scripts, put them on the machine or mount them into the
container and reference them from the config, for example
`scriptroot: '/path/to/scripts'` plus `bash '{{scriptroot}}/parse.py'`.

### Task metadata (`task-meta.json`)

Schedule and attribute edits are stored next to `config.mjs`:

```json
{
  "version": 1,
  "attributes": [
    { "name": "Category", "values": ["Finance", "Media and Files"] },
    { "name": "Best run from", "values": ["Phone", "PC"] }
  ],
  "default_group_by": "Best run from",
  "tasks": {
    "Bank Statements": {
      "attributes": { "Category": "Finance", "Best run from": "PC" },
      "schedule": { "enabled": true, "days": [0], "at": "04:00", "catchUp": true }
    }
  }
}
```

The **Attributes** dialog manages definitions and the default grouping. The
per-task **Settings** dialog edits values and the schedule. `Category` is
required; other attributes are arbitrary. Removing an attribute or value
removes it from tasks. The file is read at startup and rewritten atomically by
the server. Keep its directory writable by Task Runner.

### Task fields

Common fields: `name`, `note` (help text in the drop zone), `state_dir`
(required), `serial_key` (tasks sharing a key run one at a time), `host`
(`any` or an instance name), `prompts`, `export_url`, `schedule`, `env`,
`secrets`, `run_as` (optional `{uid, gid}`), `notify`
(`never|errors|always`) and `notify_name`.

`actions:` adds named card buttons that share the task's host and environment
but have their own `commands`, `prompts`, `require` and result state. Actions
bypass `check:` and never overwrite the task's last-run state:

```js
actions: [{
  key: 'test-auth',
  label: 'Test auth',
  commands: ['run-auth-test'],
  summary_last_line: true,
}]
```

Runner fields: `commands` (a Bash string or list), `webhook:` with optional
`commands` after it, or exactly one of `script:`, `move:` or `ingest:`.

Optional fields:

- `cwd`: working directory.
- `uploads: true` + `glob`: add a drop zone; `glob` is a string or list.
- `require: [key...]`: fail unless each prompt key has a value.
- `capture: true` + `commit_dir`: show output in a copy/paste dialog; Done
  git-commits `commit_dir`.
- `root:`: source directory the card requires; glob-aware.
- `check:`: Bash gate; the task is unavailable while it exits non-zero. The
  first output line becomes the card badge; results are cached briefly.
- `browser: true`: embed the login-browser sidecar and open it when the task
  starts.
- `summary_last_line: true`: use the last non-command log line as the summary.
- `run_as: {uid: '{{app_uid}}', gid: '{{app_gid}}'}`: drop the task shell to
  the host data owner. Leave it unset for tasks that need root.

Shorthands:

- `script: 'bash body'`: wrapped in a temp-file heredoc so inner processes
  cannot consume the rest of the script from stdin.
- `move: {rename?, dest?}`: file a drop into `dest` (default `state_dir`) via
  `lib.sh move --git`.
- `ingest: {suffix, dest?}`: extract archives, derive an account name with
  `suffix`, sync into `dest/<name>` and git-commit.

### Webhook tasks

`webhook:` runs one HTTP request. It is generic and can be combined with
`commands`, which run after a successful request or download. It cannot be
combined with `script`, `move` or `ingest`.

```js
{
  name: 'Remote archive',
  state_dir: '{{maindir}}/.tasks',
  webhook: {
    url: 'https://agent.example/v1/jobs/example-archive/archive',
    method: 'POST',
    enrollUrl: 'https://agent.example/v1/enroll',
    tokenFile: '{{maindir}}/.tasks/example-agent.token',
    downloadTo: '{{maindir}}/example-archive.tar.gz',
    timeoutMs: 1800000,
    expectStatus: [200],
    summaryHeader: 'X-DSCPLN-Summary',
  },
  commands: [`echo "Downloaded to {{maindir}}/example-archive.tar.gz"`],
  summary_last_line: true,
}
```

Fields:

| Field | Description |
|---|---|
| `url` | Required HTTP(S) endpoint |
| `method` | HTTP method; defaults to `POST` |
| `headers` | Header object; supports config tokens |
| `body` | Raw string or JSON object |
| `timeoutMs` | Request timeout; defaults to 300000 |
| `expectStatus` | Expected status or list; defaults to 2xx |
| `downloadTo` | Save the response body to a file; binary-safe |
| `maxBytes` | Maximum downloaded bytes; default 2 GiB |
| `summaryHeader` | Use a response header as the run summary |
| `summaryJson` | Use a dot path in a JSON response as the summary |
| `tokenFile` | Auto-generate a bearer token on first use, store it `0600`, and send it unless a header already sets `Authorization` |
| `enrollUrl` | Optional enrollment endpoint called before the request; requires `tokenFile` |
| `caFile`, `certFile`, `keyFile` | Optional TLS CA/client certificate paths |

With `tokenFile` + `enrollUrl`, no token is created by hand. The first run
generates a random token, enrolls it, and the agent stores only its SHA-256
hash. Keep `tokenFile` on persistent storage, not in the per-run `$TMPDIR`.

Per-run tokens: `{{uploads}}` (shell-quoted staged paths) plus one `{{key}}`
per prompt value. Prompt values are substituted as shell-quoted literals; do
not add quotes around them in `commands`. They cannot inject shell syntax or
expand `{{...}}`/`$VAR`. Config tokens are trusted and resolve recursively.
Every command gets a fresh per-run `$TMPDIR`, wiped when the run ends.

`prompts: [{key, label, type: confirm|secret}]` are rendered generically;
secret values are redacted from the command display and output.

### Login browser sidecar

When `BROWSER_REMOTE` points at a noVNC endpoint (for example
`http://localhost:7900`), the server proxies it at `<basePath>/browser/` on the
same origin and reports `browser: true` in `/api/tasks` and `/api/health`.
Task cards with `browser: true` get an embedded iframe and an auto-open when
the run starts, so a scraper can wait for a manual sign-in or 2FA while you
watch. The WebSocket (`websockify`) is bridged by the same proxy.

Scraper tools connect WebDriver to `SELENIUM_REMOTE_URL` when set and fall back
to a local Chrome otherwise. `SELENIUM_PROFILE_DIR` overrides the Chrome profile
directory. Runs that drive the browser should share a `serial_key`.

### Balance import

`examples/balance-import.mjs` bridges a scraper that prints tab-separated
transaction rows to Balance XLSX. It extracts the trailing rows, asks the
Balance external API which ones already exist, and imports only the missing
ones. A scrape where nothing matched the workbook warns that the scrape may not
reach back far enough.

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
    `node '{{repo_dir}}/apps/task-runner/examples/balance-import.mjs' --input "$TMPDIR/transactions.txt" ` +
      `--balance-url '{{balance_url}}' --balance-token "$BALANCE_TOKEN" --notify-url '{{portal_url}}'`,
  ],
  summary_last_line: true,
}
```

- `--input`: scraper output file, or `-` for stdin.
- `--balance-url` / `--balance-token`: Balance external API base path and
  bearer token. Pass the token through `env` and list it in `secrets`.
- `--notify-url`: optional Portal relay for the zero-duplicate warning.
- `--after <regex>`: only consider lines after the last matching line.
- `--dry-run`: check and report without writing.

The scraper's optional `Scraped N transactions` report is pre-filter: fewer
extracted lines than N is normal; more than N fails the run. A fully
overlapping scrape reports "Nothing new"; a partial overlap reports imported
and skipped counts.

## Writing your own tasks

1. **Write the tool.** Anything executable works: Bash, Python or Node. The
   image provides `bash`, `python3`, `node`, `rsync`, `git`, `age`, `jq`,
   `unzip`/`tar`, `wget`, `restic` and `kubectl`. The app tree is writable, so
   a task can install more at run time.
2. **Make it visible.** Locally, reference an absolute path. In a container,
   mount a tool folder read-only and point `scriptroot` at it, or bake the tool
   into a custom image. The bundled example lives at
   `apps/task-runner/examples/hello-tool.sh`; the Balance import tool is a
   fuller Node example.
3. **Set `scriptroot`** and call the tool from a task:

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
   fields. `commands` is the general form; `script`, `move` and `ingest` are
   shorthands that generate the command.

Tokens resolve inside commands and paths: your config values (`{{maindir}}`,
`{{balance_url}}`, ...), the built-ins `{{repo_dir}}` and `{{lib}}`,
`{{scriptroot}}` once set, and the per-run `{{uploads}}` plus one `{{key}}` per
prompt value.

### Bash helpers

The repo ships `lib.sh`, callable as a subcommand:

```sh
bash '{{lib}}' move --git --rename bookmarks.html '{{maindir}}/Manual' {{uploads}}
```

Subcommands: `move`, `copy`, `ingest`, `encrypt`, `git-commit`,
`validate-fresh`, `prune-exports`, `python-venv`. Sourceable helpers:
`bctl_extract`, `bctl_rsync`, `bctl_git_commit`, `bctl_standardize_into`,
`bctl_import_pair`, `bctl_python_venv`, `bctl_first_glob`, `bctl_export_dirs`.
See `lib.sh` for the full list.

## How tasks run

Every task is a list of Bash commands executed in order by the runner, with
process-group cancellation, secret redaction and per-task state recording.
Service-specific concerns such as installing a CLI, validating an export or
pruning old exports stay in the task's commands.

Stop kills exactly that run's process groups (`SIGTERM`, then `SIGKILL`).
`stdin: 'ignore'` makes interactive prompts fail fast. Prompt values are redacted
from the logged command and output. Output is streamed terminal-faithfully:
`\r` and `\n` end lines, stderr is flushed at close. `pty_runner.py` provides a
pseudo-terminal for tools that refuse non-TTY stdin, such as `lib.sh encrypt`.

## State

- `<BACKUPCTL_STATE_DIR>/tasks/<slug>.json`: `{task, ts, ok, summary, output}`.
  Legacy `<state_dir>/.backup-state-<slug>.json` is read once during upgrade.
- `running.json` in `BACKUPCTL_STATE_DIR` marks in-flight tasks. After a crash
  it shows as **Interrupted**.
- `schedules/<task>.json` stores the last scheduled occurrence and missed count.
- `<task>.<action>.json` stores an action's last result separately.
- `staging/<task>/` is transient scratch space, cleared when a run ends.
  Commands get a per-run `TMPDIR` under `BACKUPCTL_TMP_DIR` (default
  `~/Downloads/backupctl-tmp`).

## API

`GET /api/tasks` returns tasks, groups, attributes, availability and run state.
Other endpoints:

| Method | Path |
|---|---|
| `PUT` | `/api/tasks/{task}/settings` |
| `PUT` | `/api/attributes` |
| `POST` | `/api/detect?name=` |
| `POST` | `/api/upload/{task}?name=` |
| `POST` | `/api/run/{task}` |
| `POST` | `/api/actions/{task}/{action}` |
| `GET` | `/api/status` |
| `GET` | `/api/log/{task}` |
| `POST` | `/api/cancel` |
| `POST` | `/api/paste_done/{task}` |

Mutating `/api/*` requests are CSRF-checked. `POST /api/run` returns `409` when
the task is already running and `400` when it is unavailable; it queues when
the task's `serial_key` is held.

Run state is recorded exactly once, on success and failure. The command loop
stops at the first failure, which keeps trailing `validate-fresh` checks
honest. Configuration loads once at boot; restart the server to reload it.

## Failure and safety guarantees

- Commands cannot orphan: Stop kills that run's process groups; a crash leaves
  `running.json`, shown as **Interrupted**.
- Exit 0 without real work fails: commands are return-code checked, and upload
  tasks refuse zero files.
- No silent data loss: heredoc flows delete originals only after every step
  succeeds (`set -e`).
- Secrets stay out of logs: prompt values are redacted; passphrases travel in
  environment variables, never argv.

## Development

Requires Node.js 26+ for the monorepo commands (the app itself supports Node
22+; the image uses Node 26).

```sh
npm test --workspace dscpln-task-runner
npm run build:ui --workspace dscpln-task-runner
```

`ui/` is a React + Vite app built into `static/` and served by the Node server.
Tests use `node:test`; some browser tests skip when Chromium is unavailable.

## Structure

- `server.mjs`: HTTP server and run orchestration.
- `config-loader.mjs` / `template.mjs`: config loading, shorthand normalization
  and token resolution.
- `webhook.mjs`: generic HTTP task execution, token files, enrollment,
  downloads and TLS options.
- `state.mjs`: run state, running markers, staging and temporary directories.
- `runner.mjs` / `util.mjs`: subprocess layer, streaming and redaction.
- `lib.sh` / `pty_runner.py`: Bash helpers and the pty helper.
- `ui/`: React frontend; `static/`: build output (gitignored).
- `config.example.mjs`: documented starting point (`config.mjs` is ignored).
- `test/`: `node:test` sandbox suites.
