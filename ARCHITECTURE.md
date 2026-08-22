# backupctl — Architecture

## 1. Overview

A local web application for config-driven backup workflows. The repo is **personal**: `config/config.yaml` holds all values and task definitions (committed), and personal scripts are referenced as git submodules under `scripts/`. This document is the schema reference.

Design goals (in priority order):

1. **Honesty** — a run is reported OK only when its commands actually succeeded (exit codes checked, exports validated); hung commands are killed by timeouts; crashed runs show as *Interrupted*, never as success.
2. **Determinism** — the UI is plain HTML/CSS/JS with no framework, so every pixel is controlled by one stylesheet with no cascade surprises.
3. **Zero-friction automation** — drop a file anywhere, the app detects which task it belongs to, asks once, and runs the batch.
4. **Low maintenance** — one config file, no hard-coded task types: every task is a bash command. No external UI dependencies beyond the Python stdlib ecosystem (`fastapi`, `uvicorn`, `pyyaml`, `pexpect`).

## 2. Repository layout

```
backupctl/
  app.py               FastAPI server, the generic bash runner (timeouts,
                       pgids, redaction, runner options), CLI entry
  core.py              Config loading + {{token}} resolution, run-state
                       files, staging, the safe subprocess layer, and the
                       generic pty runner (python -m backupctl.core CMD...)
  lib.sh               Generic, committed bash helpers: subcommands (move,
                       copy, encrypt) + sourceable functions (extract,
                       rsync, git commit, process-and-move, ...); tasks
                       reach it via the built-in {{lib}} token
  static/
    index.html         Page skeleton (favicon inlined as a data URL)
    app.css            Full design system (plain CSS, dark, red accent)
    app.js             Frontend logic (rendering, drops, modals, polling)
scripts/
  <submodules>         The personal automation scripts that tasks call
                       (referenced via the {{scriptroot}} token)
config/
  config.yaml          Committed, personal: values + tasks (the one personal file)
pyproject.toml         Package metadata, deps, `backupctl` + `backupctl-pty` entry points
```

## 3. Component diagram

```
                    ┌────────────────────────────────────────────┐
                    │  Browser (static/app.js — vanilla JS)      │
                    │  render cards · drop zones · modals · poll │
                    └──────────────────┬─────────────────────────┘
                          JSON / HTTP  │
                    ┌──────────────────▼─────────────────────────┐
                    │  app.py (FastAPI)                          │
                    │  /api/tasks · /api/upload · /api/run       │
                    │  /api/status · /api/cancel · /api/paste_done│
                    │  RUN manager: single run slot + thread      │
                    └────────┬───────────────────┬───────────────┘
                             │                   │
              ┌──────────────▼──────┐   ┌────────▼──────────────┐
              │  app.py — runner    │   │  core.py              │
              │  resolves tokens,   │   │  subprocesses with    │
              │  runs the task's    │   │  timeouts, pgids,     │
              │  bash command(s)    │   │  askpass, redaction   │
              │  (tool/fresh/prune  │   │  .backup-state-*.json │
              │  /capture options)  │   │  running.json marker  │
              └──────────┬──────────┘   │  staging/<task>/ dirs │
                         │              └───────────────────────┘
              ┌──────────▼──────────────────────────────────────┐
              │  task command → bash backupctl/lib.sh   │
              │  (or a heredoc sourcing it) + personal scripts   │
              └─────────────────────────────────────────────────┘
              ┌──────────────────────────────────────────────────┐
              │  core.py → config/config.yaml (personal)         │
              │  values (backup_root, hosts, scripts...) + tasks[]│
              └──────────────────────────────────────────────────┘
```

## 4. Config model (`backupctl/core.py`)

- `load_config(path)` reads **one YAML file** and returns `(local, tasks)`. Top-level keys are machine-specific values; the `tasks:` key is the task list. If the file is missing it raises `FileNotFoundError` with instructions; `app.py` catches this at import and serves the app with a red warning banner instead.
- `resolve(template, local, extra)` substitutes `{{a.b.c}}` tokens from the value dict (and a per-run `extra` dict). Resolution **loops until stable**, so values can reference other tokens (`balance_script: '{{scriptroot}}/<repo>/<script>.js'`). A template that is exactly one token resolves to the token's **typed value** (dict/list/int) — e.g. `host: '{{hosts.gaming_pc}}'` — while embedded tokens are stringified. Built-in tokens: `{{repo_dir}}` (the repository root, overridable via `BACKUPCTL_REPO_DIR`) and `{{lib}}` (the packaged `backupctl/lib.sh`, wherever the package is installed).

