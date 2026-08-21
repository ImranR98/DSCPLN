"""Safe subprocess layer: runs commands in their own process groups with
timeouts, cancellation, secret redaction, and a fail-fast environment
(closed stdin, forced SSH askpass). Also git commits and age encryption."""

import os
import select
import shlex
import signal
import subprocess
import time
from pathlib import Path


def _ensure_askpass():
    """Create (once) a failing SSH askpass script and return its path."""
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
    """Start a child in its own process group with the safe environment."""
    kwargs = dict(cwd=cwd, text=True, stdin=subprocess.DEVNULL, env=SAFE_ENV, start_new_session=True)
    if capture:
        proc = subprocess.Popen(cmd, shell=shell, stdout=subprocess.PIPE, stderr=subprocess.PIPE, **kwargs)
    else:
        proc = subprocess.Popen(cmd, shell=shell, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, **kwargs)
    PROC_GROUPS.add(proc.pid)
    return proc


def _display(cmd, shell):
    """Human-readable command for logging (list commands get shell-quoted)."""
    return cmd if isinstance(cmd, str) and shell else " ".join(shlex.quote(str(a)) for a in cmd)


def _killpg(pid, log):
    """TERM then KILL the process group `pid`."""
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
    """Run a command (list or shell string), streaming output lines into log(). Returns exit code.

    timeout: seconds before the process group is killed (returns TIMEOUT_RC).
    redact: list of secret strings to mask in the logged command and output."""
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
    """Run a shell command string; see run()."""
    return run(cmd, shell=True, cwd=cwd, log=log, timeout=timeout, redact=redact)


def sh_capture(cmd, cwd=None, timeout=None, redact=None):
    """Run a shell command, capturing output; returns (rc, stdout, stderr)."""
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
    """Run rsync -aq with optional --delete/excludes/ssh transport; returns rc."""
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
    """Terminate every command started by this process (used by the Stop button)."""
    for pid in list(PROC_GROUPS):
        _killpg(pid, lambda line: None)


GIT_TIMEOUT = 300


def git_commit(dest, message, log=None):
    """git init/add/commit in dest (state files excluded); tolerates empty commits."""
    dest = Path(dest)
    dest.mkdir(parents=True, exist_ok=True)
    if run(["git", "init", "-q"], cwd=dest, log=log, timeout=GIT_TIMEOUT) != 0:
        raise RuntimeError(f"git init failed in {dest}")
    if run(["git", "add", "-A", ".", ":(exclude).backup-state-*"], cwd=dest, log=log, timeout=GIT_TIMEOUT) != 0:
        raise RuntimeError(f"git add failed in {dest}")
    r, out, err = sh_capture(f"git commit -q -m {shlex.quote(message)}", cwd=dest, timeout=GIT_TIMEOUT)
    if r != 0 and "nothing to commit" not in (out + err) and "nothing added to commit" not in (out + err):
        raise RuntimeError(f"git commit failed in {dest}: {err.strip()}")


def age_encrypt_passphrase(src, out, passphrase, log=None):
    """Encrypt a file with age using a passphrase (prompts fed via a pty)."""
    import io

    import pexpect

    if log is None:
        log = lambda line: None  # noqa: E731
    log(f"$ age --encrypt --passphrase -o {out} {src}")
    try:
        child = pexpect.spawn(
            "age", ["--encrypt", "--passphrase", "-o", str(out), str(src)],
            encoding="utf-8", timeout=30,
        )
    except pexpect.ExceptionPexpect as e:
        log(f"ERROR: could not start age: {e}")
        return 127
    PROC_GROUPS.add(child.pid)
    capture = io.StringIO()
    child.logfile_read = capture
    try:
        child.expect("Enter passphrase")
        child.sendline(passphrase)
        child.expect("Confirm passphrase")
        child.sendline(passphrase)
        child.expect(pexpect.EOF)
    except pexpect.TIMEOUT:
        child.close(force=True)
        log("TIMEOUT: age did not respond")
        return TIMEOUT_RC
    except pexpect.EOF:
        pass  # age failed early; its output is logged below
    finally:
        PROC_GROUPS.discard(child.pid)
    child.close()
    output = capture.getvalue().strip()
    if output:
        log(output)
    return child.exitstatus if child.exitstatus is not None else 1


def human_ago(ts):
    """Human-readable elapsed time (e.g. '3 weeks ago')."""
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
