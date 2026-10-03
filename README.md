# WhatsAppTXT

Merges WhatsApp `.txt` chat exports of the same conversation across multiple backup directories into a single JSON file per conversation.

## Usage

```
node WhatsAppTXT.js [--dry-run] [--no-normalize] [--date-order=auto|dmy|mdy|ymd] [--help] <output-directory> [additional-source-directory] [...]
```

- The first directory receives the merged files; old outputs there are replaced.
- Files that result in the same conversation name are merged across all directories (`Alice.txt` and `20240105 - Alice.json` are the same conversation).
- Recognized filename prefixes are stripped before matching (`WhatsApp Chat with `, `YYYYMMDD - `, `YYYY-M-D-`).
- `--dry-run` reports what would happen without renaming, deleting or writing anything.
- `--no-normalize` writes the legacy verbatim `.txt` merge instead of JSON.
- `--date-order` forces the component order for ambiguous slash/dot dates (`auto` infers per file).
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
- Output files are named `YYYYMMDD - <conversation>.json` using the last message date; `--no-normalize` uses `.txt`.

## Merging

- Sources are parsed into messages and merged as a union, then sorted by `date` (stable).
- Identical messages from overlapping backups are deduplicated by `(date, sender, body)`, keeping the highest occurrence count seen in any single source — genuine repeats survive, cross-source overlap does not duplicate.
- JSON outputs written by a previous run are read back and re-merged, so running the tool repeatedly is idempotent.

## Timestamp matching

Matching is built from two layers:

1. **Explicit formats** whose component order is unambiguous:

| Name | Example |
| --- | --- |
| `android` | `2024-01-15, 3:04 p.m. - Alice: hello` |
| `androidSeconds` | `2017-11-09, 9:01:18 AM: Alice: hello` |
| `iphone` | `[2024-01-15, 3:04:05 AM] Alice: hello` |
| `canonical` | `2024-01-15-090418 - Alice: hello` (legacy text output) |

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

## Development

```
npm test                    # node checkFormat.js --check-examples
node examples/generate.js   # regenerate the committed example fixtures
```

Layout:

- `examples/valid/` — files that must pass the checker.
- `examples/invalid/` — files that must fail, with expected reasons in `examples/expectations.json`.
- `examples/merge/` — source-directory pairs used by the merge tests.
