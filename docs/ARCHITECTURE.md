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

## Hardening & safety conventions (review pass)

- **Secrets are write-only over the API**: `configStore({ secrets })` masks set
  secret fields (`••••••••`) in `GET /api/config` and `/api/state`; saving the
  mask keeps the stored value, an explicit empty string clears it. Apps resolve
  a masked value back to the stored one for actions (discover/test-auth).
- **Interrupted runs are visible**: `stateStore.beginRun()` writes a marker that
  `recordRun()` clears; the shell shows an `interrupted` status pill when a
  marker has no live run (crash/OOM detection).
- **Files that replace user data are atomic**: kit atomic writes for
  config/state; watxt merges write temp+fsync+rename and only delete old
  outputs after every write; balance's API token file is atomic + 0600;
  media-sync review ids are containment-checked (no escape from the park dir).
- **Pods are hardened**: every app drops ALL capabilities, runs with
  `seccompProfile: RuntimeDefault` and `readOnlyRootFilesystem: true` plus a
  memory-backed `/tmp`; Task Runner is the exception (its tasks provision tools
  into the image tree at runtime, so its root stays writable).
- **UI consistency**: every app loads `ui/theme-boot.js`, the vendored Shoelace
  themes, `ui/style.css`, `ui/core.js` (+ `ui/shell.js` for scheduled apps) and
  uses the `D$CPLN ⋅ <Function>` header; app stylesheets only contain
  app-specific rules (kit tokens/components come from the shared file).

## Operations runbook

Everything is served from `https://dscpln.home.example.com/<function>` (portal at
`/`) behind Authelia SSO; only `/balance/api` bypasses SSO (token-protected).

| App | Path | Deployment | Config/state | Schedule |
|---|---|---|---|---|
| Portal | `/` | `portal` | — | — |
| Balance XLSX | `/balance` | `balance-xlsx` | config Secret → `/app/config.json`; API state next to the workbook | — (limit checks every 30 min) |
| Media Sync | `/media` | `media-sync` | `media-sync-config-pvc` → `/config/config.json` | daemon (no scheduler) |
| WhatsApp TXT | `/watxt` | `whatsapp-txt` | `wa-txt` PVC → `/data` (conversations) | — |
| Task Runner | `/tasks` | `task-runner` | config from the synced repo (`/config-src/...`), state in `~/.backupctl` | per-task `schedule:` |
| Contacts + Calendar | `/contacts` | `contacts-calendar` | `contacts-config-pvc` → `/data/{config,state}.json` | Sun 03:00 |
| Infra Compose State | `/compose` | `compose-state` | `compose-state-pvc` → `/data/{config,state}.json` | Sun 04:00 |
| YTMusic Downloads | `/ytmusic` | `ytmusic` | `ytmusic-pvc` → `/data/{config,state}.json` | daily 05:00 |

**Checking an app**

- Portal pills: `online`/`unreachable` from `GET /<path>/api/health`, plus the
  next run for the scheduled apps (from `/api/state`, refreshed every 60 s).
- State: `GET /<path>/api/state` → `lastRun`, `history` (bounded), `nextRun`,
  `missed`, `runMarker` (non-null while a run is active).
- Logs: the UI log dialog (SSE), `GET /<path>/api/log`, `kubectl -n apps logs
  deploy/<name>`, and the runner's `<data>/logs/last.log`.
- If helm/kubectl reports `permission denied`, the kubeconfig has relocked —
  run `bash scripts/kubeconfig-unlock.sh` in `~/Main/Infra` on srv0.

**Notifications**

- Every app posts to the single in-cluster topic
  `http://ntfy.base.svc.cluster.local:3000/srv0_services_dscpln` with the
  write-only token stored in each app's config (balance uses the same URL via
  its config Secret).
- Failures always notify; successes only when each app's `ntfy.notifySuccess`
  is on (contacts/compose on; ytmusic off — daily runs would be spam).
- Titles must stay latin-1 (`HTTP` headers are ByteString): the kit's Notifier
  sanitizes non-ASCII automatically and uses `D$CPLN · <app> OK|FAILED`.
- Media Sync has a test button/endpoint: `POST /media/api/ntfy-test`.

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
  after the new one is written (destination `~/Main/Infra/compose_state_backups`).
- Media Sync: staged copies are verified before originals move to trash; review
  items park in the review dir until approved.
- WhatsApp TXT: merges write temp files that are fsynced+renamed; old outputs
  are deleted only after every write succeeds.
- Contacts: exports replace files atomically and git-commit in
  `~/Main/Backups/Manual`.
- YTMusic: existing video IDs are skipped; playlist `.m3u8` files are rebuilt
  each run.

**Building & deploying an image**

```bash
# on the PC, from the monorepo root (context = repo root):
podman build --platform linux/amd64 -f apps/<app>/Dockerfile -t docker.io/imranrdev/dscpln-<image>:latest .
podman push --digestfile /tmp/<image>.digest docker.io/imranrdev/dscpln-<image>:latest
skopeo inspect docker://docker.io/imranrdev/dscpln-<image>:latest --format '{{.Digest}}'

# pin the digest in ~/Main/Infra/targets/srv0/k3s-apps/templates/<app>.yaml, then on srv0:
cd ~/Main/Infra && bash scripts/validate.sh srv0
helm upgrade --install srv0-apps targets/srv0/k3s-apps -n apps
kubectl -n apps rollout status deploy/<deployment>
```

Renovate bumps the pinned digests; never leave a floating tag unpinned.

**Balance API**

The old standalone Balance host is retired; the token-protected API keeps its
path on the shared host: `https://dscpln.home.example.com/balance/api` (no
trailing rewrite needed). On-disk automations use the new host; if a phone
shortcut still points at the old hostname, update it.

## New-app recipe

1. `apps/<name>/package.json` depending on `@dscpln/server-kit`;
2. `server.mjs`: `configStore` + `stateStore` + `Runner` + `Scheduler`
   (`onDue: () => runNow('schedule')`), a `runNow` that guards against
   concurrent runs, records state and notifies;
3. `static/index.html` links `ui/vendor/shoelace/*`, `ui/style.css`,
   `ui/core.js`, `ui/shell.js`; `app.js` calls `DSCPLNShell.mount(...)`;
4. a `Dockerfile` (context = repo root), an Infra template, and tests
   (unit + a Playwright check under a non-empty `BASE_PATH`).
