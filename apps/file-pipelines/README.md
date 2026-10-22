# File Pipelines

**Watch folders and move media through safe, repeatable pipelines.**

File Pipelines watches configured folders for new media, processes each item,
places the result in a destination, and keeps the original until you explicitly
clean up. Cleanup only happens after the destination copy is verified.

Use it for phone-sync folders, camera uploads, screenshots, voice notes or any
tree where files should be standardized or archived without losing originals.

## At a glance

| | |
|---|---|
| Runs at | `/pipelines` (or port `8791` locally) |
| Config | `--config <path>`; `/config/config.json` in the container |
| State | Staging, review, trash and logs from config |
| Methods | `standardize`, `snapchat`, `copy`, `reviewed-audio` |
| Safety | Originals are read-only until verified cleanup; cleanup moves to trash |

## Quick start

```sh
npm install
node src/index.js --config config.json
```

Open <http://127.0.0.1:8791>. A new `config.json` starts with no folders; add
them from Settings.

With Docker, mount a writable `/config` and your media trees:

```sh
mkdir -p file-pipelines-data
docker run --rm -p 8791:8791 \
  -v "$PWD/file-pipelines-data:/config" \
  -v "$PWD/file-pipelines-data:/data" \
  -v /path/to/source:/source:ro \
  -v /path/to/media:/media \
  ghcr.io/imranr98/dscpln-file-pipelines:latest
```

The first start creates an empty `/config/config.json`; add folders in
Settings. Use container paths such as `/source` and `/media` in the folder
settings, not host paths.

## How it works

1. **Watch.** A folder is scanned, then watched for settled files.
2. **Process.** The folder's method standardizes, concatenates, copies or parks
   the item for review.
3. **Place.** A finished file is moved into the destination atomically.
   Existing files are never overwritten without an explicit policy.
4. **Clean up.** The original is moved to trash only after the destination is
   verified. Trash has a retention period; it is not an immediate delete.

## Methods

| Method | What it does |
|---|---|
| `standardize` | Picks a date (`DateTimeOriginal`, else the oldest date-like tag), writes all date tags, renames to `YYYY-MM-DD-HH-MM-SS-(<original-name>).ext`, and copies into the destination. |
| `snapchat` | Waits until the folder has been quiet for `settleSeconds` (default 30 min), groups `Snapchat-*.mp4` clips whose timestamps are within `groupWindowSeconds` (default 15s), concatenates and re-encodes each group, standardizes the output, and records the input list in a custom `XMP-media-sync:Inputs` tag. |
| `copy` | Byte-verified copy with the original name preserved (call recordings). Add `recursive: true` to mirror a whole tree and `onChanged` to control what happens when a same-name source changes. |
| `reviewed-audio` | Approval-only audio. With `datePattern` + `concat: true` (default), groups same-day clips and merges them into one MP4 on approval. With `concat: false` or no `datePattern`, standardizes and moves each file individually. Delete trashes the source instead. See Reviewed audio below. |

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
- **Delete**: move the source clip/file to trash; no destination file is
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
the same never-overwrite rules as automatic placement: a destination file with
the same name and different content is refused, not clobbered.

`autoProcess: true` prepares new items continuously instead of only when you
press Process. Parked entries survive restarts (a manifest next to each file),
and a group whose source clips were deleted after parking stays placeable — the
parked merge may be the only copy.

## Safety model

- Source files are only **read** until you press Cleanup, or, for reviewed
  audio, until you approve/delete an item in Review.
- Placements are same-filesystem atomic renames from a staging area; the
  destination never sees partial files. Replacing a changed file (`copy`
  overwrite mode) is also atomic: temp file + rename in the destination
  directory.
- Destination files are **never overwritten without an explicit policy**:
  same name with a plausible size is a duplicate; a very different size is a
  conflict. `copy` folders default to `onChanged: "overwrite"` (the mirror
  updates atomically); set `onChanged: "conflict"` to flag instead. Every other
  method never overwrites.
- `copy` folders with `cleanup: false` hide and refuse the Cleanup action, so
  originals are never removed by File Pipelines.
- Cleanup verifies before deleting: `copy` files must hash-match;
  `standardize` files must exist under the standardized/tagged name with a
  matching embedded date; snap groups must have their output file present, with
  the input listed in its XMP tag and a matching duration. Anything
  unverifiable is blocked and surfaced as a conflict.
- Cleaned originals move to **trash** (default retention 30 days) instead of
  being deleted outright.
- A heartbeat lock file in the synced tree prevents two File Pipelines
  instances from processing the same mirrored folders at once.
