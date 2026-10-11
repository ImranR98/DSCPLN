# D$CPLN Monorepo Migration — Full Execution Plan

> **Status: complete (P0–P5).** Single host `dscpln.home.example.com` with all
> functions at subpaths + portal; deployments renamed (`balance-xlsx`,
> `media-sync`, `whatsapp-txt`, `task-runner`); absorbed repos archived; old
> local checkouts removed; stale image repos deleted. All Task Runner tasks
> that the apps replaced are retired (Contacts + Calendar verified live; only
> PC-local/manual drop tasks remain).
>
> **Fresh session: read this entire file before touching anything, then execute
> phases P0 → P5 in order. The user has approved the whole plan ("GO"). Work
> autonomously; only stop to ask when something is destructive/irreversible or
> a genuine user preference (this file answers most questions already).**

---

## 0. Mission

Consolidate every data backup/sync workflow into a single monorepo:

- The repo `ImranR98/DSCPLN` (checked out at `~/Main/Code/Apps/D$CPLN` on this
  PC) becomes the umbrella ("D$CPLN").
- Absorb, with full git history: `backupctl`, `Media Sync`, `WhatsAppTXT`, and
  the helper tools (`BrokeETL`, `InstacartFlation`, `Wealthsimpleton`,
  `WineGameSaveBackup`, `YTMusicDL`).
- Rename functions to plain names (no more "Media Sync"): see §4.2.
- All UIs get one consistent design, one shared component/kit layer, and the
  title format `D$CPLN ⋅ <Function>`.
- All functions become reachable at ONE public host with subpaths:
  `https://dscpln.home.example.com/<function>` plus a portal at `/`.
- Build three new scheduled apps on the shared kit: Contacts + Calendar,
  Infra Compose State, YTMusic Downloads. (ProtonMail is intentionally dropped:
  the user will keep doing it manually via Task Runner — do not automate it.)
- Keep k8s resource names and PVCs where possible (no data moves); swap images
  in place; images are renamed `imranrdev/dscpln-*` because they're rebuilt
  anyway.

**Definition of done:** all functions live under `dscpln.home.example.com` with
the unified UI, old per-app hostnames/certs/routes retired, all tests green,
old repos archived on GitHub, docs updated, and no user data affected.

---

## 1. Ground rules — read carefully (sensitive personal data)

### 1.1 Data safety (non-negotiable)

This repo drives backups of the user's personal data. Every change must
preserve these invariants:

- **Never delete user data.** Originals in `~/Main` are never removed except by
  the existing explicit, verified flows (Media Sync cleanup/trash, scoped
  `rm` of temp dirs). Do not add any automatic deletion.
- **Atomic writes** for every config/state/json file: write temp + `rename`
  (see existing helpers in `backupctl/server.mjs` and `media-sync/src/util.js`).
- **Back up before destructive ops.** Before replacing any live deployment's
  image/config, capture what's there (`kubectl get deploy -o yaml`, copy app
  `config.json` out of its PVC/pod if you're about to change schema).
- **Format compatibility**: existing on-disk formats must keep working without
  reprocessing. In particular:
  - `XMP-media-sync:Inputs` / `XMP-media-sync:ExpectedDuration` tags on media
    files (keep the name `media-sync` in the tag; do NOT rename tags).
  - `.backup-state-<task>.json` state files (keep the exact naming/exclusion
    pattern `:(exclude).backup-state-*`).
  - Media Sync `config.json` on its PVC (schema keys stay valid; new keys
    optional), WhatsAppTXT data dir, Task Runner `config.mjs`, and the Balance
    workbook/`.dscpln-api-state.json`.
- **Verify before delete/overwrite**: never overwrite a destination file
  without the existing hash/size checks; keep the trash model.

### 1.2 Testing (bulletproof, not "looks fine")

- Every phase ends with the repo's tests green **and** live verification.
- Run each app's existing tests after moving it (`node --test`), and keep every
  existing test file. When renaming/moving code, tests are the contract.
- Add tests for new behavior: scheduler (injectable clock), config validation,
  base-path URL handling, new app run logic (with stubbed commands where the
  real thing needs network/devices).
- Browser tests: Playwright via `playwright-core` (pinned 1.63.0; Chromium is
  installed at `~/.cache/ms-playwright`, skip the suite cleanly if missing).
  Every UI change needs a browser assertion; **also test each app under its
  BASE_PATH prefix** (e.g. `http://127.0.0.1:PORT/media/`) — this is where
  migrations regress most.
- `npm test` at the monorepo root must run all workspace tests. Never leave a
  failing test behind; fix or (only with strong reason, documented) skip.

### 1.3 Code reuse

- The point of the monorepo is deduplication: **do not copy-paste** server or
  UI plumbing into apps. Everything generic goes in `packages/server-kit` or
  `packages/ui-kit` (§4.3). Apps contain only their domain logic + config
  schema + pages specific to them.
- When porting an app, prefer replacing its private helpers with the kits,
  rather than keeping both.

### 1.4 Production safety

- srv0/k3s is live. Use **in-place image swaps** per deployment (Recreate
  strategy), one app at a time, verify, then move on. Never `helm uninstall`
  the apps chart.
- PVCs and PV names stay as-is; do not recreate them.
- Image pins are **registry manifest digests**. `podman image inspect
  --format '{{index .RepoDigests 0}}'` returns a digest that may NOT exist on
  the registry — always use `podman push --digestfile` (the repo's `build.sh`
  does) or verify with `skopeo inspect docker://…@sha256:…`.
- When you change which TLS certs the Gateway should serve, you MUST also
  update the cert inventory in
  `Infra/targets/srv0/k3s-base/templates/gateway.yaml` (`gateway.certRefs`)
  and upgrade `srv0-base`. Missing entries = Traefik serves
  `TRAEFIK DEFAULT CERT` (this exact bug happened to backupctl).
- `scripts/validate.sh srv0` on srv0 checks rendered charts + certRefs; run it
  before every helm upgrade.

### 1.5 Secrets

- App secrets (Nextcloud app password, YTMusic `browser.json`, compose SSH
  key) live in each app's `config.json` on its Longhorn PVC, mode `0600`,
  editable from the UI. Same model as Media Sync. Never commit secrets.
- k8s `config/srv0/values.yaml` (gitignored) holds infra secrets; it is synced
  to srv0 via Syncthing. Edit on the PC; verify the change arrived on srv0
  (`ssh … grep …`) before running helm.

---

## 2. Environment and background knowledge

### 2.1 Machines & access

