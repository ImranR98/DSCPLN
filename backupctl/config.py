"""Config loading: reads the personal config.yaml (values + tasks) and
resolves {{token}} placeholders in task fields."""

import os
import re
from pathlib import Path

import yaml

REPO_DIR = Path(__file__).resolve().parent.parent
CONFIG_DIR = Path(os.environ.get("BACKUPCTL_CONFIG_DIR", REPO_DIR / "config"))
CONFIG_FILE = CONFIG_DIR / "config.yaml"
EXAMPLE_FILE = CONFIG_DIR / "config.example.yaml"


def load_config(path=None):
    """Load the personal config file. Returns (local, tasks).

    The file holds machine-specific values at the top level (referenced from
    task entries as {{token}}) plus a `tasks:` list of task definitions.
    A built-in `repo_dir` token (this repository's root; overridable via the
    BACKUPCTL_REPO_DIR env var) is available to every value.
    """
    path = Path(path) if path else CONFIG_FILE
    if not path.exists():
        raise FileNotFoundError(f"Missing config file {path} — copy {EXAMPLE_FILE} to {path} and fill it in")
    data = yaml.safe_load(path.read_text()) or {}
    tasks = data.get("tasks") or []
    local = {k: v for k, v in data.items() if k != "tasks"}
    local.setdefault("repo_dir", os.environ.get("BACKUPCTL_REPO_DIR", str(REPO_DIR)))
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
    """Expand ~ and environment variables in a path."""
    return os.path.expanduser(os.path.expandvars(str(path)))


_TOKEN_RE = re.compile(r"\{\{([a-zA-Z0-9_.]+)\}\}")


def _lookup(key, local, extra):
    """Resolve one token path to its value (None when not found)."""
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
    """Replace {{a.b.c}} tokens from the local config (and per-run extra dict).
    Values may themselves contain tokens (e.g. {{maindir}}/...), so resolution
    loops until stable. A template that is exactly one token resolves to the
    token's typed value (dict/list/int); embedded tokens are stringified."""
    if not isinstance(template, str):
        return template
    extra = extra or {}

    def repl(m):
        """Replace one {{token}} occurrence."""
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
