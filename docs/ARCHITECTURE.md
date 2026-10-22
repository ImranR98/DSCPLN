# Architecture

How D$CPLN is put together. Read this if you are changing the code, adding an
app or debugging the shared packages. For installation and configuration, use
[Getting started](GETTING-STARTED.md) and [Configuration](CONFIGURATION.md).

## At a glance

```
DSCPLN/
  apps/
    portal/          landing page and status
    balance-xlsx/    budget app
    file-pipelines/  folder watcher and media pipelines
    whatsapp-txt/    chat export browser and merger
    task-runner/     scheduled and on-demand tasks
    lockdown/        time-limited host-port blocks + internal blocker
    agent/           optional remote archive service
  packages/
    server-kit/      shared Node/Express primitives
    ui-kit/          shared React components and styles
    test-kit/        shared test helpers
  config-template/   starter for a private deployment config
  scripts/           build, publish, screenshot and config helpers
  docker/            unified app image and entrypoint
```

Every app is a small Express server with a React front end. The front end is
built into the app's `static/` directory and served by that same server. Apps
share the packages above, but they do not share runtime state.

## Design constraints

- **Independent apps.** Each app can run alone. The Portal is optional.
- **Runtime configuration.** No personal paths, accounts or credentials belong
  in the image or public source tree.
- **State outside the image.** Config, run state and data live on mounted
  paths.
- **One host by default.** With a reverse proxy, apps can share a hostname
  under `BASE_PATH`; without one, each runs on its own port.
- **Stable, safe writes.** Config and state writes are atomic where possible.
  User data is never overwritten without a verification step or an explicit
  policy.

## Naming

| Thing | Convention |
|---|---|
| UI title | `D$CPLN ⋅ <App>` (`⋅` is U+22C5) |
| App image tags | `ghcr.io/imranr98/dscpln-<app>` |
| Agent image | `ghcr.io/imranr98/dscpln-agent` |
| Config/state files | `config.json`, `.dscpln-*-state.json`, mode `0600` |
| Task Runner state excluded from git | `.backup-state-*` |
| Media XMP tags | `XMP-media-sync:*` |

## Base-path contract

Every app except Portal can be mounted under a prefix. `BASE_PATH=""` is the
local-development default.

- The server calls `createApp({ basePath })`, mounts routes and static files at
  the prefix, and injects `<base href="${basePath}/">` and
  `window.DSCPLN_BASE` into the HTML.
- The client builds every fetch, EventSource and asset URL through
  `DSCPLN.apiUrl()`, which resolves relative to `document.baseURI`. Do not use
  leading-slash fetch paths.
- Health always answers at `<basePath>/api/health`; the root `/api/health` is
  also accepted.
- Tests must cover both an empty base path and a non-empty prefix.

## Shared packages

### `packages/server-kit`

Shared Express and persistence primitives, with no app-specific logic:

- `atomicWriteFile`/`atomicWriteJson`, `expandPath`, `deepMerge`,
  `ValidationError`.
- `configStore(file, {defaults, normalize, validate})`: load/save with change
  events and mode `0600`.
- `stateStore(file)`: last run, bounded history, next run, paused, missed and
  `lastScheduledRun`.
- `Scheduler({getSpec, onDue, now, isBusy})`: 30-second tick, catch-up across
  restarts, injectable clock.
- `Runner({logDir})`: one run at a time, detached process groups, line
  streaming to a ring buffer and `logs/last.log`, cancellation and state
  callbacks.
- `Notifier({url, token, notifySuccess})`: direct ntfy or Portal relay.
- `createApp(...)`: base path, CSRF origin check, HTML injection and the common
  routes for state, config, run, cancel, pause, log, events and health.
- `http.mjs`: JSON responses, size-capped body reading, same-origin checks and
  async route handling.

Task Runner uses `Scheduler` per task. A task schedule is
`{enabled, days, at, catchUp}`, with `days` using JavaScript weekdays and an
empty list meaning daily. Schedule markers live under
`BACKUPCTL_STATE_DIR/schedules/`. Unattended tasks cannot use uploads, prompts,
`require`, `browser` or `commit_dir`. Notification preference is
`notify: never|errors|always`.

### `packages/ui-kit`

Shared React components and helpers:

