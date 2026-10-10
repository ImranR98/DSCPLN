# Media Sync

Watches configured folders for new media, processes each file with one of three
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
| `copy`        | Byte-verified copy, original name preserved (call recordings). |

## Safety model

- Source files are only ever **read** until you press Cleanup.
- Placements are same-filesystem atomic renames from a staging area; the
  destination never sees partial files.
- Existing destination files are **never overwritten**: same name with a
  plausible size is a duplicate; a very different size is a conflict.
- Cleanup verifies before deleting: `copy` files must hash-match; `standardize`
  files must exist under the standardized/tagged name with a matching embedded
  date; snap groups must have their output file present with a matching
  duration. Anything unverifiable is blocked and surfaced as a conflict.
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
| `folders[].method` | `standardize` \| `snapchat` \| `copy` |
| `folders[].settleSeconds` | quiet period before processing (snaps: 1800) |
| `folders[].groupWindowSeconds` | snap grouping window |
| `stagingDir` / `trashDir` | working area (same filesystem as destinations for atomic renames) and cleaned-original storage |
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
not available.
