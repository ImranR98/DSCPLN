# Server-based replacements for backupctl workflows

This document tracks the plan to replace backupctl's weekly, PC-bound tasks with
dedicated apps that run continuously on `srv0` (the k3s host), each with a web UI
for the manual steps that remain. It is a living record: statuses are updated as
replacements land.

## The replacement pattern

The completed replacements follow the same shape:

| Layer | Pattern |
|---|---|
| App repo | Self-contained server + web UI (`D$CPLN`: Express + ExcelJS + bearer-token `/api`; `Media Sync`: watch daemon + queue + UI + CLI). Own `Dockerfile` and `build.sh` → `imranrdev/<app>:latest`. |
| Deploy | Helm template in `~/Main/Infra/targets/srv0/k3s-apps/templates/<app>.yaml`: 1-replica `Recreate` Deployment, `runAsUser` `MY_UID`, SELinux `s0`/`spc_t`, Service, cert-manager Certificate, `HTTPRoute` (geoblock + CrowdSec + Authelia on both LAN/VPN and public listeners). Image pinned by registry manifest digest. |
| Data | hostPath PVs bound to the `infra.local/hostpath-main` node: `~/Main`, `~/deviceSync`, plus per-app Longhorn PVCs marked `auto-backup: "true"` for config/state. App config rendered from `config/srv0/values.yaml` into a k8s Secret. |
| Auth | UI behind Authelia SSO; machine-only routes bypass SSO behind a revocable bearer token (D$CPLN `/api`) with geoblock/CrowdSec still applied. |
| Notify | In-cluster ntfy (`http://ntfy.base.svc.cluster.local:3000/<TARGET>_services_<app>`) with a write-only token. Failures always notify; bulk-success noise is controlled per folder (`notify: errors`). |
| Safety | Verify-before-delete, trash + retention, atomic staging→destination renames, heartbeat locks, `dryRun`/`paused` toggles, and tests (unit + e2e + browser). |
| Scheduling | Non-interactive work uses k3s CronJobs; interactive apps expose UI buttons + token-guarded run APIs. |

A task is a good candidate when its data is reachable from srv0 (already synced
into `~/Main` or fetchable via HTTP/API/SSH/ADB) and its manual steps can be
reduced to UI clicks. It is a poor candidate when it requires physical phone
interaction with no folder, API, or upload path.

## Status

| Replacement | Replaces | State |
|---|---|---|
| D$CPLN (`~/Main/Code/Apps/D$CPLN`) | backupctl `Balance` task (parse notes → Balance.xlsx) | Done |
| Media Sync (`scripts/media-sync` + `ImranR98/media-sync`) | backupctl `Media Import`; the `WhatsApp` archive task (media mirror + voice notes) | Done (see `media-sync-whatsapp.md`) |
| WATXT (`ImranR98/WhatsAppTXT`, `watxt.<domain>`) | backupctl `WhatsApp TXT` task | Done — upload box + server-side merge/preview in the app; the per-chat phone export stays manual |
| backupctl bridge (`backupctl.<domain>`, container on srv0) | "must be at the PC" for the manual-export long tail | Done — same app/config/UI with `host:` gating; PC-only tasks stay local |

## Candidates

### Tier 1 — strong, do next

| Task | Today | Replacement |
|---|---|---|
| Wealthsimple Recents → D$CPLN | Local Selenium scrape; human pastes rows into D$CPLN | Headless scraper container with a persistent Chromium profile; POSTs to D$CPLN's `/api/transactions` using `/api/categories` for categorisation. UI: "Sync now" + re-login. Now triggerable remotely via the bridge, but not yet continuous. |
| ProtonMail | Password + TOTP prompt, then local CLI export | Container with export CLI + stored password/TOTP seed in a k8s Secret; scheduled; `validate-fresh` + `prune-exports`; ntfy. (Already runnable from the bridge.) |
| Infra Compose State | backupctl prompts for srv0's sudo password, SSHes around | CronJob on srv0 + vps0 over SSH; k8s RBAC/ServiceAccount instead of sudo where possible. |
| Contacts + Calendar | Manual Nextcloud VCF/ICS exports | Source is already Nextcloud on srv0 — scheduled CalDAV/CardDAV (or `occ`) export into `Manual/` + git commit. |
| Instacart Orders | Local Selenium, personal browser profile | Same scraper-container pattern as Wealthsimple; delivery photos → Media Sync CLI. |
| Music (YTMusicDL) | Local download | CronJob + persistent `ytmusicapi` auth; UI button to refresh cookies; `validate_m3u8s.sh`. |

### Tier 2 — creative / experimental

- **Quest Media + Quest Files** — wireless ADB from a container with a persisted
  adb key; removes the cable and the weekly run.
- **Bank Statements** — email-attachment extraction via the ProtonMail export;
  otherwise the bridge's drop zone.
- **Social/data-request flows** (Google, GitHub, Uber, Lyft, Qwen, Medium,
  Instagram, Snapchat, Twitter, TikTok, Reddit, Mastodon) — no public
  export-trigger APIs; keep manual via the bridge, or replace some sources
  with server-side truth (FreshRSS/Linkwarden/Nextcloud already run on srv0).

### Tier 3 — not server candidates

- **PC Files** — needs the PC's local files; a PC-side timer/agent pushing into
  the Main tree, not an srv0 app.
- **Wine Game Save Files** — bigpc is a k8s worker; a CronJob pinned to bigpc
  with hostPath mounts could replace the SSH orchestration.
- **Phone-app exports** (AntennaPod, Molly/Signal, Obtainium, ntfy subs, Read
  You, Cheogram, Bookmarks, …) — the exports are manual (or land on the phone),
  so they stay as backupctl drop tasks, now usable remotely through the bridge.

### Skipped (decided)

- **example.com DNS Records** — Cloudflare config will be stored as Terraform.
- **Bitwarden** and **Aegis 2FA** — being replaced by KeePassXC.

## Roadmap

1. WhatsApp via Media Sync — **done**.
2. WATXT import panel and the backupctl bridge (containerised on srv0 with
   `host:` gating) — **done**.
3. Wealthsimple → D$CPLN, ProtonMail (scheduled rather than button-driven),
   then the trivial CronJobs (infra, contacts, music).
4. Experiments (Quest ADB, social requesters); PC agent.
5. Retire tasks one by one until backupctl is only needed for PC-local jobs
   (the bridge keeps everything else reachable from any browser).
