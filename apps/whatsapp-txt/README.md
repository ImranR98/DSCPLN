# WhatsApp TXT

**Browse, import and merge WhatsApp chat exports.**

WhatsApp TXT turns exported `.txt` chats into searchable JSON conversations. It
can merge exports of the same conversation from different backup folders,
detect renamed contacts and groups, and serve the result in a web browser.

Use it if you have WhatsApp exports from a phone or another backup and want one
clean, searchable history without uploading the chats anywhere.

## At a glance

| | |
|---|---|
| Runs at | `/watxt` (or port `8787` locally) |
| Input | WhatsApp `.txt` exports or `.zip` archives |
| Output | One `YYYYMMDD - <conversation>.json` file per conversation |
| Data | The conversation directory, `/data` in the container |
| CLI | `WhatsAppTXT.mjs` for batch merges |

## Quick start

Run a dry merge first:

```sh
node WhatsAppTXT.mjs --dry-run "/path/to/WhatsApp TXT"
```

Then merge without `--dry-run`. The first directory receives the outputs; any
additional directories are read as sources.

To browse the result in the web UI:

```sh
npm install
npm start -- --dir "/path/to/WhatsApp TXT"
```

Open <http://127.0.0.1:8787>. Browsing and search are read-only; the Import
panel writes new merged outputs.

## CLI reference

```sh
node WhatsAppTXT.mjs [--dry-run] [--no-merge-renamed] [--date-order=auto|dmy|mdy|ymd]
                   [--rename-min-shared=5] [--rename-min-coverage=0.6] [--help]
                   <output-directory> [additional-source-directory] [...]
```

- The first directory receives the merged files; old outputs there are
  replaced.
- New phone `.txt` exports merge with existing `.json` outputs. All sources are
  parsed and grouped by conversation name (`WhatsApp Chat with Alice.txt`,
  `Alice.txt` and `20240105 - Alice.json` are the same conversation).
- Recognized filename prefixes are stripped before matching
  (`WhatsApp Chat with `, `YYYYMMDD - `, `YYYY-M-D-`).
- `--dry-run` reports what would happen without renaming, deleting or writing
  anything.
- `--date-order` forces the component order for ambiguous slash/dot dates
  (`auto` infers per file).
- `--no-merge-renamed` disables detecting and merging renamed contacts/groups.
- The run aborts **before modifying anything** if a directory has filename
  collisions or a file cannot be parsed.
- Recognized 2-line export headers (`Chat exported on …` / `Last chat on …`)
  are stripped.
- Files containing ambiguous dates are reported in an `=== Ambiguous dates ===`
  summary section.

Safety:

- Run `--dry-run` first. It prints the planned renames and outputs without
  changing anything.
- Sources are renamed in place; content is never rewritten. Merged outputs
  replace previous outputs in the first directory.
- Name collisions, unparseable files and files with no date lines abort before
  any rename, delete or write.
- Hidden files (for example `.backup-state-*.json`) are ignored.

## Output format

Each merged conversation is a JSON array of message objects:

```json
[
  {
    "date": "2024-01-15T14:04:00.000Z",
    "sender": "Alice",
    "type": "text",
    "body": "Hello"
  },
  {
    "date": "2024-01-15T14:05:00.000Z",
    "sender": null,
    "type": "system",
    "body": "Alice added Carol"
  }
]
```

- `date` is a JavaScript `Date`, serialized by `JSON.stringify` as UTC ISO 8601.
- `sender` is `null` for system messages.
- `type` is one of `text`, `media`, `attachment`, `deleted` or `system`.
- Continuation lines are joined into `body` with `\n`, so a multi-line message
  is one object.
- Output is pretty-printed with stable field order and ends with one newline, so
  re-runs are byte-identical.
- Output files are named `YYYYMMDD - <conversation>.json` using the last
  message date.

## Merging

- Sources (`.txt` exports and `.json` outputs alike) are parsed into messages,
  merged as a union, then sorted by `date` (stable).
- Overlapping messages are matched by **same body within a 12-hour window**
  (nearest timestamp wins). Export-version drift such as seconds, DST or whole
  timezone changes cannot duplicate history. Unmatched messages align to the
  reference timeline using their nearest matched neighbor.