- `api.js`: base-path-aware `apiUrl`, JSON helpers, uploads with progress and
  abort, health pings and SSE subscriptions.
- `format.js` / `dates.js`: display formatting and local-date calendar helpers.
- `theme.js`: Pico `data-theme` handling, with auto/light/dark and localStorage.
- `paths.js`: dotted-path get/set for config forms.
- Components: `Shell`, `LogDialog`, `SettingsDialog`, `ThemeToggle`, `Toasts`,
  `Breakable` and `AppErrorBoundary`.
- Hooks: `useModal` and `usePolling`.
- `mountApp(App)`: renders an app inside the error boundary.
- `vite.mjs`: `appViteConfig(import.meta.url)` so app Vite configs stay small.
- `app.css`: Pico imports and shared custom rules.

### `packages/test-kit`

Shared test helpers: `tempDir`, `listen`, `withApp`, `waitFor`, and optional
Chromium helpers (`launchBrowser`, `browserAvailable`, `have`).

## Configuration and state

Apps read config and keep state separately:

| App | Config | State |
|---|---|---|
| Portal | `DSCPLN_CONFIG_FILE` (default `$DSCPLN_DATA_DIR/config.json`) | App volume |
| Balance XLSX | `DSCPLN_CONFIG` | `api.stateFile` next to the workbook |
| File Pipelines | `--config` (container `/config/config.json`) | Staging, review, trash and log paths from config |
| Task Runner | `BACKUPCTL_CONFIG_FILE` | `BACKUPCTL_STATE_DIR` (`tasks/`, `schedules/`, `running.json`) |
| WhatsApp TXT | Data directory | Conversation JSON files |
| Agent | `DSCPLN_AGENT_CONFIG` | `stateDir` |

`config-template/` is a starter for a private config repository. It is not
required by the public apps.

## UI build pipeline

Each app has `apps/<app>/ui/` (Vite + React + Pico) that builds into
`apps/<app>/static/` (gitignored). The server serves `static/` and injects the
base path. `appViteConfig` sets `base: './'`, so the same build works under any
prefix.

```sh
npm run build:ui --workspace <pkg>   # build one UI
npm run ui                           # build all UIs
npm test                             # build first, then run tests
```

## Safety and hardening

- **Secrets are write-only over the API.** `configStore({secrets})` masks set
  fields in `GET /api/config` and `/api/state`. Saving a mask keeps the stored
  value; an explicit empty string clears it. Apps resolve masked values
  internally for actions such as test-auth.
- **Interrupted runs are visible.** `stateStore.beginRun()` writes a marker
  that `recordRun()` clears. A marker without a live run shows as
  `interrupted`.
- **User-data replacements are atomic.** Config/state use kit atomic writes.
  WhatsApp merges write a temp file, fsync and rename. Balance's API token file
  is atomic and `0600`. File Pipelines containment-checks review IDs.
- **Containers are hardened.** Apps drop all capabilities, use
  `seccompProfile: RuntimeDefault`, a read-only root filesystem and a
  memory-backed `/tmp`. Task Runner is the exception: its tasks may install
  tools at runtime, and some deployments run it as root to read backup data.
- **UI consistency.** Apps use `@dscpln/ui-kit`, the
  `D$CPLN ⋅ <App>` header and a small set of app-specific CSS rules. Tests use
  `data-testid` selectors so markup changes do not break them.

## Adding an app

1. Create `apps/<name>/` with `server.mjs` (`scheduledApp` for scheduled apps)
   and a `package.json` depending on `@dscpln/server-kit`.
2. Add `ui/` with `src/main.jsx` using `mountApp(App)` and an `App.jsx` built
   from `@dscpln/ui-kit`. Add the page to `scripts/sync-app-html.mjs`, then run
   it. `vite.config.mjs` should call `appViteConfig(import.meta.url)`.
3. Add scripts `build:ui` and `test` (`npm run build:ui && node --test`).
4. Add tests under `test/`: unit tests plus a browser test using `data-testid`
   selectors and `@dscpln/test-kit`.
5. Add the app to the unified `docker/app.Dockerfile`, the root scripts and the
   deployment templates that run it.
6. Document the app's purpose, quick start and config in `apps/<name>/README.md`.

See the [project README](../README.md) for the app list and
[Operations](OPERATIONS.md) for deployment.