| Thing | Value |
|---|---|
| This PC | working dir `/home/node/Main/Code/Automation/backupctl`; user `imranr`; node 24 |
| **srv0** (k3s host, where everything is deployed) | `ssh -A user@192.0.2.247` (ALWAYS use `-A`: GitHub/deploy commands need the forwarded agent) |
| vps0 (public tunnel/VPS) | `ssh root@vps0.example.com` (from PC or srv0; srv0's access currently relies on a forwarded agent — the new compose app will generate its own key) |
| Domain | `home.example.com` (public DNS → VPS `78.17.71.170`; wildcard `*.home.example.com` is routed by vps0 Traefik through a WireGuard tunnel to srv0's `websecure-proxy` listener; LAN goes to srv0 `websecure`) |
| GitHub | `ImranR98`; all repos are public; SSH push via agent |
| Docker Hub | `imranrdev/*`; credentials live on srv0 in `~/.docker/config.json` |
| Syncthing | `~/Main` (and `~/Main/Code`, `~/Main/Infra`, the app checkouts) syncs PC ↔ srv0. Give it seconds after writing config files; verify with grep on srv0. Do NOT build images from the synced tree — clone fresh on srv0. |

### 2.2 Repositories (state at plan time)

| Repo | Local checkout | Branch | Commits | Purpose |
|---|---|---|---|---|
| `ImranR98/DSCPLN` | `/home/node/Main/Code/Apps/D$CPLN` | main | 47 | becomes the umbrella; currently only the Balance app |
| `ImranR98/backupctl` | `/home/node/Main/Code/Automation/backupctl` | master | 523 | config-driven task runner (PC + srv0 bridge) |
| `ImranR98/media-sync` | `…/backupctl/scripts/media-sync` | main | 7 | media watcher/standardizer daemon + CLI + UI |
| `ImranR98/WhatsAppTXT` | `/tmp/opencode/WhatsAppTXT` (ephemeral — re-clone if gone) | main | 12 | TXT import/merge + conversation browser |
| `ImranR98/BrokeETL` | `…/backupctl/scripts/BrokeETL` | master | 27 | bank statement PDF → JSON parser (tool) |
| `ImranR98/InstacartFlation` | `…/backupctl/scripts/InstacartFlation` | master | 37 | Instacart scraper (tool, still PC-run) |
| `ImranR98/Wealthsimpleton` | `…/backupctl/scripts/Wealthsimpleton` | master | 30 | Wealthsimple scraper (tool, still PC-run) |
| `ImranR98/WineGameSaveBackup` | `…/backupctl/scripts/WineGameSaveBackup` | ? | 1 | bigpc wine save script (tool) |
| `ImranR98/YTMusicDL` | `…/backupctl/scripts/YTMusicDL` | ? | 6 | YouTube Music downloader (will become the `ytmusic` app) |
| `ImranR98/Infra` | `/home/node/Main/Infra` (same path on srv0) | master | — | Helm charts + deploy scripts; NOT part of the merge |

Subtree sources: the backupctl checkout has every submodule checked out; use
those. For WhatsAppTXT re-clone with
`git clone git@github.com:ImranR98/WhatsAppTXT.git /tmp/opencode/WhatsAppTXT`.

### 2.3 The Infra deploy system (how a deployment happens)

Repo: `/home/node/Main/Infra` on both PC and srv0 (git checkout, Syncthing
keeps the working tree roughly in sync — but commands to deploy run on srv0).

- Charts: `targets/srv0/k3s-base` (base layer: gateway, middlewares, Authelia,
  ntfy, CronJobs) and `targets/srv0/k3s-apps` (one template file per app).
- Values: `config/srv0/values.yaml` (gitignored, real values, synced to srv0);
  template at `targets/srv0/config_template/values.yaml`. `MY_UID: 1000` comes
  from the charts' own `values.yaml` (`targets/srv0/k3s-apps/values.yaml`).
- Helm on srv0: `~/.local/bin/helm`. Kubeconfig is usually unlocked; if
  `helm list -n apps` fails with "cluster unreachable", ask the user to run
  `bash scripts/kubeconfig-unlock.sh` (needs their sudo password).
- Deploy loop (all on srv0):
  ```sh
  ssh -A user@192.0.2.247
  cd ~/Main/Infra
  git fetch origin && git reset --hard origin/master     # never `git pull`
  bash scripts/validate.sh srv0                           # expect "validate: OK (srv0)"
  helm upgrade --install srv0-apps targets/srv0/k3s-apps -n apps --create-namespace \
    -f targets/srv0/k3s-apps/values.yaml -f config/srv0/values.yaml
  # base-layer changes (gateway/middlewares) need the other chart too:
  helm upgrade --install srv0-base targets/srv0/k3s-base -n base --create-namespace \
    -f targets/srv0/k3s-base/values.yaml -f config/srv0/values.yaml
  kubectl -n apps rollout status deployment/<name> --timeout=240s
  ```
- Build/push an image (on srv0; fresh clone, forwarded agent for git):
  ```sh
  rm -rf /tmp/<app>-build
  git clone -q --recurse-submodules git@github.com:<owner>/<repo>.git /tmp/<app>-build
  cd /tmp/<app>-build && git checkout -q <sha>
  DIGEST=$(mktemp)
  podman build --platform linux/amd64 -t docker.io/imranrdev/<image>:latest .
  podman push --digestfile "$DIGEST" docker.io/imranrdev/<image>:latest
  cat "$DIGEST"   # pin this exact sha256 in the Infra template
  ```
- After building, edit the template on the PC (`image: imranrdev/<image>:latest@sha256:<digest>`),
  commit + push Infra, then run the deploy loop above.
- Cluster conventions you must follow in new templates (copy from existing):
  `namespace: apps`; `strategy: Recreate` (shared RWO PVCs); `securityContext`
  `fsGroup/runAsUser/runAsGroup = MY_UID` and `seLinuxOptions.level: s0`
  (Main-tree writers use `s0`; Syncthing uses `spc_t: s0` — for apps writing
  into `~/Main` copy dscpln/media-sync which use `level: s0`);
  Longhorn PVCs that hold config/state get `labels: auto-backup: "true"`;
  hostPath PVs for `~/Main` already exist (`hostpath-main-node-main-pvc`);
  HTTPRoutes live in namespace `base` (Traefik resolves Middleware
  `ExtensionRef`s only in the route's namespace) and reference
  geoblock/crowdsec-bouncer/forwardauth-authelia middlewares.

### 2.4 Live services (what exists right now)

| Function | Deployment | Host today | Container port | Key mounts |
|---|---|---|---|---|
| Balance XLSX | `dscpln` | `dscpln.home.example.com` | 3300 | ledger PVC `dscpln-ledger-pvc` (hostPath `/home/node/Main/Documents/Balance`); config Secret `dscpln-config`; image `imranrdev/dscpln:latest@sha256:7c8912ce…` |
| Media Sync | `media-sync` | `media-sync.home.example.com` | 8791 | `/source`=`hostpath-main-node-devicesync-pvc`; `/destination`=`hostpath-main-node-main-pvc`; `/config`=`media-sync-config-pvc` (Longhorn, auto-backup); `/appdata`=`hostpath-main-node-media-sync-pvc`; image `imranrdev/media-sync:latest@sha256:2288b9ee…` |
| WhatsApp TXT | `whatsapp-txt-browser` | `watxt.home.example.com` | 8787 | `/data`=`hostpath-main-node-wa-txt-pvc` (hostPath `/home/node/Main/Backups/WhatsApp TXT`, RW since the import feature); image `imranrdev/whatsapp-txt-browser:latest@sha256:df28a507…` |
| Task Runner (bridge) | `backupctl` | `backupctl.home.example.com` | 8085 | `/home/node`=`backupctl-home-pvc` (Longhorn); `/home/node/Main`=`hostpath-main-node-main-pvc`; `/config-src`=hostPath `/home/node/Main/Code/Automation/backupctl` (read-only, supplies `config.mjs`); env `BACKUPCTL_HOST=srv0`, `BACKUPCTL_CONFIG_FILE=/config-src/config.mjs`, `BACKUPCTL_STATE_DIR=/home/node/.backupctl`, `BACKUPCTL_TMP_DIR=/home/node/tmp`, `GIT_*` identity; image `imranrdev/backupctl:latest@sha256:c6e3f110…` |

Task Runner is also the PC app (`node server.mjs` at
`~/Main/Code/Automation/backupctl`) and is what the user runs weekly. The
bridge runs the same code with `host:`-pinned tasks (18 pins today: PC-only
tasks → `pc`; `serial_key: manual` export tasks → `srv0`).

Not yet built: Contacts + Calendar, Infra Compose State, YTMusic Downloads,
Portal. Deferred indefinitely: Wealthsimple→D$CPLN sync, Instacart app,
Quest ADB, ProtonMail automation (user keeps it manual).

### 2.5 Data layout & invariants (subset you'll touch)

- `~/Main/Backups/Manual` — git-committed small exports; Task Runner serializes
  its commits with `serial_key: manual`.
- `~/Main/Backups/Email` — ProtonMail exports (manual; do not touch).
- `~/Main/Backups/Archive/WhatsApp-AllMedia` — media mirror (Media Sync).
- `~/Main/Backups/WhatsApp TXT` — merged chat JSONs (WhatsAppTXT app data dir).
- `~/Main/Documents/Balance/Balance.xlsx` — the workbook (Balance app source of
  truth); `.dscpln-api-state.json` lives beside it.
- `~/Main/Media/...`, `~/Main/WhatsApp/...`, `~/deviceSync` — Media Sync's world.
- `~/Main/Infra/current_target/compose_live_state` + `compose_state_backups` —
  compose state backups (user-owned files; no docker needed to tar them).
- All app state uses `.backup-state-*` files that are excluded from git commits.

### 2.6 Test infrastructure

- Node: `node --test` (all apps), plus Playwright browser tests in Media Sync
  and WhatsAppTXT. Current counts: Task Runner 48, Media Sync 91, WhatsAppTXT
  17, Balance has its own `test/` suite.
- Playwright: devDependency `playwright-core@1.63.0`; browsers already at
  `~/.cache/ms-playwright` (chromium-1243). Tests skip if launch fails.
- Provide Python tests (if any) where they exist; YTMusicDL/Wealthsimpleton are
  script repos without test suites.

### 2.7 Known quirks and traps

1. **Registry digests**: use `podman push --digestfile`; `podman inspect`
   `.RepoDigests` returned a digest that 404'd on the registry.
2. **Gateway certRefs**: see §1.4; the `validate.sh` check ensures refs match
   rendered Certificates.
3. **Syncthing latency**: after editing files on the PC, verify on srv0
   (`grep`) before restarting pods that read them; new empty dirs sometimes
   lag behind file contents.
4. **kubeconfig locking**: if kubectl/helm fail, ask the user to unlock.
5. **srv0 docker**: `docker` is not usable as user `imranr` there (sudo needs a
   password), but `podman` is fully usable and has the Docker Hub auth.
6. **Express vs raw http**: Task Runner/WhatsAppTXT/Balance use express;
   Media Sync uses `node:http` with its own router. The server kit will use
   express for consistency (add the dependency in the workspace root or per
   app).
7. **`$` in the path**: the umbrella checkout is
   `~/Main/Code/Apps/D$CPLN` — always quote it in shell commands.
8. **Old hostnames die**: after P4 the only app host is `dscpln.…`; the old
   `media-sync.`/`watxt.`/`backupctl.` certs/routes are removed. This is
   intentional.
9. **Balance external API URL changes** to `…/balance/api/…` (documented).

---

## 3. Decisions already made (do not re-ask)

- One monolithic repo named **D$CPLN** (GitHub `ImranR98/DSCPLN`); all functions
  inside; old repos archived after absorption.
- Preserve history via `git subtree`.
- Plain function names; UI title format `D$CPLN ⋅ <Function>`.
- One host `dscpln.home.example.com` with subpaths; root portal lists functions.
- Keep k8s resource names and PVCs; rename only what's easy (subdomains are
  replaced by subpaths; image repos become `imranrdev/dscpln-*`).
- Apps are always-running Node servers; scheduling is Node-side (no CronJobs).
- Secrets in app config on PVCs (0600).
- New apps: Contacts + Calendar, Infra Compose State, YTMusic Downloads.
- ProtonMail stays manual — do not automate it.
- Compose app generates its own SSH key on first boot; shown in the UI for the
  user to authorize on vps0 (replaceable).
- Execute everything in one go; commit + push after each phase.
- Deferred: Wealthsimple→D$CPLN, Instacart app, Quest ADB, any social app.

---

## 4. Target architecture

### 4.1 Monorepo layout

```
DSCPLN/
  package.json                 # npm workspaces: packages/* apps/*
  package-lock.json
  README.md                    # umbrella docs
  docs/
    MONOREPO-MIGRATION-PLAN.md # THIS FILE (keep it; commit it in P0)
    ARCHITECTURE.md            # layout, naming, base-path contract, kit APIs
    REPLACEMENT-PLAN.md        # moved from backupctl docs/ (update statuses)
    media-sync-whatsapp.md     # moved from backupctl docs/media-sync-whatsapp.md
  packages/
    server-kit/                # shared Node/express primitives (no app logic)
    ui-kit/                    # shared browser kit + design system + Shoelace
  apps/
    portal/                    # root landing page
    balance-xlsx/              # (was DSCPLN repo root) workbook server + UI
    media-sync/                # (was media-sync) watcher + queue + CLI + UI
    whatsapp-txt/              # (was WhatsAppTXT) browse + import/merge
    task-runner/               # (was backupctl) config-driven tasks
    contacts-calendar/         # NEW
    compose-state/             # NEW
    ytmusic/                   # NEW + absorbed YTMusicDL downloader
  tools/                       # absorbed helper scripts (no UI)
    broke-etl/  instacart/  wealthsimple/  wine-game-saves/
  scripts/
    build.sh                   # build+push one app image, print registry digest
```

### 4.2 Naming & UI conventions

| dir | display name | image | subpath | k8s deployment (unchanged) | port |
|---|---|---|---|---|---|
| `balance-xlsx` | Balance XLSX | `imranrdev/dscpln-balance` | `/balance` | `dscpln` | 3300 |
| `media-sync` | Media Sync | `imranrdev/dscpln-media-sync` | `/media` | `media-sync` | 8791 |
| `whatsapp-txt` | WhatsApp TXT | `imranrdev/dscpln-watxt` | `/watxt` | `whatsapp-txt-browser` | 8787 |
| `task-runner` | Task Runner | `imranrdev/dscpln-task-runner` | `/tasks` | `backupctl` | 8085 |
| `contacts-calendar` | Contacts + Calendar | `imranrdev/dscpln-contacts` | `/contacts` | `contacts-calendar` (new) | 8080 |
| `compose-state` | Infra Compose State | `imranrdev/dscpln-compose` | `/compose` | `compose-state` (new) | 8080 |
| `ytmusic` | YTMusic Downloads | `imranrdev/dscpln-ytmusic` | `/ytmusic` | `ytmusic` (new) | 8080 |
| `portal` | (root) | `imranrdev/dscpln-portal` | `/` | `portal` (new) | 8080 |

UI header in every app: `D$CPLN ⋅ <display>` (use the `⋅` U+22C5 middle dot).
Document title same.

### 4.3 Shared packages

**`packages/server-kit`** (Node/express, ESM):
- `configStore(file, {defaults, validate})` — load/normalize/validate/atomic
  save (mode 0600), change notifications.
- `stateStore(file)` — last run, run history (bounded), next run, paused.
- `Scheduler({ getSpec, onDue, now })` — spec
  `{enabled, days:[0..6], at:"HH:MM", catchUp:true}` (empty days = daily);
  30 s tick; skips when a run is active (records "missed"); catch-up on boot.
  Fully unit-testable with injected `now`.
- `Runner` — one active run per app; `spawn` with `detached: true`, streamed
  stdout/stderr lines to a ring buffer + `logs/last.log`; `cancel()` kills the
  process group; `onLine` hook for SSE.
- `Notifier({url, token, notifySuccess})` — ntfy POSTs; failures always.
- `createApp({ title, basePath, ... })` — express app that:
  - mounts app routes + static at `basePath` (see base-path contract),
  - adds the CSRF origin check for POSTs (`new URL(origin).host !== req.headers.host` → 403),
  - serves `/ui/*` from `packages/ui-kit`,
  - injects `<base href="${basePath}/">` and
    `<script>window.DSCPLN_BASE=${JSON.stringify(basePath)}</script>` into
    index.html responses,
  - standard routes: `GET /api/state`, `GET/PUT /api/config`, `POST /api/run`,
    `POST /api/cancel`, `GET /api/log`, `GET /api/events` (SSE),
    `GET /api/health` (also reachable as `${basePath}/api/health`),
  - JSON errors.
- Keep it dependency-light (express; everything else stdlib).

**`packages/ui-kit`**:
- `core.js` — union of the current Media Sync `public/core.js` and DSCPLN
  `static/core.js`: `el()`, `requestJson()`, `apiUrl(path)` (resolves against
  `document.baseURI`), `showToast()`, `initTheme()`, icons, `formatBytes`,
  `formatDuration`, date/time formatters. **All app JS must use `apiUrl()` /
  relative URLs — no leading-slash fetch paths.**
- `shell.js` — standard app frame: header (`D$CPLN ⋅ <name>`, status pill,
  pause/resume, settings, refresh, theme), overview card (last/next run,
  duration, result), Run now/Stop, live Log dialog (SSE), Settings dialog
  (schedule + app fields), run-history list.
- `style.css` — ONE design system: merge the Media Sync tokens/components with
  DSCPLN's (pick Media Sync's token names as the base; keep DSCPLN's card/progress
  look), including cards, pills, progress, dialogs, toasts, forms, code blocks.
- `vendor/shoelace/` — one vendored Shoelace (copy from Media Sync's
  `public/vendor/shoelace`; D$CPLN vendors the same version).

**Base-path contract** (apps mount natively under their prefix — no Traefik
strip middleware):
- Server mounts everything under `BASE_PATH` (default `""` for local dev):
  `app.use(basePath, router)`; index served at `${basePath}` and
  `${basePath}/`.
- Probes hit `${BASE_PATH}/api/health` in k8s (update probe paths).
- Client uses `apiUrl()` for fetch/EventSource/audio `src`; HTML asset tags are
  relative. This makes `/media`, `/media/`, and root (dev) all work.
- Tests must cover both `BASE_PATH=""` and a non-empty prefix.

### 4.4 One host, path routing

- Keep `dscpln-prod-tls` (dnsName `dscpln.${SERVICES_DOMAIN}`).
- New consolidated route file (in `k3s-apps`, namespace `base`) with one
  HTTPRoute on host `dscpln.${SERVICES_DOMAIN}`, parentRefs `websecure` +
  `websecure-proxy`, and rules (order matters; put the API bypass first):
  1. `/balance/api` → geoblock + crowdsec, **no Authelia** (Bearer-token API)
     → service `dscpln:3300`
  2. `/balance` → geoblock + crowdsec + forwardauth-authelia → `dscpln:3300`
  3. `/media` → …authelia → `media-sync:8791`
  4. `/watxt` → … → `whatsapp-txt-browser:8787`
  5. `/tasks` → … → `backupctl:8085`
  6. `/contacts` → … → `contacts-calendar:8080`
  7. `/compose` → … → `compose-state:8080`
  8. `/ytmusic` → … → `ytmusic:8080`
  9. `/` → … → `portal:8080`
- Authelia's wildcard rule (`*=admins, two_factor`) already covers the host.
- Delete per-app Certificates/HTTPRoutes for media-sync/watxt/backupctl and
  remove their `gateway.certRefs` entries (keep `dscpln-prod-tls`).
- Portal (`apps/portal`): minimal ui-kit page listing the function links
  (`/balance`, `/media`, `/watxt`, `/tasks`, `/contacts`, `/compose`,
  `/ytmusic`); can later become the dashboard. No PVC.

### 4.5 Images & builds

- One `Dockerfile` per app (`apps/<name>/Dockerfile`), build context = repo
  root (so `packages/` and relevant `tools/` can be copied):
  ```sh
  podman build --platform linux/amd64 -f apps/<name>/Dockerfile -t docker.io/imranrdev/dscpln-<name>:latest .
  ```
- `scripts/build.sh <name>` wraps build+push with `--digestfile` and prints the
  digest, mirroring the existing per-repo `build.sh` files (delete/replace
  those after migration).
- Base images by need: `node:24-slim` generally; ytmusic needs
  node + `python3-venv` + `ffmpeg` (+ pip install of the downloader's
  `requirements.txt` at build time); task-runner needs node 22+ plus bash,
  rsync, openssh-client, git, age, jq, unzip, tar, wget, python3
  (existing Dockerfile); media-sync needs `node:24-slim` + ffmpeg + perl
  (existing); watxt needs node + unzip (existing); compose needs node +
  openssh-client + tar; contacts needs node only (uses fetch).

---

## 5. Per-function migration notes

### 5.1 `apps/balance-xlsx` (was the DSCPLN repo root)

- `git mv` (inside DSCPLN) `server.js api-auth.js category-suggester.js
  config.js config.example.json errors.js notifications.js workbook-git.js
  dataProviders static test mock-data.xlsx scripts/*` into `apps/balance-xlsx/`.
  Keep `package.json` per-app (name `dscpln-balance-xlsx`), `Dockerfile`,
  `build.sh` (or rely on root script).
- `server.js` runs on express and serves HTML at `/`, static at `/static`?
  (check) — mount everything under `BASE_PATH`; inject base tag via the kit.
- Rewrite `static/core.js` usage to `packages/ui-kit/core.js`; keep
  balance-specific helpers (money/number/currencyColor) in the app but import
  the shared base.
- Update HTML pages (`index.html`, `insights.html`, `settings.html`): shared
  shell/design, relative asset URLs, title `D$CPLN ⋅ Balance XLSX`.
- External API becomes `${BASE_PATH}/api/...`; update README/API docs. Keep the
  bearer token endpoints and `/settings` UI behind Authelia.
- Keep `dataProviders/excelDataProvider.js`, `workbook-git.js` behavior and all
  tests passing (they import relative paths — fix imports after the move).
- k8s: template keeps Deployment/Service/PVC/Secret/PV; remove Certificate +
  HTTPRoute (moved to the consolidated route); add `BASE_PATH=/balance`; update
  image to `imranrdev/dscpln-balance`.

### 5.2 `apps/media-sync` (was `media-sync`)

- Subtree the repo into `apps/media-sync/`. Rename the CLI bin
  `bin/media-sync.js` → `bin/media-sync.js`; package name `media-sync`.
  **Keep** `XMP-media-sync:*` tags, existing config keys, the sync-lock file
  names, and trash/staging semantics.
- Replace `public/core.js` + design tokens with `packages/ui-kit`; keep the
  app's domain UI (folder cards, review dialog, trash) but restyle with the
  shared CSS + shell header `D$CPLN ⋅ Media Sync`. Use `apiUrl()` everywhere
  (including SSE and the review audio `src`).
- Server: switch its raw `node:http` API to the server kit's express factory
  (or mount the existing handler behind express) while preserving every route
  and payload; mount under `BASE_PATH`.
- Tests: keep all 91; update paths/imports; browser tests must also pass with
  `BASE_PATH=/media`.
- Task Runner references: `{{media-sync_cli}}` → the new CLI path (see 5.4).
- k8s: same deployment/PVCs; update image to `imranrdev/dscpln-media-sync`,
  entrypoint `node apps/media-sync/src/index.js --config /config/config.json
  --bind 0.0.0.0`, add `BASE_PATH=/media`, probe
  `/media/api/health`, remove Certificate/HTTPRoute.

### 5.3 `apps/whatsapp-txt` (was `WhatsAppTXT`)

- Subtree into `apps/whatsapp-txt/`. Keep `server.mjs`, `WhatsAppTXT.js` merge
  core, import API, and tests.
- UI port: the current page has bespoke CSS (no Shoelace) — rebuild its chrome
  on `ui-kit` (header/title `D$CPLN ⋅ WhatsApp TXT`, theme, toasts, dialogs)
  while keeping the two-pane conversation/search UX. Use `apiUrl()`.
- Mount under `BASE_PATH`; keep `/api/import/*` semantics (auto-merge on
  upload, Preview = dry-run, abort-before-write, one merge at a time,
  200 MB cap, same-origin check, backdrop/Escape dismissal).
- k8s: same PVC `/data`; image `imranrdev/dscpln-watxt`; entrypoint
  `sh -c "exec node apps/whatsapp-txt/server.mjs --dir \"$DATA_DIR\" --host
  \"$HOST\" --port \"$PORT\""`; `BASE_PATH=/watxt`; probe `/watxt/api/state`.

### 5.4 `apps/task-runner` (was `backupctl`)

- Subtree the backupctl repo into `apps/task-runner/` (this brings
  `server.mjs`, `lib.sh`, `pty_runner.py`, `index.html`, `config.mjs`,
  `tests/`, `Dockerfile`).
- Remove the absorbed `.gitmodules` and the `scripts/` gitlink entries; the
  tools now live at `tools/…` (5.5) and the media CLI at `apps/media-sync`.
- Config path updates in `config.mjs`:
  - `scriptroot: '{{repo_dir}}/tools'`
  - `media-sync_cli: '{{repo_dir}}/apps/media-sync/bin/media-sync.js'`
  - All task references `{{scriptroot}}/BrokeETL` → `tools/broke-etl`,
    `InstacartFlation` → `tools/instacart`, `Wealthsimpleton` →
    `tools/wealthsimple`, `WineGameSaveBackup` → `tools/wine-game-saves`.
  - The `Music` task gets retired in P3 (ytmusic app), but until then point it
    at `{{repo_dir}}/apps/ytmusic/downloader`.
- `{{repo_dir}}` resolution: the app now sits at `apps/task-runner`, so
  `BACKUPCTL_REPO_DIR` must be the monorepo root. Set it in the root npm script
  and in the bridge deployment; optionally teach `server.mjs` to walk up to the
  nearest `package.json` with a `workspaces` field.
- `lib.sh` helper names (e.g. `bctl_ensure_media-sync`) may be renamed to match
  (`…_media_sync`) but keep behavior; update the config references.
- UI: port `index.html` onto `ui-kit`, title `D$CPLN ⋅ Task Runner`; keep all
  behaviors (drop zone/detect, staging, prompts, serial queues, host gating,
  live logs, paste dialog). Use `apiUrl()`.
- Tests (48) must pass; add a test for `host:` gating if not present (there is
  one). Root script: `npm run task-runner` → starts it locally with
  `BACKUPCTL_REPO_DIR` set.
- Bridge k8s: keep deployment name `backupctl`; update `/config-src` hostPath
  to `/home/node/Main/Code/Apps/D$CPLN` and
  `BACKUPCTL_CONFIG_FILE=/config-src/apps/task-runner/config.mjs`;
  `BACKUPCTL_REPO_DIR=/app`; image `imranrdev/dscpln-task-runner`; entrypoint
  `node apps/task-runner/server.mjs --host 0.0.0.0 --port 8085 --no-browser`;
  `BASE_PATH=/tasks`; probe `/tasks/api/tasks`.

### 5.5 `tools/` (absorbed submodules)

Subtree: `tools/broke-etl`, `tools/instacart`, `tools/wealthsimple`,
`tools/wine-game-saves`. Keep their internal layout unchanged; Task Runner
config points at them. (YTMusicDL is absorbed into `apps/ytmusic/downloader`
instead — see 5.9.) Add a short `tools/README.md` explaining they're invoked
by Task Runner and not apps. If a tool has tests, keep them and wire them into
the root test run where practical.

### 5.6 `apps/portal` (new)

- On the server kit; no PVC; port 8080; `BASE_PATH=""` (host root).
- Page: `D$CPLN` header + cards linking to each function subpath, with a short
  description each. (Optional: health pings to show status pills — good
  enhancement, keep it non-blocking.)
- k8s: Deployment/Service only; route `/` in the consolidated HTTPRoute.

### 5.7 `apps/contacts-calendar` (new)

- **Scheduled export** of Nextcloud address books/calendars into
  `~/Main/Backups/Manual` + git commit.
- In-cluster URL `http://nextcloud:80` (service `nextcloud` in `apps`), DAV
  base `/remote.php/dav`, Basic auth with a Nextcloud **app password**.
- Discovery: PROPFIND the DAV root, follow `calendar-home-set` /
  `addressbook-home-set`, list collections (`resourcetype`, `displayname`).
  Then export each enabled collection (`GET <collection>?export` — verify at
  implementation time; fall back to a REPORT/CALDAV multiget if needed).
- Config: `{ nextcloudUrl, username, appPassword, collections: [{href, type,
  displayName, enabled, filename}], destination, schedule, git: {enabled,
  message} }`. Default filenames preserve today's mapping:
  `My Contacts.vcf`, `TODO.ics`, `Regular.ics`, `Events.ics`.
- Writes atomic; commit via `git -C <dest> add -A . ':(exclude).backup-state-*'
  && git commit` with `GIT_AUTHOR_*`/`GIT_COMMITTER_*` env (values already in
  the bridge deployment; reuse pattern). Tolerate "nothing to commit".
- UI: Discover button, collection list with toggles/filenames, schedule,
  Run now, live log. Image `imranrdev/dscpln-contacts`; PVC for config; Main
  PV for the destination; k8s port 8080; `BASE_PATH=/contacts`.
- Retire Task Runner task `Contacts + Calendar (VCF+ICS)` after live
  verification.

### 5.8 `apps/compose-state` (new)

- **Scheduled backup** of compose runtime state: `srv0` local + `vps0` over SSH.
- srv0: tar `~/Main/Infra/current_target/compose_live_state` directly (files
  are user-owned; **no docker needed**). Use
  `find <dir> \( -type f -o -type d -o -type l \) -print0 | tar cf - --null -T -
  --sparse --ignore-failed-read --warning=no-file-changed
  --warning=no-file-removed` (the existing script's semantics, minus Alpine).
- vps0: same command streamed over SSH:
  `ssh -i <key> -o BatchMode=yes -o StrictHostKeyChecking=accept-new
  root@vps0.example.com "cd <path> && find … | tar cf - …"` → local file.
- Destination `~/Main/Infra/compose_state_backups/`, names
  `<target>-backup-<YYYYMMDD_HHMMSS>.tar`, retention 1 per target, delete
  partial archives on failure.
- **SSH key**: on first boot, if config has no key, generate ed25519
  (`ssh-keygen -t ed25519 -N '' -f <tmp>`), store the private key in
  config.json (0600) and display the public key in the UI with instructions to
  add it to `~/.ssh/authorized_keys` on vps0. Until authorized, the vps0 target
  shows an actionable error. The user can paste a different key.
- Config: `{ targets: [{name, mode:"local"|"ssh", host?, path}], retention,
  schedule, sshPrivateKey, knownHosts }`. Store `known_hosts` in the app data
  dir with `accept-new` on first connect.
- UI: per-target status, Run now, archive list (name/date/size), key
  display/replace. Image `imranrdev/dscpln-compose`; PVC for config; Main PV;
  port 8080; `BASE_PATH=/compose`.
- Retire Task Runner task `Infra Compose State` after live verification.

### 5.9 `apps/ytmusic` (new + absorbed YTMusicDL)

- Subtree YTMusicDL into `apps/ytmusic/downloader/` (keep `ytmusic_dl.py`,
  `requirements.txt`, `validate_m3u8s.sh`, etc.). Add the Node server + UI.
- Container: `node:24-slim` + `python3`, `python3-venv`, `ffmpeg`, `git`? (not
  needed), then create `/app/apps/ytmusic/venv` and
  `pip install -r downloader/requirements.txt` at build time.
- Config: `{ musicDir: "/home/node/Main/Media/Music", schedule,
  browserJson: "<contents of ytmusicapi browser.json>", }`.
- Run: write `browser.json` into the downloader working dir (0600), then
  `python ytmusic_dl.py --dir <musicDir>` (cwd = downloader dir) followed by
  `bash validate_m3u8s.sh <musicDir>`; capture output to the live log.
- Auth UI: textarea to paste `browser.json` contents (masked), a "Test auth"
  button (`python -c "from ytmusicapi import YTMusic;
  print(len(YTMusic('browser.json').get_library_playlists(limit=1)))"`), and a
  clear "expired — paste fresh headers" error path.
- UI: auth panel, schedule, Run now, live log. Image `imranrdev/dscpln-ytmusic`;
  PVC for config; Main PV for the music dir; port 8080; `BASE_PATH=/ytmusic`.
- Retire Task Runner task `Music (YouTube Music Download)`; remove the
  `scripts/YTMusicDL` submodule reference (content now in the app).

### 5.10 New-app defaults

- Scheduler defaults: Contacts weekly (Sunday 03:00), compose weekly
  (Sunday 04:00), ytmusic daily (05:00). `TZ=America/Toronto` env in each
  deployment (schedulers compute local times).
- Notifications via the in-cluster ntfy (`http://ntfy.base.svc.cluster.local:3000/<TARGET>_services_<app>`),
  with the write-only token from values where convenient — or the UI-editable
  config like Media Sync. Failures always notify; success optional.

---

## 6. Execution phases

> Do phases in order. Each phase: implement → tests → commit+push → deploy
> (if applicable) → live verification → move on. Use descriptive commit
> messages in the existing style (imperative, explain the why).

### P0 — Umbrella skeleton

1. In `/home/node/Main/Code/Apps/D$CPLN` (branch `main`, clean):
   create `packages/server-kit`, `packages/ui-kit`, `apps/`, `tools/`,
   `scripts/`.
2. Root `package.json` with `workspaces: ["packages/*", "apps/*"]` and scripts:
   `test` (all workspaces), `task-runner`, `balance`, etc.
3. Move the Balance app into `apps/balance-xlsx/` (`git mv` every current repo
   file except `.git`, `README.md`, `docs/`, `LICENSE`; rewrite the root
   README into the umbrella README and keep the app's README in its dir).
4. Extract `packages/ui-kit`: core.js (union of the two cores), shell, style
   tokens (merge Media Sync + DSCPLN), vendored Shoelace (copy from Media Sync).
5. Extract `packages/server-kit`: config/state stores, runner, scheduler,
   notifier, express factory, base-path middleware. Write unit tests
   (scheduler with injected clock, config store, origin check, base path).
6. Create `apps/portal` on the kit (links only), with a Playwright test.
7. Move `docs/REPLACEMENT-PLAN.md` and `docs/media-sync-whatsapp.md` from the
   backupctl checkout into `docs/` (rename the latter
   `media-sync-whatsapp.md`); write `docs/ARCHITECTURE.md`; keep this plan file.
8. Balance app: port to the kits/base-path, keep its tests green.
9. `npm install` at root, `npm test` green; commit + push.

**Acceptance:** monorepo builds/tests at root; Balance app still deployable
(do NOT deploy yet); portal test passes; plan/architecture docs committed.

### P1 — Absorb Task Runner + tools

1. Ensure subtree sources exist locally:
   - backupctl: `~/Main/Code/Automation/backupctl` (with submodules checked out)
   - tools: `…/scripts/{BrokeETL,InstacartFlation,Wealthsimpleton,WineGameSaveBackup}`
   - media-sync + WhatsAppTXT sources for P2 (submodule + clone).
2. `git subtree add --prefix=tools/broke-etl <path-or-remote> <branch>` etc. for
   the four tools (preserve history). Prefer local path remotes:
   `git remote add tool-broke-etl /path; git fetch tool-broke-etl master`.
3. `git subtree add --prefix=apps/task-runner <backupctl> master`.
4. Remove `apps/task-runner/.gitmodules`; `git rm --cached` the `scripts/*`
   gitlinks; delete empty `apps/task-runner/scripts/` if present.
5. Apply the config/path updates from §5.4; rename helpers if desired; set
   `BACKUPCTL_REPO_DIR` in the root script; port the UI to the kit/base path.
6. Run the 48 tests; run the Task Runner locally on the PC (`npm run
   task-runner`) and verify the UI loads and a harmless task card shows
   correctly (do not run export tasks).
7. Build `imranrdev/dscpln-task-runner` on srv0 (clone DSCPLN at the pushed
   commit, Dockerfile `apps/task-runner/Dockerfile`), pin the digest, update
   `backupctl.yaml` (image, entrypoint, config-src path, envs; add
   `BASE_PATH=/tasks` only in P4 — see note), deploy, verify the bridge UI
   loads and host-pinned tasks still show.
   - NOTE: add the route/base-path env now but do NOT switch routing until P4;
     to keep the bridge reachable at its old hostname until P4, either deploy
     with `BASE_PATH=""` now and flip in P4 (recommended), or flip host+routes
     together. Keep it simple: `BASE_PATH=""` until P4.
8. Commit + push (both DSCPLN and Infra).

**Acceptance:** PC Task Runner works from the monorepo; bridge pod healthy at
the old hostname; all tests green.

### P2 — Absorb Media Sync + WhatsApp TXT

1. Subtree `apps/media-sync` (media-sync) and `apps/whatsapp-txt` (WhatsAppTXT).
2. Apply §5.2/§5.3 refactors (kits, base path, renames, CLI rename). Update
   Task Runner's `media-sync_cli` path and any lib.sh references.
3. Tests: everything green, including browser tests under a prefix.
4. Build `dscpln-media-sync` and `dscpln-watxt`; pin digests; update the two
   Infra templates (images, entrypoints, probe paths, `BASE_PATH=""` for now);
   deploy and verify behavior matches today (media folders/state unchanged,
   watxt browse + a dry-run import).
5. Commit + push.

**Acceptance:** media-sync still adopts/processes correctly (state shows same
folder counts), watxt import preview works, all tests green.

### P3 — New apps

1. Build `apps/contacts-calendar`, `apps/compose-state`, `apps/ytmusic`
   (§5.7–5.9), each with tests (unit + UI).
2. Write Infra templates for each (Deployment/Service/PVC; no Certificate/
   route yet) + values additions if needed; build/pin/deploy.
3. Verify live:
   - contacts: Discover → export → files + git commit in `Manual`.
   - compose: generate key, add public key to vps0 (`ssh root@vps0.example.com
     'cat >> ~/.ssh/authorized_keys' <<< <pubkey>`), run → both tars present;
     restore check (list archive contents), retention works.
   - ytmusic: paste `browser.json`, Test auth, run a download, validate script
     output.
4. Retire Task Runner tasks `Contacts + Calendar (VCF+ICS)`,
   `Infra Compose State`, `Music (YouTube Music Download)`; remove the
   `scripts/YTMusicDL` submodule reference; run Task Runner tests; commit.
5. Commit + push everything.

**Acceptance:** three new apps live at their old-style hostnames for now (or
cluster-IP probes), each with a real successful run; three tasks retired.

### P4 — Routing switch (one host, subpaths)

1. Add `BASE_PATH` envs (`/balance`, `/media`, `/watxt`, `/tasks`, `/contacts`,
   `/compose`, `/ytmusic`) and update readinessProbe paths to
   `${BASE_PATH}/api/...` in every app template.
2. New `k3s-apps/templates/dscpln-ingress.yaml`: the single Certificate
   (`dscpln-prod-tls`) + HTTPRoute with the 9 rules from §4.4. Remove the
   Certificate+HTTPRoute blocks from `dscpln.yaml`, `media-sync.yaml`,
   `whatsapp-txt-browser.yaml`, `backupctl.yaml`.
3. Edit `k3s-base/templates/gateway.yaml` certRefs: remove
   `media-sync-prod-tls`, `watxt-prod-tls`, `backupctl-prod-tls`; keep
   `dscpln-prod-tls`.
4. Deploy `srv0-apps` **and** `srv0-base` (gateway change); rollout all.
5. Verify each path in a browser via Playwright (or curl for the balance API):
   - `https://dscpln.home.example.com/` → portal; each link loads.
   - `/balance` (UI), `/balance/api/...` (token API, no SSO redirect),
     `/media`, `/watxt` (import preview), `/tasks`, `/contacts`, `/compose`,
     `/ytmusic`.
   - SSE works per app (live log ticks).
6. Commit + push.

**Acceptance:** all functions reachable under the single host with valid TLS
(`CN=dscpln.home.example.com`), old hostnames gone, no Authelia bypass except
`/balance/api`.

### P5 — Finish

1. Titles/UI consistency pass across every app (`D$CPLN ⋅ …`), plus umbrella
   README + `docs/ARCHITECTURE.md` + `REPLACEMENT-PLAN.md` statuses (mark
   WATXT/media-sync/task-runner consolidation done; note ProtonMail manual;
   new apps done; deferred items).
2. Archive the absorbed GitHub repos (`backupctl`, `media-sync`,
   `WhatsAppTXT`, `BrokeETL`, `InstacartFlation`, `Wealthsimpleton`,
   `WineGameSaveBackup`, `YTMusicDL`) — `gh repo archive <owner>/<name> -y`
   (ask the user for confirmation first).
3. Remove the old local checkouts from the synced tree
   (`~/Main/Code/Automation/backupctl`) after confirming the monorepo Task
   Runner replaces it — coordinate with the user.
4. Root `npm test` green; final live smoke test of every function.
5. Commit + push.

---

## 7. Infra change checklist

- Edit: `targets/srv0/k3s-apps/templates/dscpln.yaml` (remove cert/route, add
  BASE_PATH, image rename)
- Edit: `media-sync.yaml`, `whatsapp-txt-browser.yaml`, `backupctl.yaml`
  (same treatment; entrypoints/config-src for task-runner)
- Add: `dscpln-ingress.yaml` (Certificate + HTTPRoute, 9 rules)
- Add: `portal.yaml`, `contacts-calendar.yaml`, `compose-state.yaml`,
  `ytmusic.yaml`
- Edit: `targets/srv0/k3s-base/templates/gateway.yaml` (certRefs)
- Possibly add values keys (TZ, ntfy defaults) to `config/srv0/values.yaml`
  and `config_template/values.yaml`
- Commit/push Infra from the PC; on srv0 `git fetch && git reset --hard
  origin/master`; `bash scripts/validate.sh srv0`; helm upgrades.

---

## 8. Verification matrix (run after P4; also per-phase where applicable)

| Function | URL | Check |
|---|---|---|
| Portal | `/` | loads, all links present |
| Balance XLSX | `/balance` | dashboard data loads; `/settings` behind SSO; `/balance/api/categories` with token works without SSO |
| Media Sync | `/media` | folder counts match pre-migration; review dialog opens; SSE live log ticks |
| WhatsApp TXT | `/watxt` | browse/search works; upload + Preview writes nothing; real merge path unchanged |
| Task Runner | `/tasks` | cards render; host pins still show (`Pinned to pc` on bridge); upload/run of a safe task works |
| Contacts + Calendar | `/contacts` | Discover lists collections; Run writes files + commits |
| Compose State | `/compose` | both tars produced; key shown; retention |
| YTMusic | `/ytmusic` | auth test passes; a download run completes |
| TLS | `https://dscpln.home.example.com` | `CN=dscpln.home.example.com` (LE), no default cert |
| Old hosts | e.g. `https://media-sync.home.example.com` | no longer routed (expected) |

Cluster probes: `kubectl -n apps rollout status deployment/<name>`; app
`/api/health` via service ClusterIP from srv0.

---

## 9. Risks, rollback, and etiquette

- **Rollback per app**: the previous image digest remains in git history; if a
  swap misbehaves, revert the template commit and redeploy (PVC state is
  backward compatible because schemas only gain optional keys).
- **Routing rollback**: keep the old per-app Certificate/HTTPRoute blocks in
  git history; restoring them (plus certRefs + srv0-base upgrade) brings the
  old hostnames back if needed.
- **Don't rush the certRefs change**: forgetting it yields default TLS on the
  new host (or legacy hosts), which looks like an outage.
- **Syncthing is not a deployment tool**: always deploy from git (PC → push →
  srv0 reset --hard). Config files synced via Syncthing must be verified to
  have arrived.
- **Ask the user** before: archiving GitHub repos, deleting old local
  checkouts, anything that removes data, or if a required access (kubeconfig
  unlock, vps0 key) is missing.
- **Never** store secrets in git; keep them in PVC configs or gitignored
  `config/srv0/values.yaml`.

---

## 10. Appendix

### 10.1 Repo/image digests at plan time (for reference/rollback)

- `imranrdev/dscpln:latest@sha256:7c8912ce13326c227472b1ef0e395ca9222be0cc09ca82605d6aa539a31719d1`
- `imranrdev/media-sync:latest@sha256:2288b9ee3ead0f604f8b17ae74900302db2a99d31fe13d7fae669d32cdfd0cb4`
- `imranrdev/whatsapp-txt-browser:latest@sha256:df28a50722a76abeb78f97ca474febf0c9b8b33c6a19ec9d5a9bd6f01ccf3b6f`
- `imranrdev/backupctl:latest@sha256:c6e3f1102c337ac4fce1f2bbd1b935e7e48f4cc0a81f804a94f0f8be20441683`

### 10.2 Commit hashes at plan time

- DSCPLN `main`: `1f903e1`
- backupctl `master`: `c61456e`
- media-sync `main`: `8f4a255`
- WhatsAppTXT `main`: `f843e6f`
- Infra `master`: `ec7dd89`

### 10.3 Useful commands

```sh
# clone a source for subtree
git clone -q --recurse-submodules git@github.com:ImranR98/<repo>.git /tmp/opencode/<repo>

# subtree add (example)
cd "/home/node/Main/Code/Apps/D\$CPLN"
git remote add src-media-sync /tmp/opencode/media-sync
git fetch src-media-sync main
git subtree add --prefix=apps/media-sync src-media-sync/main

# build + push an app on srv0 (context = monorepo root)
ssh -A user@192.0.2.247
rm -rf /tmp/dscpln-build && git clone -q git@github.com:ImranR98/DSCPLN.git /tmp/dscpln-build
cd /tmp/dscpln-build && git checkout -q <sha>
D=$(mktemp)
podman build --platform linux/amd64 -f apps/media-sync/Dockerfile -t docker.io/imranrdev/dscpln-media-sync:latest .
podman push --digestfile "$D" docker.io/imranrdev/dscpln-media-sync:latest && cat "$D"

# verify a pushed digest exists
skopeo inspect docker://docker.io/imranrdev/dscpln-media-sync@sha256:<digest> >/dev/null && echo OK

# deploy
cd ~/Main/Infra && git fetch origin && git reset --hard origin/master
bash scripts/validate.sh srv0
helm upgrade --install srv0-apps targets/srv0/k3s-apps -n apps --create-namespace \
  -f targets/srv0/k3s-apps/values.yaml -f config/srv0/values.yaml
helm upgrade --install srv0-base targets/srv0/k3s-base -n base --create-namespace \
  -f targets/srv0/k3s-base/values.yaml -f config/srv0/values.yaml

# probes
IP=$(kubectl -n apps get svc <service> -o jsonpath='{.spec.clusterIP}')
curl -s "http://$IP:<port>/<base>/api/health"
```

### 10.4 Terminology

- **Task Runner** = the former backupctl (PC app + srv0 bridge); tasks are
  config-driven bash workflows with uploads/prompts/state.
- **Media Sync** = the former Media Sync (folder watcher/queue/review/CLI).
- **Bridge** = the srv0 deployment of Task Runner that makes upload/ingest
  tasks remotely runnable.
- **Kit(s)** = `packages/server-kit` and `packages/ui-kit`.
- **BASE_PATH** = the app's subpath prefix (e.g. `/media`); empty locally.
- **certRefs** = the Gateway's explicit inventory of TLS secrets it serves.
```
