"""Core plumbing: config loading + {{token}} resolution, per-task run-state
files, upload staging, and the safe subprocess layer (process groups,
timeouts, redaction, fail-fast env), plus git commits and age encryption."""

import json
import os
import re
import select
import shlex
import signal
import subprocess
import sys
import threading
import time
from pathlib import Path

import yaml

# config ---------------------------------------------------------------------

REPO_DIR = Path(__file__).resolve().parent.parent
CONFIG_DIR = Path(os.environ.get("BACKUPCTL_CONFIG_DIR", REPO_DIR / "config"))
CONFIG_FILE = CONFIG_DIR / "config.yaml"
EXAMPLE_FILE = CONFIG_DIR / "config.example.yaml"


def load_config(path=None):
    path = Path(path) if path else CONFIG_FILE
    if not path.exists():
        raise FileNotFoundError(f"Missing config file {path} — copy {EXAMPLE_FILE} to {path} and fill it in")
    data = yaml.safe_load(path.read_text()) or {}
    tasks = data.get("tasks") or []
    local = {k: v for k, v in data.items() if k != "tasks"}
    local.setdefault("repo_dir", os.environ.get("BACKUPCTL_REPO_DIR", str(REPO_DIR)))
    local.setdefault("lib", str(Path(__file__).parent / "lib.sh"))
    seen = set()
    for t in tasks:
        name = t.get("name")
        if not name:
            raise ValueError("Every task needs a 'name'")
        if not (t.get("state_dir") or t.get("dest")):
            raise ValueError(f"Task '{name}' needs a 'dest' or 'state_dir' for its run state")
        if name in seen:
            raise ValueError(f"Duplicate task name: '{name}'")
        seen.add(name)
    return local, tasks


def expand(path):
    return os.path.expanduser(os.path.expandvars(str(path)))


_TOKEN_RE = re.compile(r"\{\{([a-zA-Z0-9_.]+)\}\}")


def _lookup(key, local, extra):
    if key in extra:
        return extra[key]
    node = local
    for part in key.split("."):
        if isinstance(node, dict) and part in node:
            node = node[part]
        else:
            return None
    return node


def resolve(template, local, extra=None):
    """Replace {{a.b.c}} tokens from local (and per-run extra). Values may
    reference other tokens, so resolution loops until stable. A template that
    is exactly one token resolves to its typed value (dict/list/int);
    embedded tokens are stringified."""
    if not isinstance(template, str):
        return template
    extra = extra or {}

    def repl(m):
        value = _lookup(m.group(1), local, extra)
        return m.group(0) if value is None else str(value)

    result = template
    for _ in range(10):
        next_result = _TOKEN_RE.sub(repl, result)
        if next_result == result:
            break
        result = next_result
    match = _TOKEN_RE.fullmatch(template)
    if match:
        value = _lookup(match.group(1), local, extra)
        if value is None:
            return result  # unresolved token: leave the literal template
        if not isinstance(value, str):
            return value
        return result
    return result


# run state + staging --------------------------------------------------------

STATE_DIR = Path.home() / ".backupctl"
RUNNING_FILE = STATE_DIR / "running.json"


def slugify(name):
    return "".join(c if c.isalnum() or c in "-_" else "_" for c in name)


def state_file_for(task, local):
    raw = task.get("state_dir") or task.get("dest")
    if not raw:
        raise RuntimeError(f"Task '{task['name']}' needs a 'dest' or 'state_dir' for its run state")
    base = Path(expand(resolve(raw, local)))
    return base / f".backup-state-{slugify(task['name'])}.json"


def save_task_state(task, local, ok, summary, output=""):
    path = state_file_for(task, local)
    path.parent.mkdir(parents=True, exist_ok=True)
    data = {
        "task": task["name"],
        "ts": time.time(),
        "ok": ok,
        "summary": summary,
        "output": output[-20000:],
    }
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(json.dumps(data, indent=1))
    tmp.replace(path)


def load_task_state(task, local):
    path = state_file_for(task, local)
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text())
    except Exception:
        return None


