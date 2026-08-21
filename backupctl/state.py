"""Run-state storage: per-task .backup-state-*.json files in each task's
destination, the interrupted-run marker, and upload staging directories."""

import json
import time
from pathlib import Path

from . import config

STATE_DIR = Path.home() / ".backupctl"
RUNNING_FILE = STATE_DIR / "running.json"


def slugify(name):
    """Sanitize a task name for use in file names."""
    return "".join(c if c.isalnum() or c in "-_" else "_" for c in name)


def state_file_for(task, local):
    """Path of the .backup-state-<slug>.json file for a task (dest or state_dir)."""
    raw = task.get("state_dir") or task.get("dest")
    if not raw:
        raise RuntimeError(f"Task '{task['name']}' needs a 'dest' or 'state_dir' for its run state")
    base = Path(config.expand(config.resolve(raw, local)))
    return base / f".backup-state-{slugify(task['name'])}.json"


def save_task_state(task, local, ok, summary, output=""):
    """Atomically record a run's outcome next to the task's data."""
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
    """Return the last recorded run state for a task, or None."""
    path = state_file_for(task, local)
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text())
    except Exception:
        return None


def mark_running(task_name):
    """Write the interrupted-run marker for a task."""
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    RUNNING_FILE.write_text(json.dumps({"task": task_name, "ts": time.time()}))


def clear_running():
    """Remove the interrupted-run marker."""
    RUNNING_FILE.unlink(missing_ok=True)


def running_marker():
    """Return the marker dict ({task, ts}) if a run was interrupted."""
    if RUNNING_FILE.exists():
        try:
            return json.loads(RUNNING_FILE.read_text())
        except Exception:
            return None
    return None


def staging_dir(task_name):
    """Directory holding a task's dropped-but-unprocessed uploads."""
    safe = slugify(task_name)
    d = STATE_DIR / "staging" / safe
    d.mkdir(parents=True, exist_ok=True)
    return d
