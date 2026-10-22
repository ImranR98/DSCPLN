# D$CPLN

**Self-hosted apps for your personal data.**

D$CPLN is a set of small web apps that run on your own machine or server. Use
one app or run several behind a single portal: track a budget in Excel, organize
photos and voice notes, browse WhatsApp exports, and run scheduled backup or
sync tasks.

Each app is independent and configured at runtime, so your paths, accounts and
data stay out of the code and images.

**In a hurry?**

- [Run it with Docker Compose](#quick-start)
- [Choose an app](#apps)
- [Configure it](docs/CONFIGURATION.md)
- [Deploy and operate it](docs/OPERATIONS.md)

## Quick start

You need Docker with Compose. To develop locally, you also need Node.js 26+.

```sh
git clone https://github.com/ImranR98/DSCPLN.git
cd DSCPLN

# Start from the configuration template.
cp -r config-template dscpln-config
cp dscpln-config/secrets.example.json dscpln-config/secrets.json

# Edit paths and settings, then start the stack.
# docker-compose.example.yaml mounts ./dscpln-config.
docker compose -f docker-compose.example.yaml up -d
```

Open <http://localhost:8080> for the portal. The Compose file is an example:
remove the apps you do not need and change the sample paths before starting.

Prefer to run a single app? Each app has its own container image and can be
started on its own. See the app pages below.

## Apps

| App | What it does | Path |
|---|---|---|
| [Portal](apps/portal/README.md) | Shows every app you run with live health and status | `/` |
| [Balance XLSX](apps/balance-xlsx/README.md) | Budget dashboard, insights and forecasts backed by an Excel workbook | `/balance` |
| [File Pipelines](apps/file-pipelines/README.md) | Watches folders, standardizes or copies media, and keeps originals until cleanup is verified | `/pipelines` |
| [WhatsApp TXT](apps/whatsapp-txt/README.md) | Browses, imports and merges WhatsApp chat exports | `/watxt` |
| [Task Runner](apps/task-runner/README.md) | Runs scheduled and on-demand shell tasks with a web UI | `/tasks` |
| [Lockdown](apps/lockdown/README.md) | Blocks srv0 host ports for time-limited emergency containment | `/lockdown` |

There is also an optional headless [Agent](apps/agent/README.md). It lets the
Task Runner pull archives from another machine without a shared filesystem or
remote shell.

## How it fits together

- **Every app runs on its own.** Start one container or all six; there is no
  central database or required service order.
- **The Portal is optional.** It links the apps together and shows their health.
- **Configuration is runtime data.** Use each app's Settings UI or mount a
  private config repo. Nothing personal is baked into the images.
- **State lives with your deployment.** Apps write config, state and logs to
  the directories you mount.

## Configuration

The apps work with their built-in defaults. For a multi-app setup, keep paths,
tasks and app settings in a private config repo created from
[`config-template/`](config-template/README.md). The template includes:

- Task Runner tasks and schedules in `config.mjs`
- Per-app settings under `apps/*/config.json`
- Secrets in a gitignored `secrets.json`
- Optional helper scripts under `tools/`

For the full model, including environment variables and state locations, see
[Configuration](docs/CONFIGURATION.md).

## Deploy and operate

Images are published to GHCR as
`ghcr.io/imranr98/dscpln-<app>:latest`; the agent is
`ghcr.io/imranr98/dscpln-agent`. Pin image digests for reproducible deployments,
put the apps behind a reverse proxy, and keep runtime data on mounted volumes.

Deployment, upgrades, health checks, logs, backups and the remote agent are
covered in [Operations](docs/OPERATIONS.md).

## Development

Requires Node.js 26+.

```sh
npm install            # install every workspace
npm test               # build every UI and run every test suite
npm run ui             # build all UIs only
npm run task-runner    # start one app locally; see package.json for the rest
```

Each app has a React front end in `apps/<app>/ui/`, built into `static/` and
served by a small Express server from `packages/server-kit`. To add an app or
work on the shared kits, read [Architecture](docs/ARCHITECTURE.md).

## Data safety

These apps handle personal data. The safety rules are part of the design:

- Originals are only removed after a verified copy exists, or after an explicit
  cleanup/approval action.
- Config and state writes are atomic; secrets are masked in API responses and
  redacted from task logs.
- Runtime config, secrets and data belong on mounted volumes. They are never
  copied into `apps/` or `packages/` or baked into an image.
- Task Runner executes the commands you configure. Treat its config as code and
  keep it private.

## Screenshots

All screenshots use synthetic demo data. Regenerate them with
`node scripts/screenshots.mjs`.

| | |
|---|---|
| ![D$CPLN portal](docs/screenshots/portal.png) | ![Balance dashboard](docs/screenshots/balance-dashboard.png) |
| ![File Pipelines](docs/screenshots/file-pipelines.png) | ![WhatsApp TXT](docs/screenshots/whatsapp.png) |
| ![Task Runner](docs/screenshots/task-runner.png) | ![Balance insights](docs/screenshots/balance-insights.png) |
| ![Balance forecasts](docs/screenshots/balance-forecasts.png) | |

## Documentation

| I want to… | Read |
|---|---|
| Run the stack for the first time | [Getting started](docs/GETTING-STARTED.md) |
| Configure apps, secrets or schedules | [Configuration](docs/CONFIGURATION.md) |
| Deploy, upgrade or troubleshoot | [Operations](docs/OPERATIONS.md) |
| Understand or extend the code | [Architecture](docs/ARCHITECTURE.md) |
| Use a specific app | [App READMEs](docs/README.md#apps) |
