# WhatsAppTXT

Merges WhatsApp `.txt` chat exports of the same conversation across multiple backup directories into a single JSON file per conversation.

## Usage

```
node WhatsAppTXT.js [--dry-run] [--no-merge-renamed] [--date-order=auto|dmy|mdy|ymd]
                   [--rename-min-shared=5] [--rename-min-coverage=0.6] [--help]
                   <output-directory> [additional-source-directory] [...]
```

- The first directory receives the merged files; old outputs there are replaced.
- New phone `.txt` exports merge with existing `.json` outputs: both are parsed and grouped by conversation name (`WhatsApp Chat with Alice.txt`, `Alice.txt` and `20240105 - Alice.json` are all the same conversation), and the result is written back as JSON.
- Recognized filename prefixes are stripped before matching (`WhatsApp Chat with `, `YYYYMMDD - `, `YYYY-M-D-`).
- `--dry-run` reports what would happen without renaming, deleting or writing anything.
- `--date-order` forces the component order for ambiguous slash/dot dates (`auto` infers per file).
- `--no-merge-renamed` disables detecting and merging renamed contacts/groups.
- The run aborts **before modifying anything** if a directory has filename collisions or a file cannot be parsed.
- Recognized 2-line export headers (`Chat exported on …` / `Last chat on …`) are stripped.
- Files containing ambiguous dates are reported in an `=== Ambiguous dates ===` summary section.

Safety:

- Run `--dry-run` first — it prints the planned renames/outputs without changing anything.
- Sources are renamed in place (content is never rewritten); merged outputs replace previous outputs in the first directory.
- Name collisions, unparseable files and files with no date lines abort before any rename, delete or write.
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

- `date` is a JS `Date`, serialized by `JSON.stringify` (UTC ISO 8601).
- `sender` is `null` for system messages.
- `type` is one of `text`, `media`, `attachment`, `deleted`, `system`.
- Continuation lines are joined into `body` with `\n`; a multi-line message is one object.
- Output is pretty-printed with stable field order and ends with one newline, so re-runs are byte-identical.
- Output files are named `YYYYMMDD - <conversation>.json` using the last message date.

## Merging

- Sources (`.txt` exports and `.json` outputs alike) are parsed into messages and merged as a union, then sorted by `date` (stable).
- Overlapping messages are matched by **same body within a 12-hour window** (nearest timestamp wins), so export-version drift — seconds, DST, or whole timezone changes — can't duplicate history; unmatched messages are aligned to the reference timeline using their nearest matched neighbour. txt+txt, txt+json and json+json merges all behave the same way, keeping the highest occurrence count seen in any single source.
- JSON outputs written by a previous run are read back and re-merged, so running the tool repeatedly is idempotent.
- Typical phone workflow: drop the new `.txt` export(s) into the JSON directory and run the tool; the txt and its existing JSON are merged into a fresh `YYYYMMDD - Name.json` and both old files are replaced.

### Renamed conversations

When a contact or group is renamed, separate exports can exist for what is really one
conversation. Those are detected automatically:

- A "shared message" means the same body text with a timestamp within **12 hours** (nearest
  match wins, so seconds/DST/timezone drift is tolerated); files whose histories share at
  least **5 messages and 60% of the smaller file** are treated as the same conversation
  (linked transitively, so rename chains merge too).
- Merged histories are deduplicated by minute+body, keeping the max multiplicity seen in any
  single file, and overlapping messages use the **newest** file's names.
- Each name change is recorded at the older file's last-message timestamp as a system message:
  `Conversation name changed from "Old Name" to "New Name"` (equivalent names such as
  `Papa_s` / `Papa's` or duplicate ` (1)` files merge without a marker).
- Control it with `--no-merge-renamed`, `--rename-min-shared=N` (default 5) and
  `--rename-min-coverage=0.6`. Renamed merges are listed in the console summary and in
  `--dry-run`.

## Timestamp matching

Matching is built from two layers:

1. **Explicit formats** whose component order is unambiguous:

| Name | Example |
| --- | --- |
| `android` | `2024-01-15, 3:04 p.m. - Alice: hello` |
| `androidSeconds` | `2017-11-09, 9:01:18 AM: Alice: hello` |
| `iphone` | `[2024-01-15, 3:04:05 AM] Alice: hello` |
| `canonical` | `2024-01-15-090418 - Alice: hello` (legacy text format, still accepted as input) |

2. **Generic matcher** for slash/dot date shapes, which covers current and future export variants:

- date components `D/M/YYYY`, `M/D/YYYY`, `D.M.YYYY`, `YYYY/MM/DD`, … with `-`, `/`, or `.` separators;
- optional `[`…`]` or `(`…`)` brackets;
- time `H:MM` or `H:MM:SS` (1–2 digit parts, optional fractional seconds);
- meridiem in any style (`am`, `a.m.`, `A.M.`, optional spaces), otherwise 24-hour;
- the timestamp must be followed by ` - `, `: `, a closing bracket, or end of line so message bodies are not misread.

Component order is resolved with this priority:

