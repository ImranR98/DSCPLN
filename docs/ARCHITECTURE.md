# D$CPLN architecture

One monorepo, one host, one design system.

```
DSCPLN/
  packages/
    server-kit/     shared Node/express primitives (no app logic)
    ui-kit/         shared React components, helpers, Pico-based styling
    test-kit/       shared test helpers (servers, temp dirs, polling)
  apps/
    portal/         root landing page (host root)
    balance-xlsx/   Balance XLSX          /balance
    file-pipelines/     File Pipelines            /pipelines
    whatsapp-txt/   WhatsApp TXT          /watxt
    task-runner/    Task Runner           /tasks
    contacts-calendar/ Contacts + Calendar /contacts
    compose-state/  Infra Compose State    /compose
    ytmusic/        YTMusic Downloads     /ytmusic
  scripts/          build helpers (one image per app)
```

## Naming

| thing | convention |
|---|---|
| UI header / document title | `D$CPLN ⋅ <Function>` (`⋅` = U+22C5) |
| images | `imranrdev/dscpln-<app>` |
| config/state on a PVC | `config.json`, `.dscpln-*-state.json`, mode `0600`, atomic writes |
| app state files excluded from git commits | `.backup-state-*` (Task Runner), keep the exclusion pattern |
| media XMP tags | `XMP-media-sync:*` (written on concatenated outputs) |

## Base-path contract

Every app mounts everything under `BASE_PATH` (`""` for local dev):

- server: `createApp({ basePath })` mounts routes/static at the prefix and
  injects `<base href="${basePath}/">` + `window.DSCPLN_BASE` into HTML;
- client: all fetch/EventSource/asset URLs go through `DSCPLN.apiUrl()`
  (which resolves relative to `document.baseURI`) — never leading-slash fetch
  paths;
- probes: `${BASE_PATH}/api/health` (root `/api/health` also answers);
- tests must cover `BASE_PATH=""` and a non-empty prefix.

## Kits

`packages/server-kit` (ESM, express):

- `atomicWriteFile/Json`, `expandPath`, `deepMerge`, `ValidationError`
- `configStore(file, { defaults, normalize, validate })` — load/save with
  change events, mode 0600
- `stateStore(file)` — last run, bounded history, next run, paused, missed,
  `lastScheduledRun` (scheduler catch-up)
- `Scheduler({ getSpec, onDue, now, isBusy })` — spec
  `{ enabled, days: [0..6], at: "HH:MM", catchUp }` (empty days = daily);
  30 s tick, busy → missed, catch-up across restarts, injectable clock
- `Runner({ logDir })` — one run at a time, detached process groups, line
  streaming to ring buffer + `logs/last.log`, `cancel()`, `onLine/onState`
- `Notifier({ url, token, notifySuccess })` — direct ntfy (the portal); with
  `relayUrl` set (apps) it POSTs to the portal's `/api/notify` instead;
  failures always notify
- `createApp({ title, basePath, routes, staticDir, config, state, runner, run })`
  — base path, CSRF origin check, HTML injection, standard routes:
  `GET /api/state`, `GET/PUT /api/config`, `POST /api/run`, `POST /api/cancel`,
  `POST /api/pause`, `GET /api/log`, `GET /api/events` (SSE), `GET /api/health`
- `http.mjs` — `sendJson`, `readBody` (size-capped), `sameOrigin`,
  `asyncRoute`

`packages/ui-kit` (React + Pico CSS):

- `api.js` — base-path-aware `apiUrl`, `getJson`/`postJson`/`putJson`/
  `deleteJson` (all throwing `ApiError` with the HTTP status), `uploadFile`
  (XHR progress + `.abort()`), `ping`, SSE `subscribe`
- `format.js` / `dates.js` — display formatters and local-date calendar helpers
- `theme.js` — Pico `data-theme` handling (auto/light/dark, localStorage)
- `paths.js` — dotted-path get/set for config forms
- components — `Shell` (header, status pill, overview tiles, run/pause, log +
  settings dialogs), `LogDialog`, `SettingsDialog`, `ThemeToggle`, `Toasts`,
  `Breakable` (money wrapping), `AppErrorBoundary`
- hooks — `useModal` (show a `<dialog>` as a true modal), `usePolling`
- `mountApp(App)` — renders an app inside the error boundary (each
  `main.jsx` is three lines: css imports + `mountApp(App)`)
- `vite.mjs` — `appViteConfig(import.meta.url)` factory so every app's
  `vite.config.mjs` is a three-line call (multi-page apps pass `inputs`)
- `app.css` — imports Pico and holds the few shared custom rules

`packages/test-kit` — shared test helpers: `tempDir`, `listen`, `withApp`,
`waitFor`, and the optional-Chromium helpers `launchBrowser`,
`browserAvailable`, `have`.

## App UI pipeline

