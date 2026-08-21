"""backupctl — FastAPI server, the six task kinds, and the CLI entry.

Kinds: ingest (extract a dropped export), move (renamed or per-mapping),
copy (rsync configured sources), run (shell command(s) with
uploads/capture/args/require/tool/fresh_dir/prune options), media (import +
standardize; optional snapshot/raw/concat/delete-originals), encrypt (age)."""

import argparse
import fnmatch
import glob
import random
import re
import shlex
import shutil
import tempfile
import threading
import time
import webbrowser
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import urlparse

import uvicorn
from fastapi import Body, FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from . import core

STATIC_DIR = Path(__file__).parent / "static"
DEFAULT_TIMEOUT = 600
DAY_SECONDS = 86400

# run plumbing ---------------------------------------------------------------


class Logger:
    def __init__(self):
        self.lines = []

    def __call__(self, line):
        self.lines.append(line)

    @property
    def text(self):
        return "\n".join(self.lines)


@dataclass
class Ctx:
    task: dict
    local: dict
    files: list = field(default_factory=list)
    log: callable = field(default_factory=Logger)
    extra: dict = field(default_factory=dict)


def _resolve(template, ctx, extra=None):
    return core.expand(core.resolve(template, ctx.local, extra))


def _path(ctx, template):
    return Path(_resolve(template, ctx))


def _timeout(ctx):
    return int(ctx.task.get("timeout", DEFAULT_TIMEOUT))


def _task_root(ctx):
    raw = ctx.task.get("root")
    if not raw:
        return None
    pattern = _resolve(raw, ctx)
    if any(c in pattern for c in "*?["):
        matches = glob.glob(pattern)
        return Path(matches[0]) if matches else None
    return Path(pattern)


def _staging_files(ctx, patterns=None):
    d = core.staging_dir(ctx.task["name"])
    files = [f for f in sorted(d.iterdir()) if f.is_file()]
    if not patterns:
        return files
    patterns = [core.resolve(p, ctx.local) for p in patterns]
    return [f for f in files if any(fnmatch.fnmatch(f.name, p) for p in patterns)]


def _require_staging(ctx, pattern):
    files = _staging_files(ctx, [pattern])
    return files if files else None


def _clear_staging(ctx):
    d = core.staging_dir(ctx.task["name"])
    shutil.rmtree(d, ignore_errors=True)
    d.mkdir(parents=True, exist_ok=True)


def _cleanup_tmp(tmp):
    if tmp.is_dir():
        shutil.rmtree(tmp, ignore_errors=True)
    else:
        tmp.unlink(missing_ok=True)


def _bash_script(script, *args, ctx):
    return core.sh(
        f"bash {shlex.quote(str(script))} {' '.join(shlex.quote(str(a)) for a in args)}",
        log=ctx.log,
        timeout=_timeout(ctx),
    )


def _commit(ctx, dest):
    core.git_commit(dest, f"{ctx.task['name']} · {time.ctime()}", log=ctx.log)


def _commit_and_clear(ctx, dest):
    _commit(ctx, dest)
    _clear_staging(ctx)


# ingest ---------------------------------------------------------------------


def run_ingest(ctx):
    task = ctx.task
    files = _require_staging(ctx, task["glob"])
    if not files:
        return False, f"No files matching '{task['glob']}' are queued — drop the export here first"
    dest_base = _resolve(task["dest"], ctx)
    tmp = Path(tempfile.mkdtemp(prefix="ingest_"))
    try:
        for f in files:
            ctx.log(f"Extracting {f.name}...")
            if f.name.lower().endswith(".zip"):
                rc = core.run(["unzip", "-oq", str(f), "-d", str(tmp)], log=ctx.log)
            else:
                rc = core.run(["tar", "-xf", str(f), "-C", str(tmp)], log=ctx.log)
            if rc != 0:
                return False, f"Failed to extract {f.name}"
        suffix = ""
        if task.get("identify"):
            rc, out, err = core.sh_capture(task["identify"], cwd=tmp, timeout=_timeout(ctx))
            if err.strip():
                ctx.log(err.strip())
            suffix = out.strip() if rc == 0 else ""
        dest = f"{dest_base} - {suffix}" if suffix else dest_base
        Path(dest).mkdir(parents=True, exist_ok=True)
        if core.rsync(tmp, dest, delete=True, excludes=[".git/"], log=ctx.log, timeout=_timeout(ctx)) != 0:
            return False, f"rsync failed → {dest}"
        if task.get("git", True):
            _commit_and_clear(ctx, dest)
        else:
            _clear_staging(ctx)
        return True, f"{len(files)} export(s) → {dest}"
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


