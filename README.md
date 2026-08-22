# backupctl

A local web app that runs config-driven backup workflows. This repo is **personal**: `config/config.mjs` (values + tasks) is committed, and personal automation scripts are referenced as git submodules under `scripts/`. `ARCHITECTURE.md` documents every field and capability.

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

- `config/config.mjs` — your personal file (committed): machine-specific values at the top of the default export (`maindir`, `hosts`, emails, script paths...) plus the `tasks:` array. Add a task by adding an entry; the menu, categories, and drop-zone validation update automatically.

Placeholders like `{{maindir}}` or `{{hosts.bigpc.host}}` inside command strings are resolved from the same file's exported values at run time; values may reference other tokens. Built-in tokens: `{{repo_dir}}` (this repository's root, env-overridable via `BACKUPCTL_REPO_DIR`) and `{{lib}}` (the packaged `lib.sh`). Every task needs `state_dir:` — run state is stored there as `.backup-state-<task>.json`.

**Personal scripts live as git submodules** under `scripts/` in this repo. Tasks that need one (e.g. a Balance-format parser) reference it via the `{{scriptroot}}` token — see `config/config.mjs` for real examples.

## How tasks work

There are no hard-coded task types — **every task is a `commands` list of bash commands** executed in order by the runner with timeouts, process-group cancellation, secret redaction, and per-task state recording. A single string is accepted for one-command tasks. The repo ships a generic bash library, `lib.sh`, which tasks call either as a subcommand for simple cases:

```sh
bash '{{lib}}' move --git --rename bookmarks.html '{{maindir}}/Manual' {{uploads}}
```

or by sourcing it inside a heredoc for anything with logic (export ingestion with an account-name suffix, media import with snapshot/standardize/delete-originals, ...). The library's functions (`bctl_extract`, `bctl_rsync`, `bctl_git_commit`, `bctl_process_and_move`, ...) and subcommands (`move`, `copy`, `encrypt`, `validate-fresh`, `prune-exports`) are rc-checked under `set -e`.

Task fields control the runner: `uploads: true` + `glob:` (drop zone, glob can be a list), `prompts:` (confirm/secret dialogs whose values become `{{key}}` tokens), `require:` (prompt keys that must have a value), `capture:` + `commit_dir:` (output in a copy/paste dialog with a Done button that git-commits), `root:` (source directory the card needs — availability badge), `summary_last_line:` (card summary = last log line), plus `timeout`, `cwd`, `note`, `export_url`. Service-specific concerns — installing a CLI, validating an export is fresh, pruning old exports — are plain bash in the task's `commands` (see the ProtonMail task for the full pattern: install-if-missing → export → `validate-fresh` → `prune-exports`).

Per-run tokens available in commands: `{{uploads}}` (quoted staged file paths) and `{{tmp}}` (unique temp path).

## Docker

The app runs fine in a container with destination dirs mounted from the host. The included `Dockerfile` (Debian slim + the app's system deps) and `docker-compose.yml` use **same-path mounts** — host dirs appear at identical container paths — so your personal `config.mjs` works unmodified. Put the app behind a reverse proxy with auth for remote access; the server binds `0.0.0.0` inside the container (`--no-browser`).

```sh
docker compose up -d --build      # adjust the host paths in docker-compose.yml first
```

Mounts: `~/Main`, `~/Downloads`, `~/deviceSync`, `~/.ssh`, `~/.gnupg`, `./config`, and a named volume for `~/.backupctl` (state + staging).

What degrades in a container:
- **Mounted-device tasks** (MTP etc.) — host device mounts aren't visible inside the container; those cards show "Source directory not found"
- **PC Files** — the `dconf` extension-settings dump needs a desktop session and silently no-ops; everything else copies normally
- **ProtonMail** — its export CLI re-downloads into the container home after image rebuilds
- No browser auto-open (`--no-browser` is the container default)

## Dependencies

- Node.js 22+ (npm dependencies: `express`, `minimatch`)
- System tools used by tasks: `bash`, `rsync`, `ssh`, `unzip`/`tar`, `git`, `age`, `jq`, `wget`, ImageMagick, plus whatever each external script needs (some personal scripts are Python and need `python3`)
- **`python3`** (stdlib only) — `lib.sh`'s `encrypt` subcommand drives tools that refuse non-TTY stdin (like `age`) through the committed helper `pty_runner.py`, which uses Python's stdlib `pty` module; python3 is already required by several personal scripts
- Personal automation scripts live as **git submodules** under `scripts/` (referenced from the personal config via the `{{scriptroot}}` token); init them with `git submodule update --init --recursive`

## Structure

- `server.mjs` — the whole engine in one module: config loading/tokens, run state, staging, the safe subprocess layer, the generic bash runner, the Express server, and the CLI entry
- `pty_runner.py` — stdlib-only Python pty helper for tools like `age` that refuse non-TTY stdin (invoked directly by `lib.sh`)
- `lib.sh` — generic, committed bash helpers that tasks call (subcommands + sourceable functions)
- `static/` — plain HTML/CSS/JS frontend (`index.html`, `app.css`, `app.js`; favicon inlined) — no UI framework
- `scripts/` — git submodules with the personal automation scripts referenced by the config
- `config/config.mjs` — the committed personal config (values + tasks)
- `tests/` — `node:test` sandbox suites (`npm test`)
- `ARCHITECTURE.md` — detailed architecture and code-level explanation
