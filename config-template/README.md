# dscpln-config starter

This folder is a starter for a private configuration repo. Nothing here is
required to run D$CPLN: the apps work with their built-in defaults. Use it when
you want all of your paths, tasks, schedules and app settings in one place.

```sh
cp -r config-template ~/dscpln-config
cd ~/dscpln-config
cp secrets.example.json secrets.json   # edit; keep it out of git
git init && git add . && git commit -m "initial config"
```

Keep the repo private: `apps/*/config.json` may contain credentials (Nextcloud
app password, ytmusic cookies, ntfy token). `secrets.json` is gitignored and is
only read by `config.mjs` for Task Runner tokens. For a shared or public repo,
keep secrets in your deployment's secret store and leave the blanks here.

## Layout

```
config.mjs                 Task Runner tasks + schedules
secrets.json               gitignored; Task Runner secrets
secrets.example.json       the shape, with blanks
apps/
  portal/config.json       ntfy settings + the portal card list
  balance-xlsx/config.json workbook path and notifications
  file-pipelines/config.json folder pipelines
tools/                     helper scripts called by tasks
```

The per-app configs are mounted/pointed at with:

| App | Environment variable | Default without this repo |
|---|---|---|
| Portal | `DSCPLN_CONFIG_FILE` | `$DSCPLN_DATA_DIR/config.json` |
| Balance XLSX | `DSCPLN_CONFIG` | `./config.json` |
| File Pipelines | `--config <path>` | `/config/config.json` |
| Task Runner | `BACKUPCTL_CONFIG_FILE` | `apps/task-runner/config.mjs` |

`DSCPLN_STATE_FILE` keeps a scheduled app's run state on its own volume when
the config file is mounted read-only. Contacts/YTMusic are Task Runner jobs in
the example config; their tools live under `tools/` in the private repo.

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
      BACKUPCTL_REPO_DIR: /app
    volumes:
      - ./dscpln-config:/config-src:ro
      - ./data:/data
```

If an app's Settings UI writes its config (Portal, File Pipelines), mount that
app's config directory writable. Balance and Task Runner only read their config.

## Schedules and notifications

Tasks with `schedule: {enabled, days, at, catchUp}` run unattended. Put only
one instance in charge of schedules (`BACKUPCTL_SCHEDULES=1`); set
`BACKUPCTL_SCHEDULES=0` on any other instance sharing the config. Scheduled
tasks cannot use uploads, prompts, browser or commit_dir. Failures notify
through the portal when `DSCPLN_PORTAL_URL` is set; `notify: always` also
sends successes.

## Adding your own tools

Put scripts under `tools/`, make them executable, and point `scriptroot` at
`/config-src/tools` (or the path where this repo is mounted). See the comments
in `config.mjs`.
