# backupctl

A local web app that runs config-driven backup workflows. This repo is **personal**: `config.mjs` (values + grouped tasks) is committed, and personal automation scripts are referenced as git submodules under `scripts/`. This README is both the usage guide and the schema/code reference.

## Usage

```sh
git clone --recurse-submodules git@github.com:ImranR98/ImranR-Backup.git   # or: git submodule update --init --recursive after cloning
npm install
npm start      # = node server.mjs — config.mjs is committed; edit it to match your machine
```

This starts a local server (http://127.0.0.1:8080) and opens your browser. To run without opening a browser: `node server.mjs --no-browser`. Different port: `node server.mjs --port 8081`.

## What you see

A **drop zone at the top** detects what kind of export you're uploading from the filename and asks for confirmation before running the matching task (e.g. `medium-export-*.zip` → Medium). If the file matches no task, or is ambiguous, you're told / asked. Cancelling just queues the file so you can run it from the card later. Task cards are grouped into categories (Apps & Accounts, Social Media, Chats, Finance, Devices, System Backups, Tools); each card has:

- a **drop zone** to queue files for that task specifically (also detected against its patterns)
- a **Run** button (disabled if the task is unavailable, e.g. its source directory is missing) — becomes a **Stop** button while running (kills the task's processes)
- a **Log** button showing the last run's output; the last log line also streams under the card title while a task runs
- a **Generate Export** button opening the service's export page in a new tab, for tasks whose config sets `export_url:` (e.g. Google Takeout, Instagram, Bitwarden)
- a status line with the last run time and result — stored per task as `.backup-state-<task>.json` in the task's `state_dir:` directory (excluded from git commits)

Every task runs with a timeout (default 10 min, overridable per task via `timeout:` in config). Interactive steps are handled in the GUI: passphrase prompts for encrypted exports, password + TOTP for ProtonMail, confirmation dialogs for everything else. Runs interrupted by a server crash show as "Interrupted" instead of a false success.

## Configuration

- `config.mjs` — your personal file (committed): machine-specific values at the top of the default export (`maindir`, `hosts`, emails, script paths...) plus the `groups:` array. Each group is `{ name, defaults?, tasks: [...] }`; **groups are displayed in array order** and tasks within a group in array order. `defaults` are merged under every task in the group (task fields override), so repeated fields like `uploads`, `summary_last_line`, or a shared `state_dir` are written once. Add a task by adding an entry; the menu, categories, and drop-zone validation update automatically.

Placeholders like `{{maindir}}` or `{{hosts.bigpc.host}}` inside command strings are resolved from the same file's exported values at run time; values may reference other tokens (resolution loops until stable). Built-in tokens: `{{repo_dir}}` (this repository's root, env-overridable via `BACKUPCTL_REPO_DIR`) and `{{lib}}` (the packaged `lib.sh`). `~` and env vars are expanded on resolved *paths*. Every task needs `state_dir:` — run state is stored there as `.backup-state-<task>.json`.

**Personal scripts live as git submodules** under `scripts/` in this repo. Tasks that need one (e.g. a Balance-format parser) reference it via the `{{scriptroot}}` token — see `config.mjs` for real examples.

### Task fields

Common: `name`, `note` (help text, shown inside the drop zone for upload tasks), `timeout` (seconds, default 600), `state_dir` (where the run state `.backup-state-<task>.json` lives; boot fails loudly if missing), `prompts`, `export_url` (optional; shows a "Generate Export" button on the card that opens the service's export page). The task's category is its group's `name`.

Runner: `commands` (bash string or list; the only required field), `cwd`, `uploads: true` + `glob` (drop zone; glob may be a list of patterns), `require: [key...]` (fail unless each prompt key has a value), `capture: true` + `commit_dir` (output becomes the summary, shown in a copy/paste dialog whose Done button git-commits `commit_dir`), `root:` (source directory the card requires; glob-aware, drives the availability badge), `summary_last_line: true` (card summary = last non-command log line).

Per-run tokens: `{{uploads}}` (shell-quoted staged file paths), `{{tmp}}` (unique temp path under the task's staging dir), plus one `{{key}}` per prompt value. Interactive input is config: `prompts: [{key, label, type: confirm|secret}]` — the GUI renders them generically, the values travel in the run `extra` payload, and secret values are redacted from the command display and output.

## How tasks work

There are no hard-coded task types — **every task is a `commands` list of bash commands** executed in order by the runner with timeouts, process-group cancellation, secret redaction, and per-task state recording. A single string is accepted for one-command tasks. The repo ships a generic bash library, `lib.sh`, which tasks call either as a subcommand for simple cases:

```sh
bash '{{lib}}' move --git --rename bookmarks.html '{{maindir}}/Manual' {{uploads}}
```

or by sourcing it inside a heredoc for anything with logic (media import with snapshot/standardize/delete-originals, ...). The library's functions (`bctl_extract`, `bctl_rsync`, `bctl_git_commit`, `bctl_process_and_move`, ...) and subcommands (`move`, `copy`, `encrypt`, `ingest`, `validate-fresh`, `prune-exports`) are rc-checked under `set -e`.

| Subcommand | Behavior |
|---|---|
| `move [--rename NAME] [--git] DEST FILE...` | move files into dest (fixed name optional; multiple files with a rename set fail), git commit when `--git` |
| `copy [--git] [--pre CMD] [--post CMD] DEST SRC...` | rsync each source into `dest/<basename>` (missing sources skipped, failures fail the run), per-source git commit when `--git` |
| `ingest DEST SUFFIX_CMD FILE...` | extract every archive into a temp dir, derive an account suffix (SUFFIX_CMD runs inside the temp dir), sync everything into `DEST` (or `DEST - <suffix>`), git commit — powers the Social Media export-import tasks |
| `encrypt DEST OUTNAME FILE` | age-encrypt exactly one file via `pty_runner.py`; passphrase comes from `AGE_PASSPHRASE` (env, never argv); git commit |
| `validate-fresh DIR [MAX_AGE_SECONDS]` | fail unless the newest export dir (by name) is non-empty and modified within the max age |
| `prune-exports DIR [--keep-newer]` | delete all but the newest export dir; `--keep-newer` keeps any dir with more files than the newest |

Sourceable functions: `bctl_extract` (unzip/tar), `bctl_rsync`/`bctl_rsync_delete` (rsync -aq with optional --delete), `bctl_git_commit DIR` (init/add/commit with `:(exclude).backup-state-*`; empty commits tolerated), `bctl_process_and_move SRC DEST SCRIPT [keep]` (copy to a temp dir, run the standardize script once, move results to dest, delete originals unless kept), `bctl_first_glob PATTERN` (first match, e.g. MTP mounts).

Service-specific concerns — installing a CLI, validating an export is fresh, pruning old exports — are plain bash in the task's `commands` (see the ProtonMail task for the full pattern: install-if-missing → export → `validate-fresh` → `prune-exports`).

## Server (`server.mjs`)

The whole engine in one module: config loading/tokens, run state, staging, the safe subprocess layer, the generic bash runner, the Express server, and the CLI entry. Config is loaded once at boot (edit → restart); no hot reload. Module state:

```
CURRENT = {name, log, read, done, cancelled}   # run slot (a plain object)
LOCAL, TASK_LIST                               # from load_config()
```

| Endpoint | Purpose |
|---|---|
| `GET /api/tasks` | `groups` in config order: per group, its task definitions — availability + reason, queued count, last-run state (or *Interrupted* if `running.json` mentions the task), per-task `running`/`live`/`pill` — plus `missing_config` |
| `POST /api/detect?name=` | Returns the upload task a filename belongs to (most-specific pattern wins, ties listed as `ambiguous`) — the frontend does no matching itself |
| `POST /api/upload/{task}?name=` | Raw request body saved to `staging/<task>/<name>` after glob validation (400 on mismatch) |
| `POST /api/run/{task}` | Body: JSON `extra` (`password`, `totp`, `confirmed`). Refuses when the slot is busy (409) or the task is unavailable. Snapshots the staging file list, writes the `running.json` marker, starts an async worker |
| `GET /api/status` | `running` task name, newly appended log lines, one-shot `done` result |
| `POST /api/cancel` | Marks the run cancelled and kills all registered child process groups; the worker then records `Cancelled by user` |
| `POST /api/paste_done/{task}` | Runs `git_commit` on the task's `commit_dir` (the "Done" button in the paste dialog) |

POSTs to `/api/*` are guarded by a CSRF check (cross-origin requests are rejected). The worker is the run slot: `await run_task(...)`; if `cancelled` was set, the result is overwritten with `Cancelled by user`; `done` is published and the slot + running marker are cleared in `finally`. No threads — the event loop is the worker pool, and a single slot object serializes runs.

### Runner

`run_task(task, local, files, log, extra)` wraps the single execution path: builds a ctx, resolves tokens, checks `uploads`/`require`, runs each `commands` entry (token-resolved, per-command timeout, redacted), then clears staging (upload tasks) or the `{{tmp}}` dir, and records run state — so **state is recorded exactly once, on both success and failure**. The loop stops at the first failing command, which is what makes trailing `validate-fresh`/`prune-exports` steps honest. With `capture:` the captured output is the summary; with `summary_last_line:` the summary is the last non-command log line; otherwise "Completed".

### Process safety

Every subprocess goes through `run()` / `sh()` / `shCapture()`:

- **`detached: true`** — each command gets its own session/process group.
- **Timeouts** — a timer kills the whole group (`SIGTERM`, then `SIGKILL` 1s later via `process.kill(-pid)`) and the call returns 124 (task reports "timed out").
- **`stdin: 'ignore'`** — interactive prompts fail fast instead of hanging.
- **`SSH_ASKPASS_REQUIRE=force` + a failing askpass script** (generated at `~/.backupctl/askpass.sh`) — ssh can never prompt for a password on a hidden terminal.
- **`PROC_GROUPS` registry + `cancel_all()`** — the Stop button kills every live child process group.
- **`redact=[...]`** — secrets are masked in both the logged command line and the streamed output (every prompt value is redacted). Output is streamed line-by-line through `readline`; stderr is buffered and flushed at process close (so nothing is lost to the pipe race), then redacted the same way.
- **PTY via `pty_runner.py`** — for tools that refuse non-TTY stdin (e.g. `age --passphrase`): `lib.sh`'s `encrypt` subcommand pipes the passphrase into `python3 pty_runner.py age ...` directly. Node has no stdlib pty API and native addons are off the table, so the pty work lives in a stdlib-only Python helper (`pty.fork` + `os.execvp`) that allocates the pseudo-terminal, forwards piped stdin line by line (paced so prompt loops that switch the terminal to raw mode between reads never lose input), strips terminal control sequences, and exits with the child's status. Secrets travel in stdin from env vars, never on a command line. Requires `python3` — already a dependency of the personal scripts.

### State

- **Run state lives with the data**: `<state_dir>/.backup-state-<slug>.json` — `{task, ts, ok, summary, output}` (output capped at 20k chars). Written atomically (tmp + rename).
- **Git hygiene**: `git_commit()` and `bctl_git_commit` stage with `git add -A . ':(exclude).backup-state-*'`, so state files never enter backup repos (and "nothing added to commit" is tolerated).
- **`running.json`** (app state dir, `~/.backupctl` or `BACKUPCTL_STATE_DIR`) marks an in-flight task; `task_json` reports such a task as red `Interrupted · <ago>` after a server crash.
- **`staging/<task>/`** holds dropped-but-unprocessed uploads; cleared after a successful run.

## Frontend (`index.html`)

One self-contained file: plain HTML + one inline CSS design system (dark by default, light via `prefers-color-scheme`) + ~400 lines of vanilla JS. No build step, no framework. Structure: topbar (logo, title, config-missing warning) → global drop zone → `#page` container (groups + cards rendered by JS) → footer note → `#modal-root` and `#toasts`.

| JS function | Role |
|---|---|
| `el/api/toast` | DOM helper, fetch wrapper (errors as `{error}`), toast stack |
| `openModal/confirmModal/fieldsModal/pickerModal` | Generic modal system; the last three return Promises so flows read like `await confirmModal(...)` |
| `loadTasks/render/card` | Fetch `/api/tasks` (groups in config order), build each card (pill, live-log line, availability badge, note, drop zone + hidden file input, queue chip, Run/Log buttons, and a "Generate Export" link when `export_url` is set) |
| (server) `pill` | Single staleness policy served to the UI: running → ok(<24h) → neutral(≤7d) → fail; the frontend just renders the class |
| `uploadFiles` | Per-card drop handling; validation happens server-side (400 → toast) |
| `handleGlobalFiles` | Global drop flow: detect each file server-side (ties → picker modal), upload to each task's staging, one batch confirm, then run sequentially (`STATE.pendingQueue`) |
| `runTask(task, opts)` | Renders the task's `prompts:` (confirm/secret) generically — no task-type branches — then POSTs `/api/run` and starts polling. Prompt-less non-upload tasks get the generic confirm (skippable via `opts.skipGenericConfirm` for batch runs) |
| `cancelRun` | Stop button: kills processes and clears the pending batch queue |
| `startPolling` | 700 ms polling of `/api/status`; while running it simply re-renders from `/api/tasks` (the server reports per-task `running`/`live`/`pill`), and on completion toasts the result, opens the paste dialog, and auto-starts the next pending batch task. The frontend holds no imperative DOM refs |
| `openLog/openPaste` | Monospace log modal; paste modal with Copy + Done (Done POSTs `/api/paste_done`) |

## Failure & honesty guarantees

| Failure mode | Guarantee |
|---|---|
| Command hangs (prompt, network, deadlock) | Per-task timeout (default 10 min) kills the process group → red "timed out" |
| User wants out | Stop button kills all live process groups → "Cancelled by user" |
| Server dies mid-run | `running.json` survives → pill shows red "Interrupted · ago" |
| Command exits 0 but did nothing | a trailing `validate-fresh` command (rc-checked) fails the run when the actual export is empty or stale |
| rsync/unzip failure swallowed | rc checked in the lib and every run command; any failure fails the run |
| Uploaded files ignored | run-with-uploads refuses zero files |
| Originals deleted prematurely | media heredocs delete only after every step succeeded (`set -e`) and the confirm prompt was approved (`require: [confirmed]`) |
| Secrets in logs | `redact=` masks passwords/TOTP in command display and output; the age passphrase travels in an env var, never argv |
| State files churning git repos | `:(exclude).backup-state-*` pathspec in every commit |

## Dependencies

- Node.js 22+ (npm dependency: `express` only)
- System tools used by tasks: `bash`, `rsync`, `ssh`, `unzip`/`tar`, `git`, `age`, `jq`, `wget`, ImageMagick, plus whatever each external script needs (some personal scripts are Python and need `python3`)
- **`python3`** (stdlib only) — `lib.sh`'s `encrypt` subcommand drives tools that refuse non-TTY stdin (like `age`) through the committed helper `pty_runner.py`, which uses Python's stdlib `pty` module; python3 is already required by several personal scripts
- Personal automation scripts live as **git submodules** under `scripts/` (referenced from the personal config via the `{{scriptroot}}` token); init them with `git submodule update --init --recursive`

## Testing

`npm test` runs `node:test` suites in `tests/server.test.mjs`. Every suite builds a temporary sandbox under the OS temp dir with its own generated `config.mjs` (never touching real destinations); `BACKUPCTL_STATE_DIR` points staging and run markers at the sandbox. Coverage: token resolution (typed, nested, looped, tildes), config validation, state-file round-trip, subprocess streaming + redaction + timeouts, git-commit hygiene, the move/mappings/ingest/copy/encrypt task flows (real bash through the runner), uploads/require/capture/summary options, `validate-fresh`/`prune-exports` (fresh, stale, keep-newer), glob matching, and the API surface (upload validation, detect scoring + ambiguity, CSRF guard, run/cancel, paste_done). The encrypt round-trip suite runs only when `python3` and `age` are installed.

## Structure

- `server.mjs` — the whole engine in one module: config loading/tokens, run state, staging, the safe subprocess layer, the generic bash runner, the Express server, and the CLI entry
- `index.html` — the whole frontend in one file: inline CSS design system + vanilla JS (no build step)
- `pty_runner.py` — stdlib-only Python pty helper for tools like `age` that refuse non-TTY stdin (invoked directly by `lib.sh`)
- `lib.sh` — generic, committed bash helpers that tasks call (subcommands + sourceable functions)
- `scripts/` — git submodules with the personal automation scripts referenced by the config
- `config.mjs` — the committed personal config (values + groups of tasks)
- `tests/` — `node:test` sandbox suites (`npm test`)

## Key design decisions (and why)

1. **Plain HTML/CSS/JS instead of a UI framework** — no cascade layers, no runtime-injected component CSS, no custom elements: every style rule is fully deterministic. One self-contained `index.html`; no static asset serving at all.
2. **One committed personal config** — the repo is a personal tool; this README is the schema reference. The config is a JS module: values are real JS (numbers, objects, multi-line template literals for heredocs), comments stay.
3. **State next to the data** — each task's last-run record lives in its destination folder (`.backup-state-<task>.json`), consistent with data ownership, and excluded from git.
4. **No task types — Node runs bash, bash does the work** — the engine is a generic runner (tokens, timeouts, pgids, redaction, state, prompts) plus a small rc-checked bash library. Everything service-specific is a bash command in the config; no kind registry to maintain, and no engine fields for one-off needs (tool installs, freshness checks, pruning are config bash + `lib.sh` subcommands).
5. **One JS module** — `server.mjs` holds the engine, the server, and the CLI. No hot config reload: edit config → restart. The async event loop replaces a worker-thread design outright.
6. **Subprocess process groups + timeouts** — the UI can never get stuck in a silent "Running" state.
7. **A generic pty helper instead of a special-cased encryptor** — any tool that insists on a terminal (`age -p`, `ssh-add`, ...) is driven the same way: pipe input in, stream output out, secrets off argv. `lib.sh` invokes the stdlib-only `pty_runner.py` directly, so there are no native Node addons to rebuild and no extra system packages.
8. **Success = verified side effects** — exit codes plus post-run validation commands (`validate-fresh`), not just "the command returned".
