# D$CPLN

Every data backup and sync workflow in one place. D$CPLN is a monorepo of
small always-on Node apps, one per function, deployed behind a single host at
`https://dscpln.home.example.com/<function>` with a portal at `/`.

| Function | Path | Description |
|---|---|---|
| Balance XLSX | `/balance` | Budget dashboard backed by the live Excel workbook (external add-transaction API at `/balance/api`) |
| Media Sync | `/media` | Watches device folders, standardizes media, queues review/trash |
| WhatsApp TXT | `/watxt` | Browses, imports and merges WhatsApp exports |
| Task Runner | `/tasks` | Config-driven backup/export workflows (PC + srv0 bridge) |
| Contacts + Calendar | `/contacts` | Scheduled Nextcloud contacts/calendar exports |
| Infra Compose State | `/compose` | Scheduled srv0/vps0 compose runtime-state backups |
| YTMusic Downloads | `/ytmusic` | Scheduled YouTube Music library downloads |

Helper tools (bank-statement ETL, Instacart/Wealthsimple scrapers, wine game
saves) live under `tools/` and are invoked by Task Runner.

## Development

Requires Node 22+ (24 recommended).

```sh
npm install            # installs every workspace
npm test               # builds every UI and runs every test suite
npm run ui             # build all UIs only
npm run balance-xlsx   # start Balance XLSX locally (http://localhost:3300)
npm run ytmusic        # ...or any app by name
```

Each app runs standalone from its directory with `BASE_PATH` empty; apps on
the Svelte stack build their UI first (`npm run build:ui --workspace <pkg>`,
then `npm start --workspace <pkg>`). In the cluster every app gets its
`BASE_PATH` (`/balance`, `/media`, …) and is routed through one TLS host.

See `docs/ARCHITECTURE.md` for the kit APIs, the base-path contract and the
new-app recipe; `docs/REPLACEMENT-PLAN.md` tracks which old workflows have been
replaced.

## Safety

This repo drives backups of personal data. Never delete user data, write
config/state atomically (`0600`), verify before overwriting, and keep the
existing on-disk formats (`.backup-state-*.json`, `XMP-media-sync:*` tags,
WhatsAppTXT data dirs) compatible.
