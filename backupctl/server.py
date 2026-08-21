"""Backup Web App — FastAPI server (no UI framework; plain HTML/CSS/JS
frontend): task/upload/run/status/detect endpoints and the single
in-flight run slot with its worker thread and cancellation."""

import argparse
import fnmatch
import threading
import time
import webbrowser
from pathlib import Path
from urllib.parse import urlparse

import uvicorn
from fastapi import Body, FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from . import config, shell, state, tasks

STATIC_DIR = Path(__file__).parent / "static"


def _load_config():
    """Load (or reload) the config; on failure return empty data."""
    try:
        return config.load_config(), False
    except FileNotFoundError as e:
        print(f"WARNING: {e}", flush=True)
        return ({}, []), True
    except ValueError as e:
        print(f"WARNING: config error: {e}", flush=True)
        return None


def _initial_config():
    """Load config at startup, refusing to boot on invalid content."""
    result = _load_config()
    if result is None:
        raise SystemExit("config.yaml has errors — fix it and restart")
    (LOCAL, TASK_LIST), MISSING_CONFIG = result
    return LOCAL, TASK_LIST, MISSING_CONFIG


LOCAL, TASK_LIST, MISSING_CONFIG = _initial_config()
TASK_MAP = {t["name"]: t for t in TASK_LIST}
_CONFIG_MTIME = config.CONFIG_FILE.stat().st_mtime if config.CONFIG_FILE.exists() else 0.0


def _maybe_reload():
    """Reload config when config.yaml changed on disk."""
    global LOCAL, TASK_LIST, TASK_MAP, MISSING_CONFIG, _CONFIG_MTIME
    try:
        mtime = config.CONFIG_FILE.stat().st_mtime
    except OSError:
        mtime = 0.0
    if mtime == _CONFIG_MTIME:
        return
    _CONFIG_MTIME = mtime
    result = _load_config()
    if result is None:
        return
    (LOCAL, TASK_LIST), MISSING_CONFIG = result
    TASK_MAP = {t["name"]: t for t in TASK_LIST}


app = FastAPI(title="Backup Web App", docs_url=None, redoc_url=None)


@app.middleware("http")
async def block_cross_origin(request: Request, call_next):
    """Reject cross-origin POSTs to /api/* (CSRF guard)."""
    if request.method == "POST" and request.url.path.startswith("/api/"):
        origin = request.headers.get("origin") or request.headers.get("referer")
        if origin and urlparse(origin).netloc != request.headers.get("host"):
            return JSONResponse({"detail": "cross-origin request blocked"}, status_code=403)
    return await call_next(request)

CURRENT = {"name": None, "log": [], "read": 0, "done": None, "cancelled": False}


def _queued_count(name):
    """Number of files staged for a task."""
    return len([p for p in state.staging_dir(name).iterdir() if p.is_file()])


def _state_json(ts, ok, summary, output, label):
    """Build the per-task last-run state payload."""
    return {
        "ts": ts,
        "ok": ok,
        "summary": summary,
        "output": output,
        "last_run_text": label,
    }


def _pill(state_json):
    """One staleness policy: running > ok(<24h) > neutral(<=7d) > fail."""
    if not state_json:
        return "fail"
    if not state_json["ok"]:
        return "fail"
    age = time.time() - state_json["ts"]
    if age < 24 * 3600:
        return "ok"
    if age <= 7 * 86400:
        return "neutral"
    return "fail"


def _task_json(t):
    """Full card payload for one task."""
    avail, reason = tasks.availability(t, LOCAL)
    rec = state.load_task_state(t, LOCAL)
    marker = state.running_marker()
    state_json = None
    if marker and marker.get("task") == t["name"]:
        # a previous run was interrupted (server stopped/crashed mid-task)
        ts = marker.get("ts", time.time())
        state_json = _state_json(ts, False, "Interrupted", "", f"Interrupted · {shell.human_ago(ts)}")
    elif rec:
        ok = rec.get("ok", False)
        state_json = _state_json(
            rec["ts"], ok, rec.get("summary", ""), rec.get("output", ""),
            f"{'OK' if ok else 'FAILED'} · {shell.human_ago(rec['ts'])}",
        )
    running = CURRENT["name"] == t["name"]
    return {
        "name": t["name"],
        "group": t["group"],
        "kind": t["kind"],
        "note": t.get("note"),
        "prompts": t.get("prompts", []),
        "uploads": tasks.supports_uploads(t),
        "export_url": t.get("export_url"),
        "avail": avail,
        "avail_reason": reason,
        "queued": _queued_count(t["name"]),
        "state": state_json,
        "pill": "running" if running else _pill(state_json),
        "running": running,
        "live": (CURRENT["log"][-1][:120] if running and CURRENT["log"] else ""),
    }


def _detect(name):
    """Return the task a dropped file belongs to (most specific pattern wins)."""
    candidates = []
    for t in TASK_LIST:
        if not tasks.supports_uploads(t):
            continue
        for p in tasks.upload_patterns(t, LOCAL):
            if fnmatch.fnmatch(name, p):
                candidates.append({"task": t["name"], "score": sum(c not in "*?" for c in p)})
    if not candidates:
        return None
    best = max(c["score"] for c in candidates)
    tied = [c["task"] for c in candidates if c["score"] == best]
    return {"task": tied[0], "ambiguous": tied}


