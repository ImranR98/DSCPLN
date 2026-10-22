# Portal

**One page for every D$CPLN app you run.**

The Portal links to your apps, shows their health and gives you a quick status
view. It is optional: every app works without it.

## At a glance

| | |
|---|---|
| Runs at | `/` (always the host root) |
| Config | `DSCPLN_CONFIG_FILE`, default `$DSCPLN_DATA_DIR/config.json` |
| Data | `DSCPLN_DATA_DIR`, default `/data` |
| Notifications | Owns the ntfy URL and token for all apps |

## Quick start

```sh
npm run portal   # http://localhost:8080
```

Or with Docker:

```sh
docker run --rm -p 8080:8080 ghcr.io/imranr98/dscpln-portal:latest
```

The built-in card list links to the standard app paths. Configure `functions`
to match the apps you actually run.

## Configuration

The card list is configuration-driven, so a deployment only shows its own apps.
Each entry needs a name, a path and an icon; `description` is shown on the card.

```json
{
  "functions": [
    {
      "path": "tasks",
      "icon": "wrench",
      "name": "Task Runner",
      "description": "Run scheduled and on-demand tasks",
      "kind": "tasks"
    }
  ]
}
```

Each card links to the app's subpath (`/balance`, `/pipelines`, ...). Health and
details are fetched client-side, so a down app still has a usable link.

| Card data | Source |
|---|---|
| `online` / `unreachable` | `GET /<path>/api/health` |
| File Pipelines queue/error counts | `GET /pipelines/api/state` |
| WhatsApp TXT conversation/message counts | `GET /watxt/api/state` |
| Task Runner stale/recent/error counts and next run | `GET /tasks/api/tasks` |
| Balance budget overage | `GET /balance/status` |

To keep the config in a private repository, set `DSCPLN_CONFIG_FILE` to its
`apps/portal/config.json`. See [Configuration](../../docs/CONFIGURATION.md).

## Notifications

The Portal owns the notification channel. Its Settings (gear icon in the
header) hold the ntfy URL and write-only token. Other apps post through
`POST /api/notify` instead of talking to ntfy directly. The test button uses
`POST /api/notify/test`.

Settings live in `config.json` under `DSCPLN_DATA_DIR` (default `/data`).
`ntfy.token` is masked in API responses.

If the Portal is behind a forward-auth proxy, the notification relay must be
reachable by the other apps without the user-facing login header. External
requests should still go through the proxy's normal authentication.

## Running

The Portal is served at the host root and intentionally ignores `BASE_PATH`;
its links are absolute subpaths. Run it behind the same host/proxy as the other
apps.

```sh
DSCPLN_DATA_DIR=./data npm run portal
```

`DSCPLN_DATA_DIR` defaults to `/data` in the container. Point it at a writable
directory for local runs.

## Development

The page is a React app under `ui/`, built into `static/`:

```sh
npm run build:ui --workspace dscpln-portal
npm test --workspace dscpln-portal
```

`npm test` builds the UI first and then runs the browser tests.
