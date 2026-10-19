# D$CPLN

A simple web app that shows whether you've gone over your budget this month, and sends push notifications when a limit is reached.

It reads your expenses from an Excel workbook (the source of truth) and writes changes straight back to it. The dashboard covers the current month and adding transactions; the insights page is a historical viewer with date ranges and comparisons; the forecasts page is a live projection planner.

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
- Budgets live in the settings blocks to the right of the category table (one blank column over, starting at row 2):
  ```
               | Budgets
               | Currency  | Monthly Budget | First Day Bias
               | CAD       | 3000           | 1500
               | USD       | 500            | 100
               |
               | Excluded from Budget by Default
               | Investment Buy
               | Investment Sell
  ```
  The first-day bias is an extra amount available on the 1st of the month. A currency with no row (or a 0 budget) simply has no budget tracking; saving a budget of 0 clears it. The app creates the table on the first save if it is missing.
- `Excluded from Budget by Default` lists categories that start out unchecked (left out of every total) on the dashboard and insights pages. Saving a selection from the dashboard's category picker writes this list; names that are no longer categories are ignored. Both settings blocks are read from anywhere on the sheet and are moved to this position on the next settings save.

### Scenario sheets (Forecasts page)

The forecasts page persists one visible worksheet named `Scenario - Base plan`. The sheet is **inputs only**: the page computes the baseline, target date, runway and projection live, and nothing computed is written back. A marker in `A1` (`D$CPLN Scenario v1`) identifies the sheet; the old date-named forecast snapshots, `Stats`, `Transactions` and `Constants` are never treated as scenarios. If multiple valid scenario sheets already exist, the app uses Base plan (or the first valid sheet) and leaves the others untouched.

| Section | Contents |
| --- | --- |
| Settings | Scenario name, currency, as-of date (blank = today), horizon, baseline window, notes; model settings (`Baseline method` Auto/Simple/Robust, `Recurring detection` On/Off, `Uncertainty` On/Off); revision and updated timestamp |
| Target | Label, amount, optional date |
| Accounts | Account, balance, include (`Yes`/`No`) |
| One-time events | Date, details, kind (`Income`/`Expense`), amount, notes |
| Recurring adjustments | Kind, category, normalized details, label, include, amount override, cadence, next date. Only user changes are written |
| Scheduled changes | From month (`YYYY-MM`), kind, category, monthly amount. Applies from the first day of that month |
| Category inputs | Kind, category, monthly override (replaces the category total, including recurring items), include (`Yes`/`No`) |

Input cells are blue, matching the old manual sheets' convention; metadata is black. The app creates or updates the Base plan sheet on Save. Detected recurring items, chosen methods, outliers, backtests and projections are computed live and are not persisted. Reset restores the default inputs; Save persists the reset, and Discard returns to the last saved sheet. `GET/PUT /forecast` use the sheet revision, so a stale edit is rejected with `409` before anything is written.

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
| `POST` | `/excluded-defaults` | `{ "categories": ["Investment Buy", ...] }` — writes the Constants "Excluded from Budget by Default" list |
| `GET` | `/forecast` | - — returns `{ "scenario", "errors" }` for the active Base plan sheet |
| `PUT` | `/forecast` | `{ "scenario": { "sheetName"?, "revision", ...inputs } }` — updates the one active sheet in a single workbook write. A stale revision is rejected with `409`. |

The forecast scenario object carries the model settings (`baselineMethod`, `recurringDetection`, `uncertainty`), `recurringAdjustments` and `changes` alongside the accounts/events/target. Updating it sends the same object back as `scenario`; the app validates it and writes the input-only sheet.

`/data` accepts repeated `exclude=<category>` parameters that leave those categories out of every figure for the view (spend, budgets, trailing averages, the history chart); without the parameter the workbook's default exclusions apply, and the response carries `defaultExcludedCategories` (the workbook's list). The month's transaction list, the all-time range and the suggestion helpers always see the whole workbook.

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
| `POST` | `/balance/api/transactions/check` | `{ "text" }` — the same tab-separated batch format as the UI import |
| `POST` | `/balance/api/transactions/import` | `{ "text", "skipDuplicates"? }` — imports the batch; with `skipDuplicates: true` lines already present are skipped |