@app.post("/api/detect")
async def api_detect(name: str):
    """Return the task a filename belongs to (most specific pattern wins)."""
    return {"result": _detect(Path(name).name)}


@app.get("/api/tasks")
def api_tasks():
    """List all tasks with state, availability, and run status."""
    _maybe_reload()
    return {
        "tasks": [_task_json(t) for t in TASK_LIST],
        "missing_config": MISSING_CONFIG,
    }


@app.post("/api/upload/{task_name}")
async def api_upload(task_name: str, name: str, request: Request):
    """Save a dropped file into the task's staging (glob-validated)."""
    task = TASK_MAP.get(task_name)
    if task is None or not tasks.supports_uploads(task):
        raise HTTPException(404, "Unknown task")
    filename = Path(name).name
    patterns = tasks.upload_patterns(task, LOCAL)
    if not any(fnmatch.fnmatch(filename, p) for p in patterns):
        raise HTTPException(400, f"{filename} does not match the expected pattern(s): {', '.join(patterns)}")
    body = await request.body()
    staging = state.staging_dir(task_name)
    (staging / filename).write_bytes(body)
    return {"queued": filename, "count": _queued_count(task_name)}


@app.post("/api/run/{task_name}")
def api_run(task_name: str, payload: dict = Body(default={})):
    """Start a task in the background (extra payload carries prompt values). 409 if busy."""
    task = TASK_MAP.get(task_name)
    if task is None:
        raise HTTPException(404, "Unknown task")
    if CURRENT["name"]:
        raise HTTPException(409, "Another task is already running")
    avail, reason = tasks.availability(task, LOCAL)
    if not avail:
        raise HTTPException(400, reason)
    files = [p for p in state.staging_dir(task_name).iterdir() if p.is_file()]
    logger = tasks.Logger()
    CURRENT["name"] = task_name
    CURRENT["log"] = logger.lines
    CURRENT["read"] = 0
    CURRENT["done"] = None
    CURRENT["cancelled"] = False
    state.mark_running(task_name)

    def worker():
        """Run the task, honour cancellation, publish the result."""
        ok, summary = False, "Internal error"
        try:
            ok, summary = tasks.run_task(task, LOCAL, files, logger, payload or {})
            if CURRENT["cancelled"]:
                ok, summary = False, "Cancelled by user"
                state.save_task_state(task, LOCAL, False, summary, output=logger.text)
        finally:
            CURRENT["done"] = {
                "task": task_name,
                "ok": ok,
                "summary": summary,
                "paste": bool(task.get("capture")),
            }
            CURRENT["name"] = None
            CURRENT["cancelled"] = False
            state.clear_running()

    threading.Thread(target=worker, daemon=True).start()
    return {"started": True}


@app.get("/api/status")
def api_status():
    """Running task name, new log lines, and a one-shot completion result."""
    log = CURRENT["log"]
    new_lines = log[CURRENT["read"]:]
    CURRENT["read"] = len(log)
    done = CURRENT["done"]
    CURRENT["done"] = None
    return {"running": CURRENT["name"], "log": new_lines, "done": done}


@app.post("/api/cancel")
def api_cancel():
    """Stop the running task (kills its process groups)."""
    if not CURRENT["name"]:
        raise HTTPException(409, "No task is running")
    CURRENT["cancelled"] = True
    shell.cancel_all()
    return {"cancelled": True}


@app.post("/api/paste_done/{task_name}")
def api_paste_done(task_name: str):
    """git-commit the task's commit_dir (the paste dialog's Done button)."""
    task = TASK_MAP.get(task_name)
    if task is None:
        raise HTTPException(404, "Unknown task")
    commit_dir = task.get("commit_dir")
    if not commit_dir:
        return {"committed": False}
    dest = config.expand(config.resolve(commit_dir, LOCAL))
    try:
        shell.git_commit(dest, f"{task_name} · {time.ctime()}")
    except Exception as e:  # noqa: BLE001
        raise HTTPException(500, f"git commit failed: {e}")
    return {"committed": True, "dest": dest}


@app.get("/")
def index():
    """Serve the static frontend."""
    return FileResponse(STATIC_DIR / "index.html")


app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


def main():
    """CLI entry: --port/--host/--no-browser, then run the server."""
    parser = argparse.ArgumentParser(prog="backupctl", description="Config-driven backup web GUI")
    parser.add_argument("--port", type=int, default=8080)
    parser.add_argument("--host", default="127.0.0.1", help="bind address (use 0.0.0.0 inside Docker)")
    parser.add_argument("--no-browser", action="store_true")
    args = parser.parse_args()

    url = f"http://{args.host}:{args.port}"
    if not args.no_browser:
        threading.Timer(1.0, lambda: webbrowser.open(url)).start()
    uvicorn.run(app, host=args.host, port=args.port, log_level="warning")


if __name__ == "__main__":
    main()
