# Media Sync

Watches configured folders for new media, processes each file with one of four
methods, places the result into a destination folder, and **never deletes an
original until you explicitly clean up** — and then only after verifying the
destination copy.

The app replaces the old `mdscl` deployments and the weekly `backupctl`
`Media Import` task for phone-synced media, and its CLI replaces the old
`MediaDateStandardize` / `mediaConcat` bash scripts entirely.

## Methods

| method        | what it does |
|---------------|--------------|
| `standardize` | Picks a date (`DateTimeOriginal`, else the oldest date-like tag), writes all date tags, renames to `YYYY-MM-DD-HH-MM-SS-(<original-name>).ext`, and copies into the destination. |
| `snapchat`    | Waits until the folder has been quiet for `settleSeconds` (default 30 min), groups `Snapchat-*.mp4` clips whose timestamps are within `groupWindowSeconds` (default 15s), concatenates + re-encodes each group, standardizes the output, and records the input list in a custom `XMP-media-sync:Inputs` tag on the output. |
| `copy`        | Byte-verified copy, original name preserved (call recordings). Add `recursive: true` to mirror a whole tree (WhatsApp AllMedia archives) and `onChanged` to control what happens when a same-name source changes. |
| `voicenotes`  | Concatenates same-day clips from the same folder into one MP4 (a 0.1s tone between clips), standardizes it, and records inputs in XMP. The clip-date scheme is **user-defined** per folder via `datePattern` (e.g. WhatsApp push-to-talk `PTT-YYYYMMDD-WA####.opus` uses `-(\d{8})-`); see Manual placement below. |

## Manual placement (review before writing)

Any `standardize`, `snapchat` or `voicenotes` folder can set
`placement: "manual"`: the daemon still processes items, but instead of writing
to the destination it **parks** the finished file under `reviewDir` and waits.
The web UI's Review dialog lists pending clip groups (with a per-group Process
action) and parked outputs (with audio preview, Place and Discard). Placing is
an atomic rename with the same never-overwrite rules as automatic placement —
a destination file with the same name and different content is refused, not
clobbered. Discarded clips are skipped until the source changes or you
explicitly process them again. `autoProcess: true` prepares new items
continuously instead of only when you press Process.

Parked entries survive restarts (a manifest next to each file), and a group
whose source clips were deleted after parking stays placeable — the parked
merge may be the only copy.

## Safety model

- Source files are only ever **read** until you press Cleanup.
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
  refuse the Cleanup action, so originals are never removed by Media Sync.
- Cleanup verifies before deleting: `copy` files must hash-match; `standardize`
  files must exist under the standardized/tagged name with a matching embedded
  date; snap and voicenote groups must have their output file present, with the
  input listed in its XMP tag (and a matching duration for snaps). Anything
  unverifiable is blocked and surfaced as a conflict.
- Cleaned originals move to **trash** (default retention 30 days) instead of
  being deleted outright.
- A heartbeat lock file in the synced tree prevents two Media Sync instances
  (e.g. a server and a laptop) from processing the same mirrored folders at once.
- `dryRun` mode reports what would happen without writing anything.

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
| `folders[].source` / `.destination` | watched folder and its destination |
| `folders[].method` | `standardize` \| `snapchat` \| `copy` \| `voicenotes` |
| `folders[].settleSeconds` | quiet period before processing (snaps: 1800) |
| `folders[].groupWindowSeconds` | snap grouping window |
| `folders[].filePattern` | optional glob (`Snapchat-*.mp4`); non-matching files show as ignored |
| `folders[].recursive` | mirror subdirectories (implied by `voicenotes`); `copy` uses it for whole-tree archives |
| `folders[].includeHidden` | also ingest dot-files (`copy` archives); sync internals (`.stfolder`, `!sync`, `*.tmp`, `.media-sync*`) are always skipped |
| `folders[].onChanged` | `copy` only: `overwrite` (default) replaces a changed destination copy atomically; `conflict` flags it |
| `folders[].cleanup` | `false` hides and refuses cleanup (forever archives) |
| `folders[].notify` | `all` (default) notifies on every success; `errors` only notifies failures (use for bulk archives) |
| `folders[].placement` | `auto` (default) or `manual` — park processed files for review (not valid for `copy`) |
| `folders[].autoProcess` | `placement: manual` only: process new items automatically instead of on demand |
| `folders[].datePattern` | `voicenotes` only (required): regex extracting the clip date; capture groups are joined, non-digits stripped, result must be `YYYYMMDD` |
| `stagingDir` / `reviewDir` / `trashDir` | working area (same filesystem as destinations for atomic renames), parked review outputs, and cleaned-original storage |
| `trashRetentionDays` | days before trash is swept |
| `concurrency` | parallel jobs (per-folder jobs are serialized) |
| `ntfy` | optional `{url, token, notifySuccess}`; failures always notify, successes notify unless `notifySuccess` is off |
| `paused` / `dryRun` | persisted toggles |

## CLI

The same processing core is exposed as a standalone CLI
(`node bin/media-sync.js <cmd>` or `media-sync` after `npm link`):

```sh
media-sync standardize [-n] [-p] [--strict] [--parallel N] <dir>
media-sync snapconcat [--park DIR] [--dest DIR] [--window SECONDS] <dir>
media-sync concataudio <src dir> <dest dir>
media-sync clean-synced [--delete | --trash DIR] [--force] <src dir> <dest dir>
media-sync serve [--config FILE] [--port N] [--bind HOST] [--force]
```

- `standardize` matches the old `mediaDateStandardize.sh`, including `-n`
  (dates from file names, with MP4 truncation repair via ffmpeg) and `-p`.
- `snapconcat` matches `concatSnaps.sh` / `snapsPre.sh` (use `--park`).
- `concataudio` matches `concatAudio.sh` (same-day voice notes with a tone).
- `clean-synced` matches `deleteSynced.sh` but verifies before removing; the
  default action is to trash rather than delete.

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
npm test        # unit + parity (vs the old bash scripts) + e2e with generated fixtures
```

The web UI uses [Shoelace](https://shoelace.style/) components (dialogs, buttons,
inputs, badges, details), vendored into `public/vendor/shoelace` with
`npm run vendor` — re-run that after upgrading the `@shoelace-style/shoelace`
devDependency. The page is otherwise plain HTML/CSS/JS with no build step.

Tests generate their own media with ffmpeg/exiftool and never touch real data.
The parity suite is skipped when `ffmpeg`, `exiftool` or the old bash script is
not available. The UI suite (`test/ui.test.js`) drives the real page through
`playwright-core` and skips when no Chromium is installed.