def mark_running(task_name):
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    RUNNING_FILE.write_text(json.dumps({"task": task_name, "ts": time.time()}))


def clear_running():
    RUNNING_FILE.unlink(missing_ok=True)


def running_marker():
    if RUNNING_FILE.exists():
        try:
            return json.loads(RUNNING_FILE.read_text())
        except Exception:
            return None
    return None


def staging_dir(task_name):
    safe = slugify(task_name)
    d = STATE_DIR / "staging" / safe
    d.mkdir(parents=True, exist_ok=True)
    return d


# subprocess layer -----------------------------------------------------------

def _ensure_askpass():
    path = Path.home() / ".backupctl" / "askpass.sh"
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("#!/bin/sh\nexit 1\n")
        path.chmod(0o755)
    return path


ASKPASS = _ensure_askpass()

# Commands run with stdin closed (interactive prompts fail fast instead of
# hanging) and SSH forced to use a failing askpass (no password prompts on a
# hidden terminal).
SAFE_ENV = {
    **os.environ,
    "SSH_ASKPASS_REQUIRE": "force",
    "SSH_ASKPASS": str(ASKPASS),
}

PROC_GROUPS = set()  # pgids of running children, for cancellation

TIMEOUT_RC = 124  # exit code returned when a command's deadline expires


def _spawn(cmd, cwd, shell=False, capture=False):
    kwargs = dict(cwd=cwd, text=True, stdin=subprocess.DEVNULL, env=SAFE_ENV, start_new_session=True)
    if capture:
        proc = subprocess.Popen(cmd, shell=shell, stdout=subprocess.PIPE, stderr=subprocess.PIPE, **kwargs)
    else:
        proc = subprocess.Popen(cmd, shell=shell, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, **kwargs)
    PROC_GROUPS.add(proc.pid)
    return proc


def _display(cmd, shell):
    return cmd if isinstance(cmd, str) and shell else " ".join(shlex.quote(str(a)) for a in cmd)


def _killpg(pid, log):
    try:
        os.killpg(pid, signal.SIGTERM)
    except (ProcessLookupError, PermissionError):
        pass
    time.sleep(1)
    try:
        os.killpg(pid, signal.SIGKILL)
    except (ProcessLookupError, PermissionError):
        pass
    log("(killed)")


def run(cmd, shell=False, cwd=None, log=None, timeout=None, redact=None):
    """Run a command (list or shell string), streaming output lines into
    log(). Returns exit code; timeout kills the process group and returns
    TIMEOUT_RC; redact masks secrets in the logged command and output."""
    if log is None:
        log = lambda line: None  # noqa: E731
    if isinstance(cmd, str) and not shell:
        cmd = shlex.split(cmd)
    display = _display(cmd, shell)
    for secret in redact or []:
        display = display.replace(secret, "***")
    log(f"$ {display}")
    try:
        proc = _spawn(cmd, cwd, shell=shell)
    except OSError as e:
        log(f"ERROR: could not start: {e}")
        return 127
    try:
        deadline = time.time() + timeout if timeout else None
        while True:
            if deadline is not None and time.time() >= deadline:
                _killpg(proc.pid, log)
                proc.wait()
                log("TIMEOUT: command killed")
                return TIMEOUT_RC
            wait = 1.0 if deadline is None else min(1.0, max(0.1, deadline - time.time()))
            readable, _, _ = select.select([proc.stdout], [], [], wait)
            if proc.stdout in readable:
                line = proc.stdout.readline()
                if not line:
                    break
                line = line.rstrip("\n")
                for secret in redact or []:
                    line = line.replace(secret, "***")
                log(line)
            elif proc.poll() is not None:
                break
        return proc.wait()
    finally:
        PROC_GROUPS.discard(proc.pid)


def sh(cmd, cwd=None, log=None, timeout=None, redact=None):
    return run(cmd, shell=True, cwd=cwd, log=log, timeout=timeout, redact=redact)