1. `--date-order=dmy|mdy|ymd` override.
2. A component above 12 is proof (per line, then per-file majority).
3. **Filename export date** (`YYYYMMDD - ` or `YYYY-M-D-` prefixes) — the strongest tie-breaker: the order whose last date matches the filename date wins; an order whose last date lands in the future relative to the export is rejected.
4. **Neighbor fit**: ambiguous dates should fall between their nearest unambiguous neighbors.
5. **Monotonicity**: the order with fewer/smaller backward jumps.
6. **DMY default** (`05/06/2024` → 5 June).

Ambiguous lines are reported as warnings by the app and the checker together with the evidence used, e.g. `resolved as MDY (filename 20221009)` or `(neighbors)` / `(monotonic)` / `(default)`; `--date-order` always overrides.

Notes:

- Two-digit years are read as `20yy`.
- Lines may carry a leading `U+200E`/`U+200F` direction mark, and narrow no-break spaces before the meridiem are normalized.
- `NFKD` normalization is applied, so fullwidth digits parse too.
- Lines whose values are impossible (`2024-13-45`, `15:04 p.m.`, `32/13/2024`) are rejected.

## Format checker

```
node checkFormat.js [--no-content] [--summary] [--date-order=auto|dmy|mdy|ymd] <file-or-directory> [...]
node checkFormat.js --check-examples
```

Validates `.txt` exports and app-produced `.json` conversations, without modifying anything. Exit codes: `0` all pass, `1` any fail, `2` usage/IO error.

- `--no-content` omits chat excerpts and sender names from the report (useful for runs over private data).
- `--summary` collapses per-line diagnostics into per-file counts.
- `--date-order` mirrors the merge app's override for ambiguous dates.
- `--check-examples` runs the test suite: fixtures, parser, inference, message parsing, merge units, collisions and end-to-end runs in temp dirs.

## Web browser

```
npm install
npm start -- --dir "/path/to/WhatsApp TXT" [--port 8787] [--host 127.0.0.1] [--no-watch]
```

An Express server that indexes every `.json` conversation into memory and serves a
single-page UI. Browsing and search only read the data directory; the import
panel (and its API) merges uploaded exports into it:

- conversation sidebar with name filter, message counts and last activity;
- message view with date separators, sender colors and type styling (`media`, `attachment`, `deleted`, `system`); dates and times render as `YYYY-MM-DD` and `hh:mm AM/PM` in the browser's timezone;
- full-text search (case-insensitive substring, with a **Whole words** toggle so `the` does not match `then`) with snippets, filters (conversation, sender, type, date range) and globally chronological results (oldest/newest first);
- click a search result to jump to that exact message;
- windowed paging keeps very large conversations (tens of thousands of messages) responsive;
- three view modes (Transcript / Bubbles / Compact) and jump-to-top/latest buttons (`Home` / `End`);
- live debounced search with a whole-words toggle, filters kept in the URL, and `j`/`k` result navigation;
- keyboard-friendly conversation list, loading skeletons and error banners, and an automatic light/dark theme that follows the device;
- `fs.watch` reindexing plus a manual reload button; `/` focuses search.

**Importing exports.** The Import button opens a panel where you drop WhatsApp
exports (`.zip` or `.txt`); each upload is streamed to a hidden incoming
directory, then **Import** extracts any archives (including a nested zip level),
strips `.vcf` files and merges everything with the existing conversations.
**Preview** runs the same merge as a dry run and writes nothing. Uploads are
consumed only after a successful merge, so a failed or previewed batch can be
retried or discarded. The merge aborts before renaming, deleting or writing
anything when a file cannot be parsed or a name collision would occur; a merge
runs one at a time and rejects cross-origin posts. Uploads are capped at 200MB
each.

Performance at the current scale (455 conversations, 539k messages, ~80MB): ~0.5s startup,
~300MB RSS, searches in <100ms. Invalid or hidden files are skipped and reported in
`/api/state`. The JSON API is `/api/state`, `/api/conversations`,
`/api/conversations/:id/messages?offset=&limit=&around=`, `/api/search` (add `whole=1` for whole-word matching) and `POST /api/reload`.
Import API: `POST /api/import/upload?batch=&name=` (raw body), `POST /api/import/merge`
(`{batch, dryRun?, dateOrder?}`), `POST /api/import/cancel` and `GET /api/import/last`.

### Docker

```
docker build -t whatsapptxt-browser .
docker run --rm -p 8787:8787 -v "/path/to/WhatsApp TXT:/data" whatsapptxt-browser
```

The container uses `/data` by default, so mount the conversation directory there
(writable when you want to import; a read-only mount still supports browsing).
`DATA_DIR`, `HOST` and `PORT` environment variables override the defaults
(e.g. `-e PORT=9000 -p 9000:9000`). The image runs as uid 1000; if your files are owned by a different
uid, add `--user "$(id -u):$(id -g)"` to the `docker run` command. `unzip` is
bundled for archive imports.

## Development

```
npm test                    # checker self-test + server API and browser tests
npm run test:server         # server tests only (browser tests skip without Chromium)
node examples/generate.js   # regenerate the committed example fixtures
```

Layout:

- `examples/valid/` — files that must pass the checker.
- `examples/invalid/` — files that must fail, with expected reasons in `examples/expectations.json`.
- `examples/merge/` — source-directory pairs used by the merge tests.