# move -----------------------------------------------------------------------


def run_move(ctx):
    dest = _path(ctx, ctx.task["dest"])
    dest.mkdir(parents=True, exist_ok=True)
    if "mappings" in ctx.task:
        return _move_mappings(ctx, dest)
    return _move_renamed(ctx, dest)


def _move_mappings(ctx, dest):
    files = _staging_files(ctx)
    copied = []
    for m in ctx.task["mappings"]:
        m_glob = core.resolve(m["glob"], ctx.local)
        match = next((f for f in files if f not in copied and fnmatch.fnmatch(f.name, m_glob)), None)
        if match:
            name = core.resolve(m["name"], ctx.local)
            ctx.log(f"{match.name} → {dest / name}")
            shutil.move(str(match), str(dest / name))
            copied.append(match)
        else:
            ctx.log(f"No file matching pattern: {m_glob}")
    if not copied:
        return False, "No matching files were queued"
    _commit(ctx, dest)
    leftover = [f for f in files if f not in copied]
    if leftover:
        ctx.log(f"Keeping {len(leftover)} unmatched file(s) queued")
    else:
        _clear_staging(ctx)
    return True, f"Files → {dest}"


def _move_renamed(ctx, dest):
    task = ctx.task
    files = _require_staging(ctx, task["glob"])
    if not files:
        return False, f"No files matching '{task['glob']}' are queued — drop them here first"
    rename = core.resolve(task.get("rename_to"), ctx.local) if task.get("rename_to") else None
    if rename and len(files) > 1:
        return False, f"Multiple files match '{task['glob']}' but rename_to is set — drop one file at a time"
    for f in files:
        name = rename or f.name
        ctx.log(f"Moving {f.name} → {dest / name}")
        shutil.move(str(f), str(dest / name))
    _commit_and_clear(ctx, dest)
    return True, f"Files → {dest}"


# copy -----------------------------------------------------------------------


def run_copy(ctx):
    task = ctx.task
    dest = _path(ctx, task["dest"])
    dest.mkdir(parents=True, exist_ok=True)
    git = task.get("git", False)
    if task.get("pre"):
        core.sh(_resolve(task["pre"], ctx), log=ctx.log)
    root = _task_root(ctx) if task.get("root") else None
    if task.get("root") and root is None:
        return False, "Source directory not found"
    failed = False
    for src in task["sources"]:
        path = root / src if root is not None else _path(ctx, src)
        target = dest / path.name
        if not path.exists():
            ctx.log(f"DOES NOT EXIST: {path}")
            continue
        if core.rsync(path, target, delete=True, excludes=[".git/"] if git else (), log=ctx.log, timeout=_timeout(ctx)) != 0:
            ctx.log(f"rsync failed for {path}")
            failed = True
        elif git:
            _commit(ctx, target)
    if task.get("post"):
        core.sh(_resolve(task["post"], ctx), log=ctx.log)
    if failed:
        return False, "Some sources failed to sync"
    return True, f"Synced sources → {dest}"


# run ------------------------------------------------------------------------


def _fail(rc, tmp, timeout):
    _cleanup_tmp(tmp)
    if rc == core.TIMEOUT_RC:
        return False, f"Command timed out after {timeout}s"
    return False, f"Command failed (exit {rc})"


