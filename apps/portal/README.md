# Portal

The D$CPLN landing page: one card per app with a non-blocking health pill, a
detail line, and an "N need attention" count. Served at the host root (`/`).

Each card links to the app's subpath (`/balance`, `/media`, ...). Health and
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

## Running

The portal is served at the host root; it intentionally ignores `BASE_PATH`
(its links are absolute subpaths). Run it behind the same host/proxy as the
other apps:

```sh
npm start --workspace dscpln-portal        # http://localhost:8080
```

## Development

The page is a Svelte app under `ui/` built into `static/`:

```sh
npm run build:ui --workspace dscpln-portal
npm test --workspace dscpln-portal         # builds, then runs the browser tests
```
