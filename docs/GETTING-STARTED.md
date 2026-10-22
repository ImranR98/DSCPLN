# Getting started

This page gets D$CPLN running with Docker Compose and explains the first things
to configure. For a single app, start with that app's README.

## What you need

- Docker with the Compose plugin (`docker compose version`)
- A writable directory for runtime config, state and data
- Node.js 26+ only if you want to develop locally or run the apps without
  Docker

## Run the stack

From a fresh clone:

```sh
git clone https://github.com/ImranR98/DSCPLN.git
cd DSCPLN

cp -r config-template dscpln-config
cp dscpln-config/secrets.example.json dscpln-config/secrets.json
```

The example Compose file mounts `./dscpln-config`. Edit
`docker-compose.example.yaml` before starting:

- replace `/path/to/...` with real host paths;
- remove apps you do not want;
- check that the config mounts match the files you created.

Then start it:

```sh
docker compose -f docker-compose.example.yaml up -d
```

Open <http://localhost:8080> for the portal.

The example stack includes Portal, Balance XLSX, File Pipelines and Task
Runner. WhatsApp TXT is not in the example; add it if you need it. Balance XLSX
also needs an existing Excel workbook at the path configured in
`dscpln-config/apps/balance-xlsx/config.json`.

### Check what is running

```sh
docker compose -f docker-compose.example.yaml ps
```

The default ports are:

| App | Port |
|---|---|
| Portal | `8080` |
| Balance XLSX | `3300` |
| File Pipelines | `8791` |
| Task Runner | `8085` |
| WhatsApp TXT | `8787` (when added) |

Each app also exposes `/api/health` under its base path.

## Run one app locally

For development, install the workspace and start an app by name:

```sh
npm install
npm run portal
npm run balance-xlsx
npm run file-pipelines
npm run task-runner
npm run whatsapp-txt
```

Use the app's README for the config file and environment variables it expects.
`npm test` builds every UI and runs the full test suite.

## Configure the basics

There are two ways to configure an app:

1. **Use its Settings UI.** Portal, File Pipelines and several Task Runner
   settings can be edited from the running app.
2. **Mount a config file.** This is the reproducible option for a deployment.
   The private [`dscpln-config`](../config-template/README.md) template keeps
   every app's config in one repository.

Config is separate from state:

- **Config** describes what the app should do. It belongs in your private
  config repo or a mounted file.
- **State** records what the app has done. It belongs on a writable volume.

Never copy secrets or runtime data into `apps/` or `packages/`; those are public
source directories.

See [Configuration](CONFIGURATION.md) for the full environment-variable and
state-location reference.

## Put apps behind one host

By default each app listens on its own port. To serve them under one hostname,
set `BASE_PATH` for each app (for example `/pipelines`) and route that prefix to
the matching container. The Portal is always served at `/` and links to the
other paths.

Examples:

| App | `BASE_PATH` | URL |
|---|---|---|
| Portal | *(ignored; always `/`)* | `https://example.com/` |
| Balance XLSX | `/balance` | `https://example.com/balance` |
| File Pipelines | `/pipelines` | `https://example.com/pipelines` |
| WhatsApp TXT | `/watxt` | `https://example.com/watxt` |
| Task Runner | `/tasks` | `https://example.com/tasks` |

If you use a reverse proxy with authentication, keep each app's API routes
behind the same protection unless the app documents a token-protected endpoint
(for example the [Balance external API](../apps/balance-xlsx/README.md#external-api)).

## First-run troubleshooting

- **A container exits immediately:** check `docker compose logs <service>` and
  make sure its config path exists and is readable.
- **The portal shows an app as unreachable:** check the app's port, base path
  and health endpoint. The portal still links to a down app.
- **Config changes do not appear:** the app may load its config at startup.
  Restart that container after editing a mounted file.
- **A path works locally but not in Docker:** the container sees only mounted
  paths. Use container paths such as `/data` and `/config`, not host paths.
- **Images cannot be pulled:** the GHCR packages may still be private. See
  [Operations](OPERATIONS.md#images-and-digests).

## Next steps

- [Configuration](CONFIGURATION.md) — config sources, secrets, schedules and
  state.
- [Operations](OPERATIONS.md) — deployment, reverse proxy, upgrades and
  troubleshooting.
- [App READMEs](README.md#apps) — the details for each app.
