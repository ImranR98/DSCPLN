# Backup Web App — Architecture

## 1. Overview

A local web application for config-driven backup workflows. The repo is a **generic engine**: it contains no task definitions, no personal paths, and no personal scripts. One gitignored config file defines everything the app does; a committed example config documents every capability.

Design goals (in priority order):

1. **Honesty** — a run is reported OK only when its commands actually succeeded (exit codes checked, exports validated); hung commands are killed by timeouts; crashed runs show as *Interrupted*, never as success.
2. **Determinism** — the UI is plain HTML/CSS/JS with no framework, so every pixel is controlled by one stylesheet with no cascade surprises.
3. **Zero-friction automation** — drop a file anywhere, the app detects which task it belongs to, asks once, and runs the batch.
4. **Low maintenance** — declarative tasks, one config file, no external UI dependencies beyond the Python stdlib ecosystem (`fastapi`, `uvicorn`, `pyyaml`).

## 2. Repository layout

```
backupctl/
  server.py            FastAPI server + run manager (single in-flight run slot)
  config.py            Config loading, token resolution, machine checks
  state.py             Per-destination run-state files, interrupted marker, staging
  shell.py             Safe subprocess runner (timeouts, process groups, redaction)
                       (generates the failing SSH askpass at ~/.backupctl/askpass.sh)
  tasks.py             All task engines ("kinds")
  static/
    index.html         Page skeleton (favicon inlined as a data URL)
    app.css            Full design system (plain CSS, dark, red accent)
    app.js             Frontend logic (rendering, drops, modals, polling)
scripts/               Git submodules: the personal automation scripts that
                       tasks call (referenced via the {{scriptroot}} token);
                       init with `git submodule update --init --recursive`
config/
  config.example.yaml  Committed, generic: schema docs + one example per kind
  config.yaml          Gitignored, personal: values + tasks (the only personal file)
pyproject.toml         Package metadata, deps, `backupctl` entry point
```

## 3. Component diagram

```
                    ┌────────────────────────────────────────────┐
                    │  Browser (static/app.js — vanilla JS)      │
                    │  render cards · drop zones · modals · poll │
                    └──────────────────┬─────────────────────────┘
                          JSON / HTTP  │
                    ┌──────────────────▼─────────────────────────┐
                    │  server.py (FastAPI)                       │
                    │  /api/tasks · /api/upload · /api/run       │
                    │  /api/status · /api/cancel · /api/paste_done│
                    │  RUN manager: single run slot + thread      │
                    └──────────────────┬─────────────────────────┘
                                       │
                    ┌──────────────────▼─────────────────────────┐
                    │  tasks.py — kind dispatcher                │
                    │  ingest move copy run media archive        │
                    │  encrypt winesaves proton                  │
                    └────────┬───────────────────┬───────────────┘
                             │                   │
              ┌──────────────▼──────┐   ┌────────▼──────────────┐
              │ shell.py            │   │ state.py              │
              │ subprocesses with   │   │ .backup-state-*.json  │
              │ timeouts, pgids,    │   │ running.json marker   │
              │ askpass, redaction  │   │ staging/<task>/ dirs  │
              └──────────────┬──────┘   └───────────────────────┘
                             │
              ┌──────────────▼──────────────────────────────────┐
              │ config.py → config/config.yaml (personal)       │
              │ values (maindir, hosts, scripts...) + tasks[]   │
              └─────────────────────────────────────────────────┘
```

## 4. Config model (`backupctl/config.py`)

- `load_config(path)` reads **one YAML file** and returns `(local, tasks)`. Top-level keys are machine-specific values; the `tasks:` key is the task list. If the file is missing it raises `FileNotFoundError` with instructions; `server.py` catches this at import and serves the app with a red warning banner instead.
- `resolve(template, local, extra)` substitutes `{{a.b.c}}` tokens from the value dict (and a per-run `extra` dict, e.g. `{{uploads}}`, `{{tmp}}`). Resolution **loops until stable**, so values can reference other tokens (`balance_script: '{{scriptroot}}/Balance/...'`).

### Task fields

