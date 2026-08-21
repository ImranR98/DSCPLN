"""Task engines: the eight generic "kinds" and the plumbing around them.

File layout:
  constants · Logger · Ctx
  shared helpers        resolution, paths, staging, extraction, bash scripts,
                        git commits, tmp cleanup
  kind: ingest          drop a cloud export archive
  kind: move            move dropped files (renamed, or per mapping)
  kind: copy            rsync configured sources into a backup dir
  kind: run             execute shell command(s) with generic tool/fresh/prune options
  kind: media           import + standardize media from a source root
  kind: archive         snapshot + standardize media, delete originals on success
  kind: encrypt         age-encrypt a dropped file
  kind: remote          run a script on a remote host and pull its results
  task metadata         availability, upload support, drop patterns
  dispatcher            KINDS table + run_task

Kinds are generic engines: every service-specific detail lives in the task
config (paths, scripts, hosts, prompts). Task configs stay plain dicts from
config.yaml; paths in task fields are {{token}} strings resolved with
_resolve/_path.
"""

import fnmatch
import glob
import random
import re
import shlex
import shutil
import tempfile
import time
from dataclasses import dataclass, field
from pathlib import Path
from . import config, shell, state

DEFAULT_TIMEOUT = 600  # seconds, per task; overridable via task config "timeout"
DAY_SECONDS = 86400


class Logger:
    """Callable that collects log lines."""

    def __init__(self):
        """Start with an empty line buffer."""
        self.lines = []

    def __call__(self, line):
        """Append one log line."""
        self.lines.append(line)

    @property
    def text(self):
        """All log lines joined with newlines."""
        return "\n".join(self.lines)


@dataclass
class Ctx:
    """Per-run context passed to task kinds."""
    task: dict
    local: dict
    files: list = field(default_factory=list)
    log: callable = field(default_factory=Logger)
    extra: dict = field(default_factory=dict)


# ---------------------------------------------------------------------------
# shared helpers
# ---------------------------------------------------------------------------

def _resolve(template, ctx, extra=None):
    """Resolve {{tokens}} (local config + per-run extras), then expand ~/$ENV."""
    return config.expand(config.resolve(template, ctx.local, extra))


def _path(ctx, template):
    """A task config path string, fully resolved."""
    return Path(_resolve(template, ctx))


def _timeout(ctx):
    """Task timeout in seconds (config `timeout` or the default)."""
    return int(ctx.task.get("timeout", DEFAULT_TIMEOUT))


def _rand_tag():
    """Short random number for unique temp names."""
    return random.randrange(1000000)


def _task_root(ctx):
    """Resolve a task's source root (config field `root`).
    Supports glob patterns (e.g. MTP mounts); returns Path or None."""
    raw = ctx.task.get("root")
    if not raw:
        return None
    pattern = _resolve(raw, ctx)
    if any(c in pattern for c in "*?["):
        matches = glob.glob(pattern)
        return Path(matches[0]) if matches else None
    return Path(pattern)


def _staging_files(ctx, patterns=None):
    """Uploaded files for the task, optionally filtered by resolved globs."""
    d = state.staging_dir(ctx.task["name"])
    files = [f for f in sorted(d.iterdir()) if f.is_file()]
    if not patterns:
        return files
    patterns = [config.resolve(p, ctx.local) for p in patterns]
    return [f for f in files if any(fnmatch.fnmatch(f.name, p) for p in patterns)]


def _require_staging(ctx, pattern):
    """Staged files filtered by a resolved glob, or None when empty."""
    files = _staging_files(ctx, [pattern])
    return files if files else None


def _clear_staging(ctx):
    """Remove everything in the task's staging dir."""
    d = state.staging_dir(ctx.task["name"])
    shutil.rmtree(d, ignore_errors=True)
    d.mkdir(parents=True, exist_ok=True)


def _cleanup_tmp(tmp):
    """Delete the per-run {{tmp}} file or directory."""
    if tmp.is_dir():
        shutil.rmtree(tmp, ignore_errors=True)
    else:
        tmp.unlink(missing_ok=True)


def _extract_archive(f, dest, ctx):
    """Extract a zip/tar archive into dest; returns rc."""
    if f.name.lower().endswith(".zip"):
        return shell.run(["unzip", "-oq", str(f), "-d", str(dest)], log=ctx.log)
    return shell.run(["tar", "-xf", str(f), "-C", str(dest)], log=ctx.log)


