# D$CPLN

A simple webpage that shows whether or not you've gone over your budget this month, and sends you push notifications when the limit is reached.

Does this by reading a list of your expenses from some source and checking to see if the total exceeds a preference you set. This assumes that you religiously record your expenses somewhere as they happen. You can also add, edit, and delete transactions from the dashboard, which writes them back to the data file.

Currently, the only supported data source are text files with a specific formatting, but the code could be expanded to include other data sources.

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

The app reads `config.json` from its directory by default. Set `DSCPLN_CONFIG` to use a different path (useful in Docker).

## Configuration

`config.example.json` lists every option with its defaults:

| Key | Description |
| --- | --- |
| `port` | HTTP port to listen on (defaults to `3300`). |
| `dataProvider` | The module from `/dataProviders` to use for data sourcing. Defaults to `textFileDataProvider` (the only one currently available). |
| `providers.<name>` | Provider-specific options, described below. |
| `notifications.monthlyLimitUrl` | The ntfy.sh URL to which to send "monthly budget limit reached" notifications, or `null`. |
| `notifications.weeklyLimitUrl` | The ntfy.sh URL to which to send "weekly budget limit reached" notifications, or `null`. |
| `notifications.ntfyToken` | An authorization token to use when sending out notifications, or `null`. |
| `notifications.checkIntervalMinutes` | How often, in minutes, to check for changes so that notifications can be sent out if needed (defaults to `30`). |
| `notifications.onlyWarnOnce` | When `true`, monthly and weekly notifications are only sent the first time you go over budget, not for subsequent increases. |

### `textFileDataProvider` options

| Key | Description |
| --- | --- |
| `dataFile` | The path to the text file where you record expenses (defaults to `./data.txt`). Relative paths resolve against the config file's directory. |
| `budgetFile` | The path to a text file where the budget limit should be stored (defaults to `./budget.txt`). |
| `monthlyBudgetInit` | The amount that the monthly limit should be initialized to if `budgetFile` does not already exist. |
| `firstDayBiasInit` | The first day bias that should be initialized to if `budgetFile` does not already exist. |

The budget file's first line is the monthly budget and its second line is the first day bias: an extra amount assigned to the first day of the month (for example, for rent). Weekly budgets are given for "full weeks" (weeks with all 7 days), with any adjacent partial weeks lumped in to the current week's budget.

## Data file format

Lines in the data file must adhere to the format:

```
<optional 3-letter currency> <amount> <description> <optional 'M D' date (if none, take from previous line)>
```

For example:

```
34 groceries 9 28
12 coffee
77.2 utilities 9 30
USD 50 lunch 10 2
```

Lines that do not start with an amount (or a 3-letter uppercase currency code followed by an amount) are ignored, so you can keep other notes in the same file.

Lines prefixed with a currency code are foreign-currency transactions. They are not counted in any month/week/budget calculations by default; pick a currency from the dropdown in the header to view it, at which point its lines are used for the spend totals and transaction list instead of the local ones. Budget tracking is only available for local spending, so budget figures, progress, and pace are hidden while a currency is selected. Currencies found anywhere in the file are offered as autocomplete options when adding or editing a transaction.

When you add or edit a transaction from the dashboard, the line is written with an explicit date. When you delete a line that provided a date for following undated lines, the date is copied onto the next undated line so no other dates change.

## Transactions

- **Add**: open "This month", click "Add transaction", and fill in amount, description, optional currency, and date. The date defaults to the day you are viewing, and the currency defaults to the one currently selected.
- **Edit / delete**: use the buttons on each row. Deleting asks for confirmation.

The same actions are available over HTTP:

| Method | Path | Body |
| --- | --- | --- |
| `GET` | `/data?date=YYYY-MM-DD&currency=USD` | - |
| `POST` | `/transactions` | `{ "amount", "description", "date", "currency" }` |
| `PUT` | `/transactions/:id` | `{ "amount", "description", "date", "currency" }` |
| `DELETE` | `/transactions/:id` | - |
| `POST` | `/budget` | `{ "monthlyBudget", "firstDayBias" }` |

`currency` is optional and must be a 3-letter code; omit it for local transactions. The `/data` `currency` query parameter also accepts any 3-letter code and filters the response to it.

Transaction ids embed the line number and a hash of the line. If the file changes underneath the app, stale ids are rejected with `409 Conflict` and the UI refreshes.

## Docker

```sh
docker build -t dscpln .
docker run -p 3300:3300 -v ~/expenses.md:/app/data.txt -v ./config.json:/app/config.json dscpln
```

## Tests

```sh
npm test
```
