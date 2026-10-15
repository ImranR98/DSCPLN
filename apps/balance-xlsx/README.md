# D$CPLN

A simple web app that shows whether you've gone over your budget this month, and sends push notifications when a limit is reached.

It reads your expenses from an Excel workbook (the source of truth) and writes changes straight back to it. The dashboard covers the current month and adding transactions; the insights page is a historical viewer with date ranges and comparisons.

## Setup

1. Install dependencies:
   ```sh
   npm install
   ```
2. Copy the example config and edit it:
   ```sh
   cp config.example.json config.json
   ```
3. Start the app:
   ```sh
   npm start
   ```

The app reads `config.json` from its directory by default; set `DSCPLN_CONFIG` to use a different path. The example config points at the included `mock-data.xlsx`, so you can try it immediately; `npm run mock` regenerates that file.

## Configuration

`config.example.json` lists every option with its defaults:

| Key | Description |
| --- | --- |
| `port` | HTTP port to listen on (defaults to `3300`). |
| `dataProvider` | The module from `/dataProviders` to use for data sourcing. Defaults to `excelDataProvider` (the only one currently available). |
| `providers.<name>` | Provider-specific options, described below. |
| `notifications.checkIntervalMinutes` | How often, in minutes, to check for changes so that notifications can be sent out if needed (defaults to `30`). |
| `notifications.onlyWarnOnce` | When `true`, a given currency's monthly notification is only sent the first time it goes over budget, not for subsequent increases. |
| `api.stateFile` | The file holding the external API token and its edit-token signing secret (defaults to `./api-state.json`; created on first run, mode `0600`). Relative paths resolve against the config file's directory. |

Budget notifications are relayed through the portal (`DSCPLN_PORTAL_URL`, e.g.
`http://portal:8080` in Kubernetes), whose Settings hold the ntfy URL and
token; without a relay configured the check is a no-op.

### `excelDataProvider` options

| Key | Description |
| --- | --- |
| `workbookFile` | The path to the Excel workbook (`.xlsx`). Relative paths resolve against the config file's directory. |
| `transactionsSheet` | Name of the sheet holding transactions (defaults to `Transactions`). |
| `constantsSheet` | Name of the sheet holding categories, currencies, and the budget (defaults to `Constants`). |

## Workbook schema

### Transactions sheet

The first row holds the headers, which are matched by name (other sheets and extra columns are left untouched):

| Date | Details | Money In | Expenses | Currency | Type | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| 2026-09-01 | Rent September | | 1275 | CAD | Rent | |
| 2026-09-03 | Job | 2645 | | CAD | Job | Paycheque |

- `Date` is a real Excel date; the app reads and writes full dates, so the sheet can span any number of years.
- `Money In` and `Expenses` are separate amount columns; a transaction fills one of them (choose Expense or Income in the form).
- Amounts may have up to 12 decimal places (fractional currencies like XMR work). The UI always shows at least two decimals and adds more only when a value needs it.
- `Type` is the category, and must exist in the Constants sheet (matched to the transaction kind).
- `Currency` must be one of the currencies listed in the Constants sheet.

### Constants sheet

Row 2 holds a header per column, and each column lists the allowed values for that group:

| Main Expenses | Extra Expenses | Special Expenses | Money In | Currencies | Symbols |
| --- | --- | --- | --- | --- | --- |
| Rent | Entertainment | School Fees | Job | CAD | $ |
| Subscriptions | Snacks | Loan Repayment | From Parents | USD | $ |
| ... | ... | ... | ... | XMR | |

- Category names and currencies are never hardcoded: edit this sheet to add, rename, or remove them.
- `Symbols` pairs with `Currencies` by row and prefixes every amount shown for that currency (e.g. `$1,234.56`, `TSh1,234.56`). Leave it blank for currencies without a symbol; their amounts are shown as bare numbers, since the currency code is displayed elsewhere (row, section, chart lane). Two group names are special: `Money In` defines income categories, and `Conversions` marks currency-conversion categories. Conversion categories are valid for both kinds and are tracked separately from spending/earning (see below); everything not in `Money In` is an expense category.
- Budgets live below the table, one row per currency:
  ```
  Budgets
  Currency   Monthly Budget   First Day Bias
  CAD        3000             1500
  USD        500              100
  ```
  The first-day bias is an extra amount available on the 1st of the month. A currency with no row (or a 0 budget) simply has no budget tracking; saving a budget of 0 clears it. The app creates the table on the first save if it is missing.