def run_commands(ctx):
    task = ctx.task
    capture = bool(task.get("capture"))
    if task.get("uploads") and not ctx.files:
        return False, "No files queued — drop them here first"
    for key in task.get("require", []):
        if not (ctx.extra or {}).get(key):
            return False, f"Missing required input: {key}"
    timeout = _timeout(ctx)
    tmp = Path(core.staging_dir(task["name"]) / f"tmp_{random.randrange(1000000)}")
    extra = {
        "uploads": " ".join(shlex.quote(str(f)) for f in ctx.files),
        "tmp": str(tmp),
        **{k: str(v) for k, v in (ctx.extra or {}).items()},
    }
    redact = [str(v) for v in (ctx.extra or {}).values() if v]
    ok, err = _ensure_tool(ctx, task, extra, timeout)
    if not ok:
        return False, err
    output = []
    cwd = _resolve(task.get("cwd", "."), ctx)
    if "args" in task:
        argv = _resolve_args(task["args"], ctx, extra)
        if not argv:
            return False, "Command args are empty"
        rc = core.run(argv, cwd=cwd, log=ctx.log, timeout=timeout, redact=redact)
        if rc != 0:
            return _fail(rc, tmp, timeout)
    else:
        for cmd in task.get("commands") or [task["command"]]:
            cmd = core.resolve(cmd, ctx.local, extra)
            if capture:
                rc, out, err = core.sh_capture(cmd, cwd=cwd, timeout=timeout, redact=redact)
                for line in out.splitlines():
                    ctx.log(line)
                if err.strip():
                    ctx.log(err.strip())
                output.extend(out.splitlines())
            else:
                rc = core.sh(cmd, cwd=cwd, log=ctx.log, timeout=timeout, redact=redact)
            if rc != 0:
                return _fail(rc, tmp, timeout)
    if task.get("uploads"):
        _clear_staging(ctx)
    else:
        _cleanup_tmp(tmp)
    ok, err = _check_fresh_dir(ctx, task, extra)
    if not ok:
        return False, err
    _prune_exports(ctx, task, extra)
    if capture:
        return True, "\n".join(output)
    return True, "Completed"


def _ensure_tool(ctx, task, extra, timeout):
    # download+extract the task's `tool:` if its binary is missing
    tool = task.get("tool")
    if not tool:
        return True, ""
    binary = _resolve(tool["binary"], ctx, extra)
    if not Path(binary).is_absolute():
        binary = str(Path(_resolve(tool["dir"], ctx, extra)) / binary)
    binary_path = Path(binary)
    if binary_path.exists():
        extra["tool_binary"] = binary
        return True, ""
    ctx.log(f"Downloading {binary_path.name}...")
    tool_dir = Path(_resolve(tool["dir"], ctx, extra))
    tool_dir.mkdir(parents=True, exist_ok=True)
    archive = tool_dir / "tool.tar.gz"
    steps = [f"wget -q {tool['url']} -O {shlex.quote(str(archive))}"]
    if tool.get("extract", False):
        steps += [
            f"tar xf {shlex.quote(str(archive))} -C {shlex.quote(str(tool_dir))}",
            f"rm {shlex.quote(str(archive))}",
        ]
    if tool.get("chmod", False):
        steps += [f"chmod +x {shlex.quote(str(binary_path))}"]
    if core.sh(" && ".join(steps), log=ctx.log, timeout=timeout) != 0:
        return False, f"Failed to install {binary_path.name}"
    extra["tool_binary"] = binary
    return True, ""


def _resolve_args(args, ctx, extra):
    # entries resolving empty (or to an unresolved token) are dropped along
    # with the flag preceding them (so optional `-t {{totp}}` pairs work)
    resolved = []
    for arg in args:
        value = core.resolve(arg, ctx.local, extra)
        if isinstance(value, str) and (not value.strip() or "{{" in value):
            if resolved:
                resolved.pop()
            continue
        resolved.append(str(value))
    return resolved


