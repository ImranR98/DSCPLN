# D$CPLN UI preview (shadcn-svelte)

A throwaway prototype that shows what the Balance screens (dashboard + insights)
would look like built with [shadcn-svelte](https://shadcn-svelte.com) instead of
the current D$CPLN design system. Same data and functionality; only the look
changes. It is **not** part of the workspace, CI, or any deployment.

## Nothing is vendored

- `src/lib/components/ui/` (the shadcn components), `src/lib/generated/shadcn-base.css`,
  and `src/lib/utils.js` are generated at build time and **gitignored**.
- `scripts/sync-ui.mjs` fetches them with the **unpinned** `shadcn-svelte` CLI
  (`npx shadcn-svelte@latest add ...`) so the components track the latest registry;
  it also copies the CLI's bundled base stylesheet and writes the registry `cn` util.
- `predev`/`prebuild` run the sync automatically. Use `npm run sync -- --force` to refetch.

## Run it

Two processes:

```sh
# 1. the real Balance API with the synthetic workbook (port 5599)
node /tmp/opencode/proto-shot.mjs   # or run apps/balance-xlsx with BALANCE_URL elsewhere
# 2. the preview itself (Vite proxies /data, /transactions, ... to :5599)
cd prototypes/ui-preview && npm install && npm run dev
```

Or use `BALANCE_URL` to point at an already-running Balance server.

## Screens

- `#/` dashboard: month hero, comparison table, currency cards, last-12-months
  bar charts per currency, transactions list, and all four dialogs
  (budget, add/edit with details→category suggestions, import, delete).
- `#/insights`: range + comparison filters, quick-range presets, KPI tiles with
  deltas, category include/exclude, cumulative current-vs-previous line chart,
  movers and a 30-day forecast.

`src/routes/*.svelte` import the balance app's pure math modules directly
(`@balance/money.js`, `@balance/insights-math.js`) — no logic is duplicated.

## Screenshots

`docs/` holds captured screenshots (desktop light/dark, mobile, dialogs).