def _bash_script(script, *args, ctx):
    """Run a bash script with quoted args; returns rc."""
    return shell.sh(
        f"bash {shlex.quote(str(script))} {' '.join(shlex.quote(str(a)) for a in args)}",
        log=ctx.log,
        timeout=_timeout(ctx),
    )


def _commit(ctx, dest):
    """git commit dest with the task's standard message."""
    shell.git_commit(dest, f"{ctx.task['name']} · {time.ctime()}", log=ctx.log)


def _commit_and_clear(ctx, dest):
    """Epilogue shared by drop-based kinds: git commit, then clear staging."""
    _commit(ctx, dest)
    _clear_staging(ctx)


# ---------------------------------------------------------------------------
# kind: ingest — drop a cloud export archive
# ---------------------------------------------------------------------------

def run_ingest(ctx):
    """Drop a cloud export: extract, optional identify-suffix, rsync into dest, git commit."""
    task = ctx.task
    files = _require_staging(ctx, task["glob"])
    if not files:
        return False, f"No files matching '{task['glob']}' are queued — drop the export here first"
    dest_base = _resolve(task["dest"], ctx)
    tmp = Path(tempfile.mkdtemp(prefix="ingest_"))
    try:
        for f in files:
            ctx.log(f"Extracting {f.name}...")
            if _extract_archive(f, tmp, ctx) != 0:
                return False, f"Failed to extract {f.name}"
        suffix = _identify_suffix(task, tmp, ctx)
        dest = f"{dest_base} - {suffix}" if suffix else dest_base
        Path(dest).mkdir(parents=True, exist_ok=True)
        if shell.rsync(tmp, dest, delete=True, excludes=[".git/"], log=ctx.log, timeout=_timeout(ctx)) != 0:
            return False, f"rsync failed → {dest}"
        if task.get("git", True):
            _commit_and_clear(ctx, dest)
        else:
            _clear_staging(ctx)
        return True, f"{len(files)} export(s) → {dest}"
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def _identify_suffix(task, tmp, ctx):
    """Run the identify command inside the extracted tree; returns the suffix."""
    if not task.get("identify"):
        return ""
    rc, out, err = shell.sh_capture(task["identify"], cwd=tmp, timeout=_timeout(ctx))
    if err.strip():
        ctx.log(err.strip())
    return out.strip() if rc == 0 else ""


# ---------------------------------------------------------------------------
# kind: move — move dropped files (renamed, or per mapping)
# ---------------------------------------------------------------------------

def run_move(ctx):
    """Move dropped files into dest (rename_to, or per-mapping renames), git commit."""
    dest = _path(ctx, ctx.task["dest"])
    dest.mkdir(parents=True, exist_ok=True)
    if "mappings" in ctx.task:
        return _move_mappings(ctx, dest)
    return _move_renamed(ctx, dest)


def _move_mappings(ctx, dest):
    """Move staged files per mappings list; unmatched files stay queued."""
    files = _staging_files(ctx)
    copied = []
    for m in ctx.task["mappings"]:
        m_glob = config.resolve(m["glob"], ctx.local)
        match = next((f for f in files if f not in copied and fnmatch.fnmatch(f.name, m_glob)), None)
        if match:
            name = config.resolve(m["name"], ctx.local)
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
    """Move staged files into dest, optionally under one fixed name."""
    task = ctx.task
    files = _require_staging(ctx, task["glob"])
    if not files:
        return False, f"No files matching '{task['glob']}' are queued — drop them here first"
    rename = config.resolve(task.get("rename_to"), ctx.local) if task.get("rename_to") else None
    if rename and len(files) > 1:
        return False, f"Multiple files match '{task['glob']}' but rename_to is set — drop one file at a time"
    for f in files:
        name = rename or f.name
        ctx.log(f"Moving {f.name} → {dest / name}")
        shutil.move(str(f), str(dest / name))
    _commit_and_clear(ctx, dest)
    return True, f"Files → {dest}"


# ---------------------------------------------------------------------------
# kind: copy — rsync configured sources into a backup dir
# ---------------------------------------------------------------------------