## API

These routes are used by the web UI (and only support what it needs).

| Method | Path | Body |
| --- | --- | --- |
| `GET` | `/data?date=YYYY-MM-DD` | - |
| `GET` | `/category-suggestions?q=details&kind=expense` | - |
| `GET` | `/details-suggestions?q=details&kind=expense` | - |
| `GET` | `/transactions?start=YYYY-MM-DD&end=YYYY-MM-DD` | - |
| `POST` | `/transactions` | `{ "kind", "amount", "details", "date", "category", "currency", "notes" }` |
| `POST` | `/transactions/import` | `{ "text" }` — tab-separated rows in the sheet's column order (non-transaction columns must be empty) |
| `PUT` | `/transactions/:id` | `{ "kind", "amount", "details", "date", "category", "currency", "notes" }` |
| `DELETE` | `/transactions/:id` | - |
| `POST` | `/budget` | `{ "monthlyBudget", "firstDayBias", "currency" }` |

`/data` also returns `conversionCategories` (the categories in the `Conversions` group), `transactionRange` (the first and last dated transactions, used by the insights "All time" preset), and a `fractional` flag per currency (whether any amount needs sub-cent precision). Each currency also carries `firstMonth` (its earliest transaction month, so averages skip months before the data begins), `trailingMonths` (how many months the trailing averages cover), and month-to-date variants of the previous-month and trailing-average figures (`previousMonths*ToDate`, `trailing*AverageToDate`) used for same-days comparisons on the dashboard.

Transaction ids embed the row number and a hash of the row values. If the workbook changes underneath the app, stale ids are rejected with `409 Conflict` and the UI refreshes.

### External API

`/balance/api/*` is a small JSON API meant for scripts and other automations. It is designed to be
reachable without SSO (the consolidated ingress routes it around Authelia), so it is protected by a
bearer token instead. Open the settings page (`/balance/settings`, linked from the header) to copy or
regenerate the single token; send it as `Authorization: Bearer <token>`.

| Method | Path | Body |
| --- | --- | --- |
| `GET` | `/balance/api/categories?details=<text>&kind=expense\|income` | - |
| `POST` | `/balance/api/transactions` | `{ "amount", "details", "currency", "category", "date"?, "notes"? }` |

- `GET /balance/api/categories` returns every category grouped as in the Constants sheet, each with `score: 0`. Adding `details` and `kind` scores every category of that kind between 0 and 1, best match first (`0` when nothing matches); `details` without `kind`, or an unknown kind, is a `400`.
- `amount` is signed: negative is an expense (`Expenses`), positive is income (`Money In`); `0` is rejected. `date` defaults to today. `details`, `currency` and `category` are required, and the category must exist in the Constants sheet for the transaction's kind. The response is `201 { "transaction": ... }`.

```sh
# See how each expense category scores for a description
curl -G https://dscpln.example.com/balance/api/categories \
  -H "Authorization: Bearer $TOKEN" \
  --data-urlencode "details=Coffee beans" --data-urlencode "kind=expense"

# Add the transaction with the chosen category
curl -X POST https://dscpln.example.com/balance/api/transactions \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"amount":-12.34,"details":"Coffee beans","currency":"CAD","category":"Snacks"}'
```

## Dashboard

- **Month navigation** in the header (`‹`/`›`) moves the whole page between
  months.
- The **primary currency** (the first one in Constants) gets the hero card:
  spend against its budget, a progress bar, remaining budget, per-day
  allowance and days left, plus a This month / Last month / 12-mo avg table
  for spend and earnings.
