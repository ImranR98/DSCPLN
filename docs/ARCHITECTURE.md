# D$CPLN architecture

One monorepo, one host, one design system.

```
DSCPLN/
  packages/
    server-kit/     shared Node/express primitives (no app logic)
    ui-kit/         shared browser kit, design system, vendored Shoelace
  apps/
    portal/         root landing page (host root)
    balance-xlsx/   Balance XLSX      /balance    (k8s deployment: dscpln)
    media-sync/     Media Sync        /media      (k8s deployment: media-sync)
    whatsapp-txt/   WhatsApp TXT      /watxt      (k8s deployment: whatsapp-txt-browser)
    task-runner/    Task Runner       /tasks      (k8s deployment: backupctl)
    contacts-calendar/ Contacts + Calendar /contacts
    compose-state/  Infra Compose State    /compose
    ytmusic/        YTMusic Downloads      /ytmusic
  tools/            absorbed helper scripts invoked by Task Runner (no UI)
  scripts/          build helpers (one image per app)
```

## Naming

| thing | convention |
|---|---|
| UI header / document title | `D$CPLN ⋅ <Function>` (`⋅` = U+22C5) |
| images | `imranrdev/dscpln-<app>` |
| config/state on a PVC | `config.json`, `.dscpln-*-state.json`, mode `0600`, atomic writes |
| app state files excluded from git commits | `.backup-state-*` (Task Runner), keep the exclusion pattern |
| media XMP tags | `XMP-media-sync:*` — the name is frozen, do not rename tags |

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
- `Notifier({ url, token, notifySuccess })` — ntfy; failures always notify
- `createApp({ title, basePath, routes, staticDir, config, state, runner, run })`
  — base path, CSRF origin check, `/ui/*` from ui-kit, HTML injection,
  standard routes: `GET /api/state`, `GET/PUT /api/config`, `POST /api/run`,
  `POST /api/cancel`, `POST /api/pause`, `GET /api/log`, `GET /api/events`
  (SSE), `GET /api/health`

`packages/ui-kit` (served at `${BASE_PATH}/ui/*`):

- `core.js` — `apiUrl`, `el`, `requestJson`, dates/formatters, money,
  `formatBytes/Duration/time/DateTime`, `humanAgo`, theme, toasts;
  `window.DSCPLN` (also `require('@dscpln/ui-kit/core')` for node)
- `shell.js` — standard frame: header (`D$CPLN ⋅ <name>`, status, actions),
  overview card (last/next run, Run now/Stop, history), live log dialog,
  settings dialog (schedule + app fields), SSE wiring
- `style.css` — the design system (tokens with `.light`/`[data-theme="dark"]`
  variants, cards, pills, progress, dialogs, toasts, forms, code blocks)
- `theme-boot.js`, `fonts/`, `vendor/shoelace/`

## New-app recipe

1. `apps/<name>/package.json` depending on `@dscpln/server-kit`;
2. `server.mjs`: `configStore` + `stateStore` + `Runner` + `Scheduler`
   (`onDue: () => runNow('schedule')`), a `runNow` that guards against
   concurrent runs, records state and notifies;
3. `static/index.html` links `ui/vendor/shoelace/*`, `ui/style.css`,
   `ui/core.js`, `ui/shell.js`; `app.js` calls `DSCPLNShell.mount(...)`;
4. a `Dockerfile` (context = repo root), an Infra template, and tests
   (unit + a Playwright check under a non-empty `BASE_PATH`).