def run_copy(ctx):
    """rsync each configured source into dest (optional task root, git, pre/post)."""
    task = ctx.task
    dest = _path(ctx, task["dest"])
    dest.mkdir(parents=True, exist_ok=True)
    git = task.get("git", False)
    _run_hook(ctx, task.get("pre"))
    root = _task_root(ctx) if task.get("root") else None
    if task.get("root") and root is None:
        return False, "Source directory not found"
    failed = False
    for src in task["sources"]:
        path = root / src if root is not None else _path(ctx, src)
        if not _sync_source(ctx, path, dest / path.name, git):
            failed = True
    _run_hook(ctx, task.get("post"))
    if failed:
        return False, "Some sources failed to sync"
    return True, f"Synced sources → {dest}"


def _run_hook(ctx, hook):
    """Run an optional pre/post shell command."""
    if hook:
        shell.sh(_resolve(hook, ctx), log=ctx.log)


def _sync_source(ctx, path, target, git):
    """rsync one source into its target; returns True unless rsync failed."""
    if not path.exists():
        ctx.log(f"DOES NOT EXIST: {path}")
        return True
    if shell.rsync(path, target, delete=True, excludes=[".git/"] if git else (), log=ctx.log, timeout=_timeout(ctx)) != 0:
        ctx.log(f"rsync failed for {path}")
        return False
    if git:
        _commit(ctx, target)
    return True


# ---------------------------------------------------------------------------
# kind: run — execute shell command(s)
# ---------------------------------------------------------------------------

def run_commands(ctx):
    """Execute shell command(s). Generic options: `capture: true` (output
    becomes the summary, shown in the paste dialog), `uploads: true` (dropped
    files required, available as {{uploads}}), `args:` (argv list; empty
    values drop their flag pair), `tool:` (download+extract a CLI if its
    binary is missing, exposed as {{tool_binary}}), `fresh_dir:` (validate
    the newest export dir is non-empty and fresh), `prune:` (delete older
    export dirs, optionally keeping any larger than the newest). Prompt
    secrets are redacted from the log."""
    task = ctx.task
    capture = bool(task.get("capture"))
    if task.get("uploads") and not ctx.files:
        return False, "No files queued — drop them here first"
    for key in task.get("require", []):
        if not (ctx.extra or {}).get(key):
            return False, f"Missing required input: {key}"
    timeout = _timeout(ctx)
    tmp = Path(state.staging_dir(task["name"]) / f"tmp_{_rand_tag()}")
    extra = _tokens(ctx, tmp)
    redact = [str(v) for v in (ctx.extra or {}).values() if v]
    ok, err = _ensure_tool(ctx, task, extra, timeout)
    if not ok:
        return False, err
    output = []
    if "args" in task:
        argv = _resolve_args(task["args"], ctx, extra)
        if not argv:
            return False, "Command args are empty"
        rc = shell.run(argv, cwd=_resolve(task.get("cwd", "."), ctx), log=ctx.log, timeout=timeout, redact=redact)
        if rc != 0:
            _cleanup_tmp(tmp)
            if rc == shell.TIMEOUT_RC:
                return False, f"Command timed out after {timeout}s"
            return False, f"Command failed (exit {rc})"
    else:
        for cmd in _commands(task):
            cmd = config.resolve(cmd, ctx.local, extra)
            cwd = _resolve(task.get("cwd", "."), ctx)
            if capture:
                rc, out, err = shell.sh_capture(cmd, cwd=cwd, timeout=timeout, redact=redact)
                for line in out.splitlines():
                    ctx.log(line)
                if err.strip():
                    ctx.log(err.strip())
                output.extend(out.splitlines())
            else:
                rc = shell.sh(cmd, cwd=cwd, log=ctx.log, timeout=timeout, redact=redact)
            if rc != 0:
                _cleanup_tmp(tmp)
                if rc == shell.TIMEOUT_RC:
                    return False, f"Command timed out after {timeout}s"
                return False, f"Command failed (exit {rc})"
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


def _commands(task):
    """The task's shell commands (list `commands`, or a single `command`)."""
    return task.get("commands") or [task["command"]]