Common: `name`, `group` (card category), `kind`, `note` (help text, shown inside the drop zone for upload tasks), `timeout` (seconds, default 600), `dest` / `state_dir` (run state location; `state_dir` falls back to `dest`; boot fails loudly if neither), `root` (source root for media/copy; glob-aware), `prompts`, `glob`, `export_url` (optional; shows a "Generate Export" button on the card that opens the service's export page).

Kind-specific: `identify` (ingest), `rename_to` / `mappings` (move), `sources` / `pre` / `post` / `git` (copy), `uploads` / `capture` / `command(s)` / `cwd` (run), `commit_dir` (run+capture), `pairs` (media), `src_dir` / `media_dirs` / `audio_dir` (archive), `output` (encrypt).

Interactive input is config: `prompts: [{key, label, type: confirm|secret}]` — the GUI renders them generically, the values travel in the run `extra` payload, and secret values are also usable as `{{key}}` tokens inside run commands.

## 5. Server layer (`backupctl/server.py`)

A FastAPI app (no UI framework). Module state:

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

**Worker thread** (the run slot): calls `tasks.run_task(...)`; if `cancelled` was set, overwrites the result with `Cancelled by user`; publishes `done`, clears the slot and the running marker in `finally`.

## 6. Engine layer (`backupctl/tasks.py`)

`run_task(task, local, files, log, extra)` wraps every kind: builds a `Ctx` (task, local, files, `Logger`, extra), dispatches through the `KINDS` table, catches exceptions, and records run state via `state.save_task_state(...)` — so **state is recorded exactly once, for every kind, on both success and failure**.

| Kind | Behavior |
|---|---|
| `ingest` | Extract dropped archives (zip/tar), optionally run an `identify` shell command inside the extracted tree to derive a folder suffix, rsync into `dest` (rc checked), git commit, clear staging |
| `move` | Move dropped files into `dest`, renamed via `rename_to` (single) or `mappings` (group of exports per card), git commit |
| `copy` | rsync each `sources` entry into `dest/<basename>` (rc checked per source; any failure fails the run), optional git, `pre`/`post` shell commands |
| `run` | Execute `command`/`commands` with token resolution, per-command timeouts (rc 124 → "timed out"), output streamed to the log. With `uploads: true`, requires ≥1 staged file and provides `{{uploads}}`. With `capture: true`, the output becomes the summary and is shown in a copy/paste dialog ("Done" commits `commit_dir`) |
| `media` | Per `pairs:` (relative to the task's `root`, default `{{phone_sync_dir}}`), delete already-synced files (`{{media_rm_script}}`), then copy, standardize (`{{media_process_script}}`), move, delete originals. Optional `snaps:` (concat + import) and `calls:` (move recordings) blocks |

| `archive` | Chat-app archive: copy `src_dir` to `dest` (rsync rc checked), standardize `media_dirs` into `wamedia_dir`, concat `audio_dir` per chat, delete originals **only if every step succeeded** |
| `encrypt` | `age --encrypt --passphrase` driven through a pseudo-terminal (see §7), git commit, clear staging — fully generic, service-agnostic |
| `winesaves` | Push `{{wine_backup_script}}` to `hosts.bigpc` over SSH (`BatchMode=yes`), run it once per `games_dirs` entry, rsync the results back, remote cleanup in `finally`; every step rc-checked |
| `proton` | Build `proton-mail-export-cli -k -o backup -d <dest> -u <email> -p <pw> [-t <totp>]`, secrets redacted from log; after exit 0 the newest export dir must be non-empty and fresh (≤1 day) or the run **fails**; older exports pruned |

`availability(task, local)` decides card state (source root present, bigpc configured). `supports_uploads(task)` and `upload_patterns(task, local)` define drop-zone presence and filename matching (patterns are token-resolved, so `{{dns_export_file}}` works).

## 7. Process safety (`backupctl/shell.py`)

Every subprocess goes through `run()` / `sh()` / `sh_capture()` / `rsync()`:

- **`start_new_session=True`** — each command is its own process group.
- **Timeouts** — a `select()`-based read loop with a deadline; on expiry the whole group is SIGTERM'd then SIGKILL'd and the call returns 124 (task reports "timed out").
- **`stdin=DEVNULL`** — interactive prompts fail fast instead of hanging.
- **`SSH_ASKPASS_REQUIRE=force` + a failing askpass script** (generated at `~/.backupctl/askpass.sh`) — ssh can never prompt for a password on a hidden terminal.
- **`PROC_GROUPS` registry + `cancel_all()`** — the Stop button kills every live child process group.
- **`redact=[...]`** — secrets are masked in both the logged command line and the streamed output (used by the proton task).
- **`age_encrypt_passphrase`** — `age -p` refuses non-TTY stdin, so encryption is driven through a pty via `pexpect` (passphrase sent twice: enter + confirm; 30s timeouts; exit status checked).

## 8. State layer (`backupctl/state.py`)

- **Run state lives with the data**: `<state_dir>/.backup-state-<slug>.json` — `{task, ts, ok, summary, output}` (output capped at 20k chars). Written atomically (tmp + rename).
- **Git hygiene**: `git_commit()` stages with `git add -A . ':(exclude).backup-state-*'`, so state files never enter backup repos (and "nothing added to commit" is tolerated).
- **`running.json`** (app dir) marks an in-flight task; `_task_json` reports such a task as red `Interrupted · <ago>` after a server crash.
- **`staging/<task>/`** holds dropped-but-unprocessed uploads; cleared after a successful run.

## 9. Frontend (`backupctl/static/`)

Plain HTML + one CSS file + ~450 lines of vanilla JS. No build step, no framework.

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
| `runTask(task, opts)` | Renders the task's `prompts:` (confirm/secret) generically — no kind-specific branches — then POSTs `/api/run` and starts polling. Prompt-less non-upload tasks get the generic confirm (skippable via `opts.skipGenericConfirm` for batch runs) |
| `cancelRun` | Stop button: kills processes and clears the pending batch queue |
| `startPolling` | 700 ms polling of `/api/status`; while running it simply **re-renders from `/api/tasks`** (the server reports per-task `running`/`live`/`pill`), and on completion toasts the result, opens the paste dialog, and auto-starts the next pending batch task. The frontend holds no imperative DOM refs |
| `openLog/openPaste` | Monospace log modal; paste modal with Copy + Done (Done POSTs `/api/paste_done`) |
| `wireGlobalDropzone` | Dragover styling + click-to-browse on the global zone |

### Global drop flow (multi-file batch)

1. For each dropped file: `POST /api/detect` (server-side `fnmatch` scoring — most literal chars wins); ties → task picker modal; no match → warning toast.
2. Group files by detected task (duplicates of one task run it **once**).
3. Upload everything to each task's staging.
4. One **batch confirm** modal: `Detected: <task> (N files), ... Run all now?` — Cancel leaves files queued.
5. `STATE.pendingQueue` holds the ordered task list; the first runs immediately (generic confirm skipped; kind-specific prompts still appear at their turn), and each completion in the poll loop starts the next.

## 10. Run lifecycle (end-to-end)

```
User clicks Run / confirms batch
  → JS POST /api/run {extra}
  → server: slot check → availability check → snapshot staging files
      → write running.json → spawn worker thread
  → worker: tasks.run_task → kind function (shell.py runs every command
      with timeout/pgid/env safety) → state.save_task_state(dest-dir file)
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
| Command exits 0 but did nothing (proton CLI) | Post-run validation of the actual export (non-empty, fresh) fails the run |
| rsync/unzip failure swallowed | rc checked in ingest/copy/archive and every run command; any failure fails the run |
| Uploaded files ignored | run-with-uploads refuses zero files; ingest/move/encrypt refuse empty staging |
| Secrets in logs | `redact=` masks passwords/TOTP in command display and output |
| State files churning git repos | `:(exclude).backup-state-*` pathspec in every commit |

## 12. Testing

Sandbox suites in `/tmp/opencode` (never touching real destinations):
- `test_engine.py` — ingest (incl. identify suffix), move mappings/rename, encrypt pty encryption, run-with-tokens
- `test_engine2.py` — copy+git, media import, archive/media/delete-originals, chat-TXT run+uploads merge, run-capture paste, bank upload run
- `test_engine3.py` — timeout kill, zero-upload refusal, proton credential flags + log redaction + export validation + pruning, interrupted marker, `_task_json` display

Each suite builds a temporary merged config file (sandbox values + the machine's task list) and loads it through `config.load_config(path)`.

## 13. Key design decisions (and why)

1. **Plain HTML/CSS/JS instead of a UI framework** — no cascade layers, no runtime-injected component CSS, no custom elements: every style rule is fully deterministic.
2. **One gitignored personal config** — the repo stays a pure engine; the example file documents every kind generically.
3. **State next to the data** — each task's last-run record lives in its destination folder (`.backup-state-<task>.json`), consistent with data ownership, and excluded from git.
4. **Subprocess process groups + timeouts** — the UI can never get stuck in a silent "Running" state.
5. **`pexpect` for `age -p`** — the standard library for feeding a passphrase to a tool that insists on a terminal.
6. **Success = verified side effects** — exit codes plus post-run validation (proton), not just "the command returned".
