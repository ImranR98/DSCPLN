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
| `notifications.monthlyLimitUrl` | The ntfy.sh URL to which to send "monthly budget limit reached" notifications, or `null`. Notifications are sent per currency with a budget. |
| `notifications.ntfyToken` | An authorization token to use when sending out notifications, or `null`. |
| `notifications.checkIntervalMinutes` | How often, in minutes, to check for changes so that notifications can be sent out if needed (defaults to `30`). |
| `notifications.onlyWarnOnce` | When `true`, a given currency's monthly notification is only sent the first time it goes over budget, not for subsequent increases. |

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

| Main Expenses | Extra Expenses | Special Expenses | Money In | Currencies |
| --- | --- | --- | --- | --- |
| Rent | Entertainment | School Fees | Job | CAD |
| Subscriptions | Snacks | Loan Repayment | From Parents | USD |
| ... | ... | ... | ... | XMR |

- Category names and currencies are never hardcoded: edit this sheet to add, rename, or remove them. Two group names are special: `Money In` defines income categories, and `Conversions` marks currency-conversion categories. Conversion categories are valid for both kinds and are tracked separately from spending/earning (see below); everything not in `Money In` is an expense category.
- Budgets live below the table, one row per currency:
  ```
  Budgets
  Currency   Monthly Budget   First Day Bias
  CAD        3000             1500
  USD        500              100
  ```
  The first-day bias is an extra amount available on the 1st of the month. A currency with no row (or a 0 budget) simply has no budget tracking; saving a budget of 0 clears it. The app creates the table on the first save if it is missing.

## API

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

`/data` also returns `conversionCategories` (the categories in the `Conversions` group), `transactionRange` (the first and last dated transactions, used by the insights "All time" preset), and a `fractional` flag per currency (whether any amount needs sub-cent precision).

Transaction ids embed the row number and a hash of the row values. If the workbook changes underneath the app, stale ids are rejected with `409 Conflict` and the UI refreshes.

## Dashboard

The dashboard covers the current month, per currency:

- The **main currency** (the first one in Constants) gets the full Month card: spend against its budget with progress, pace, remaining/day, previous-month spend, and 12-month average spend.
- **Earnings** for the main currency: `Money In` for the current month, the previous calendar month, and the running average of the 12 complete months before the current month (missing months count as $0).
- **Other currencies** appear as compact tiles below, each with spend vs budget, a progress bar, remaining, and income. Currencies with no spending or income this month are hidden; the main currency is always shown.
- **Last 12 months** charts money in and out per month for every currency with activity in that window, as small multiples (one lane per currency, each with its own scale), a 12-month Total column, and a hover tooltip. The current month is capped at today and marked with an asterisk. Each currency keeps a stable accent color across its tile, chips, and chart lane.
- **This month** lists all currencies' transactions newest first, with the date on each row; future-dated rows are dimmed.
- **Currency conversions** (categories in the `Conversions` group) do not count as spending or earning: they are excluded from the Spent/Earned figures, budgets, pace and notifications. The main card shows a net **Converted** row (in − out per period, hover for the out/in split), currency tiles show a compact converted line, and the chart's Total column lists `conv out`/`conv in` rows.
- Each currency has its own budget, editable from the pencil button on its card.

On wide screens the transactions list sits in a second column on the right, with the chart below the month overview; on narrow screens everything stacks in one column, with the chart below the transactions list.

### Transactions

- **Add**: open "This month", click "Add transaction", and fill in Expense/Income, amount, details, date, category, currency, and optional notes. The date defaults to today, and the currency defaults to the main (first) Constants currency.
- **Details autocomplete**: as you type in Details, previously used descriptions appear in a suggestion menu (ranked by prefix/token match, use count and recency). Picking one also fills the category with the last one used for that description.
- **Category suggestions**: as you type details, the app scores them against all past transactions of the same kind (fuzzy token/trigram/edit-distance matching, weighted by how often and how recently a category was used). It auto-selects the category when the match is confident, and always shows the top suggestions so you can pick a different one.
- **Import**: click "Import" and paste one transaction per line, tab-separated, using the Transactions sheet's column order (shown in the dialog). Exactly one of Money In / Expenses must be filled; any other sheet columns must be left empty. Every line is validated first: if any line is invalid the whole paste is rejected with per-line errors and nothing is written. Lines dated before the current month trigger a confirmation step ("Import anyway"). A successful import is one git commit.
- **Edit / delete**: use the buttons on each row. Deleting shifts the remaining rows up, like deleting a row in Excel.

## Insights