Every app has `apps/<app>/ui/` (Vite + React + Pico) that builds into
`apps/<app>/static/` (gitignored). The server serves `static/` and injects
`<base href>` for `BASE_PATH`; the shared `appViteConfig` uses `base: './'` so
the build works under any prefix. `npm run build:ui --workspace <pkg>` builds
(or `npm run ui` for all); `npm test` builds first; the Dockerfile builds the
UI in its layer and prunes dev deps. Balance builds three pages from one Vite
config (`index`/`insights`/`settings`).

The scaffolding is deliberately uniform and mostly generated:

- `scripts/sync-app-html.mjs` writes every `ui/*.html` from one template
  (head, favicon, pre-paint theme bootstrap, module entry); `--check` reports
  drift. Add the page to its PAGES map when adding an app/page.
- `mountApp` + `appViteConfig` keep `main.jsx`/`vite.config.mjs` to a few lines
  with no per-app drift.
- React apps are decomposed by convention: `components/` for view components,
  `lib/` for pure model/format helpers, hooks in the component or `hooks/`.

## Hardening & safety conventions (review pass)

- **Secrets are write-only over the API**: `configStore({ secrets })` masks set
  secret fields (`••••••••`) in `GET /api/config` and `/api/state` — fields may
  be top-level names or dotted paths (`ntfy.token`); saving the
  mask keeps the stored value, an explicit empty string clears it. Apps resolve
  a masked value back to the stored one for actions (discover/test-auth).
- **Interrupted runs are visible**: `stateStore.beginRun()` writes a marker that
  `recordRun()` clears; the shell shows an `interrupted` status pill when a
  marker has no live run (crash/OOM detection).
- **Files that replace user data are atomic**: kit atomic writes for
  config/state; watxt merges write temp+fsync+rename and only delete old
  outputs after every write; balance's API token file is atomic + 0600;
  file-pipelines review ids are containment-checked (no escape from the park dir).
- **Pods are hardened**: every app drops ALL capabilities, runs with
  `seccompProfile: RuntimeDefault` and `readOnlyRootFilesystem: true` plus a
  memory-backed `/tmp`; Task Runner is the exception (its tasks provision tools
  into the image tree at runtime, so its root stays writable).
- **UI consistency**: every app builds its `ui/` (React + Pico via
  `@dscpln/ui-kit`), uses the `D$CPLN ⋅ <Function>` header, and keeps custom
  CSS to a few app-specific rules — Pico and the kit supply the rest. Tests use
  `data-testid` selectors so they survive markup changes.

## Operations runbook

In the example deployment everything is served from one host
(`https://dscpln.example.com/<function>`, portal at `/`) behind a forward-auth
proxy (Authelia); only `/balance/api` bypasses it (token-protected). Any
reverse proxy works — the apps only need `BASE_PATH` set per subpath.

| App | Path | Deployment | Config/state | Schedule |
|---|---|---|---|---|
| Portal | `/` | `portal` | config PVC → `/data/config.json` (ntfy settings; notification relay) | — |
| Balance XLSX | `/balance` | `balance-xlsx` | config Secret → `/app/config.json`; API state next to the workbook | — (limit checks every 30 min) |
| File Pipelines | `/pipelines` | `file-pipelines` | config PVC → `/config/config.json` | daemon + snapshot scheduler (Jobs on remote nodes) |
| WhatsApp TXT | `/watxt` | `whatsapp-txt` | data PVC → `/data` (conversations) | — |
| Task Runner | `/tasks` | `task-runner` | mounted config file, state in `~/.backupctl` | per-task `serial_key` |
| Contacts + Calendar | `/contacts` | `contacts-calendar` | config PVC → `/data/{config,state}.json` | Sun 03:00 |
| Infra Compose State | `/compose` | `compose-state` | config PVC → `/data/{config,state}.json` | Sun 04:00 |
| YTMusic Downloads | `/ytmusic` | `ytmusic` | config PVC → `/data/{config,state}.json` | daily 05:00 |

**Checking an app**

- Portal pills: `online`/`unreachable` from `GET /<path>/api/health`, plus a
  detail line per app and an "N need attention" count. What the portal reads:
  scheduled apps `GET /<path>/api/state` (last run, next run, missed, paused),
  File Pipelines `GET /pipelines/api/state` (queue/error counts), WhatsApp TXT
  `GET /watxt/api/state` (conversations/messages), Task Runner
  `GET /tasks/api/tasks` (per-task last run), Balance `GET /balance/status`
  (budget overage; memoized 60 s so the poll stays cheap).
- State: `GET /<path>/api/state` → `lastRun`, `history` (bounded), `nextRun`,
  `missed`, `runMarker` (non-null while a run is active).
- Logs: the UI log dialog (SSE), `GET /<path>/api/log`, `kubectl -n apps logs
  deploy/<name>`, and the runner's `<data>/logs/last.log`.
- Kubeconfigs that are re-encrypted at rest (as in the example deployment)
  need unlocking before helm/kubectl work; that mechanism lives in the
  deployment repo, not here.