def _check_fresh_dir(ctx, task, extra):
    template = task.get("fresh_dir")
    if not template:
        return True, ""
    root = Path(_resolve(template, ctx, extra))
    if not root.is_dir():
        return False, f"No export directory found at {root}"
    dirs = _sorted_export_dirs(root)
    if not dirs:
        return False, "Export produced no backup directory"
    newest = dirs[-1]
    max_age = int(task.get("fresh_max_age_seconds", DAY_SECONDS))
    if not any(newest.iterdir()) or time.time() - newest.stat().st_mtime > max_age:
        return False, f"Export directory {newest.name} is empty or stale — the export did not complete"
    ctx.log(f"Validated export: {newest.name} ({len(list(newest.iterdir()))} items)")
    return True, ""


def _prune_exports(ctx, task, extra):
    cfg = task.get("prune")
    if not cfg:
        return
    root = Path(_resolve(cfg["dir"], ctx, extra))
    dirs = _sorted_export_dirs(root)
    if len(dirs) < 2:
        return
    newest_count = len(list(dirs[-1].iterdir()))
    for d in dirs[:-1]:
        count = len(list(d.iterdir()))
        if cfg.get("keep_newer") and count > newest_count:
            ctx.log(f"WARNING: previous backup '{d.name}' has MORE files ({count}) than the newest ({newest_count}). NOT deleted.")
        else:
            shutil.rmtree(d)
            ctx.log(f"Deleted old export {d.name}")


def _sorted_export_dirs(root):
    return sorted(
        (d for d in root.iterdir() if d.is_dir()),
        key=lambda d: [int(x) if x.isdigit() else x for x in re.split(r"(\d+)", d.name)],
    )


# media ----------------------------------------------------------------------


def run_media_import(ctx):
    root = _task_root(ctx)
    if root is None:
        return False, "Source directory not found"
    task = ctx.task
    delete_later = bool(task.get("delete_originals"))
    if delete_later and not ctx.extra.get(task.get("confirm_key", "confirmed")):
        return False, "Aborted by user"
    snap = task.get("snapshot")
    if snap:
        src_path = _path(ctx, snap["src"])
        dest_path = _path(ctx, snap["dest"])
        dest_path.mkdir(parents=True, exist_ok=True)
        ctx.log(f"Snapshotting {src_path} → {dest_path}...")
        if core.rsync(src_path, dest_path, log=ctx.log, timeout=_timeout(ctx)) != 0:
            return False, "Snapshot failed; originals NOT deleted"
    defaults = {
        "process_script": task.get("process_script"),
        "rm_script": task.get("rm_script"),
    }
    failed = False
    for pair in task["pairs"]:
        if not _sync_pair(ctx, root, pair, defaults, delete_later):
            failed = True
    if delete_later and not failed:
        for pair in task["pairs"]:
            src = root / pair["src"]
            if src.is_dir():
                shutil.rmtree(src, ignore_errors=True)
        return True, "Import completed; originals deleted"
    if failed:
        return False, "Some imports failed — see log"
    return True, "Media import completed"


def _sync_pair(ctx, root, pair, defaults, delete_later):
    src = root / pair["src"]
    if not src.is_dir():
        ctx.log(f"Missing source dir: {src}")
        return True
    dest = _path(ctx, pair["dest"])
    dest.mkdir(parents=True, exist_ok=True)
    pre = pair.get("pre_script")
    if pre:
        pre_args = [core.resolve(a, ctx.local) for a in pair.get("pre_args", [])]
        _bash_script(_path(ctx, pre), src, *pre_args, ctx=ctx)
    if pair.get("raw"):
        if core.rsync(src, dest, log=ctx.log, timeout=_timeout(ctx)) != 0:
            return False
    if not pair.get("process", True):
        moved = 0
        for f in src.iterdir():
            shutil.move(str(f), str(dest / f.name))
            moved += 1
        ctx.log(f"Moved {moved} file(s) from {src.name}")
        return True
    process = _path(ctx, pair.get("process_script", defaults["process_script"]))
    rm_script_raw = pair.get("rm_script", defaults.get("rm_script"))
    rm_script = _path(ctx, rm_script_raw) if rm_script_raw else None
    if rm_script:
        _bash_script(rm_script, src, dest, ctx=ctx)
    concat = _path(ctx, pair["concat_script"]) if pair.get("concat_script") else None
    ctx.log(f"Importing {src.name} → {dest}...")
    return _import_pair(ctx, src, dest, process, concat, ctx.task.get("concat_dir", "processed"), delete_later, bool(pair.get("raw")))