`/insights` (linked from the dashboard header) analyzes an arbitrary date range, per currency:

- **Filters**: start/end date pickers; quick ranges `This month`, `Last month`, a month chip (opens a month picker), `Last 3/6/12 full months` (complete calendar months only), `Year to date` and `All time` (first to latest transaction); and one **Compare with** selector: `Previous period` (default; whole months compare with the same number of whole months before, partial months with the matching calendar days of the previous month — e.g. This month on Oct 5 compares Oct 1–5 with Sep 1–5 — and Year to date with the same period last year), `Same period last year`, or `Trailing 3/6/12-month average`. All comparisons on the page — KPIs, categories, movers, chart baselines and the forecast — use this window. The range and comparison are kept in the URL, and a note spells out the exact windows being compared (partial-month comparisons are explained; average comparisons are scaled per day).
- **Transactions panel** (top, collapsed by default): all transactions in the range across currencies, read-only.
- **Monthly totals chart** (above the currency sections, when the range spans more than one month): the same chart as the dashboard, with an asterisk marking partial months.
- **Per-currency sections** (primary first, then by volume), each with:
  - KPI tiles for spent, earned, net (colored by sign, with intensity based on the smaller of spent/earned), average spend per day, average earned per day and transaction count — all vs the selected comparison, with the exact window in the tooltip.
  - Category breakdowns for spending and earning with include/exclude checkboxes that recompute the totals, percentages, charts and forecast (select all/none included).
  - A cumulative spent-and-earned chart (over the selected range, starting/ending at its actual dates) with dashed spent/earned baselines for the selected comparison.
  - Forecasts: projected month-end spend/income when the range includes today, plus a next-30-days estimate based on the selected comparison window (labeled with the exact dates/months used).
  - Biggest spending and earning increases/decreases vs the comparison.
- Budgets are not referenced on this page.
- Conversion categories are de-selected by default in every section (they remain in the list and can be re-enabled).

## Operations

### Backups and version control

- The workbook is required to live in a git repository. Every write is committed automatically to that repository as `D$CPLN <dscpln@localhost>`, with signing disabled (any configured git user, email, or signing key is not used).
- Every write first copies the current workbook to `<workbookFile>.bak`, then writes a temp file and atomically renames it over the original. Add `*.xlsx.bak` and `*.xlsx.tmp` to the repository's `.gitignore`.
- Close the workbook in Excel/LibreOffice while the app is editing it; otherwise the app's save or the spreadsheet app's save can overwrite the other.
- Writing recalculates formulas only when the workbook is next opened; cached formula values are not preserved by the writer.

### Docker

```sh
docker build -t dscpln .
docker run -p 3300:3300 -v ./config.json:/app/config.json -v ./dscpln-data:/data dscpln
```

The image includes git and runs as the non-root `node` user (uid 1000), so mount the workbook's repository directory (with its `.git` directory) writable by that uid and point `workbookFile` at the file inside it (for example `/data/Balance.xlsx`). `./build.sh` builds and pushes `imranrdev/dscpln:latest` for linux/amd64 and prints the digest to pin in your deployment.

### Tests

```sh
npm test
```

## Architecture

No build step and no framework: the browser loads plain scripts, and the server is a small Express app.

| File | Purpose |
| --- | --- |
| `static/core.js` | Shared primitives exposed as one `DSCPLN.*` global: dates, Intl formatters, money formatting, currency colors, the `el()` DOM builder, `requestJson()`, theme cycling and toasts. |
| `static/insights-math.js` | Pure aggregation and comparison math (`DSCPLN.math`); also required by the Node tests. |
| `static/transaction-list.js` | Transaction rows shared by both pages (editable on the dashboard, read-only on insights). |
| `static/chart.js` | SVG charts: the multi-currency monthly chart and the cumulative spent/earned line chart. |
| `static/app.js`, `static/insights.js` | Page controllers (rendering, dialogs, filters). |
| `server.js` | Routes and error handling; `notifications.js` sends budget-limit pushes. |
| `dataProviders/excelDataProvider.js` | Workbook reading/writing; `category-suggester.js` and `workbook-git.js` are its helpers. |

`theme-boot.js` runs first (synchronously in `<head>`, to set the theme before first paint), then scripts must load in this order: `core.js` → (`insights-math.js` on insights) → `transaction-list.js` → `chart.js` → page script. Conventions: `render*` draws into an existing container, `build*` creates and returns a node, `read*` parses workbook data, `create*` is a factory. Tests use `test/helpers.js` for temporary git-backed workbooks and a test server.