- `GET /balance/api/categories` returns every category grouped as in the Constants sheet, each with `score: 0`. Adding `details` and `kind` scores every category of that kind between 0 and 1, best match first (`0` when nothing matches); `details` without `kind`, or an unknown kind, is a `400`.
- `amount` is signed: negative is an expense (`Expenses`), positive is income (`Money In`); `0` is rejected. `date` defaults to today. `details`, `currency` and `category` are required, and the category must exist in the Constants sheet for the transaction's kind. The response is `201 { "transaction": ... }`.
- `POST /balance/api/transactions/check` is read-only: it returns `{ "total", "duplicates", "new", "lines": [{ "line", "duplicate" }] }`. A line is a duplicate when the workbook already has a transaction with the same Date, Details, signed amount and Currency; `Type` and `Notes` are ignored, and the comparison is count-aware (two identical lines match two stored rows, not one), so a recategorized or annotated stored row still matches a freshly scraped line. `Type`/`Notes` may be empty in checked batches (the import itself still requires them).
- `POST /balance/api/transactions/import` reuses the UI import's parsing and validation (all-or-nothing, invalid lines reject the whole batch) and responds `201 { "imported", "skipped", "transactions" }`. With `skipDuplicates: true`, lines matching the loose key above are reported in `skipped` before validation, so a since-renamed category on an already-imported row cannot block a clean import.

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
- The header's **category picker** (slider button) chooses which categories
  count: unchecked ones are left out of the monthly figures, budgets, trailing
  averages and the chart. It starts from the workbook's "Excluded from Budget
  by Default" list, and **Save as default** writes the current selection back
  to the Constants sheet.

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
  12 months, Year to date). Each currency section's category panels uncheck
  excluded categories; conversions and the workbook's "Excluded from Budget by
  Default" categories start unchecked.
- **Totals** for the range: spent, earned, net, and the previous period's
  spend (the same-length window immediately before the range).
- **Monthly totals** bar chart (out vs in per month) and a **cumulative
  spend** line chart (Chart.js).
- **Biggest category moves** vs the previous period, ranked by absolute
  change.

## Forecasts

`/forecasts` (linked from every page) builds a forward-looking cash-flow projection from the transaction history plus your inputs. The page is a live editor: nothing is written to the workbook until you press **Save**, so changing an account, target, category override, event or window immediately updates the KPIs, chart and projection table.

- **Base plan** is the single scenario, stored in `Scenario - Base plan` (see the schema above). Edit it freely; **Save** writes the inputs in one workbook rewrite/commit. **Discard** returns to the last saved workbook state, and `Ctrl/Cmd+S` saves. A sticky bar keeps Reset, Discard and Save reachable while editing.
- **Reset** restores the default inputs after confirmation: Base plan, primary currency, blank As-of (today), 24-month horizon, 6-month baseline, Auto model, recurring detection and uncertainty on, no target, one `Main account` with a 0 balance, all categories included, and no events, overrides, adjustments, changes or notes. Reset is a local change until you press Save.
- **Recurring detection**: groups transactions by normalized details, infers weekly/biweekly/semi-monthly/monthly/quarterly/annual cadences, and schedules the next occurrences. Detected items show confidence and amount; **Adjust** reveals amount, cadence and next-date controls, which stay automatic until you override them. Unchecking an item removes it from the forecast entirely rather than folding its history back into the baseline. Recurring detection can be turned off in **Advanced model**.
- **Baseline**: a robust variable baseline over the trailing 3/6/12/24 complete months. Intermittent categories use a zero-inflated frequency × severity estimate, continuous categories use recency-weighted/trimmed estimates, sparse categories are shrunk and low-confidence, and MAD outliers are highlighted. `Auto` compares Simple vs Robust on a rolling variable-layer backtest and prefers Simple unless Robust is meaningfully better; **Advanced model** exposes the manual methods. Every category is included by default (cash-flow view, including investments and conversions); uncheck a category or type an override to change it. An override replaces the category **total**, including recurring items; use the **Auto** action on an overridden row to clear it. Confidence reflects active months, amount stability and outlier count; an **Outlier** badge marks an unusually large month that robust estimates exclude but a Simple average includes.
- **Scheduled changes**: a dated category total from a chosen month onward, for rent increases, salary changes, etc. It suppresses recurring items in that category from that month.
- **As of** is optional: blank means today. The header shows `Today`, and the saved sheet keeps the As-of cell blank so reopening it always means the current day. A non-empty date is preserved.
- **Accounts** supply the starting balance; include only the accounts that should count. Negative balances are allowed. A starting balance of **0 is treated as unknown**: the projection still runs, but balances are relative to $0 and the page shows a disclaimer plus the projected low point instead of a cash-out runway. Add your real balances for absolute figures.
- **One-time events** are dated income/expenses applied on their exact date. Events after the chart horizon are marked as such; they still feed the long-run target/runway calculation.
- **Projection**: recurring items land on their dates, variable spending is spread through each month, the rest of the as-of month is prorated, and events are applied on their dates. Category overrides/scheduled changes are monthly amounts. The page shows target date, balance at the horizon, runway/cash-out and savings rate; the monthly table and model-quality details are collapsed by default.
- **Forecast drivers**: a collapsed card explains the monthly shape (recurring vs variable/changes), one-time events in the horizon, and the largest income/expense categories.
- **Draft recovery**: unsaved edits are kept locally in the browser. If the tab closes or reloads before Save, the next visit offers to restore or dismiss the draft. The workbook remains the source of truth; drafts never write automatically.
- **Target**: one **target balance** and an optional date. The target date is the first date the projected balance reaches the amount; the long-run simulation looks beyond the chart horizon so a far-away target still gets a date.
- **Uncertainty**: when enabled and enough backtest history exists, a seeded residual bootstrap produces P10/P50/P90 balance bands, a target-date range, probability of reaching the target by a date/horizon and cash-out probability. The band represents historical variable income/spending; recurring items and one-time events are deterministic.
- The workbook's old date-named sheets are legacy snapshots; the Forecasts page does not read or modify them.