### Task fields

Common: `name`, `group` (card category), `note` (help text, shown inside the drop zone for upload tasks), `timeout` (seconds, default 600), `dest` / `state_dir` (run state location; `state_dir` falls back to `dest`; boot fails loudly if neither), `prompts`, `export_url` (optional; shows a "Generate Export" button on the card that opens the service's export page).

Runner: `command` / `commands` (bash; the only required field), `cwd`, `args` (argv form; empty values drop their flag pair), `uploads: true` + `glob` (drop zone; glob may be a list of patterns), `require: [key...]` (fail unless each prompt key has a value), `capture: true` + `commit_dir` (output becomes the summary, shown in a copy/paste dialog whose Done button git-commits `commit_dir`), `tool:` (download+extract a CLI if missing, exposed as `{{tool_binary}}`), `fresh_dir:` (fail unless the newest export dir is non-empty and fresh), `prune:` (delete older export dirs, `keep_newer` keeps any larger than the newest), `root:` (source directory the card requires; glob-aware, drives the availability badge), `summary_last_line: true` (card summary = last non-command log line).

Per-run tokens: `{{uploads}}` (shlex-quoted staged file paths), `{{tmp}}` (unique temp path under the task's staging dir), `{{python}}` (the server's interpreter), plus one `{{key}}` per prompt value. Interactive input is config: `prompts: [{key, label, type: confirm|secret}]` — the GUI renders them generically, the values travel in the run `extra` payload, and secret values are redacted from the command display and output.

## 5. Server layer (`backupctl/app.py`)

A FastAPI app (no UI framework). Config is loaded once at boot (edit → restart). Module state:

```
CURRENT = {"name", "log", "read", "done", "cancelled"}   # run slot
LOCAL, TASK_LIST                                           # from load_config()
```

| Endpoint | Purpose |
|---|---|
| `GET /api/tasks` | Full task list: definitions, availability + reason, queued count, last-run state (or *Interrupted* if `running.json` mentions the task), per-task `running`/`live`/`pill`, `missing_config` flag |
| `POST /api/detect?name=` | Returns the upload task a filename belongs to (most-specific pattern wins, ties listed as `ambiguous`) — the frontend does no matching itself |
| `POST /api/upload/{task}?name=` | Raw request body saved to `staging/<task>/<name>` after glob validation (400 on mismatch) |
| `POST /api/run/{task}` | Body: JSON `extra` (`password`, `totp`, `confirmed`). Refuses when the slot is busy (409) or the task is unavailable. Snapshots the staging file list, writes the `running.json` marker, starts a daemon worker thread |
| `GET /api/status` | `running` task name, newly appended log lines, one-shot `done` result |
| `POST /api/cancel` | Marks the run cancelled and kills all registered child process groups; the worker then records `Cancelled by user` |
| `POST /api/paste_done/{task}` | Runs `git_commit` on the task's `commit_dir` (the "Done" button in the paste dialog) |

**Worker thread** (the run slot): calls `run_task(...)`; if `cancelled` was set, overwrites the result with `Cancelled by user`; publishes `done`, clears the slot and the running marker in `finally`.

## 6. Runner (`backupctl/app.py`)

`run_task(task, local, files, log, extra)` wraps the single execution path: builds a `Ctx`, resolves tokens, checks `uploads`/`require`, optionally installs the task's `tool`, runs `args:` or each `command` (token-resolved) with per-command timeouts, redacts prompt secrets, then clears staging (upload tasks) or the `{{tmp}}` dir, validates `fresh_dir`, prunes old exports, and records run state via `save_task_state(...)` — so **state is recorded exactly once, on both success and failure**. With `capture:` the captured output is the summary; with `summary_last_line:` the summary is the last non-command log line; otherwise "Completed".

The bash library `backupctl/lib.sh` (sourced or called as a subcommand) is rc-checked under `set -euo pipefail` and provides:

| Entry | Behavior |
|---|---|
| `move [--rename NAME] [--git] DEST FILE...` | move files into dest (fixed name optional; multiple files with a rename set fail), git commit when `--git` (like `copy`) |
| `copy [--git] [--pre CMD] [--post CMD] DEST SRC...` | rsync each source into `dest/<basename>` (missing sources skipped, failures fail the run), per-source git commit when `--git` |
| `encrypt PYTHON DEST OUTNAME FILE` | age-encrypt exactly one file via the generic pty runner; passphrase comes from `AGE_PASSPHRASE` (env, never argv); git commit |
| `bctl_extract` / `bctl_rsync(_delete)` | unzip/tar extraction; rsync -aq with optional --delete |
| `bctl_git_commit DIR` | git init/add/commit with `:(exclude).backup-state-*`; empty commits tolerated |
| `bctl_process_and_move SRC DEST SCRIPT [keep]` | copy files to a temp dir, run the standardize script once, move results to dest, delete originals (unless kept) |
| `bctl_first_glob PATTERN` | first match of a glob (e.g. MTP mounts) |

Task commands are plain shell — export ingestion with an account-name suffix, per-pattern renames, and media workflows (snapshot → raw rsync → standardize → delete originals) are small heredoc scripts sourcing the library. **Delete-originals honesty** comes from `set -e`: the final `rm -rf` is only reached when every prior step succeeded, and `require: [confirmed]` gates the confirm prompt.

## 7. Process safety (`backupctl/core.py`)

Every subprocess goes through `run()` / `sh()` / `sh_capture()` / `rsync()`:

- **`start_new_session=True`** — each command is its own process group.
- **Timeouts** — a `select()`-based read loop with a deadline; on expiry the whole group is SIGTERM'd then SIGKILL'd and the call returns 124 (task reports "timed out").
- **`stdin=DEVNULL`** — interactive prompts fail fast instead of hanging.
- **`SSH_ASKPASS_REQUIRE=force` + a failing askpass script** (generated at `~/.backupctl/askpass.sh`) — ssh can never prompt for a password on a hidden terminal.
- **`PROC_GROUPS` registry + `cancel_all()`** — the Stop button kills every live child process group.
- **`redact=[...]`** — secrets are masked in both the logged command line and the streamed output (every prompt value is redacted).
- **Generic pty runner** (`pty_main`, also the `backupctl-pty` entry point) — for tools that refuse non-TTY stdin (e.g. `age --passphrase`): spawns the command in a pseudo-terminal via `pexpect`, forwards piped stdin to it, strips terminal control sequences, exits with the child's status. Secrets are piped in from env vars, never placed on a command line.

## 8. State layer (`backupctl/core.py`)

- **Run state lives with the data**: `<state_dir>/.backup-state-<slug>.json` — `{task, ts, ok, summary, output}` (output capped at 20k chars). Written atomically (tmp + rename).
- **Git hygiene**: `git_commit()` and `bctl_git_commit` stage with `git add -A . ':(exclude).backup-state-*'`, so state files never enter backup repos (and "nothing added to commit" is tolerated).
- **`running.json`** (app dir) marks an in-flight task; `_task_json` reports such a task as red `Interrupted · <ago>` after a server crash.
- **`staging/<task>/`** holds dropped-but-unprocessed uploads; cleared after a successful run.

## 9. Frontend (`backupctl/static/`)

Plain HTML + one CSS file + ~400 lines of vanilla JS. No build step, no framework.

### Structure (`index.html`)
Topbar (logo, title, config-missing warning) → global drop zone → `#page` container (groups + cards rendered by JS) → footer note → `#modal-root` and `#toasts`.

### JS function map (`app.js`)

| Function | Role |
|---|---|
| `el/api/toast` | DOM helper, fetch wrapper (errors as `{error}`), toast stack |
| `openModal/confirmModal/inputModal/fieldsModal/pickerModal` | Generic modal system; the last four return Promises so flows read like `await confirmModal(...)` |
| `loadTasks/render/card` | Fetch `/api/tasks`, group by category, build each card (pill, live-log line, availability badge, note, drop zone + hidden file input, queue chip, Run/Log buttons, and a "Generate Export" link when `export_url` is set) |
| (server) `_pill` | Single staleness policy served to the UI: running → ok(<24h) → neutral(≤7d) → fail; the frontend just renders the class |
| `uploadFiles` | Per-card drop handling; validation happens server-side (400 → toast) |
| `handleGlobalFiles` | **Global drop flow** (below) |
| `runTask(task, opts)` | Renders the task's `prompts:` (confirm/secret) generically — no task-type branches — then POSTs `/api/run` and starts polling. Prompt-less non-upload tasks get the generic confirm (skippable via `opts.skipGenericConfirm` for batch runs) |
| `cancelRun` | Stop button: kills processes and clears the pending batch queue |
| `startPolling` | 700 ms polling of `/api/status`; while running it simply **re-renders from `/api/tasks`** (the server reports per-task `running`/`live`/`pill`), and on completion toasts the result, opens the paste dialog, and auto-starts the next pending batch task. The frontend holds no imperative DOM refs |
| `openLog/openPaste` | Monospace log modal; paste modal with Copy + Done (Done POSTs `/api/paste_done`) |
| `wireGlobalDropzone` | Dragover styling + click-to-browse on the global zone |

### Global drop flow (multi-file batch)

1. For each dropped file: `POST /api/detect` (server-side `fnmatch` scoring — most literal chars wins); ties → task picker modal; no match → warning toast.
2. Group files by detected task (duplicates of one task run it **once**).
3. Upload everything to each task's staging.
4. One **batch confirm** modal: `Detected: <task> (N files), ... Run all now?` — Cancel leaves files queued.
5. `STATE.pendingQueue` holds the ordered task list; the first runs immediately (generic confirm skipped; task-specific prompts still appear at their turn), and each completion in the poll loop starts the next.

## 10. Run lifecycle (end-to-end)

```
User clicks Run / confirms batch
  → JS POST /api/run {extra}
  → server: slot check → availability check → snapshot staging files
      → write running.json → spawn worker thread
  → worker: run_task → token resolution → the task's bash command(s)
      (core.py runs every command with timeout/pgid/env safety)
      → fresh_dir/prune validation → save_task_state(dest-dir file)
      → cancelled? record "Cancelled by user"
      → publish done, clear slot + marker
  → JS poll loop: live log line on card → completion → toast → refresh
      → paste dialog / next batch task
```

## 11. Failure & honesty guarantees

| Failure mode | Guarantee |
|---|---|
| Command hangs (prompt, network, deadlock) | Per-task timeout (default 10 min) kills the process group → red "timed out" |
| User wants out | Stop button kills all live process groups → "Cancelled by user" |
| Server dies mid-run | `running.json` survives → pill shows red "Interrupted · ago" |
| Command exits 0 but did nothing | `fresh_dir:` post-run validation of the actual export (non-empty, fresh) fails the run |
| rsync/unzip failure swallowed | rc checked in the lib and every run command; any failure fails the run |
| Uploaded files ignored | run-with-uploads refuses zero files |
| Originals deleted prematurely | media heredocs delete only after every step succeeded (`set -e`) and the confirm prompt was approved (`require: [confirmed]`) |
| Secrets in logs | `redact=` masks passwords/TOTP in command display and output; the age passphrase travels in an env var, never argv |
| State files churning git repos | `:(exclude).backup-state-*` pathspec in every commit |

## 12. Testing

Sandbox suites in `/tmp/opencode` (never touching real destinations) build a temporary merged config (sandbox values + the machine's task list) and load it through `core.load_config(path)`. The current suite covers: move subcommand (rename + staging cleared), mappings heredoc, ingest heredoc with identify suffix, copy subcommand with git + pre/post (state files excluded from commits), encrypt via the generic pty runner (round-trip decryption + passphrase redaction), run with uploads/capture/tool+fresh_dir+prune/timeout-kill/redaction, media heredoc (plain pairs, process:false, pre script), and media snapshot+raw+concat+delete-originals with confirm.

## 13. Key design decisions (and why)

1. **Plain HTML/CSS/JS instead of a UI framework** — no cascade layers, no runtime-injected component CSS, no custom elements: every style rule is fully deterministic.
2. **One committed personal config** — the repo is a personal tool; this document is the schema reference.
3. **State next to the data** — each task's last-run record lives in its destination folder (`.backup-state-<task>.json`), consistent with data ownership, and excluded from git.
4. **No task types — Python runs bash, bash does the work** — the engine is a generic runner (tokens, timeouts, pgids, redaction, state, prompts) plus a small rc-checked bash library. Everything service-specific is a bash command in the config; no kind registry to maintain.
5. **Two Python modules** — `core.py` holds everything shared (config, state, subprocess safety, pty runner); `app.py` holds the server, the runner, and the CLI. No cross-module plumbing, no hot config reload: edit config → restart.
6. **Subprocess process groups + timeouts** — the UI can never get stuck in a silent "Running" state.
7. **A generic pty runner instead of a special-cased encryptor** — any tool that insists on a terminal (`age -p`, `ssh-add`, ...) is driven the same way: pipe input in, stream output out, secrets off argv.
8. **Success = verified side effects** — exit codes plus post-run validation (`fresh_dir`), not just "the command returned".
