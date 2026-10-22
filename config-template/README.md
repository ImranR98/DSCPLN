# dscpln-config starter

A starter for a private configuration repository. The apps work without it,
but a multi-app deployment is easier to manage when paths, tasks, schedules and
settings live in one place.

**Use it if** you want reproducible configuration and a place for secrets that
is separate from the public source tree. **Skip it** if you are just trying an
app with its Settings UI.

## Quick start

From the D$CPLN repository:

```sh
npm run init-config -- ./dscpln-config
cd dscpln-config
cp secrets.example.json secrets.json
```

Or copy the directory manually:

```sh
cp -r config-template dscpln-config
cd dscpln-config
cp secrets.example.json secrets.json
git init
```

Then:

1. Edit `config.mjs` for Task Runner tasks and schedules.
2. Edit `apps/*/config.json` for per-app settings.
3. Fill in `secrets.json` locally.
4. Keep the repository private and commit everything except `secrets.json`.

Do not commit `secrets.json`. It is already in `.gitignore`.

## Layout

```
config.mjs                 Task Runner tasks and schedules
secrets.json               gitignored; local secrets
secrets.example.json       the shape, with blanks
apps/
  portal/config.json       notification settings + the portal card list
  balance-xlsx/config.json workbook path and notifications
  file-pipelines/config.json folder pipelines
  lockdown/config.json       port-blocker presets
tools/                     helper scripts called by tasks
```

The config files may contain credentials (a Nextcloud app password, an API
token, an ntfy token, and so on). For a shared deployment, keep secrets in the
deployment's secret store and leave the blanks in this repository.

## Connect the apps

Point each app at its config file:

| App | Environment variable | Default without this repo |
|---|---|---|
| Portal | `DSCPLN_CONFIG_FILE` | `$DSCPLN_DATA_DIR/config.json` |
| Balance XLSX | `DSCPLN_CONFIG` | `./config.json` |
| File Pipelines | `--config <path>` | `/config/config.json` |
| Task Runner | `BACKUPCTL_CONFIG_FILE` | `apps/task-runner/config.mjs` |
| Lockdown | `LOCKDOWN_CONFIG` | `/config/config.json` |

`DSCPLN_STATE_FILE` keeps a scheduled app's run state on its own volume when
the config file is mounted read-only.

Example Docker Compose mounts:

```yaml
services:
  portal:
    environment:
      APP: portal
      DSCPLN_CONFIG_FILE: /config/config.json
    volumes:
      - ./dscpln-config/apps/portal:/config

  balance-xlsx:
    environment:
      APP: balance
      DSCPLN_CONFIG: /config/config.json
    volumes:
      - ./dscpln-config/apps/balance-xlsx:/config:ro
      - ./balance:/data

  task-runner:
    environment:
      APP: task-runner
      BACKUPCTL_CONFIG_FILE: /config-src/config.mjs
      BACKUPCTL_STATE_DIR: /data/state
    volumes:
      - ./dscpln-config:/config-src:ro
      - ./data:/data
```

Mount an app's config directory writable if its Settings UI writes to it. Read
the app README before choosing read-only mounts.

## Schedules and notifications

Tasks can run unattended with:

```js
schedule: { enabled: true, days: [], at: '02:00', catchUp: true }
```

- `days` uses JavaScript weekdays (`0` = Sunday); empty means daily.
- `at` is local `HH:MM`.
- `catchUp` runs an occurrence missed while the instance was down.
- Scheduled tasks cannot use uploads, prompts, browser or `commit_dir`.

Run schedules on only one instance. Set `BACKUPCTL_SCHEDULES=0` on any other
instance that shares this config.

Failures notify through the Portal when `DSCPLN_PORTAL_URL` is set.
`notify: always` also sends successes; `notify: errors` is the default for
scheduled tasks.

## Adding your own tools

Put scripts under `tools/`, make them executable, and point `scriptroot` at
`/config-src/tools` (or wherever this repository is mounted). The starter's
`config.mjs` contains examples and comments for the available task fields.

For the full Task Runner reference, see the
[Task Runner README](../apps/task-runner/README.md).
