# Portal

The D$CPLN landing page: one card per app with a non-blocking health pill, a
detail line, and an "N need attention" count. Served at the host root (`/`).

The card list is config-driven (`functions` in the portal config), so a
deployment only shows the apps it runs. Each card links to the app's subpath
(`/balance`, `/pipelines`, ...). Health and details are fetched client-side,
best-effort — if an app is down the link still works:

| Card data | Source |
|---|---|
| `online` / `unreachable` | `GET /<path>/api/health` |
| File Pipelines (queue/error counts) | `GET /pipelines/api/state` |
| WhatsApp TXT (conversation/message counts) | `GET /watxt/api/state` |
| Task Runner (stale/recent/error counts; next run and missed) | `GET /tasks/api/tasks` |
| Balance (budget overage) | `GET /balance/status` |

Configuration can also be mounted from a private `dscpln-config` repo: set `DSCPLN_CONFIG_FILE` to its `apps/portal/config.json`; run state stays on the app volume (`DSCPLN_STATE_FILE` for scheduled apps). See `config-template/README.md`.

## Notifications

The portal owns the notification channel: its Settings (gear icon in the
header) hold the ntfy URL and write-only token, and every app posts through
`POST /api/notify` instead of talking to ntfy itself. `POST /api/notify/test`
powers the settings dialog's test button. Settings live in
`config.json` under `DSCPLN_DATA_DIR` (default `/data`); `ntfy.token` is masked
in API responses.

The relay endpoint is expected to be reachable in-cluster without the
forward-auth proxy header (set `AUTH_EXEMPT_PATHS=/api/notify` in the
deployment); external requests still pass through Authelia at the ingress.

## Running

The portal is served at the host root; it intentionally ignores `BASE_PATH`
(its links are absolute subpaths). Run it behind the same host/proxy as the
other apps:

```sh
DSCPLN_DATA_DIR=./data npm start --workspace dscpln-portal   # http://localhost:8080
```

`DSCPLN_DATA_DIR` defaults to `/data` (the container's volume); set it to a
writable directory for local runs.

## Development

The page is a React app under `ui/` built into `static/`:

```sh
npm run build:ui --workspace dscpln-portal
npm test --workspace dscpln-portal         # builds, then runs the browser tests
```