- **Other currencies** are compact tiles with spend vs budget and a progress
  bar. Every currency has its own budget, editable from the Edit button on its
  card.
- **Last 12 months** charts money in and out per month for the primary
  currency (Chart.js).
- **Transactions** lists the selected month's rows newest first — date,
  details, category, out, in, currency — with Add transaction and per-row
  Edit/Delete.

### Transactions

- **Add**: open the dialog from the transactions card; it takes date, details,
  kind (expense or income), amount, currency and notes. Income fills `Money
  In`, expense fills `Expenses`.
- **Edit / delete**: per-row buttons; deleting shifts the remaining rows up in
  the workbook, like deleting a row in Excel.
- The workbook's remaining columns (`Type`, categories, ...) are preserved;
  the external API (below) accepts full transaction objects including
  categories.

## Insights

`/insights` (linked from the dashboard header) analyzes a date range per
currency:

- **Filters**: currency, start/end date pickers and quick ranges (Last
  12 months, Year to date).
- **Totals** for the range: spent, earned, net, and the previous period's
  spend (the same-length window immediately before the range).
- **Monthly totals** bar chart (out vs in per month) and a **cumulative
  spend** line chart (Chart.js).
- **Biggest category moves** vs the previous period, ranked by absolute
  change.

## Operations

### Backups and version control

- The workbook is required to live in a git repository. Every write is committed automatically to that repository as `D$CPLN <dscpln@localhost>`, with signing disabled (any configured git user, email, or signing key is not used).
- Every write first copies the current workbook to `<workbookFile>.bak`, then writes a temp file and atomically renames it over the original. Add `*.xlsx.bak` and `*.xlsx.tmp` to the repository's `.gitignore`.
- Close the workbook in Excel/LibreOffice while the app is editing it; otherwise the app's save or the spreadsheet app's save can overwrite the other.
- Writing recalculates formulas only when the workbook is next opened; cached formula values are not preserved by the writer.

### Docker

```sh
# from the monorepo root (the build context is the repo root):
docker build -f apps/balance-xlsx/Dockerfile -t dscpln-balance .
docker run -p 3300:3300 -v ./config.json:/app/config.json -v ./balance-data:/data dscpln-balance
```

The image includes git and runs as the non-root `node` user (uid 1000), so mount the workbook's repository directory (with its `.git` directory) writable by that uid and point `workbookFile` at the file inside it (for example `/data/Balance.xlsx`). Build and push with `scripts/build.sh balance-xlsx` from the monorepo root (set `IMAGE_ORG` to your registry namespace) and pin the printed digest in your deployment.

### Tests

```sh
npm test
```

## Architecture

React + Vite front end under `ui/` (built into `static/`, served by the
node server) and a small Express back end. The UI reads the workbook through
the API; the workbook stays the source of truth.

| File | Purpose |
| --- | --- |
| `ui/src/Dashboard.jsx` | Month dashboard; hero/currency cards are components in `ui/src/components/`. |
| `ui/src/Insights.jsx` | Range analysis, charts and category movers (math in `ui/src/lib/insights-model.js`). |
| `ui/src/Settings.jsx` | Data-source info and the external API token. |
| `ui/src/lib/insights-math.js` | Pure aggregation/comparison helpers (also imported by the Node tests). |
| `ui/src/lib/chart.js` | Chart.js setup shared by both pages. |
| `ui/src/lib/money.js` | Money formatting and stable per-currency colors. |
| `server.mjs` | Routes and error handling; `notifications.mjs` sends budget-limit pushes. |
| `api-auth.mjs` | The external API's bearer token and edit-token signing, persisted in `api.stateFile`. |
| `dataProviders/excel/provider.mjs` | Workbook reading/writing; `parse.mjs` and `model.mjs` are its helpers (`category-suggester.mjs`, `workbook-git.mjs` alongside). |

Build the UI with `npm run build:ui --workspace dscpln-balance-xlsx` (or
`npm run ui` at the repo root); `npm test` builds it first. Tests use
`test/helpers.mjs` for temporary git-backed workbooks and a test server.
