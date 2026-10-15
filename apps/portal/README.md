# Portal

The D$CPLN landing page: one card per app with a non-blocking health pill, a
detail line, and an "N need attention" count. Served at the host root (`/`).

Each card links to the app's subpath (`/balance`, `/pipelines`, ...). Health and
details are fetched client-side, best-effort — if an app is down the link still
works:

| Card data | Source |
|---|---|
| `online` / `unreachable` | `GET /<path>/api/health` |
| Scheduled apps (last run, next run, missed, paused) | `GET /<path>/api/state` |
| File Pipelines (queue/error counts) | `GET /pipelines/api/state` |
| WhatsApp TXT (conversation/message counts) | `GET /watxt/api/state` |
| Task Runner (per-task last run) | `GET /tasks/api/tasks` |
| Balance (budget overage) | `GET /balance/status` |

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