def _tokens(ctx, tmp):
    """Token values for run commands: {{uploads}}, {{tmp}}, and prompt extras."""
    return {
        "uploads": " ".join(shlex.quote(str(f)) for f in ctx.files),
        "tmp": str(tmp),
        **{k: str(v) for k, v in (ctx.extra or {}).items()},
    }


def _ensure_tool(ctx, task, extra, timeout):
    """Download+extract the task's `tool:` if its binary is missing;
    exposes the binary path as {{tool_binary}}."""
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
    if shell.sh(" && ".join(steps), log=ctx.log, timeout=timeout) != 0:
        return False, f"Failed to install {binary_path.name}"
    extra["tool_binary"] = binary
    return True, ""


def _resolve_args(args, ctx, extra):
    """Resolve an argv list; entries resolving empty (or to an unresolved
    token) are dropped along with the flag preceding them (so optional
    `-t {{totp}}` pairs work)."""
    resolved = []
    for arg in args:
        value = config.resolve(arg, ctx.local, extra)
        if isinstance(value, str) and (not value.strip() or "{{" in value):
            if resolved:
                resolved.pop()
            continue
        resolved.append(str(value))
    return resolved


def _check_fresh_dir(ctx, task, extra):
    """Validate the newest subdir of `fresh_dir:` is non-empty and fresh."""
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
    """Prune older export dirs under `prune.dir`, keeping any (when
    `keep_newer` is set) that hold more files than the newest."""
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
    """Subdirs sorted naturally (Export-2 before Export-10)."""
    return sorted(
        (d for d in root.iterdir() if d.is_dir()),
        key=lambda d: [int(x) if x.isdigit() else x for x in re.split(r"(\d+)", d.name)],
    )


# ---------------------------------------------------------------------------
# kind: media — import + standardize media from a source root
# ---------------------------------------------------------------------------

def _process_and_move(process_script, src, dest, ctx):
    """Copy a dir's files to a temp dir, run the process script on them,
    move the results to dest, and delete the originals."""
    files = [f for f in src.iterdir() if f.is_file()]
    if not files:
        ctx.log(f"No files in directory, skipped: {src}")
        return True
    dest.mkdir(parents=True, exist_ok=True)
    tmp = Path(tempfile.mkdtemp(prefix="pam_"))
    try:
        for f in files:
            shutil.copy2(f, tmp / f.name)
        if _bash_script(process_script, tmp, ctx=ctx) != 0:
            ctx.log(f"Processing script failed for {src}")
            return False
        for f in tmp.iterdir():
            shutil.move(str(f), str(dest / f.name))
        for f in files:
            f.unlink(missing_ok=True)
        return True
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def _sync_pair(ctx, root, pair, defaults):
    """One media pair: optional pre script, optional delete-synced, then
    standardize-and-move (or plain move when `process: false`)."""
    src = root / pair["src"]
    if not src.is_dir():
        ctx.log(f"Missing source dir: {src}")
        return True
    dest = _path(ctx, pair["dest"])
    pre = pair.get("pre_script")
    if pre:
        pre_args = [config.resolve(a, ctx.local) for a in pair.get("pre_args", [])]
        _bash_script(_path(ctx, pre), src, *pre_args, ctx=ctx)
    if not pair.get("process", True):
        dest.mkdir(parents=True, exist_ok=True)
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
    ctx.log(f"Importing {src.name} → {dest}...")
    return _process_and_move(process, src, dest, ctx)


def run_media_import(ctx):
    """Media import: for each `pairs:` entry, run its optional pre script,
    delete already-synced files, then standardize and move the rest (plain
    move when `process: false`). Scripts come from the task's
    `process_script`/`rm_script` fields, overridable per pair."""
    root = _task_root(ctx)
    if root is None:
        return False, "Source directory not found"
    task = ctx.task
    defaults = {
        "process_script": task.get("process_script"),
        "rm_script": task.get("rm_script"),
    }
    failed = False
    for pair in task["pairs"]:
        if not _sync_pair(ctx, root, pair, defaults):
            failed = True
    if failed:
        return False, "Some imports failed — see log"
    return True, "Media import completed"


# ---------------------------------------------------------------------------
# kind: archive — snapshot a source, standardize its media subdirs, then
# delete the originals only if every step succeeded
# ---------------------------------------------------------------------------

