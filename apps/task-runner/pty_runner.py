#!/usr/bin/env python3
"""Generic pty runner for tools that refuse non-TTY stdin (e.g. age -p).

Forwards piped stdin to a command running in a pseudo-terminal, strips
terminal control sequences from the output, and exits with the child's
status. Secrets travel in stdin (e.g. from an env var), never on the
command line. Stdlib only — no third-party modules.

Usage: printf 'pw\npw\n' | python3 pty_runner.py CMD [ARGS...]"""

import os
import pty
import re
import select
import sys
import threading
import time

ANSI = re.compile(rb"\x1b\[[0-9;?]*[a-zA-Z]")


def drain(fd, timeout):
    """Read whatever the pty has to offer; True when there was output."""
    try:
        readable, _, _ = select.select([fd], [], [], timeout)
    except (OSError, ValueError):
        return False
    if fd not in readable:
        return False
    try:
        data = os.read(fd, 65536)
    except OSError:
        return False
    if not data:
        return False
    sys.stdout.buffer.write(ANSI.sub(b"", data))
    sys.stdout.buffer.flush()
    return True


def main():
    if len(sys.argv) < 2:
        print("usage: python3 pty_runner.py CMD [ARGS...]", file=sys.stderr)
        sys.exit(2)
    pid, fd = pty.fork()
    if pid == 0:
        os.execvp(sys.argv[1], sys.argv[1:])

    def feed():
        # Line by line with a small pause: prompt loops switch the terminal
        # to raw mode between reads, and a burst written before the first
        # read can be discarded by that switch.
        try:
            while True:
                chunk = sys.stdin.buffer.readline()
                if not chunk:
                    break
                os.write(fd, chunk)
                time.sleep(0.15)
        except OSError:
            pass

    threading.Thread(target=feed, daemon=True).start()

    status = 0
    while True:
        drain(fd, 0.5)
        done, status = os.waitpid(pid, os.WNOHANG)
        if done == pid:
            break

    # child exited: drain whatever output is left, then relay its status
    for _ in range(8):
        if not drain(fd, 0.1):
            break

    if os.WIFEXITED(status):
        sys.exit(os.WEXITSTATUS(status))
    sys.exit(1)


if __name__ == "__main__":
    main()