def sh_capture(cmd, cwd=None, timeout=None, redact=None):
    proc = _spawn(cmd, cwd, shell=True, capture=True)
    try:
        try:
            out, err = proc.communicate(timeout=timeout)
        except subprocess.TimeoutExpired:
            _killpg(proc.pid, lambda line: None)
            out, err = proc.communicate()
            for secret in redact or []:
                out = out.replace(secret, "***")
                err = err.replace(secret, "***")
            return TIMEOUT_RC, out, err
        for secret in redact or []:
            out = out.replace(secret, "***")
            err = err.replace(secret, "***")
        return proc.returncode, out, err
    finally:
        PROC_GROUPS.discard(proc.pid)


def rsync(src, dst, delete=False, excludes=(), log=None, ssh=None, timeout=None):
    args = ["rsync", "-aq"]
    if delete:
        args.append("--delete")
    for e in excludes:
        args += ["--exclude", e]
    if ssh:
        args += ["-e", ssh]
    s = str(src)
    if Path(s).is_dir() and not s.endswith("/"):
        s += "/"
    args += [s, str(dst)]
    return run(args, log=log, timeout=timeout)


def cancel_all():
    for pid in list(PROC_GROUPS):
        _killpg(pid, lambda line: None)


GIT_TIMEOUT = 300


def git_commit(dest, message, log=None):
    dest = Path(dest)
    dest.mkdir(parents=True, exist_ok=True)
    if run(["git", "init", "-q"], cwd=dest, log=log, timeout=GIT_TIMEOUT) != 0:
        raise RuntimeError(f"git init failed in {dest}")
    if run(["git", "add", "-A", ".", ":(exclude).backup-state-*"], cwd=dest, log=log, timeout=GIT_TIMEOUT) != 0:
        raise RuntimeError(f"git add failed in {dest}")
    r, out, err = sh_capture(f"git commit -q -m {shlex.quote(message)}", cwd=dest, timeout=GIT_TIMEOUT)
    if r != 0 and "nothing to commit" not in (out + err) and "nothing added to commit" not in (out + err):
        raise RuntimeError(f"git commit failed in {dest}: {err.strip()}")


def human_ago(ts):
    delta = time.time() - ts
    if delta < 3600:
        return f"{int(delta // 60)} min ago"
    if delta < 86400:
        return f"{int(delta // 3600)} hr ago"
    if delta < 86400 * 30:
        return f"{int(delta // 86400)} days ago"
    if delta < 86400 * 365:
        return f"{int(delta // (86400 * 30))} months ago"
    return f"{int(delta // (86400 * 365))} years ago"


# pty runner -----------------------------------------------------------------


def pty_main():
    """Run a command in a pseudo-terminal, forwarding piped stdin to it.

    For tools that refuse non-TTY input (e.g. `age --passphrase`). Output
    streams to stdout (terminal control sequences stripped); exit code is
    the child's. Secrets stay off argv by piping them in (e.g. from an env
    var), never passing them as arguments.

    Usage: printf 'pw\npw\n' | python -m backupctl.core CMD [ARGS...]"""
    import pexpect

    ansi = re.compile(r"\x1b\[[0-9;?]*[a-zA-Z]")
    if len(sys.argv) < 2:
        print("usage: python -m backupctl.core CMD [ARGS...]", file=sys.stderr)
        sys.exit(2)
    child = pexpect.spawn(sys.argv[1], sys.argv[2:], encoding="utf-8", timeout=30)

    def feed():
        for line in sys.stdin:
            child.send(line)
        try:
            child.sendeof()
        except Exception:
            pass

    threading.Thread(target=feed, daemon=True).start()
    while True:
        try:
            sys.stdout.write(ansi.sub("", child.read_nonblocking(size=65536, timeout=0.5)))
            sys.stdout.flush()
        except pexpect.TIMEOUT:
            pass
        except pexpect.EOF:
            break
    child.close()
    sys.exit(child.exitstatus if child.exitstatus is not None else 1)


if __name__ == "__main__":
    pty_main()