def _import_pair(ctx, src, dest, process, concat, concat_dir, delete_later, subdirs):
    # originals are deleted immediately unless the task defers deletion to
    # the end (delete_later); raw pairs process one pass per child dir
    targets = [d for d in sorted(src.iterdir()) if d.is_dir()] if subdirs else [src]
    for target in targets:
        if concat:
            processed = target / concat_dir
            processed.mkdir(parents=True, exist_ok=True)
            if _bash_script(concat, target, processed, ctx=ctx) != 0:
                return False
            work = processed
        else:
            work = target
        files = [f for f in work.iterdir() if f.is_file()]
        if not files:
            ctx.log(f"No files in directory, skipped: {work}")
            if concat:
                shutil.rmtree(processed, ignore_errors=True)
            continue
        tmp = Path(tempfile.mkdtemp(prefix="pam_"))
        try:
            for f in files:
                shutil.copy2(f, tmp / f.name)
            if _bash_script(process, tmp, ctx=ctx) != 0:
                ctx.log(f"Processing script failed for {work}")
                return False
            for f in tmp.iterdir():
                shutil.move(str(f), str(dest / f.name))
            if not delete_later:
                for f in files:
                    f.unlink(missing_ok=True)
        finally:
            shutil.rmtree(tmp, ignore_errors=True)
        if concat:
            shutil.rmtree(processed, ignore_errors=True)
    return True


# encrypt --------------------------------------------------------------------


def run_encrypt(ctx):
    task = ctx.task
    files = _require_staging(ctx, task["glob"])
    if not files:
        return False, "No file queued — drop the export here"
    if len(files) > 1:
        return False, f"Multiple files queued ({len(files)}) — encrypt one file at a time"
    password = ctx.extra.get("password", "")
    if not password:
        return False, "No passphrase provided"
    dest = _path(ctx, task["dest"])
    dest.mkdir(parents=True, exist_ok=True)
    out = dest / task.get("output", "backup.json")
    if core.age_encrypt_passphrase(files[0], out, password, log=ctx.log) != 0:
        return False, "age encryption failed"
    _commit_and_clear(ctx, dest)
    return True, f"Encrypted export → {out}"


# task metadata + dispatcher -------------------------------------------------


def availability(task, local):
    root_raw = task.get("root")
    if task["kind"] == "media" or root_raw:
        if not root_raw:
            return False, "Source directory not found"
        pattern = core.expand(core.resolve(root_raw, local))
        found = any(glob.glob(pattern)) if any(c in pattern for c in "*?[") else Path(pattern).is_dir()
        if not found:
            return False, "Source directory not found"
    return True, ""


def supports_uploads(task):
    return task["kind"] in ("ingest", "move", "encrypt") or (
        task["kind"] == "run" and task.get("uploads")
    )


def upload_patterns(task, local=None):
    if task["kind"] == "move" and "mappings" in task:
        patterns = [m["glob"] for m in task["mappings"]]
    else:
        patterns = [task.get("glob", "*")]
    if local is not None:
        patterns = [core.resolve(p, local) for p in patterns]
    return patterns


KINDS = {
    "ingest": run_ingest,
    "move": run_move,
    "copy": run_copy,
    "run": run_commands,
    "media": run_media_import,
    "encrypt": run_encrypt,
}