def _standardize_subdirs(ctx, media_root, out_root, process, concat=None, concat_dir="processed"):
    """For each subdir of media_root: standardize its contents into out_root.
    With concat set, segments are first concatenated into a per-subdir
    <concat_dir>/ directory."""
    out_root.mkdir(parents=True, exist_ok=True)
    for entry in sorted(media_root.iterdir()):
        if not entry.is_dir():
            continue
        if concat:
            processed = entry / concat_dir
            processed.mkdir(parents=True, exist_ok=True)
            if _bash_script(concat, entry, processed, ctx=ctx) != 0:
                return False
            if _bash_script(process, processed, ctx=ctx) != 0:
                return False
            for f in processed.iterdir():
                shutil.move(str(f), str(out_root / f.name))
            shutil.rmtree(processed, ignore_errors=True)
        elif not _process_and_move(process, entry, out_root, ctx):
            return False
    return True


def run_archive(ctx):
    """Snapshot src_dir into dest, standardize its media subdirs into
    out_dir, then delete the originals — only if every step succeeded."""
    task = ctx.task
    src = _path(ctx, task["src_dir"])
    if not src.is_dir():
        return False, f"Source directory not found: {src}"
    if not ctx.extra.get(task.get("confirm_key", "confirmed")):
        return False, "Aborted by user"
    archive = _path(ctx, task["dest"])
    ok, err = _copy_snapshot(ctx, src, archive)
    if not ok:
        return False, err
    out = _path(ctx, task["out_dir"])
    process = _path(ctx, task["process_script"])
    media = src / task.get("media_dir", "Media")
    ok, err = _archive_subdirs(ctx, media, out, process)
    if not ok:
        return False, err
    shutil.rmtree(media, ignore_errors=True)
    return True, "Archive completed; originals deleted"


def _copy_snapshot(ctx, src, archive):
    """Snapshot src_dir into the archive via a temp copy."""
    tmp = Path(tempfile.mkdtemp(prefix="arc_"))
    try:
        shutil.copytree(src, tmp / src.name)
        archive.mkdir(parents=True, exist_ok=True)
        if shell.rsync(tmp / src.name, archive, log=ctx.log, timeout=_timeout(ctx)) != 0:
            return False, "Archive copy failed; originals NOT deleted"
        return True, ""
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def _archive_subdirs(ctx, media, out, process):
    """Rsync each configured media subdir into out, then standardize the
    live copies (concat first for subdirs with a concat_script)."""
    task = ctx.task
    for sub in task.get("subdirs", []):
        s = media / sub["name"]
        if not s.is_dir():
            continue
        (out / sub["name"]).mkdir(parents=True, exist_ok=True)
        if shell.rsync(s, out / sub["name"], log=ctx.log, timeout=_timeout(ctx)) != 0:
            return False, "Media copy failed; originals NOT deleted"
        concat = _path(ctx, sub["concat_script"]) if sub.get("concat_script") else None
        if not _standardize_subdirs(ctx, s, out / sub["name"], process, concat, task.get("concat_dir", "processed")):
            return False, "Media processing failed; originals NOT deleted"
    return True, ""


# ---------------------------------------------------------------------------
# kind: encrypt — age-encrypt a dropped file
# ---------------------------------------------------------------------------

def run_encrypt(ctx):
    """age-encrypt the dropped file with a prompted passphrase, then git commit."""
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
    if shell.age_encrypt_passphrase(files[0], out, password, log=ctx.log) != 0:
        return False, "age encryption failed"
    _commit_and_clear(ctx, dest)
    return True, f"Encrypted export → {out}"


# ---------------------------------------------------------------------------
# kind: remote — run a script on a remote host and pull its results
# ---------------------------------------------------------------------------

