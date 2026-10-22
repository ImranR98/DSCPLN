# Configuration

D$CPLN apps are configured at runtime. You can use the app's Settings UI for a
quick local setup, or mount a private config repository for a reproducible
deployment.

## Config and state are different

- **Config** says what the app should do: paths, schedules, folders, accounts
  and notification settings.
- **State** says what the app has already done: last runs, schedules, queues,
  review items and logs.

Keep both outside the source tree. Config may contain credentials, so treat it
as private. State changes constantly, so put it on a persistent volume.

The public source tree and images contain no personal config or data.

## Use a private config repo

For a multi-app deployment, start from
[`config-template/`](../config-template/README.md):

```sh
cp -r config-template dscpln-config
cp dscpln-config/secrets.example.json dscpln-config/secrets.json
```

Then:

1. Edit `config.mjs` for Task Runner tasks and schedules.
2. Edit `apps/*/config.json` for per-app settings.
3. Fill in `secrets.json` locally.
4. Keep the repository private and never commit `secrets.json`.

If you prefer the helper script, `npm run init-config -- ./dscpln-config`
copies the template and initializes a git repository.

The per-app mounts in `docker-compose.example.yaml` expect this layout. If you
use another directory, update the mounts.

## Configuration sources

| App | Config | Default | State |
|---|---|---|---|
| Portal | `DSCPLN_CONFIG_FILE` | `$DSCPLN_DATA_DIR/config.json` | App volume |
| Balance XLSX | `DSCPLN_CONFIG` | `./config.json` | `api.stateFile` next to the workbook |
| File Pipelines | `--config <path>` | `/config/config.json` in the container | Paths in the config; default `/data` |
| WhatsApp TXT | Data directory only | `/data` in the container | Conversation JSON files in the data directory |
| Task Runner | `BACKUPCTL_CONFIG_FILE` | `apps/task-runner/config.mjs` | `BACKUPCTL_STATE_DIR` |
| D$CPLN Agent | `DSCPLN_AGENT_CONFIG` | `/config/agent.json` | `stateDir` in the agent config |

### Common environment variables

| Variable | Used by | Meaning |
|---|---|---|
| `APP` | App images | Selects the app when using the unified image |
| `BASE_PATH` | All apps except Portal | URL prefix, such as `/tasks` |
| `DSCPLN_DATA_DIR` | Portal and other apps | Writable data directory |
| `DSCPLN_PORTAL_URL` | Apps that send notifications | Portal base URL, such as `http://portal:8080` |
| `DSCPLN_ORIGIN` | Apps that send notifications | Public origin used for notification links |
| `DSCPLN_STATE_FILE` | Scheduled apps | Optional state file path |

### Task Runner variables

| Variable | Meaning |
|---|---|
| `BACKUPCTL_CONFIG_FILE` | Path to `config.mjs` |
| `BACKUPCTL_STATE_DIR` | Run state, schedules and staging metadata |
| `BACKUPCTL_TMP_DIR` | Per-run temporary files |
| `BACKUPCTL_REPO_DIR` | Repo root; resolves the built-in `{{repo_dir}}` token |
| `BACKUPCTL_HOST` | Instance name used by task `host:` pins |
| `BACKUPCTL_SCHEDULES` | Set to `0` on secondary instances that must not fire shared schedules |

## Secrets

- Put secrets in `secrets.json` or in the deployment's secret store, never in
  `config.example.*`.
- `secrets.json` is gitignored in the template.
- Config-level secret fields are masked in API responses. Saving a masked value
  keeps the stored value; an explicit empty value clears it.
- Task Runner secrets can be listed under `secrets:` and passed through `env`.
  They are redacted from logs and command output.
- Use `0600` permissions for secret and token files.

The generated agent token files are secrets too. Keep them on persistent
storage; the agent stores only a hash.

## Schedules

Schedules belong to Task Runner tasks:

```js
schedule: { enabled: true, days: [1, 3, 5], at: '02:00', catchUp: true }
```

- `days` uses JavaScript weekdays (`0` = Sunday); an empty list means daily.
- `at` is local `HH:MM`.
- `catchUp` runs an occurrence missed while the instance was down.
- Scheduled tasks cannot use uploads, prompts, `require`, `browser` or
  `commit_dir`.
- Run only one scheduler for a shared config. Set `BACKUPCTL_SCHEDULES=0` on any
  other instance.

See the [Task Runner README](../apps/task-runner/README.md#scheduled-tasks) for
the task fields and UI behavior.

## Notifications

The Portal owns the notification destination. Configure its ntfy URL and token
in Portal Settings, then give the other apps `DSCPLN_PORTAL_URL`. Apps send
notifications through the Portal's `/api/notify` endpoint instead of storing
their own ntfy credentials.

If the Portal is down, app notifications are skipped. Failures still appear in
the sending app's logs and state.

## Per-app configuration

Each app README documents its fields and defaults:

- [Portal](../apps/portal/README.md#configuration)
- [Balance XLSX](../apps/balance-xlsx/README.md#configuration)
- [File Pipelines](../apps/file-pipelines/README.md#configuration)
- [WhatsApp TXT](../apps/whatsapp-txt/README.md#web-browser)
- [Task Runner](../apps/task-runner/README.md#configuration)
- [D$CPLN Agent](../apps/agent/README.md#configuration)

## Common mistakes

- **Using host paths inside Docker.** Mount the host path and configure the
  container path, for example `/data/Balance.xlsx`.
- **Mounting config read-only when the app writes settings.** Portal, File
  Pipelines and Task Runner metadata may need a writable config directory.
- **Putting state in the image.** Image updates would discard it.
- **Committing secrets.** Keep `secrets.json` out of git and use a secret store
  in shared deployments.
- **Running two schedulers.** Duplicate schedules can run the same task twice.
