# File Pipelines

Watches configured folders for new media, processes each file with one of the
file methods below, and **never deletes an original until you explicitly clean
up** — and then only after verifying the destination copy.

Configuration can also be mounted from a private `dscpln-config` repo: set `--config` to its `apps/file-pipelines/config.json`; run state stays on the app volume (`DSCPLN_STATE_FILE` for scheduled apps). See `config-template/README.md`.

## Methods

| method        | what it does |
|---------------|--------------|
| `standardize` | Picks a date (`DateTimeOriginal`, else the oldest date-like tag), writes all date tags, renames to `YYYY-MM-DD-HH-MM-SS-(<original-name>).ext`, and copies into the destination. |
| `snapchat`    | Waits until the folder has been quiet for `settleSeconds` (default 30 min), groups `Snapchat-*.mp4` clips whose timestamps are within `groupWindowSeconds` (default 15s), concatenates + re-encodes each group, standardizes the output, and records the input list in a custom `XMP-media-sync:Inputs` tag on the output. |
| `copy`        | Byte-verified copy, original name preserved (call recordings). Add `recursive: true` to mirror a whole tree (WhatsApp AllMedia archives) and `onChanged` to control what happens when a same-name source changes. |
| `reviewed-audio` | Approval-only audio. With `datePattern` + `concat: true` (default), groups same-day clips and merges them into one MP4 on approval (a 0.1s tone between clips). With `concat: false` or no `datePattern`, standardizes and moves each file individually. Delete trashes the source instead. See Reviewed audio below. |

## Reviewed audio (approval only)

Reviewed audio never processes automatically. The source folder is the queue.
Open **Review**, listen to the source clip(s), and choose one action per item:

- **Grouped mode** (`datePattern` + `concat: true`, the default): a group is
  every clip currently present for one chat directory + clip date.
  **Merge & move** concatenates the group, standardizes the output, moves it to
  the destination, then moves the source clips to trash.
- **Per-file mode** (`concat: false`, or no `datePattern`): each file is listed
  separately. **Standardize & move** standardizes and moves that file, then
  moves the source to trash.
- **Delete** — move the source clip/file to trash; no destination file is
  written.

The Reviewed audio section also offers **Standardize & move all** (or **Merge &
move all** for grouped folders) and **Delete all**. Both ask for confirmation,
process items one at a time, and report any failures without stopping the rest.

Each approval is a single transaction, so a discarded item cannot come back
after a restart. In grouped mode, if a destination merge already exists for the
same chat/day, the merge is accepted as already done when its XMP input list
matches; otherwise approval is refused until that destination file is moved or
deleted. A clip that arrives after approval appears as a new group.

Review streams the source audio with HTTP Range requests, so players can start
before the file is downloaded and seeking works. `settleSeconds` delays an item
until its files have been quiet that long. `placement`, `autoProcess` and
cleanup are not used for reviewed audio.

To standardize and copy **individual files** instead of merging them, set
`concat: false` (or omit `datePattern`):

```json
{
  "name": "WhatsApp Audio",
  "source": "/source/Media/WhatsApp Audio",
  "destination": "/destination/Media/Recordings",
  "method": "reviewed-audio",
  "datePattern": "-(\\d{8})-",
  "concat": false,
  "settleSeconds": 60
}
```

With `concat: false`, `datePattern` is still used to extract the file date for
the standardized name; leave it out to let the normal date metadata/file mtime
decide. Each file appears in Review with **Standardize & move** and **Delete**.
The old `voicenotes` method name is accepted and normalized to `reviewed-audio`
when a config is loaded.

## Manual placement (standardize / snapchat)

`standardize` and `snapchat` folders can set `placement: "manual"`: the daemon
processes items, but instead of writing to the destination it **parks** the
finished file under `reviewDir` and waits. The Review dialog lists parked
outputs with audio preview, Place and Discard. Placing is an atomic rename with
the same never-overwrite rules as automatic placement — a destination file with
the same name and different content is refused, not clobbered. `autoProcess:
true` prepares new items continuously instead of only when you press Process.

