# WhatsApp → Media Sync: implementation record

The backupctl `WhatsApp` task was replaced by two Media Sync folder configs on
srv0. This document records what was built, how it is deployed, and how to
operate it. The app itself is documented in `scripts/media-sync/README.md`.

## Requirements

1. The synced `~/Main/WhatsApp` tree is **mirrored additively** into
   `Backups/Archive/WhatsApp-AllMedia`: raw copies only, never deleted from the
   archive, even when the phone deletes the source.
2. WhatsApp media is **no longer standardized** into `~/Main/Media`.
3. Voice notes are the exception: they can be concatenated (same-day clips per
   chat, with a tone between) and saved to `~/Main/Media/Recordings`, but only
   **case-by-case** — the app prepares merges, the user approves each one.

## What was added to Media Sync

- **`copy` is now the archive method**: `recursive` mirrors whole trees;
  `onChanged: "overwrite"` (default) replaces a changed destination file
  atomically (temp file + rename in the destination directory, so the
  destination never sees a partial file); `includeHidden` brings dot-files
  while sync/temp artifacts (`.stfolder`, `!sync`, `*.tmp`, `.tmp.chck`,
  `.media-sync*`) are always skipped; `cleanup: false` hides and refuses the
  cleanup action; `notify: "errors"` suppresses per-file success
  notifications for bulk runs.
- **`voicenotes` method**: concatenates same-day clips from the same
  chat/folder, standardizes the merged MP4, records the input list in an
  `XMP-media-sync:Inputs` tag, and applies `placement` (below). The clip-date
  scheme is **user-defined** per folder via `datePattern` (capture groups are
  joined, non-digits stripped, must yield `YYYYMMDD`); the WhatsApp folder uses
  `-(\d{8})-` for `PTT-YYYYMMDD-WA####.opus` names.
- **Manual placement (review park)**: `placement: "manual"` folders process on
  demand (`autoProcess: false`) and park the finished file under `reviewDir`.
  The Review dialog lists unprocessed clip groups (checkboxes → Process
  selected) and parked outputs (audio preview, Place / Discard, bulk actions).
  Placing is an atomic rename with the never-overwrite rule; when a same-name
  destination file is provably an earlier merge of the same group (its XMP
  input list is a subset), the UI offers an explicit, confirmed **Replace**.
  Discarded clips are skipped until the source changes or they are explicitly
  re-processed.
- **Adoption without touching the destination**: on startup, each source file
  is `stat`ed at its exact destination path; a size + second-precision mtime
  match means "already mirrored". No destination traversal and no hashing, so
  adopting the existing ~80 GB archive is instant.
- **Startup race fix**: the daemon waits for chokidar's `ready` and re-scans,
  closing the window where files created during startup could be missed until
  the periodic rescan.

## srv0 configuration

Paths are as seen inside the pod (`/destination` is the host's `~/Main`):

| Folder | Source | Destination | Settings |
|---|---|---|---|
| WhatsApp AllMedia | `/destination/WhatsApp` | `/destination/Backups/Archive/WhatsApp-AllMedia` | `copy`, `recursive`, `includeHidden`, `onChanged: overwrite`, `cleanup: false`, `notify: errors`, settle 300s |
| WhatsApp Voice Notes | `/destination/WhatsApp/Media/WhatsApp Voice Notes` | `/destination/Media/Recordings` | `voicenotes`, `datePattern: -(\d{8})-`, `placement: manual`, `autoProcess: false`, settle 60s |

Global: `reviewDir: /destination/.media-sync-review` (same filesystem as the
destinations, so Place is an atomic rename), `stagingDir:
/destination/.media-sync-staging`.

Merged voice notes land flat in `Media/Recordings` as
`YYYY-MM-DD-00-00-00-(YYYYMMDD-merged-<chat>).mp4`; the chat id keeps names
unique across chats on the same day.

## Operations

- **Review voice notes**: media-sync web UI → the Voice Notes card → Review.
  Process a chat/day group, listen to the merge, then Place or Discard.
- **Cleanup** (moving source clips to trash) is optional and verified against
  the XMP input list; it is never automatic. The archive folder refuses cleanup
  entirely, so phone deletions stay a manual phone action.
- **Changing the date scheme** (a different exporter/naming): edit the folder's
  `datePattern` in Settings; a folder whose `datePattern` doesn't match a file
  leaves it `ignored` with a visible message rather than stuck pending.

## Deployment record

- App commits: `737d96b` (feature), `5435f08` (verified replace + startup race),
  `8f4a255` (per-folder notify) in `ImranR98/media-sync`.
- Image: `imranrdev/media-sync:latest` pinned by registry manifest digest in
  `Infra/targets/srv0/k3s-apps/templates/media-sync.yaml` (use
  `scripts/media-sync/build.sh`, which captures the digest via `podman push
  --digestfile` — `podman inspect .RepoDigests` is not the registry digest).
- First adoption run: 814 files already mirrored, 306 copied (files changed
  after the last backupctl archive), 0 recopied after restart.
- Tests: 91 passing (`npm test` in `scripts/media-sync`) covering adoption,
  overwrite/conflict, restart behaviour, the review park (place/discard/replace,
  corrupt clips, tampered files, source deletions), the API surface, and the UI
  via Playwright (skips when no Chromium is installed).
