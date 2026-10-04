# D$CPLN

A simple webpage that shows whether or not you've gone over your budget this month, and sends you push notifications when the limit is reached.

Does this by reading a list of your expenses from an Excel workbook and checking to see if the total exceeds a preference you set. You can add, edit, and delete transactions from the dashboard, which writes them straight back to the workbook, and the app suggests a category for new transactions based on similar past ones.

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

The app reads `config.json` from its directory by default. Set `DSCPLN_CONFIG` to use a different path (useful in Docker). The example config points at the included `mock-data.xlsx`, so you can try it immediately; `npm run mock` regenerates that file.

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
  The first-day bias is an extra amount available on the 1st of the month. A currency with no row (or a 0 budget) simply has no budget tracking. The app creates the table on the first save if it is missing. If you still have the older single `Budget` section (`Monthly Budget` / `First Day Bias` in column A/B), it is read as the first currency's budget until you save a new one.

## Transactions

- **Add**: open "This month", click "Add transaction", and fill in Expense/Income, amount, details, date, category, currency, and optional notes. The date defaults to the day you are viewing, and the currency defaults to the main (first) Constants currency.
- **Details autocomplete**: as you type in Details, previously used descriptions appear in a suggestion menu (ranked by prefix/token match, use count and recency). Picking one also fills the category with the last one used for that description.
- **Category suggestions**: as you type details, the app scores them against all past transactions of the same kind (fuzzy token/trigram/edit-distance matching, weighted by how often and how recently a category was used). It auto-selects the category when the match is confident, and always shows the top suggestions so you can pick a different one.
- **Import**: click "Import" and paste one transaction per line, tab-separated, using the Transactions sheet's column order (shown in the dialog). Exactly one of Money In / Expenses must be filled. Every line is validated first: if any line is invalid the whole paste is rejected with per-line errors and nothing is written. A successful import is one git commit.
- **Edit / delete**: use the buttons on each row. Deleting shifts the remaining rows up, like deleting a row in Excel.

The same actions are available over HTTP:

| Method | Path | Body |
| --- | --- | --- |
| `GET` | `/data?date=YYYY-MM-DD` | - |
| `GET` | `/category-suggestions?q=details&kind=expense` | - |
| `GET` | `/details-suggestions?q=details&kind=expense` | - |
| `GET` | `/transactions?start=YYYY-MM-DD&end=YYYY-MM-DD` | - |
| `POST` | `/transactions` | `{ "kind", "amount", "details", "date", "category", "currency", "notes" }` |
| `POST` | `/transactions/import` | `{ "text" }` — tab-separated rows in the sheet's column order |
| `PUT` | `/transactions/:id` | `{ "kind", "amount", "details", "date", "category", "currency", "notes" }` |
| `DELETE` | `/transactions/:id` | - |
| `POST` | `/budget` | `{ "monthlyBudget", "firstDayBias", "currency" }` |

Transaction ids embed the row number and a hash of the row values. If the workbook changes underneath the app, stale ids are rejected with `409 Conflict` and the UI refreshes.

## Dashboard

Everything is shown on one page, per currency:

- The **main currency** (the first one in Constants) gets the full Month card: spend against its budget with progress, pace, remaining/day, previous-month spend, and 12-month average spend.
- **Earnings** for the main currency: `Money In` for the viewed month, the previous calendar month, and the running average of the 12 complete months before the viewed month (missing months count as $0).
- **Other currencies** appear as compact tiles below, each with spend vs budget, a progress bar, remaining, and income. Currencies with no spending or income on the viewed date are hidden; the main currency is always shown.
- **Last 12 months** charts money in and out per month for every currency with activity in that window, as small multiples (one lane per currency, each with its own scale), a 12-month Total column, and a hover tooltip. Each currency keeps a stable accent color across its tile, chips, and chart lane.
- On wide screens the transactions list moves into a second column on the right; on narrow screens everything stacks in one column.
- **This month** lists all currencies' transactions with the date shown on each row.
- **Currency conversions** (categories in the `Conversions` group) do not count as spending or earning: they are excluded from the Spent/Earned figures, budgets, pace and notifications. The main card shows a net **Converted** row (in − out per period, hover for the out/in split), currency tiles show a compact converted line, and the chart's Total column lists `conv out`/`conv in` rows.
- Each currency has its own budget, editable from the pencil button on its card. The first-day bias is available from day 1 and the rest of the budget accrues across the month.

## Insights

`/insights` (linked from the dashboard header) analyzes an arbitrary date range, per currency:

- **Filters**: start/end date pickers, a month picker that selects a whole month, and quick ranges (this/last month, 3/6/12 months, YTD). The range is kept in the URL.
- **Per-currency sections** (primary first, then by volume), each with:
  - KPI tiles for spent, earned, net, average spend per day and transaction count, each compared with the preceding equal-length period.
  - Category breakdowns for spending and earning with include/exclude checkboxes that recompute the totals, percentages, charts and forecast (select all/none included).
  - A cumulative-spend chart with the budget pace line for single-month ranges, or monthly spend/income bars for longer ranges.
  - Forecasts: projected month-end spend/income vs budget when the range includes today, plus a next-30-days estimate from the trailing 3-month average.
  - Biggest category increases/decreases vs the previous period.
- Conversion categories are de-selected by default in every section (they remain in the list and can be re-enabled).

## Migrations

Older workbooks can be migrated with:

```bash
node scripts/migrate-workbook.js --dry-run   # report what would change
node scripts/migrate-workbook.js             # apply, save, and commit
```

It converts the legacy single `Budget` section into the per-currency `Budgets` table and moves conversion categories (default `Conversion`, override with `--categories "A,B"`) into a new `Conversions` group column. It is idempotent and leaves a `.bak` file next to the workbook.

## Backups and version control

- The workbook is required to live in a git repository. Every write is committed automatically to that repository as `D$CPLN <dscpln@localhost>`, with signing disabled (any configured git user, email, or signing key is not used).
- Every write first copies the current workbook to `<workbookFile>.bak`, then writes a temp file and atomically renames it over the original. Add `*.xlsx.bak` and `*.xlsx.tmp` to the repository's `.gitignore`.
- Close the workbook in Excel/LibreOffice while the app is editing it; otherwise the app's save or the spreadsheet app's save can overwrite the other.
- Writing recalculates formulas only when the workbook is next opened; cached formula values are not preserved by the writer.

## Docker

```sh
docker build -t dscpln .
docker run -p 3300:3300 -v ./config.json:/app/config.json -v ./dscpln-data:/data dscpln
```

The image includes git and runs as the non-root `node` user (uid 1000), so mount the workbook's repository directory (with its `.git` directory) writable by that uid and point `workbookFile` at the file inside it (for example `/data/Balance.xlsx`). `./build.sh` builds and pushes `imranrdev/dscpln:latest` for linux/amd64 and prints the digest to pin in your deployment.

## Tests

```sh
npm test
```