- JSON outputs written by a previous run are read back and re-merged, so
  repeated runs are idempotent.
- Typical phone setup: drop the new `.txt` export(s) into the JSON
  directory and run the tool. The text and existing JSON merge into a fresh
  `YYYYMMDD - Name.json`, and both old files are replaced.

### Renamed conversations

When a contact or group is renamed, separate exports can exist for what is
really one conversation. Those are detected automatically:

- A **shared message** is the same body text with a timestamp within **12
  hours**. The nearest match wins, so seconds/DST/timezone drift is tolerated.
- Files whose histories share at least **5 messages and 60% of the smaller
  file** are treated as the same conversation. They are linked transitively, so
  rename chains merge too.
- Merged histories are deduplicated by minute + body, keeping the maximum
  multiplicity seen in any single file. Overlapping messages use the newest
  file's names.
- Each name change is recorded at the older file's last-message timestamp as a
  system message:
  `Conversation name changed from "Old Name" to "New Name"`. Equivalent names
  such as `Papa_s` / `Papa's`, or duplicate ` (1)` files, merge without a
  marker.
- Control it with `--no-merge-renamed`, `--rename-min-shared=N` (default 5) and
  `--rename-min-coverage=0.6`. Renamed merges are listed in the console summary
  and in `--dry-run`.

## Timestamp matching

Matching uses two layers.

**1. Explicit formats with an unambiguous component order:**

| Name | Example |
|---|---|
| `android` | `2024-01-15, 3:04 p.m. - Alice: hello` |
| `androidSeconds` | `2017-11-09, 9:01:18 AM: Alice: hello` |
| `iphone` | `[2024-01-15, 3:04:05 AM] Alice: hello` |
| `canonical` | `2024-01-15-090418 - Alice: hello` (legacy text format, still accepted) |

**2. A generic matcher for slash/dot date shapes** covers current and future
export variants:

- components `D/M/YYYY`, `M/D/YYYY`, `D.M.YYYY`, `YYYY/MM/DD`, and similar,
  with `-`, `/` or `.` separators;
- optional `[`…`]` or `(`…`)` brackets;
- time `H:MM` or `H:MM:SS`, with 1–2 digit parts and optional fractional
  seconds;
- meridiem in any style (`am`, `a.m.`, `A.M.`, optional spaces), otherwise
  24-hour;
- the timestamp must be followed by ` - `, `: `, a closing bracket or the end
  of the line, so message bodies are not misread.

Component order is resolved in this priority:

1. `--date-order=dmy|mdy|ymd` override.
2. A component above 12 is proof, per line and then per-file majority.
3. **Filename export date** (`YYYYMMDD - ` or `YYYY-M-D-` prefixes): the order
   whose last date matches the filename wins; an order whose last date is in
   the future relative to the export is rejected.
4. **Neighbor fit**: ambiguous dates should fall between their nearest
   unambiguous neighbors.
5. **Monotonicity**: the order with fewer or smaller backward jumps.
6. **DMY default**: `05/06/2024` becomes 5 June.

Ambiguous lines are reported with the evidence used, for example
`resolved as MDY (filename 20221009)`, `(neighbors)`, `(monotonic)` or
`(default)`. `--date-order` always overrides.

Notes:

- Two-digit years are read as `20yy`.
- Lines may carry a leading `U+200E`/`U+200F` direction mark. Narrow no-break
  spaces before the meridiem are normalized.
- `NFKD` normalization is applied, so fullwidth digits parse too.
- Impossible values (`2024-13-45`, `15:04 p.m.`, `32/13/2024`) are rejected.

## Format checker

```sh
node checkFormat.mjs [--no-content] [--summary] [--date-order=auto|dmy|mdy|ymd] <file-or-directory> [...]
node checkFormat.mjs --check-examples
```

Validates `.txt` exports and app-produced `.json` conversations without
modifying anything. Exit codes: `0` all pass, `1` any fail, `2` usage/IO error.

- `--no-content` omits chat excerpts and sender names from the report, useful
  for runs over private data.