def run_task(task, local, files, log=None, extra=None):
    if log is None:
        log = Logger()
    ctx = Ctx(task=task, local=local, files=files, log=log, extra=extra or {})
    fn = KINDS.get(task["kind"])
    if fn is None:
        log(f"ERROR: unknown task kind: {task['kind']}")
        ok, summary = False, f"Unknown task kind: {task['kind']}"
    else:
        try:
            ok, summary = fn(ctx)
        except Exception as e:  # noqa: BLE001
            log(f"ERROR: {e}")
            ok, summary = False, str(e)
    core.save_task_state(task, local, ok, summary, output=log.text)
    return ok, summary


# server ---------------------------------------------------------------------


def _load_config():
    try:
        return core.load_config(), False
    except FileNotFoundError as e:
        print(f"WARNING: {e}", flush=True)
        return ({}, []), True
    except ValueError as e:
        print(f"WARNING: config error: {e}", flush=True)
        return None


def _initial_config():
    result = _load_config()
    if result is None:
        raise SystemExit("config.yaml has errors — fix it and restart")
    (LOCAL, TASK_LIST), MISSING_CONFIG = result
    return LOCAL, TASK_LIST, MISSING_CONFIG


LOCAL, TASK_LIST, MISSING_CONFIG = _initial_config()
TASK_MAP = {t["name"]: t for t in TASK_LIST}


app = FastAPI(title="backupctl", docs_url=None, redoc_url=None)


@app.middleware("http")
async def block_cross_origin(request: Request, call_next):
    # CSRF guard: reject cross-origin POSTs to /api/*
    if request.method == "POST" and request.url.path.startswith("/api/"):
        origin = request.headers.get("origin") or request.headers.get("referer")
        if origin and urlparse(origin).netloc != request.headers.get("host"):
            return JSONResponse({"detail": "cross-origin request blocked"}, status_code=403)
    return await call_next(request)


CURRENT = {"name": None, "log": [], "read": 0, "done": None, "cancelled": False}


def _queued_count(name):
    return len([p for p in core.staging_dir(name).iterdir() if p.is_file()])


def _task_json(t):
    avail, reason = availability(t, LOCAL)
    state_json = None
    marker = core.running_marker()
    if marker and marker.get("task") == t["name"]:
        # a previous run was interrupted (server stopped/crashed mid-task)
        ts = marker.get("ts", time.time())
        state_json = {"ts": ts, "ok": False, "summary": "Interrupted", "output": "",
                      "last_run_text": f"Interrupted · {core.human_ago(ts)}"}
    elif (rec := core.load_task_state(t, LOCAL)):
        ok = rec.get("ok", False)
        state_json = {"ts": rec["ts"], "ok": ok, "summary": rec.get("summary", ""),
                      "output": rec.get("output", ""),
                      "last_run_text": f"{'OK' if ok else 'FAILED'} · {core.human_ago(rec['ts'])}"}
    # staleness policy: ok(<24h) > neutral(<=7d) > fail
    pill = "fail"
    if state_json and state_json["ok"]:
        age = time.time() - state_json["ts"]
        pill = "ok" if age < 24 * 3600 else ("neutral" if age <= 7 * 86400 else "fail")
    running = CURRENT["name"] == t["name"]
    return {
        "name": t["name"],
        "group": t["group"],
        "kind": t["kind"],
        "note": t.get("note"),
        "prompts": t.get("prompts", []),
        "uploads": supports_uploads(t),
        "export_url": t.get("export_url"),
        "avail": avail,
        "avail_reason": reason,
        "queued": _queued_count(t["name"]),
        "state": state_json,
        "pill": "running" if running else pill,
        "running": running,
        "live": (CURRENT["log"][-1][:120] if running and CURRENT["log"] else ""),
    }


