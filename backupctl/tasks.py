"""Task engines: the nine generic "kinds" and the plumbing around them.

File layout:
  constants · Logger · Ctx
  shared helpers        resolution, paths, staging, extraction, bash scripts,
                        git commits, tmp cleanup
  kind: ingest          drop a cloud export archive
  kind: move            move dropped files (renamed, or per mapping)
  kind: copy            rsync configured sources into a backup dir
  kind: run             execute shell command(s)
  kind: media           import + standardize media from a source root
  kind: archive         chat-app archive + media standardization
  kind: encrypt         age-encrypt a dropped file
  kind: winesaves       remote game-save backup over SSH
  kind: proton          ProtonMail export CLI + prune older exports
  task metadata         availability, upload support, drop patterns
  dispatcher            KINDS table + run_task

Task configs stay plain dicts from config.yaml; paths in task fields are
{{token}} strings resolved with _resolve/_path.
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


def _task_root(ctx, default_token="phone_sync_dir"):
    """Resolve a task's source root (config field `root`, or a default token).
    Supports glob patterns (e.g. MTP mounts); returns Path or None."""
    raw = ctx.task.get("root") or "{{%s}}" % default_token
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
    """Execute shell command(s). With `capture: true` the output becomes the
    summary (shown in the paste dialog); with `uploads: true` dropped files
    are required and available as {{uploads}}."""
    task = ctx.task
    capture = bool(task.get("capture"))
    if task.get("uploads") and not ctx.files:
        return False, "No files queued — drop them here first"
    timeout = _timeout(ctx)
    tmp = Path(state.staging_dir(task["name"]) / f"tmp_{_rand_tag()}")
    extra = _tokens(ctx, tmp)
    output = []
    for cmd in _commands(task):
        cmd = config.resolve(cmd, ctx.local, extra)
        cwd = _resolve(task.get("cwd", "."), ctx)
        if capture:
            rc, out, err = shell.sh_capture(cmd, cwd=cwd, timeout=timeout)
            for line in out.splitlines():
                ctx.log(line)
            if err.strip():
                ctx.log(err.strip())
            output.extend(out.splitlines())
        else:
            rc = shell.sh(cmd, cwd=cwd, log=ctx.log, timeout=timeout)
        if rc != 0:
            _cleanup_tmp(tmp)
            if rc == shell.TIMEOUT_RC:
                return False, f"Command timed out after {timeout}s"
            return False, f"Command failed (exit {rc})"
    if task.get("uploads"):
        _clear_staging(ctx)
    else:
        _cleanup_tmp(tmp)
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


def _sync_pair(process_script, rm_script, src, dest, ctx):
    """One media pair: delete already-synced files, then process+move the rest."""
    if not src.is_dir():
        ctx.log(f"Missing source dir: {src}")
        return True
    if rm_script:
        _bash_script(rm_script, src, dest, ctx=ctx)
    ctx.log(f"Importing {src.name} → {dest}...")
    return _process_and_move(process_script, src, dest, ctx)


def _import_pairs(ctx, root, pairs, main, process, rm_script):
    """Run _sync_pair for every pair of a media task; returns success."""
    ok = True
    for sub, dest_rel in pairs:
        if not _sync_pair(process, rm_script, root / sub, main / dest_rel, ctx):
            ok = False
    return ok


def run_media_import(ctx):
    """Media import: for each `pairs:` entry, delete already-synced files,
    then copy, standardize, and move. Optional `snaps:` (concat then import)
    and `calls:` (move recordings) blocks extend the phone flow."""
    root = _task_root(ctx)
    if root is None:
        return False, "Source directory not found"
    main = _path(ctx, "{{maindir}}")
    process = _path(ctx, "{{media_process_script}}")
    rm_script = _path(ctx, "{{media_rm_script}}")
    failed = not _import_pairs(ctx, root, ctx.task["pairs"], main, process, rm_script)
    failed = _import_snaps(ctx, root, main, process) or failed
    _import_calls(ctx, root, main)
    if failed:
        return False, "Some imports failed — see log"
    return True, "Media import completed"


def _import_snaps(ctx, root, main, process):
    """Snaps block: concat short clips (moving raw mp4s aside), then import."""
    snaps = ctx.task.get("snaps")
    if not snaps:
        return False
    s = root / snaps["src"]
    if not s.is_dir():
        return False
    failed = False
    concat = _path(ctx, snaps["concat_script"])
    if _bash_script(concat, s, ctx=ctx) == 0:
        deletable = _path(ctx, "{{snaps_deletable_dir}}")
        deletable.mkdir(parents=True, exist_ok=True)
        for f in s.glob("*.mp4"):
            shutil.move(str(f), str(deletable / f.name))
    if not _process_and_move(process, s, main / config.resolve(snaps["dest"], ctx.local), ctx):
        failed = True
    return failed


def _import_calls(ctx, root, main):
    """Calls block: move call recordings into their destination folder."""
    calls = ctx.task.get("calls")
    if not calls:
        return
    c = root / calls["src"]
    if not c.is_dir():
        return
    dest = main / config.resolve(calls["dest"], ctx.local)
    dest.mkdir(parents=True, exist_ok=True)
    moved = 0
    for f in c.iterdir():
        shutil.move(str(f), str(dest / f.name))
        moved += 1
    ctx.log(f"Moved {moved} call recordings")


# ---------------------------------------------------------------------------
# kind: archive — chat-app archive + media standardization
# ---------------------------------------------------------------------------

def _standardize_subdirs(ctx, media_root, out_root, process, concat=None):
    """For each subdir of media_root: standardize its contents into out_root.
    With concat set, audio segments are first concatenated into a per-chat processed/ dir."""
    out_root.mkdir(parents=True, exist_ok=True)
    for entry in sorted(media_root.iterdir()):
        if not entry.is_dir():
            continue
        if concat:
            processed = entry / "processed"
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
    """Copy the live chat folder into dest, standardize media into
    wamedia_dir, then delete the originals — only if every step succeeded.
    src_dir, media_dirs and audio_dir come from the task config."""
    task = ctx.task
    src = _path(ctx, task["src_dir"])
    if not src.is_dir():
        return False, f"Active chat directory not found: {src}"
    if not ctx.extra.get("confirmed"):
        return False, "Aborted by user"
    archive = _path(ctx, task["dest"])
    ok, err = _copy_live_chat(ctx, src, archive)
    if not ok:
        return False, err
    out = _path(ctx, "{{wamedia_dir}}")
    process = _path(ctx, "{{media_process_script}}")
    media = src / task.get("media_root", "Media")
    ok, err = _archive_media_dirs(ctx, media, out, process)
    if not ok:
        return False, err
    ok, err = _archive_voice_notes(ctx, media, out, process)
    if not ok:
        return False, err
    shutil.rmtree(media, ignore_errors=True)
    return True, "Chat archive completed; originals deleted"


def _copy_live_chat(ctx, src, archive):
    """Snapshot the live chat dir into the archive via a temp copy."""
    tmp = Path(tempfile.mkdtemp(prefix="arc_"))
    try:
        shutil.copytree(src, tmp / src.name)
        archive.mkdir(parents=True, exist_ok=True)
        if shell.rsync(tmp / src.name, archive, log=ctx.log, timeout=_timeout(ctx)) != 0:
            return False, "Archive copy failed; originals NOT deleted"
        return True, ""
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def _archive_media_dirs(ctx, media, out, process):
    """Rsync each media subdir into out, then standardize the live copies."""
    for sub in ctx.task.get("media_dirs", []):
        s = media / sub
        if not s.is_dir():
            continue
        (out / sub).mkdir(parents=True, exist_ok=True)
        if shell.rsync(s, out / sub, log=ctx.log, timeout=_timeout(ctx)) != 0:
            return False, "Media copy failed; originals NOT deleted"
        if not _standardize_subdirs(ctx, s, out / sub, process):
            return False, "Media processing failed; originals NOT deleted"
    return True, ""


def _archive_voice_notes(ctx, media, out, process):
    """Rsync voice notes into out, then concat+standardize per chat."""
    task = ctx.task
    audio = task.get("audio_dir")
    if not audio:
        return True, ""
    vn = media / audio
    if not vn.is_dir():
        return True, ""
    (out / audio).mkdir(parents=True, exist_ok=True)
    if shell.rsync(vn, out / audio, log=ctx.log, timeout=_timeout(ctx)) != 0:
        return False, "Voice notes copy failed; originals NOT deleted"
    if not task.get("audio_concat_script"):
        return False, "audio_concat_script is not configured; originals NOT deleted"
    concat = _path(ctx, task["audio_concat_script"])
    if not _standardize_subdirs(ctx, vn, out / audio, process, concat):
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
# kind: winesaves — remote game-save backup over SSH
# ---------------------------------------------------------------------------

def run_winesaves(ctx):
    """Push the backup script to hosts.bigpc, run it once per games dir, pull results back."""
    host = ctx.local.get("hosts", {}).get("bigpc", {})
    user, hostname, port = host.get("user"), host.get("host"), host.get("port", 22)
    games_dirs = host.get("games_dirs", [])
    if not hostname:
        return False, "bigpc host is not configured in config.yaml"
    if not user:
        return False, "bigpc user is not configured in config.yaml"
    if not games_dirs:
        return False, "bigpc games_dirs is not configured in config.yaml"
    pref = _rand_tag()
    script = _path(ctx, "{{wine_backup_script}}")
    if not script.is_file():
        return False, f"wine_backup_script not found: {script}"
    dest = _path(ctx, ctx.task["dest"])
    dest.mkdir(parents=True, exist_ok=True)
    home = f"/home/{user}"
    remote_tmp = f"/tmp/{pref}_backup"
    remote_out = f"{home}/Downloads/{pref}_gamehomebak"
    try:
        if _ssh_run(ctx, host, f"mkdir -p {_remote_path(remote_tmp, home)}") != 0:
            return False, "Could not reach bigpc"
        if shell.rsync(script, f"{user}@{hostname}:{remote_tmp}/", ssh=_ssh_opt(port), log=ctx.log, timeout=_timeout(ctx)) != 0:
            return False, "Failed to copy script to bigpc"
        for games in games_dirs:
            rc = _ssh_run(
                ctx, host,
                f"cd {_remote_path(remote_tmp, home)} && bash ./{shlex.quote(script.name)} "
                f"{_remote_path(games, home)} {_remote_path(remote_out, home)}",
            )
            if rc != 0:
                return False, f"Remote backup failed for {games} (exit {rc})"
        if shell.rsync(f"{user}@{hostname}:{remote_out}/", dest, ssh=_ssh_opt(port), log=ctx.log, timeout=_timeout(ctx)) != 0:
            return False, "Failed to pull backups from bigpc"
        return True, f"Game saves → {dest}"
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
# kind: proton — ProtonMail export CLI + prune older exports
# ---------------------------------------------------------------------------

def run_proton(ctx):
    """ProtonMail export: download the CLI if needed, run with prompted
    credentials, validate the fresh export, and prune older ones."""
    task = ctx.task
    email = _resolve("{{protonmail_email}}", ctx)
    if not email:
        return False, "protonmail_email is not configured in config.yaml"
    password = ctx.extra.get("password", "")
    totp = ctx.extra.get("totp", "")
    if not password:
        return False, "No password provided"
    cli, err = _ensure_proton_cli(ctx)
    if cli is None:
        return False, err
    dest = _path(ctx, task["dest"])
    args = [str(cli), "-k", "-o", "backup", "-d", str(dest), "-u", email, "-p", password]
    if totp:
        args += ["-t", totp]
    rc = shell.run(args, log=ctx.log, timeout=_timeout(ctx), redact=[password, totp])
    if rc != 0:
        if rc == shell.TIMEOUT_RC:
            return False, f"ProtonMail export timed out after {_timeout(ctx)}s"
        return False, f"ProtonMail export failed (exit {rc})"
    export_root = dest / email
    if not export_root.is_dir():
        return False, f"No export directory found at {export_root}"
    dirs = _sorted_exports(export_root)
    if not dirs:
        return False, "Export produced no backup directory"
    ok, err = _validate_newest(ctx, dirs)
    if not ok:
        return False, err
    _prune_exports(ctx, dirs)
    return True, f"Emails → {dest}"


def _ensure_proton_cli(ctx):
    """Return the ProtonMail export CLI path, downloading it if needed."""
    cli_dir = Path.home() / "proton-mail-export-cli-linux_x86_64"
    cli = cli_dir / "proton-mail-export-cli"
    if cli.exists():
        return cli, ""
    ctx.log("Downloading ProtonMail export CLI...")
    cli_dir.mkdir(parents=True, exist_ok=True)
    url = "https://proton.me/download/export-tool/proton-mail-export-cli-linux_x86_64.tar.gz"
    rc = shell.sh(
        f"wget -q {url} -O {shlex.quote(str(cli_dir / 'cli.tar.gz'))} "
        f"&& tar xf {shlex.quote(str(cli_dir / 'cli.tar.gz'))} -C {shlex.quote(str(cli_dir))} "
        f"&& rm {shlex.quote(str(cli_dir / 'cli.tar.gz'))} "
        f"&& chmod +x {shlex.quote(str(cli))}",
        log=ctx.log,
        timeout=_timeout(ctx),
    )
    if rc != 0:
        return None, "Failed to install ProtonMail export CLI"
    return cli, ""


def _sorted_exports(export_root):
    """Backup dirs sorted naturally (Export-2 before Export-10)."""
    return sorted(
        (d for d in export_root.iterdir() if d.is_dir()),
        key=lambda d: [int(x) if x.isdigit() else x for x in re.split(r"(\d+)", d.name)],
    )


def _validate_newest(ctx, dirs):
    """The newest export dir must be non-empty and fresh."""
    newest = dirs[-1]
    if not any(newest.iterdir()) or time.time() - newest.stat().st_mtime > DAY_SECONDS:
        return False, f"Export directory {newest.name} is empty or stale — the export did not complete"
    ctx.log(f"Validated export: {newest.name} ({len(list(newest.iterdir()))} items)")
    return True, ""


def _prune_exports(ctx, dirs):
    """Delete older exports, keeping any that hold more files than the newest."""
    if len(dirs) < 2:
        return
    newest_count = len(list(dirs[-1].iterdir()))
    for d in dirs[:-1]:
        count = len(list(d.iterdir()))
        if count > newest_count:
            ctx.log(f"WARNING: previous backup '{d.name}' has MORE files ({count}) than the newest ({newest_count}). NOT deleted.")
        else:
            shutil.rmtree(d)
            ctx.log(f"Deleted old export {d.name}")


# ---------------------------------------------------------------------------
# task metadata
# ---------------------------------------------------------------------------

def availability(task, local):
    """Return (available, reason) for a task on this machine."""
    root_raw = task.get("root")
    if task["kind"] == "media" or root_raw:
        pattern = config.expand(config.resolve(root_raw or "{{phone_sync_dir}}", local))
        found = any(glob.glob(pattern)) if any(c in pattern for c in "*?[") else Path(pattern).is_dir()
        if not found:
            return False, "Source directory not found"
    if task["kind"] == "winesaves" and not local.get("hosts", {}).get("bigpc", {}).get("host"):
        return False, "bigpc host not configured"
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
    "winesaves": run_winesaves,
    "proton": run_proton,
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
