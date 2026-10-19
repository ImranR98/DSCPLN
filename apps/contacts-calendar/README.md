# Contacts + Calendar

Scheduled exports of Nextcloud CalDAV calendars and CardDAV address books.
Each enabled collection is written to its own file (`.ics` / `.vcf`) in a
destination folder, optionally committed to git, and replaced atomically.

Configuration can also be mounted from a private `dscpln-config` repo: set `DSCPLN_CONFIG_FILE` to its `apps/contacts-calendar/config.json`; run state stays on the app volume (`DSCPLN_STATE_FILE` for scheduled apps). See `config-template/README.md`.

## Configuration

| Field | Meaning |
|---|---|
| `nextcloudUrl` | Nextcloud base URL (in-cluster services often use `http://nextcloud`) |
| `username` / `appPassword` | Nextcloud login; create a device password under Personal settings → Security. The password is write-only in the UI (masked in API responses) |
| `destination` | where the exports are written (default `~/Backups/Manual`) |
| `collections` | discovered calendars/address books: `{ href, type, displayName, enabled, filename }`; the export file defaults to the collection's Nextcloud display name |
| `git` | `{ enabled, message }` — commit the exports after each run (`message` empty uses a timestamp) |
| `schedule` / `notifySuccess` | `{enabled, days, at, catchUp}` (default Sundays 03:00) and whether successful runs notify |

Press **Discover** in Settings to list the account's collections (new ones are
enabled by default; uncheck any to skip). Files are written atomically and the
destination can be a git repository, so every run is one commit.

## Running

```sh
npm start --workspace dscpln-contacts      # http://localhost:8080
```

Container: mount a writable volume for config/state (the image uses `/data`)
and mount the destination folder from your data tree; set the Nextcloud URL
reachable from the container.

## Development

UI is React under `ui/` (built into `static/`):

```sh
npm run build:ui --workspace dscpln-contacts
npm test --workspace dscpln-contacts       # builds, then unit (fake DAV) + browser tests
```
