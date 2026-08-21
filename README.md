# Backup Web App

A local web app that runs config-driven backup workflows. Nothing personal is committed to this repo: the repo is a generic engine, and all tasks plus machine-specific values live in a single gitignored `config/config.yaml`. A committed, heavily-commented `config/config.example.yaml` demonstrates every task kind with generic examples.

## Usage

```sh
python3 -m venv .venv
.venv/bin/pip install -e .
cp config/config.example.yaml config/config.yaml   # fill in your own values and tasks
.venv/bin/backupctl
```

This starts a local server (http://127.0.0.1:8080) and opens your browser. To run without opening a browser: `backupctl --no-browser`. Different port: `backupctl --port 8081`.

## What you see

A **drop zone at the top** detects what kind of export you're uploading from the filename and asks for confirmation before running the matching task (e.g. `medium-export-*.zip` → Medium). If the file matches no task, or is ambiguous, you're told / asked. Cancelling just queues the file so you can run it from the card later. Task cards are grouped into categories (Manual Exports, Device Imports, Local Backups, Tools); each card has:

- a **drop zone** to queue files for that task specifically (also detected against its patterns)
- a **Run** button (disabled if the task is unavailable, e.g. its source directory is missing) — becomes a **Stop** button while running (kills the task's processes)
- a **Log** button showing the last run's output; the last log line also streams under the card title while a task runs
- a **Generate Export** button opening the service's export page in a new tab, for tasks whose config sets `export_url:` (e.g. Google Takeout, Instagram, Bitwarden)
- a status line with the last run time and result — stored per task as `.backup-state-<task>.json` in the task's destination directory (`state_dir:` in config, defaulting to `dest:`; excluded from git commits)

Every task runs with a timeout (default 10 min, overridable per task via `timeout:` in config). Interactive steps are handled in the GUI: passphrase prompts for encrypted exports, password + TOTP for ProtonMail, confirmation dialogs for everything else. Runs interrupted by a server crash show as "Interrupted" instead of a false success.

## Configuration

- `config/config.yaml` — your personal file (gitignored): machine-specific values at the top level (`maindir`, `phone_sync_dir`, hosts, emails, script paths...) plus the `tasks:` list. Add a task by adding an entry; the menu, categories, and drop-zone validation update automatically.
- `config/config.example.yaml` — committed template demonstrating every task kind with generic examples and schema comments.

Placeholders like `{{maindir}}` or `{{hosts.bigpc.host}}` are resolved from the same file's top-level values at run time; values may reference other tokens. Every task needs either `dest:` or `state_dir:` — run state is stored there as `.backup-state-<task>.json`.

**Personal scripts are not part of this repo.** Tasks that need one (e.g. a Balance-format parser) reference it via a token such as `{{balance_script}}` pointing anywhere under `{{maindir}}` — see the example config.

## Docker

The app runs fine in a container with destination dirs mounted from the host. The included `Dockerfile` (Debian slim + the app's system deps) and `docker-compose.yml` use **same-path mounts** — host dirs appear at identical container paths — so your personal `config.yaml` works unmodified. Put the app behind a reverse proxy with auth for remote access; the server binds `0.0.0.0` inside the container (`--no-browser`).

```sh
docker compose up -d --build      # adjust the host paths in docker-compose.yml first
```

Mounts: `~/Main`, `~/Downloads`, `~/deviceSync`, `~/.ssh`, `~/.gnupg`, `./config`, and a named volume for `~/.backupctl` (state + staging).

What degrades in a container:
- **Mounted-device tasks** (MTP etc.) — host device mounts aren't visible inside the container; those cards show "Source directory not found"
- **PC Files** — the `dconf` extension-settings dump needs a desktop session and silently no-ops; everything else copies normally
- **ProtonMail** — its export CLI re-downloads into the container home after image rebuilds
- No browser auto-open (`--no-browser` is the container default)

## Task kinds

The engine provides nine generic kinds — `ingest`, `move`, `copy`, `run` (with `uploads:`/`capture:` modes), `media` (any configurable source root), `archive`, `encrypt`, `winesaves`, `proton`. Every field, prompt, and option is demonstrated with a generic example in `config/config.example.yaml`; see `ARCHITECTURE.md` for the code-level semantics.

## Dependencies

- Python 3.10+ and the venv above (`fastapi`, `uvicorn`, `pyyaml`)
- System tools used by tasks: `rsync`, `ssh`, `unzip`/`tar`, `git`, `age`, `node`, `jq`, `wget`, ImageMagick, plus whatever each external script needs
- External automation scripts under `{{maindir}}/Code/Automation` (referenced from the personal config) are called as-is

## Structure

- `backupctl/server.py` — FastAPI server (task/upload/run/status endpoints)
- `backupctl/static/` — plain HTML/CSS/JS frontend (`index.html`, `app.css`, `app.js`; favicon inlined) — no UI framework
- `backupctl/tasks.py` — task engines; `config.py`, `state.py`, `shell.py` — config/state/helpers
- `config/config.example.yaml` — generic example (your personal `config/config.yaml` is gitignored)
- `ARCHITECTURE.md` — detailed architecture and code-level explanation
