# D$CPLN

A simple webpage that shows whether or not you've gone over your budget this month, and sends you push notifications when the limit is reached.

Does this by reading a list of your expenses from some source and checking to see if the total exceeds a preference you set. This assumes that you religiously record your expenses somewhere as they happen.

Currently, the only supported data source are text files with a specific formatting, but the code could be expanded to include other data sources.

Environment variables needed (a `.env` file can be used for this - see `template.env`):
- `DATA_PROVIDER`: The module from `/dataProviders` to use for data sourcing. By default, this is `textFileDataProvider` (the only one currently available).
- `PORT`: The HTTP port to listen on (defaults to `3300`).
- If you use the `textFileDataProvider`:
  - `TEXTFILE_DATA_PROVIDER_DATA_PATH`: The path to the text file where you record expenses (defaults to `data.txt`).
    - Lines in this file must adhere to the format: `'<amount> <description> <optional 'M D' date (if none, take from previous line)>'`
  - `TEXTFILE_DATA_PROVIDER_BUDGET_PATH`: The path to a text file where the budget limit should be stored (defaults to `budget.txt`).
  - `TEXTFILE_BUDGET_INIT_AMT`: The amount that the monthly limit should be initialized to if it does not already exist.
  - `TEXTFILE_FIRST_WEEK_BIAS_INIT_AMT`: The extra amount that will be assigned to the first week.
  - Note: Weekly budgets are given for "full weeks" (weeks with all 7 days), with any adjacent partial weeks lumped in to the current week's budget.
- `MONTHLY_LIMIT_NTFY_URL`: The ntfy.sh URL to which to send "monthly budget limit reached" notifications.
- `WEEKLY_LIMIT_NTFY_URL`: The ntfy.sh URL to which to send "weekly budget limit reached" notifications.
- `NTFY_CHECK_INTERVAL_MINUTES`: How often, in minutes, to check for changes so that notifications can be sent out if needed.
- `NTFY_TOKEN`: An authorization token to use when sending out notifications.
- `ONLY_WARN_ONCE`: Monthly and Weekly notifications will only be sent the first time you go over budget and not for subsequent increases.