- `dryRun` mode reports what would happen without writing anything.

## Configuration

Paths accept `~` and environment variables. Key fields:

| Field | Meaning |
|---|---|
| `folders[].source` / `.destination` | Watched folder and destination |
| `folders[].method` | `standardize`, `snapchat`, `copy` or `reviewed-audio` |
| `folders[].settleSeconds` | Quiet period before processing (snaps: 1800) |
| `folders[].groupWindowSeconds` | Snap grouping window |
| `folders[].filePattern` | Optional glob (`Snapchat-*.mp4`); non-matching files show as ignored |
| `folders[].recursive` | Mirror subdirectories (implied by `reviewed-audio`); `copy` uses it for whole-tree archives |
| `folders[].includeHidden` | Also ingest dot-files (`copy` archives); sync internals (`.stfolder`, `!sync`, `*.tmp`, `.file-pipelines*`) are always skipped |
| `folders[].onChanged` | `copy` only: `overwrite` (default) replaces a changed destination copy atomically; `conflict` flags it |
| `folders[].cleanup` | `false` hides and refuses cleanup (forever archives); always false for reviewed audio |
| `folders[].notify` | `all` (default) notifies on every success; `errors` only notifies failures |
| `folders[].placement` | `auto` (default) or `manual`; park processed files for review (standardize/snapchat only) |
| `folders[].autoProcess` | `placement: manual` only: process new items automatically instead of on demand |
| `folders[].datePattern` | `reviewed-audio` only (optional): regex extracting the clip/file date; capture groups are joined, non-digits stripped, result must be `YYYYMMDD` |
| `folders[].concat` | `reviewed-audio` only (default `true`): group by chat/day and merge. `false` (or no `datePattern`) standardizes each file individually |
| `stagingDir` / `reviewDir` / `trashDir` | Working area, parked review outputs and cleaned-original storage |
| `trashRetentionDays` | Days before trash is swept |
| `concurrency` | Parallel jobs; per-folder jobs are serialized |
| `notifySuccess` | Failures always notify; successes notify unless this is off |
| `paused` / `dryRun` | Runtime toggles persisted in `<logDir>/../state.json`, not in `config.json` |

Point the staging directory at the same filesystem as the destinations so
placements are atomic renames. Exclude it from any file-sync tool if it lives
inside a synced tree.

Notifications are relayed through the Portal (`DSCPLN_PORTAL_URL`), whose
Settings hold the ntfy URL and token. Without a relay configured they are
skipped.

## CLI

The same processing core is available as a standalone CLI:

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

The image runs the daemon with `--config /config/config.json`, listens on
`0.0.0.0:8791`, and sets `HOME=/config`, so mount a writable volume at
`/config` for `config.json` and the default staging/trash/log directories.
Mount media trees wherever you like and reference those paths in the config.

A fresh install starts with no folders and is configured entirely from the UI.
Deployment manifests belong with your infrastructure, not in this repository.

## Development

```sh
npm run build:ui   # build ui/ into static/
npm test           # builds the UI, then runs unit and e2e suites
```

The front end is a React app under `ui/` (Vite output in `static/`, served by
the Node server). Tests generate their own media with ffmpeg/exiftool and never
touch real data. The browser suite drives the real page through
`playwright-core` and skips when no Chromium is installed.

## Source map

| Path | What lives there |
|---|---|
| `src/index.js` | CLI entry (`serve`, `standardize`, `snapconcat`, `concataudio`, `clean-synced`) |
| `src/daemon.js` | Wires the store, queue, watchers and API |
| `src/config.js` | Config shape, normalization and validation |
| `src/store.js` | Per-folder file state: scan, dedupe/conflict detection, cleanup previews |
| `src/queue.js` / `src/processors/` | Work queue and the standardize/snapchat/copy processors |
| `src/reviewed-audio-flow.js` | Approval-only listing, per-file standardize/move and grouped merge/delete |
| `src/watchers.js` | Chokidar watchers for watched folders |
| `src/cleanup.js` | Verified cleanup into trash, restore and empty |
| `src/review.js` / `src/park.js` | Manual-placement parking and the review API |
| `src/api/index.js` | HTTP server setup and route dispatch |
| `src/api/{state,folders,review,cleanup,trash}.js` | API route modules |
| `ui/src/App.jsx` | Dashboard orchestration |
| `ui/src/components/` | Folder, overview, trash and activity cards, plus dialogs |
| `ui/src/lib/view.js` | Pure view helpers |
