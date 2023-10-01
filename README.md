# D$CPLN

A simple webpage that shows whether or not you've gone over your budget this month.

Does this by reading a list of your expenses from some source and checking to see if the total exceeds a preference you set. This assumes that you religiously record your expenses somewhere as they happen.

Currently, the only supported data source are text files with a specific formatting, but the code could be expanded to include other data sources.

Environment variables needed (a `.env` file can be used for this):
- `DATA_PROVIDER`: The module from `/dataProviders` to use for data sourcing. By default, this is `textFileDataProvider` (the only one currently available).
- `PORT`: The HTTP port to listen on (defaults to `3300`).
- If you use the `textFileDataProvider`:
  - `TEXTFILE_DATA_PROVIDER_DATA_PATH`: The path to the text file where you record expenses (defaults to `data.txt`).
    - Lines in this file must adhere to the format: `'<amount> <description> <optional 'M D' date (if none, take from previous line)>'`
  - `TEXTFILE_DATA_PROVIDER_BUDGET_PATH`: The path to a text file where the budget limit should be stored (defaults to `budget.txt`).

