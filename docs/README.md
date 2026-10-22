# D$CPLN documentation

Start with what you need. You do not have to read these pages in order.

| I want to… | Read |
|---|---|
| Try D$CPLN, run the stack, or run one app | [Getting started](GETTING-STARTED.md) |
| Configure apps, secrets, state or schedules | [Configuration](CONFIGURATION.md) |
| Deploy, upgrade, monitor or troubleshoot | [Operations](OPERATIONS.md) |
| Understand the code or add an app | [Architecture](ARCHITECTURE.md) |
| Use an app | The app pages below |
| Start a private config repo | [`config-template/`](../config-template/README.md) |

## Apps

- [Portal](../apps/portal/README.md) — the landing page and status board.
- [Balance XLSX](../apps/balance-xlsx/README.md) — a budget tracker backed by an
  Excel workbook.
- [File Pipelines](../apps/file-pipelines/README.md) — folder watchers that
  standardize, copy and archive media.
- [WhatsApp TXT](../apps/whatsapp-txt/README.md) — browse, import and merge
  WhatsApp chat exports.
- [Task Runner](../apps/task-runner/README.md) — scheduled and on-demand shell
  tasks with a web UI.
- [D$CPLN Agent](../apps/agent/README.md) — an optional archive service for
  other machines.

## Conventions

- `D$CPLN` is the project name. App names are written as **Balance XLSX**,
  **File Pipelines**, **WhatsApp TXT**, **Task Runner** and **Portal**.
- `dscpln-*` names are container images and package names.
- A **task** is one unit of work in Task Runner. A **run** is one execution of
  that task.
- **Config** is runtime data; **state** is written by an app while it runs.
  Keep both outside the source tree.

For the high-level overview, go back to the [project README](../README.md).