**Notifications**

- The portal owns the notification channel: its Settings hold one ntfy URL +
  write-only token, and every app (File Pipelines, Contacts, Compose State,
  YTMusic, Balance) posts to `POST /<portal>/api/notify` over
  `DSCPLN_PORTAL_URL` (e.g. `http://portal:8080`) instead of talking to ntfy.
  The portal is the only workload allowed to reach ntfy.
- Apps keep only their behaviour toggles: `notifySuccess` (top-level config;
  old `ntfy.notifySuccess` values are migrated on first load) and File
  Pipelines' per-folder `notify: all|errors`. Notifications stop if the portal
  is down — that is the tradeoff for a single credential store.
- Titles are latin-1 (`HTTP` headers are ByteString): the kit's Notifier
  sanitizes non-ASCII automatically and follows one convention —
  run results `D$CPLN - <Function> OK|FAILED`, event notifications
  `D$CPLN - <Function>: <event>` (ASCII `-`; the ntfy apps mangle non-ASCII
  header characters).
- Priority/tags: success `default` + `white_check_mark`; failure `high` +
  `warning`; warnings (balance over budget) `default` + `warning`; File Pipelines
  info `low` + `white_check_mark`.
- Tapping a notification opens the app when the sending pod has
  `DSCPLN_ORIGIN` (`https://dscpln.<domain>`) — the kit builds
  `DSCPLN_ORIGIN + BASE_PATH` and sends it as the ntfy `Click` header.
- Failures always notify; successes only when each app's `notifySuccess` is on
  (contacts/compose on; ytmusic off — daily runs would be spam). File Pipelines
  keeps its per-folder `notify: all|errors` setting.
- The portal has a test button/endpoint: `POST /api/notify/test`.

**Scheduler semantics** (`packages/server-kit/scheduler.mjs`)

- Spec `{enabled, days: [0..6] (empty = daily), at: "HH:MM" local, catchUp}`;
  30 s tick.
- Fresh install (no persisted `lastScheduledRun`): the latest occurrence is
  adopted without firing.
- `catchUp: true` fires any occurrence newer than the persisted marker (app was
  down over the scheduled time); `catchUp: false` records it as missed unless it
  is < 90 s old.
- A due occurrence that lands while a run is active is counted as missed.

**Retention & trash**

- Compose State: retention 1 archive per target; the old archive is removed only
  after the new one is written (destination `~/compose_state_backups`).
- File Pipelines: staged copies are verified before originals move to trash; review
  items park in the review dir until approved.
- WhatsApp TXT: merges write temp files that are fsynced+renamed; old outputs
  are deleted only after every write succeeds.
- Contacts: exports replace files atomically and git-commit in
  `~/Main/Backups/Manual`.
- YTMusic: existing video IDs are skipped; playlist `.m3u8` files are rebuilt
  each run.

**Building & deploying an image**

```bash
# on the PC, from the monorepo root (context = repo root). Every app image is
# FROM the shared base (monorepo + full workspace install), so refresh it
# first; scripts/build-all.sh does both:
scripts/build-base.sh
scripts/build.sh <app>

# or all apps at once (prints the digest table):
scripts/build-all.sh

# pin the digest in your deployment repo's template for the app, then deploy:
helm upgrade --install <release> <chart> -n apps
kubectl -n apps rollout status deploy/<deployment>
```

`scripts/build-all.sh` wraps the per-app loop: it builds/pushes each app, prints
a digest table, and with `--pin` writes the digests into your deployment repo
(`INFRA_DIR`; it refuses a dirty checkout). `REGISTRY`/`IMAGE_ORG` choose where
images are pushed. The example Kubernetes templates share a `_helpers.tpl`
(pod/container security contexts, readiness probe, Service) so the hardening
posture and Service shape stay uniform.

Renovate bumps the pinned digests; never leave a floating tag unpinned.

**Balance API**

The token-protected API lives under the app's path:
`https://<your-host>/balance/api` (no trailing rewrite needed). Update any
phone shortcuts or scripts that still point at an older hostname.

## New-app recipe

1. `apps/<name>/` with `server.mjs` (`scheduledApp` for scheduled apps) and
   `package.json` depending on `@dscpln/server-kit`;
2. `ui/` with `src/main.jsx` (`import '@dscpln/ui-kit/app.css'`, the app css,
   then `mountApp(App)`) and `src/App.jsx` using `@dscpln/ui-kit`
   (`Shell` + components); add the page to `scripts/sync-app-html.mjs` and run
   it; `vite.config.mjs` is `appViteConfig(import.meta.url)`; scripts
   `build:ui` and `test` (`npm run build:ui && node --test`);
3. tests under `test/` (unit + a Playwright browser test using `data-testid`
   selectors and `@dscpln/test-kit` helpers), plus the Infra template and a
   Dockerfile `FROM imranrdev/dscpln-base:latest` (app packages, build UI,
   prune dev deps).