def run_remote(ctx):
    """Push `script` to a remote host, run it once per `args` entry, pull
    the results into `dest`, and clean up the remote temp dirs."""
    task = ctx.task
    host = config.resolve(task["host"], ctx.local)
    if not isinstance(host, dict) or not host.get("host"):
        return False, "Remote host is not configured in config.yaml"
    if not host.get("user"):
        return False, "Remote user is not configured in config.yaml"
    args_entries = config.resolve(task["args"], ctx.local)
    if not isinstance(args_entries, list) or not args_entries:
        return False, "Remote args are not configured in config.yaml"
    script = _path(ctx, task["script"])
    if not script.is_file():
        return False, f"Script not found: {script}"
    dest = _path(ctx, task["dest"])
    dest.mkdir(parents=True, exist_ok=True)
    extra = {"tag": str(_rand_tag()), **{k: str(v) for k, v in (ctx.extra or {}).items()}}
    remote_tmp = _resolve(task["remote_tmp"], ctx, extra)
    remote_out = _resolve(task["remote_out"], ctx, extra)
    home = f"/home/{host['user']}"
    try:
        if _ssh_run(ctx, host, f"mkdir -p {_remote_path(remote_tmp, home)}") != 0:
            return False, "Could not reach remote host"
        if shell.rsync(script, f"{host['user']}@{host['host']}:{remote_tmp}/", ssh=_ssh_opt(host.get("port", 22)), log=ctx.log, timeout=_timeout(ctx)) != 0:
            return False, "Failed to copy script to remote host"
        for entry in args_entries:
            rc = _ssh_run(
                ctx, host,
                f"cd {_remote_path(remote_tmp, home)} && bash ./{shlex.quote(script.name)} "
                f"{_remote_path(entry, home)} {_remote_path(remote_out, home)}",
            )
            if rc != 0:
                return False, f"Remote run failed for {entry} (exit {rc})"
        if task.get("pull", True):
            if shell.rsync(f"{host['user']}@{host['host']}:{remote_out}/", dest, ssh=_ssh_opt(host.get("port", 22)), log=ctx.log, timeout=_timeout(ctx)) != 0:
                return False, "Failed to pull results from remote host"
        return True, f"Results → {dest}"
    finally:
        _ssh_run(ctx, host, f"rm -rf {_remote_path(remote_tmp, home)} {_remote_path(remote_out, home)}")


def _ssh_opt(port):
    """rsync -e ssh option string (non-interactive)."""
    return f"ssh -p {port} -o BatchMode=yes -o StrictHostKeyChecking=no"


def _ssh_run(ctx, host, remote_cmd):
    """Run a shell command on the host over SSH; returns rc."""
    return shell.run(
        ["ssh", "-p", str(host.get("port", 22)), f"{host['user']}@{host['host']}", remote_cmd],
        log=ctx.log,
        timeout=_timeout(ctx),
    )


def _remote_path(path, home):
    """Quote a path for the remote shell, expanding a leading ~ to home."""
    if path.startswith("~"):
        path = home + path[1:]
    return shlex.quote(path)


# ---------------------------------------------------------------------------
# task metadata
# ---------------------------------------------------------------------------

def availability(task, local):
    """Return (available, reason) for a task on this machine."""
    root_raw = task.get("root")
    if task["kind"] == "media" or root_raw:
        if not root_raw:
            return False, "Source directory not found"
        pattern = config.expand(config.resolve(root_raw, local))
        found = any(glob.glob(pattern)) if any(c in pattern for c in "*?[") else Path(pattern).is_dir()
        if not found:
            return False, "Source directory not found"
    if task.get("host"):
        h = config.resolve(task["host"], local)
        if not isinstance(h, dict) or not h.get("host"):
            return False, "host not configured"
    return True, ""


def supports_uploads(task):
    """Does the task accept dropped files?"""
    return task["kind"] in ("ingest", "move", "encrypt") or (
        task["kind"] == "run" and task.get("uploads")
    )


def upload_patterns(task, local=None):
    """Filename globs accepted by the task (token-resolved when local given)."""
    if task["kind"] == "move" and "mappings" in task:
        patterns = [m["glob"] for m in task["mappings"]]
    else:
        patterns = [task.get("glob", "*")]
    if local is not None:
        patterns = [config.resolve(p, local) for p in patterns]
    return patterns


# ---------------------------------------------------------------------------
# dispatcher
# ---------------------------------------------------------------------------

KINDS = {
    "ingest": run_ingest,
    "move": run_move,
    "copy": run_copy,
    "run": run_commands,
    "media": run_media_import,
    "archive": run_archive,
    "encrypt": run_encrypt,
    "remote": run_remote,
}


def run_task(task, local, files, log=None, extra=None):
    """Run one task. Returns (ok, summary)."""
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
    state.save_task_state(task, local, ok, summary, output=log.text)
    return ok, summary