Parked entries survive restarts (a manifest next to each file), and a group
whose source clips were deleted after parking stays placeable — the parked
merge may be the only copy.

## Safety model

- Source files are only ever **read** until you press Cleanup, or — for reviewed audio — until you approve/delete an item in Review.
- Placements are same-filesystem atomic renames from a staging area; the
  destination never sees partial files. Replacing a changed file (`copy`
  overwrite mode) is also atomic: temp file + rename in the destination
  directory, never an in-place rewrite.
- Destination files are **never overwritten without an explicit policy**:
  same name with a plausible size is a duplicate; a very different size is a
  conflict. `copy` folders default to `onChanged: "overwrite"` (the mirror
  updates, applied atomically); set `onChanged: "conflict"` to flag instead.
  Every other method never overwrites.
- `copy` folders with `cleanup: false` (e.g. a forever archive) hide and
  refuse the Cleanup action, so originals are never removed by File Pipelines.
- Cleanup verifies before deleting: `copy` files must hash-match; `standardize`
  files must exist under the standardized/tagged name with a matching embedded
  date; snap groups must have their output file present, with the input listed
  in its XMP tag and a matching duration. Anything unverifiable is blocked and
  surfaced as a conflict.
- Cleaned originals move to **trash** (default retention 30 days) instead of
  being deleted outright.
- A heartbeat lock file in the synced tree prevents two File Pipelines instances
  (e.g. a server and a laptop) from processing the same mirrored folders at once.
- `dryRun` mode reports what would happen without writing anything.

## Source map

| path | what lives there |
|---|---|
| `src/index.js` | CLI entry (`serve`/`standardize`/`snapconcat`/`concataudio`/`clean-synced`) |
| `src/daemon.js` | wires the store, queue, watchers and API |
| `src/config.js` | config shape/normalization/validation |
| `src/store.js` | per-folder file state (scan, dedupe/conflict detection, cleanup previews) |
| `src/queue.js` / `src/processors/` | the work queue and the standardize/snapchat/copy processors |
| `src/reviewed-audio-flow.js` | approval-only reviewed-audio listing, per-file standardize/move and grouped merge/delete |
| `src/watchers.js` | chokidar watchers for watched folders |
| `src/cleanup.js` | verified cleanup into trash, restore and empty |
| `src/review.js` / `src/park.js` | manual-placement parking and the review API |
| `src/api/index.js` | HTTP server setup and route dispatch |
| `src/api/{state,folders,review,cleanup,trash}.js` | the API route modules |
| `ui/src/App.jsx` | dashboard orchestration (state, actions, layout) |
| `ui/src/components/` | folder/overview/trash/activity cards and the dialogs |
| `ui/src/lib/view.js` | pure view helpers (stats, labels, file sorting, review groups) |

## Running

```sh
npm install

# watch mode (web UI on http://127.0.0.1:8791)
node src/index.js --config config.json
```

`config.json` is created **empty** (no folders) on first start; everything —
folders, staging/trash paths, tuneables — is editable from the UI (Settings)
and written back to the file atomically.

### Config

Paths accept `~` and environment variables. Key fields:

