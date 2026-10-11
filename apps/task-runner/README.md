# Task Runner (backupctl)

A local web app that runs config-driven backup workflows. It lives in the
D$CPLN monorepo (`apps/task-runner`); personal automation scripts are absorbed
under `tools/` and the Media Sync CLI under `apps/media-sync`. This README is
both the usage guide and the schema/code reference.

## Usage

From the monorepo root:

```sh
npm install
npm run task-runner    # = BACKUPCTL_REPO_DIR=$PWD node apps/task-runner/server.mjs --no-browser
```

Or from this directory (`config.mjs` is committed; edit it to match your
machine):

```sh
BACKUPCTL_REPO_DIR="$(git rev-parse --show-toplevel)" npm start
```

This starts a local server (http://127.0.0.1:8080) and opens your browser. To run without opening a browser: `node server.mjs --no-browser`. Different port: `node server.mjs --port 8081`. Unknown flags are an error (`--help` shows the options).

### The same app on the server (bridge instance)

backupctl also runs as a container on the always-on server (`srv0`) against the
synced `~/Main` tree, so every upload/ingest task is usable from any browser
(behind the SSO proxy) while PC-bound tasks keep running on the PC. The same
`config.mjs` is used by both; the `host:` field pins tasks to a machine:

- `host: 'any'` (default) — runs on any instance.
- `host: 'pc'` — e.g. local files (`PC Files`), device mounts (Quest), personal
  browser profiles (Selenium scrapers); shown as `Pinned to pc` on the server.
- `host: 'srv0'` — e.g. the manual-export tasks that git-commit to
  `Backups/Manual`, so all such commits happen from one machine.

The instance identity comes from `BACKUPCTL_HOST` (default `pc`). The container
(see `Dockerfile`/`build.sh`) mounts `~/Main` at the same path and uses a
mounted config:

```sh
BACKUPCTL_HOST=srv0 \
BACKUPCTL_CONFIG_FILE=/config-src/config.mjs \
BACKUPCTL_STATE_DIR=$HOME/.backupctl \
BACKUPCTL_TMP_DIR=$HOME/tmp \
node server.mjs --host 0.0.0.0 --port 8085 --no-browser
```

Deployment for the home k3s stack lives in the Infra repo
(`targets/srv0/k3s-apps/templates/backupctl.yaml`).

## What you see

A **drop zone at the top** detects what kind of export you're uploading from the filename and asks for confirmation before running the matching task (e.g. `medium-export-*.zip` → Medium). If the file matches no task, or is ambiguous, you're told / asked. Cancelling just leaves the files on their cards. Task cards are grouped into categories (Apps & Accounts, Social Media, Chats, Finance, Devices, System Backups, Tools); each card has:

- a **drop zone** to stage files for that task specifically (also detected against its patterns); dropped files are held in the browser and listed on the card until you press Run
- a **Run** button (disabled if the task is unavailable, e.g. its source directory is missing) — becomes a **Stop** button while running (kills the task's processes)
- a **Log** button showing the last run's output; the last log line also streams under the card title while a task runs
- a **Generate Export** button opening the service's export page in a new tab, for tasks whose config sets `export_url:` (e.g. Google Takeout, Instagram, Bitwarden)
- a status line with the last run time and result — stored per task as `.backup-state-<task>.json` in the task's `state_dir:` directory (excluded from git commits)

Tasks have **no automatic timeouts** — a run goes until it finishes or you stop it with the card's Stop button. Any number of tasks can run in parallel; tasks sharing a `serial_key:` (all the ones that git-commit to `Backups/Manual`) are queued and run one at a time. Interactive steps are handled in the GUI: passphrase prompts for encrypted exports, password + TOTP for ProtonMail, confirmation dialogs for everything else. Runs interrupted by a server crash show as "Interrupted" instead of a false success. While a task runs, its pill shows an elapsed timer and its Log dialog updates live.

## Configuration

- `config.mjs` — your personal file (committed): machine-specific values at the top of the default export (`maindir`, `hosts`, emails, script paths...) plus the `groups:` array. Each group is `{ name, defaults?, tasks: [...] }`; **groups are displayed in array order** and tasks within a group in array order. `defaults` are merged under every task in the group (task fields override), so repeated fields like `uploads`, `summary_last_line`, or a shared `state_dir` are written once. Add a task by adding an entry; the menu, categories, and drop-zone validation update automatically.

Placeholders like `{{maindir}}` or `{{hosts.bigpc.host}}` inside command strings are resolved from the same file's exported values at run time; values may reference other tokens (resolution loops until stable). Built-in tokens: `{{repo_dir}}` (this repository's root, env-overridable via `BACKUPCTL_REPO_DIR`) and `{{lib}}` (the packaged `lib.sh`). `~` and env vars are expanded on resolved *paths*. Every task needs `state_dir:` — run state is stored there as `.backup-state-<task>.json`.

**Personal scripts live under `tools/` in this monorepo** (absorbed with git history). Tasks that need one (e.g. a statement parser) reference it via the `{{scriptroot}}` token (`{{repo_dir}}/tools`) — see `config.mjs` for real examples.

### Task fields

Common: `name`, `note` (help text, shown inside the drop zone for upload tasks), `state_dir` (where the run state `.backup-state-<task>.json` lives; boot fails loudly if missing), `serial_key` (optional; tasks sharing a key run one at a time), `host` (optional machine pin: `pc`, `srv0`, or `any` — the default), `prompts`, `export_url` (optional; shows a "Generate Export" button on the card that opens the service's export page). The task's category is its group's `name`.

Runner: every task is defined by exactly one of `commands` (bash string or list), `script:`, `move:`, or `ingest:` — the shorthands are normalized into a command at config load. `cwd`, `uploads: true` + `glob` (drop zone; glob may be a list of patterns), `require: [key...]` (fail unless each prompt key has a value), `capture: true` + `commit_dir` (output becomes the summary, shown in a copy/paste dialog whose Done button git-commits `commit_dir`), `root:` (source directory the card requires; glob-aware, drives the availability badge), `summary_last_line: true` (card summary = last non-command log line).

- `script: 'bash body'` — the body is wrapped in a temp-file heredoc, so inner processes that read stdin (e.g. ffmpeg) cannot consume the rest of the script.
- `move: { rename?, dest? }` — files the drop into `dest` (defaults to `state_dir`) via `lib.sh move --git [--rename NAME]`; use it for one-shot exports that keep a fixed name.
- `ingest: { suffix, dest? }` — extracts every archive into a temp dir, derives an account name with `suffix` (a shell snippet run inside the temp dir), syncs into `dest/<name>` (defaults to `state_dir`), and git-commits; powers the Social Media export-import tasks.

Per-run tokens: `{{uploads}}` (shell-quoted staged file paths) plus one `{{key}}` per prompt value. Every command runs with a fresh per-run `$TMPDIR`, wiped when the run ends. Interactive input is config: `prompts: [{key, label, type: confirm|secret}]` — the GUI renders them generically, the values travel in the run `extra` payload, and secret values are redacted from the command display and output.

## How tasks work

There are no hard-coded task types — **every task is a `commands` list of bash commands** (the `script:`/`move:`/`ingest:` shorthands just generate the command for you) executed in order by the runner with process-group cancellation, secret redaction, and per-task state recording. The repo ships a generic bash library, `lib.sh`, which tasks call either as a subcommand for simple cases:

```sh
bash '{{lib}}' move --git --rename bookmarks.html '{{maindir}}/Manual' {{uploads}}
```

or by sourcing it inside a `script:` for anything with logic (Quest media import, WhatsApp archiving, ...). The library's functions (`bctl_extract`, `bctl_rsync`, `bctl_git_commit`, `bctl_standardize_into`, `bctl_import_pair`, ...) and subcommands (`move`, `copy`, `encrypt`, `ingest`, `git-commit`, `validate-fresh`, `prune-exports`) are rc-checked under `set -e`.

| Subcommand | Behavior |
|---|---|
| `move [--rename NAME] [--git] DEST FILE...` | move files into dest (fixed name optional; multiple files with a rename set fail), git commit when `--git` |
| `copy [--git] [--pre CMD] [--post CMD] DEST SRC...` | rsync each source into `dest/<basename>` (missing sources skipped, failures fail the run), per-source git commit when `--git` |
| `ingest DEST SUFFIX_CMD FILE...` | extract every archive into a temp dir, derive an account suffix (SUFFIX_CMD runs inside the temp dir), sync everything into `DEST/<suffix>` (or `DEST` when no suffix), git commit — powers the Social Media export-import tasks |
| `encrypt DEST OUTNAME FILE` | age-encrypt exactly one file via `pty_runner.py`; passphrase comes from `AGE_PASSPHRASE` (env, never argv); git commit |
| `git-commit DIR [MSG]` | init/add/commit with `:(exclude).backup-state-*`; empty commits tolerated — also used by the server's paste-done flow |
| `validate-fresh DIR [MAX_AGE_SECONDS]` | fail unless the newest export dir (by name) is non-empty and modified within the max age |
| `prune-exports DIR [--keep-newer]` | delete all but the newest export dir; `--keep-newer` keeps any dir with more files than the newest |

Sourceable functions: `bctl_extract` (unzip/tar), `bctl_rsync`/`bctl_rsync_delete` (rsync -aq with optional --delete), `bctl_git_commit DIR [MSG]` (state files excluded; empty commits tolerated), `bctl_standardize_into SRC DEST MEDIA_SYNC_CLI` (copy to a temp dir, standardize via the Media Sync CLI, move results to dest, keep originals), `bctl_import_pair SRC DEST MEDIA_SYNC_CLI` (clean already-synced + standardize + move + delete originals — the Quest media import flow), `bctl_first_glob PATTERN` (first match, e.g. MTP mounts), `bctl_export_dirs ROOT` (export dirs sorted by name).

Service-specific concerns — installing a CLI, validating an export is fresh, pruning old exports — are plain bash in the task's `commands` (see the ProtonMail task for the full pattern: install-if-missing → export → `validate-fresh` → `prune-exports`).

## Server (`server.mjs`)

The whole engine in one module: config loading/tokens, run state, staging, the safe subprocess layer, the generic bash runner, the Express server, and the CLI entry. Config is loaded once at boot (edit → restart); no hot reload.

**API surface**: `GET /api/tasks` (groups in config order — availability + reason, last-run state or *Interrupted*, per-task `running`/`live`/`pill`, plus `missing_config`); `POST /api/detect?name=` (most-specific pattern wins, ties listed as `ambiguous` — the frontend does no matching itself); `POST /api/upload/{task}?name=` (the request body is **streamed straight to disk** — into a `.part` file that is renamed on completion, after glob validation, 400 on mismatch; runs never pick up half-written files, and uploads of any size work without chunking); `POST /api/run/{task}` (JSON `extra`; 409 when the same task is already running, 400 when unavailable; if another run holds the task's `serial_key` it is queued and started when the key frees up; snapshots staging, writes `running.json`, starts the async worker); `GET /api/status` (`runs` with new log lines per active task + a one-shot `done` list); `GET /api/log/{task}` (the last run's full output, fetched lazily by the Log dialog); `POST /api/cancel` (JSON `{task}` — kills only that run's process groups, or removes it from a serial queue); `POST /api/paste_done/{task}` (git-commits the task's `commit_dir` via `lib.sh git-commit`). POSTs to `/api/*` are guarded by a CSRF check. Any number of workers run in parallel — the event loop is the worker pool, one `RUNS` record per active task; `done` entries land in a buffer served by `/api/status`.

`run_task(task, local, files, log, extra)` wraps the single execution path: builds a ctx, resolves tokens, checks `uploads`/`require`, runs each `commands` entry (token-resolved, redacted), clears the task's staging dir (upload tasks) and its per-run TMPDIR in `finally`, and records run state — so **state is recorded exactly once, on both success and failure**. The loop stops at the first failing command, which is what makes trailing `validate-fresh`/`prune-exports` steps honest. With `capture:` the captured output is the summary; with `summary_last_line:` the summary is the last non-command log line; otherwise "Completed".

**Process safety** (every subprocess goes through `run()` / `sh()` / `shCapture()`):

- Each command gets its own process group (`detached: true`); a task's pids are registered in that run's own group set, and the task's Stop button kills exactly that set (`SIGTERM`, then `SIGKILL` via `process.kill(-pid)`) — other parallel runs are untouched. There are no automatic timeouts: hanging runs are killed manually.
- `stdin: 'ignore'` makes interactive prompts fail fast, `SSH_ASKPASS_REQUIRE=force` + a failing askpass script means ssh can never prompt for a password, and `redact=[...]` masks every prompt value in the logged command line and the streamed output. Output is streamed terminal-faithfully: `\r` (progress) and `\n` both end log lines, trailing partial lines are flushed, blank lines are kept, and stderr is buffered and flushed at process close (nothing is lost to the pipe race).
- **PTY via `pty_runner.py`** — for tools that refuse non-TTY stdin (e.g. `age --passphrase`): `lib.sh`'s `encrypt` subcommand pipes the passphrase into `python3 pty_runner.py age ...` directly. The stdlib-only helper (`pty.fork` + `os.execvp`) allocates the pseudo-terminal, forwards piped stdin line by line, strips terminal control sequences, and exits with the child's status. Secrets travel in stdin from env vars, never on a command line. Requires `python3` — already a dependency of the personal scripts.

### State

- **Run state lives with the data**: `<state_dir>/.backup-state-<slug>.json` — `{task, ts, ok, summary, output}` (the complete log output). Written atomically (tmp + rename).
- **Git hygiene**: `bctl_git_commit` (and its `git-commit` subcommand, used by paste-done) stage with `git add -A . ':(exclude).backup-state-*'`, so state files never enter backup repos (and "nothing added to commit" is tolerated).
- **`running.json`** (app state dir, `~/.backupctl` or `BACKUPCTL_STATE_DIR`) marks an in-flight task; after a server crash such a task shows as red `Interrupted · <ago>`.
- **`staging/<task>/`** is transient scratch space: the frontend streams the task's files into it right before a run, and it is cleared when the run ends (success or failure). Run commands get a per-run `TMPDIR` under `~/Downloads/backupctl-tmp` (env-overridable via `BACKUPCTL_TMP_DIR`), so big extractions land on the real filesystem instead of a small/quota'd `/tmp` tmpfs; the temp dir is wiped when the run ends.

## Frontend (`index.html`)

One self-contained file: plain HTML + one inline CSS design system (dark by default, light via `prefers-color-scheme`) + ~400 lines of vanilla JS. No build step, no framework. Structure: topbar → global drop zone → `#page` container (groups + cards rendered by JS) → footer → `#modal-root` and `#toasts`.

The UI is a thin loop: `loadTasks()` fetches `/api/tasks` and rebuilds the card grid (pill with an elapsed timer while running, live-log line, availability badge, drop zone with the queued filenames, Run/Log buttons, Generate Export link); dropped files live only in browser memory (`STATE.queues`, per task) and are listed on the card with a per-file remove button — nothing touches the server until Run; `handleGlobalFiles()` detects files server-side (ties → picker modal), groups them into the browser queues, batch-confirms, and starts every detected task in parallel (server-side `serial_key` queues handle same-destination tasks); `runTask()` renders the task's `prompts:` generically (no task-type branches), uploads the task's queued files via `/api/upload` in a single request each (each card shows its own upload progress bar + percentage), then POSTs `/api/run` and clears the queue; a persistent 700 ms `poll()` consumes `/api/status` (new log lines per active run accumulate in `STATE.liveLogs`, one-shot `done` entries drive result toasts and the paste dialog) and re-renders from `/api/tasks`. The Log dialog of a running task updates live (append + auto-scroll) from the same buffer; for finished tasks it lazily fetches `/api/log/<task>`. The frontend holds no imperative DOM refs.

## Failure & honesty guarantees

- **Commands can't hang or orphan**: the per-task Stop button kills that run's process groups → "Cancelled by user" (no automatic timeouts — you decide when a run has gone on too long); a server crash leaves `running.json`, so the pill shows red "Interrupted · ago".
- **Exit 0 without real work fails the run**: rc-checked commands plus a trailing `validate-fresh` (empty/stale export fails); run-with-uploads refuses zero files.
- **No silent data loss**: media heredocs delete originals only after every step succeeded (`set -e`).
- **Secrets stay out of logs**: `redact=` masks prompt values in command display and output; the age passphrase travels in env, never argv. State files never churn backup repos (`:(exclude).backup-state-*` in every commit).

## Dependencies

- Node.js 22+ (npm dependency: `express` only)
- System tools used by tasks: `bash`, `rsync`, `ssh`, `unzip`/`tar`, `git`, `age`, `jq`, `wget`, ImageMagick, plus whatever each external script needs (some personal scripts are Python and need `python3`)
- **`python3`** (stdlib only) — `lib.sh`'s `encrypt` subcommand drives tools that refuse non-TTY stdin (like `age`) through the committed helper `pty_runner.py`, which uses Python's stdlib `pty` module; python3 is already required by several personal scripts
- Personal automation scripts live under **`tools/`** in the monorepo (referenced from the personal config via the `{{scriptroot}}` token)

## Testing

`npm test` runs `node:test` suites in `tests/server.test.mjs`. Every suite builds a temporary sandbox under the OS temp dir with its own generated `config.mjs` (never touching real destinations); `BACKUPCTL_STATE_DIR` points staging and run markers at the sandbox. Coverage: token resolution (typed, nested, looped, tildes), config validation, the `script:`/`move:`/`ingest:` shorthand normalization, state-file round-trip, subprocess streaming + redaction, git-commit hygiene (lib.sh subcommand), the move/mappings/ingest/copy/encrypt task flows (real bash through the runner), uploads/require/capture/summary options, `validate-fresh`/`prune-exports` (fresh, stale, keep-newer), glob matching, and the API surface (upload streaming + validation, detect scoring + ambiguity, CSRF guard, run/cancel, paste_done, `/api/log`). The encrypt round-trip suite runs only when `python3` and `age` are installed.

## Structure

- `server.mjs` — the whole engine in one module: config loading/tokens, run state, staging, the safe subprocess layer, the generic bash runner, the Express server, and the CLI entry
- `index.html` / `app.js` / `style.css` — the frontend on the shared ui-kit (Shoelace components, kit design tokens, DSCPLN core helpers; no build step)
- `pty_runner.py` — stdlib-only Python pty helper for tools like `age` that refuse non-TTY stdin (invoked directly by `lib.sh`)
- `lib.sh` — generic, committed bash helpers that tasks call (subcommands + sourceable functions)
- `tools/` (monorepo) — the personal automation scripts referenced by the config
- `config.mjs` — the committed personal config (values + groups of tasks)
- `tests/` — `node:test` sandbox suites (`npm test`)
- the monorepo `docs/` — the replacement plan (`REPLACEMENT-PLAN.md`) and architecture (`ARCHITECTURE.md`)
