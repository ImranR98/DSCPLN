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
- `Type` is the category, and must exist in the Constants sheet (matched to the transaction kind).
- `Currency` must be one of the currencies listed in the Constants sheet.

### Constants sheet

Row 2 holds a header per column, and each column lists the allowed values for that group:

| Main Expenses | Extra Expenses | Special Expenses | Money In | Currencies |
| --- | --- | --- | --- | --- |
| Rent | Entertainment | School Fees | Job | CAD |
| Subscriptions | Snacks | Loan Repayment | From Parents | USD |
| ... | ... | ... | ... | XMR |

- Category names and currencies are never hardcoded: edit this sheet to add, rename, or remove them (the `Money In` column defines income categories; everything else is an expense category).
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
- **Category suggestions**: as you type details, the app scores them against all past transactions of the same kind (fuzzy token/trigram/edit-distance matching, weighted by how often and how recently a category was used). It auto-selects the category when the match is confident, and always shows the top suggestions so you can pick a different one.
- **Edit / delete**: use the buttons on each row. Deleting shifts the remaining rows up, like deleting a row in Excel.

The same actions are available over HTTP:

| Method | Path | Body |
| --- | --- | --- |
| `GET` | `/data?date=YYYY-MM-DD` | - |
| `GET` | `/category-suggestions?q=details&kind=expense` | - |
| `POST` | `/transactions` | `{ "kind", "amount", "details", "date", "category", "currency", "notes" }` |
| `PUT` | `/transactions/:id` | `{ "kind", "amount", "details", "date", "category", "currency", "notes" }` |
| `DELETE` | `/transactions/:id` | - |
| `POST` | `/budget` | `{ "monthlyBudget", "firstDayBias", "currency" }` |

Transaction ids embed the row number and a hash of the row values. If the workbook changes underneath the app, stale ids are rejected with `409 Conflict` and the UI refreshes.

## Dashboard

Everything is shown on one page, per currency:

- The **main currency** (the first one in Constants) gets the full Month card: spend against its budget with progress, pace, remaining/day, previous-month spend, and 12-month average spend.
- **Earnings** for the main currency: `Money In` for the viewed month, the previous calendar month, and the running average of the 12 complete months before the viewed month (missing months count as $0).
- **Other currencies** appear as compact cards below, each with spend vs budget, a progress bar, income, and the same trend figures. Currencies with no spending or income on the viewed date are hidden; the main currency is always shown.
- **This month** lists all currencies' transactions, grouped by currency with per-currency out/in totals.
- Each currency has its own budget, editable from the pencil button on its card. The first-day bias is available from day 1 and the rest of the budget accrues across the month.

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