| field | meaning |
|---|---|
| `folders[].source` / `.destination` | watched folder and the destination |
| `folders[].method` | `standardize` \| `snapchat` \| `copy` \| `reviewed-audio` |
| `folders[].settleSeconds` | quiet period before processing (snaps: 1800) |
| `folders[].groupWindowSeconds` | snap grouping window |
| `folders[].filePattern` | optional glob (`Snapchat-*.mp4`); non-matching files show as ignored |
| `folders[].recursive` | mirror subdirectories (implied by `reviewed-audio`); `copy` uses it for whole-tree archives |
| `folders[].includeHidden` | also ingest dot-files (`copy` archives); sync internals (`.stfolder`, `!sync`, `*.tmp`, `.file-pipelines*`) are always skipped |
| `folders[].onChanged` | `copy` only: `overwrite` (default) replaces a changed destination copy atomically; `conflict` flags it |
| `folders[].cleanup` | `false` hides and refuses cleanup (forever archives); always false for reviewed audio |
| `folders[].notify` | `all` (default) notifies on every success; `errors` only notifies failures (use for bulk archives) |
| `folders[].placement` | `auto` (default) or `manual` — park processed files for review (standardize/snapchat only) |
| `folders[].autoProcess` | `placement: manual` only (standardize/snapchat): process new items automatically instead of on demand |
| `folders[].datePattern` | `reviewed-audio` only (optional): regex extracting the clip/file date; capture groups are joined, non-digits stripped, result must be `YYYYMMDD` |
| `folders[].concat` | `reviewed-audio` only (default `true`): group by chat/day and merge. `false` (or no `datePattern`) standardizes each file individually |
| `stagingDir` / `reviewDir` / `trashDir` | working area (same filesystem as destinations for atomic renames), parked review outputs, and cleaned-original storage |
| `trashRetentionDays` | days before trash is swept |
| `concurrency` | parallel jobs (per-folder jobs are serialized) |
| `notifySuccess` | failures always notify; successes notify unless `notifySuccess` is off |
| `paused` / `dryRun` | runtime toggles persisted in `<logDir>/../state.json`, not in the declarative `config.json` |

Notifications are relayed through the portal (`DSCPLN_PORTAL_URL`, e.g.
`http://portal:8080` in Kubernetes), whose Settings hold the ntfy URL and
token; without a relay configured they are skipped.

## CLI

The same processing core is exposed as a standalone CLI
(`node bin/file-pipelines.js <cmd>` or `file-pipelines` after `npm link`):

```sh
file-pipelines standardize [-n] [-p] [--strict] [--parallel N] <dir>
file-pipelines snapconcat [--park DIR] [--dest DIR] [--window SECONDS] <dir>
file-pipelines concataudio <src dir> <dest dir>
file-pipelines clean-synced [--delete | --trash DIR] [--force] <src dir> <dest dir>
file-pipelines serve [--config FILE] [--port N] [--bind HOST] [--force]
```

- `standardize`: `-n` takes the date from the file name when possible (with MP4
  truncation repair via ffmpeg); `-p` keeps the original name.
- `snapconcat`: concatenates clip groups by time proximity; `--park` moves the
  raw clips aside afterwards.
- `concataudio`: concatenates same-day audio with a short tone between clips.
- `clean-synced`: removes sources that already exist in the destination,
  verifying before deleting; the default action is to trash, not delete.

## Container

The image runs the daemon with a hardcoded `--config /config/config.json`,
listens on `0.0.0.0:8791` (overridable with `--bind`/`--port`), and sets
`HOME=/config`, so mount a writable volume at `/config` (it holds
`config.json` and, until you point them elsewhere in Settings, the staging,
trash and log directories). Mount media trees wherever you like and reference
those paths in the config. A fresh install starts with no folders and is
configured entirely from the UI; nothing environment-specific is baked into the
image or this repo — deployment manifests live with the operator's infra.

Point the staging directory at the same filesystem as the destinations so
placements are atomic renames, and exclude it from any file-sync tool if it
lives inside a synced tree.

## Development

```sh
npm run build:ui   # build ui/ (React + Vite) into static/
npm test           # builds the UI, then runs the unit + e2e suites
```

The front end is a React app under `ui/` (Vite output in `static/`, served by
the node server). Tests generate their own media with ffmpeg/exiftool and never
touch real data. Optional parity checks compare `standardize` output against an
existing implementation when `MEDIA_SYNC_BASH_STANDARDIZE` points at one; the
browser suite (`test/ui.test.js`) drives the real page through `playwright-core`
and skips when no Chromium is installed.