## Operations

### Backups and version control

- The workbook is required to live in a git repository. Every write is committed automatically to that repository as `D$CPLN <dscpln@localhost>`, with signing disabled (any configured git user, email, or signing key is not used).
- Every write goes to a temp file and is atomically renamed over the original; there is deliberately no `.bak` copy because the workbook repository's git history is the recovery path. Add `*.xlsx.tmp` to the repository's `.gitignore`.
- Close the workbook in Excel/LibreOffice while the app is editing it; otherwise the app's save or the spreadsheet app's save can overwrite the other.
- Writing recalculates formulas only when the workbook is next opened; cached formula values are not preserved by the writer. Saving the Base plan therefore rewrites the workbook.

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
| `ui/src/Forecasts.jsx` | Single Base plan editor, reset/save flow, KPIs, projection chart/table and draft recovery. |
| `ui/src/Settings.jsx` | Data-source info and the external API token. |
| `ui/src/lib/insights-math.js` | Pure aggregation/comparison helpers (also imported by the Node tests). |
| `ui/src/lib/forecast-recurring.js` | Recurring detection, adjustments and occurrence generation. |
| `ui/src/lib/forecast-baseline.js` | Robust/zero-inflated variable baseline, outliers and backtest. |
| `ui/src/lib/forecast-uncertainty.js` | Seeded residual bootstrap, bands and probabilities. |
| `ui/src/lib/forecast-math.js` | Projection orchestration, recurring/dated plan, target/runway (also imported by the Node tests). |
| `ui/src/lib/forecast-model.js` | Display model and scenario helpers for the Forecasts page. |
| `ui/src/components/ForecastToolbar.jsx` | Base plan header and reset/discard/save controls. |
| `ui/src/components/ForecastSaveBar.jsx` | Sticky unsaved-changes actions. |
| `ui/src/components/ForecastDrivers.jsx` | Monthly composition and largest income/expense explanation. |
| `ui/src/lib/chart.js` | Chart.js setup shared by both pages. |
| `ui/src/lib/money.js` | Money formatting and stable per-currency colors. |
| `server.mjs` | Routes and error handling; `notifications.mjs` sends budget-limit pushes. |
| `api-auth.mjs` | The external API's bearer token and edit-token signing, persisted in `api.stateFile`. |
| `dataProviders/excel/provider.mjs` | Workbook reading/writing; `parse.mjs` and `model.mjs` are its helpers (`category-suggester.mjs`, `workbook-git.mjs` alongside). |

Build the UI with `npm run build:ui --workspace dscpln-balance-xlsx` (or
`npm run ui` at the repo root); `npm test` builds it first. Tests use
`test/helpers.mjs` for temporary git-backed workbooks and a test server.