@app.post("/api/detect")
async def api_detect(name: str):
    # most-specific pattern wins; ties listed as `ambiguous`
    name = Path(name).name
    candidates = []
    for t in TASK_LIST:
        if not supports_uploads(t):
            continue
        for p in upload_patterns(t, LOCAL):
            if fnmatch.fnmatch(name, p):
                candidates.append({"task": t["name"], "score": sum(c not in "*?" for c in p)})
    if not candidates:
        return {"result": None}
    best = max(c["score"] for c in candidates)
    tied = [c["task"] for c in candidates if c["score"] == best]
    return {"result": {"task": tied[0], "ambiguous": tied}}


@app.get("/api/tasks")
def api_tasks():
    return {"tasks": [_task_json(t) for t in TASK_LIST], "missing_config": MISSING_CONFIG}


@app.post("/api/upload/{task_name}")
async def api_upload(task_name: str, name: str, request: Request):
    task = TASK_MAP.get(task_name)
    if task is None or not supports_uploads(task):
        raise HTTPException(404, "Unknown task")
    filename = Path(name).name
    patterns = upload_patterns(task, LOCAL)
    if not any(fnmatch.fnmatch(filename, p) for p in patterns):
        raise HTTPException(400, f"{filename} does not match the expected pattern(s): {', '.join(patterns)}")
    body = await request.body()
    staging = core.staging_dir(task_name)
    (staging / filename).write_bytes(body)
    return {"queued": filename, "count": _queued_count(task_name)}


@app.post("/api/run/{task_name}")
def api_run(task_name: str, payload: dict = Body(default={})):
    task = TASK_MAP.get(task_name)
    if task is None:
        raise HTTPException(404, "Unknown task")
    if CURRENT["name"]:
        raise HTTPException(409, "Another task is already running")
    avail, reason = availability(task, LOCAL)
    if not avail:
        raise HTTPException(400, reason)
    files = [p for p in core.staging_dir(task_name).iterdir() if p.is_file()]
    logger = Logger()
    CURRENT["name"] = task_name
    CURRENT["log"] = logger.lines
    CURRENT["read"] = 0
    CURRENT["done"] = None
    CURRENT["cancelled"] = False
    core.mark_running(task_name)

    def worker():
        ok, summary = False, "Internal error"
        try:
            ok, summary = run_task(task, LOCAL, files, logger, payload or {})
            if CURRENT["cancelled"]:
                ok, summary = False, "Cancelled by user"
                core.save_task_state(task, LOCAL, False, summary, output=logger.text)
        finally:
            CURRENT["done"] = {
                "task": task_name,
                "ok": ok,
                "summary": summary,
                "paste": bool(task.get("capture")),
            }
            CURRENT["name"] = None
            CURRENT["cancelled"] = False
            core.clear_running()

    threading.Thread(target=worker, daemon=True).start()
    return {"started": True}


@app.get("/api/status")
def api_status():
    log = CURRENT["log"]
    new_lines = log[CURRENT["read"]:]
    CURRENT["read"] = len(log)
    done = CURRENT["done"]
    CURRENT["done"] = None
    return {"running": CURRENT["name"], "log": new_lines, "done": done}


@app.post("/api/cancel")
def api_cancel():
    if not CURRENT["name"]:
        raise HTTPException(409, "No task is running")
    CURRENT["cancelled"] = True
    core.cancel_all()
    return {"cancelled": True}


@app.post("/api/paste_done/{task_name}")
def api_paste_done(task_name: str):
    task = TASK_MAP.get(task_name)
    if task is None:
        raise HTTPException(404, "Unknown task")
    commit_dir = task.get("commit_dir")
    if not commit_dir:
        return {"committed": False}
    dest = core.expand(core.resolve(commit_dir, LOCAL))
    try:
        core.git_commit(dest, f"{task_name} · {time.ctime()}")
    except Exception as e:  # noqa: BLE001
        raise HTTPException(500, f"git commit failed: {e}")
    return {"committed": True, "dest": dest}


@app.get("/")
def index():
    return FileResponse(STATIC_DIR / "index.html")


app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


def main():
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