- `--summary` collapses per-line diagnostics into per-file counts.
- `--date-order` mirrors the merge app's override for ambiguous dates.
- `--check-examples` runs the test suite: fixtures, parser, inference, message
  parsing, merge units, collisions and end-to-end runs in temp dirs.

## Web browser

```sh
npm install
npm start -- --dir "/path/to/WhatsApp TXT" [--port 8787] [--host 127.0.0.1] [--no-watch]
```

The Express server indexes every `.json` conversation into memory and serves a
single-page UI. Browsing and search only read the data directory; the Import
panel and its API write merged outputs.

- Conversation sidebar with name filter, message counts and last activity.
- Message view with date separators, sender colors and type styling. Dates and
  times render in the browser's timezone.
- Full-text search with a **Whole words** toggle, snippets, filters
  (conversation, sender, type, date range) and globally chronological results.
- Click a search result to jump to that exact message.
- Windowed paging keeps very large conversations responsive.
- Three view modes (Transcript, Bubbles, Compact) and jump-to-top/latest
  buttons (`Home` / `End`).
- Live debounced search; filters are kept in the URL; `j`/`k` moves between
  results.
- Keyboard-friendly conversation list, loading skeletons, error banners and an
  automatic light/dark theme.
- `fs.watch` reindexing plus a manual reload button; `/` focuses search.

**Importing exports.** The Import button opens a panel where you drop `.zip` or
`.txt` exports. Each upload streams to a hidden incoming directory, then
**Import** extracts archives (including one nested zip level), strips `.vcf`
files and merges everything with existing conversations. **Preview** runs the
same merge as a dry run and writes nothing. Uploads are consumed only after a
successful merge, so a failed or previewed batch can be retried or discarded.
The merge aborts before renaming, deleting or writing anything when a file
cannot be parsed or a name collision would occur. Merges run one at a time and
reject cross-origin posts. Uploads are capped at 200 MB each.

At the current scale (455 conversations, 539k messages, about 80 MB), startup
takes about 0.5 s, memory use is about 300 MB, and searches complete in under
100 ms. Invalid or hidden files are skipped and reported in `/api/state`.

The JSON API is `/api/state`, `/api/conversations`,
`/api/conversations/:id/messages?offset=&limit=&around=`, `/api/search` (add
`whole=1` for whole-word matching) and `POST /api/reload`. Import endpoints:
`POST /api/import/upload?batch=&name=` (raw body),
`POST /api/import/merge` (`{batch, dryRun?, dateOrder?}`),
`POST /api/import/cancel` and `GET /api/import/last`.

### Docker

```sh
docker run --rm -p 8787:8787 \
  -v "/path/to/WhatsApp TXT:/data" \
  ghcr.io/imranr98/dscpln-watxt:latest
```

The container uses `/data` by default. Mount the conversation directory there;
it can be read-only for browsing, but importing needs write access. `DATA_DIR`,
`HOST` and `PORT` override the defaults. The image runs as uid 1000; if your
files use another owner, add `--user "$(id -u):$(id -g)"`. `unzip` is bundled
for archive imports.

## Layout

| File | Purpose |
|---|---|
| `server.mjs` | HTTP server: browsing, search and the import API |
| `src/parse.mjs`, `src/dates.mjs` | Chat parsing and date-line classification (DMY/MDY/YMD inference) |
| `src/merge.mjs`, `src/files.mjs` | Cross-file matching, alignment and rename handling |
| `src/main.mjs` | Merge pipeline used by the CLI and import API |
| `WhatsAppTXT.mjs` | CLI entry (merge exports across directories) |
| `checkFormat.mjs` | Export validator used by examples and tests |
| `ui/` | React front end (built into `static/`) |
| `examples/` | Generated fixtures for the checker and merge tests |

## Development

```sh
npm test                     # checker self-test + server/browser tests
npm run test:server          # server tests only; browser tests skip without Chromium
node examples/generate.mjs   # regenerate committed example fixtures
```

Example fixtures:

- `examples/valid/`: files that must pass the checker.
- `examples/invalid/`: files that must fail, with reasons in
  `examples/expectations.json`.
- `examples/merge/`: source-directory pairs used by the merge tests.
