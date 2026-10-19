#!/usr/bin/env node
// Scraper output → Balance XLSX import.
//
// Extracts the tab-separated transaction lines a scraper prints at the end of
// its output, asks the Balance XLSX external API which of them are already in
// the workbook, imports the missing ones, and calls out the suspicious case:
// when none of the scraped lines matched, the scrape probably did not reach
// back far enough to overlap with what was imported last time, so the summary
// says which date to check manually from. That warning is also pushed over
// the portal relay (ntfy) when --notify-url (or DSCPLN_PORTAL_URL) is set.
//
//   node balance-import.mjs --input scrape.txt \
//     --balance-url http://balance-xlsx:3300/balance \
//     --balance-token "$BALANCE_TOKEN" \
//     [--after <regex>] [--pattern <regex>] [--notify-url <portal>] \
//     [--click <url>] [--dry-run]
//
// The token may also come from BALANCE_TOKEN. The scraper's optional
// "Scraped N transactions" report is pre-filter (it counts everything it saw,
// not just the lines it prints), so extracted lines may be fewer than N;
// more than N is treated as a parsing failure.

import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const DEFAULT_PATTERN = '^\\d{4}-\\d{2}-\\d{2}\\t';
const COUNT_PATTERN = /Scraped\s+(\d+)\s+transactions?\b/gi;

const USAGE = `Usage: balance-import.mjs --input <file|-> --balance-url <url> --balance-token <token>
         [--after <regex>] [--pattern <regex>] [--notify-url <portal-url>] [--click <url>] [--dry-run]

  --input          scraper output file, or - for stdin (required)
  --balance-url    Balance XLSX base URL, e.g. http://balance-xlsx:3300/balance (required)
  --balance-token  external API token from Balance XLSX Settings, or set BALANCE_TOKEN
  --after          only consider lines after the last line matching this regex
  --pattern        transaction-line regex (default ${DEFAULT_PATTERN})
  --notify-url     portal relay base URL, or DSCPLN_PORTAL_URL; a zero-duplicate warning is pushed there
  --click          URL opened by the notification (optional)
  --dry-run        report what would be imported without writing anything

The last output line is the run summary (task-runner summary_last_line).`;

export function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      index += 1;
      if (index >= argv.length) throw new Error(`${arg} needs a value`);
      return argv[index];
    };
    switch (arg) {
      case '--input': options.input = next(); break;
      case '--after': options.after = next(); break;
      case '--pattern': options.pattern = next(); break;
      case '--balance-url': options.balanceUrl = next(); break;
      case '--balance-token': options.balanceToken = next(); break;
      case '--notify-url': options.notifyUrl = next(); break;
      case '--click': options.click = next(); break;
      case '--dry-run': options.dryRun = true; break;
      case '-h':
      case '--help': options.help = true; break;
      default: throw new Error(`unknown argument: ${arg}`);
    }
  }
  return options;
}

// The transaction lines: import-shaped TSV rows (date first). With `after`,
// only lines following the last marker match are considered, which isolates
// the trailing list from anything above it that happens to look similar.
export function extractTransactions(text, { after, pattern } = {}) {
  let lines = String(text ?? '').split(/\r?\n/);
  if (after) {
    let marker;
    try {
      marker = new RegExp(after);
    } catch {
      throw new Error(`--after is not a valid regex: ${after}`);
    }
    let last = -1;
    lines.forEach((line, index) => {
      if (marker.test(line)) last = index;
    });
    if (last === -1) {
      throw new Error(`--after marker /${after}/ was not found in the scraper output`);
    }
    lines = lines.slice(last + 1);
  }
  let linePattern;
  try {
    linePattern = new RegExp(pattern ?? DEFAULT_PATTERN);
  } catch {
    throw new Error(`--pattern is not a valid regex: ${pattern}`);
  }
  const candidates = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (line && linePattern.test(line)) {
      candidates.push(line);
    }
  }
  return candidates;
}

// The scraper's own "Scraped N transactions" log line, when present (N is
// pre-filter, so it is an upper bound for the printed rows, not an equality).
export function reportedTransactions(text) {
  const matches = [...String(text ?? '').matchAll(COUNT_PATTERN)];
  return matches.length ? Number(matches[matches.length - 1][1]) : null;
}

// Human-readable form of an import line (Date, Details, Money In/Expenses,
// Currency, Type; Notes is ignored).
const describeLine = (line) => {
  const [date, details, moneyIn, expenses, currency, type] = line.split('\t').map((value) => value.trim());
  const amount = moneyIn ? `+${moneyIn}` : `-${expenses}`;
  return `${date}  ${details}  ${amount} ${currency}  (${type})`;
};

const readInput = (input) => {
  if (!input) {
    throw new Error('--input is required (a file path, or - to read stdin)');
  }
  return input === '-' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(input, 'utf8');
};

const postJson = async (url, body, token, label) => {
  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (e) {
    throw new Error(`${label} request failed: ${e.message}`, { cause: e });
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`${label} failed (${response.status})${data?.error ? `: ${data.error}` : ''}`);
  }
  return data ?? {};
};

const sendNotification = async (options, message) => {
  try {
    const response = await fetch(`${String(options.notifyUrl).replace(/\/+$/, '')}/api/notify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message,
        title: 'D$CPLN - Balance import needs a check',
        priority: 'high',
        tags: ['warning'],
        app: 'Balance Import',
        click: /^https?:\/\//i.test(options.click ?? '') ? options.click : undefined,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    return response.ok;
  } catch {
    return false;
  }
};

export async function run(options) {
  const log = options.log ?? console.log;
  const baseUrl = String(options.balanceUrl ?? '').replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(baseUrl)) {
    throw new Error('--balance-url must start with http:// or https://');
  }
  const token = String(options.balanceToken ?? process.env.BALANCE_TOKEN ?? '');
  if (!token) {
    throw new Error('--balance-token (or BALANCE_TOKEN) is required');
  }
  options.notifyUrl ??= process.env.DSCPLN_PORTAL_URL;

  const text = readInput(options.input);
  const candidates = extractTransactions(text, { after: options.after, pattern: options.pattern });
  const reported = reportedTransactions(text);
  if (candidates.length === 0) {
    throw new Error('no transaction lines found in the scraper output');
  }
  if (reported != null && candidates.length > reported) {
    throw new Error(`extracted ${candidates.length} transaction line(s) but the scraper reported only ${reported}`);
  }
  log(`Extracted ${candidates.length} transaction line(s)` +
    (reported != null ? ` (scraper reported ${reported}).` : '.'));

  const batch = candidates.join('\n');
  const check = await postJson(`${baseUrl}/api/transactions/check`, { text: batch }, token, 'Balance check');
  log(`Balance check: ${check.duplicates} already in the workbook, ${check.new} new.`);

  const statuses = Array.isArray(check.lines) && check.lines.length ? check.lines : null;
  const logStatuses = (imported) => {
    if (!statuses) {
      return;
    }
    for (const entry of statuses) {
      const line = candidates[entry.line - 1];
      if (!line) {
        continue;
      }
      const state = entry.duplicate ? 'Skipped (already in workbook)' : imported ? 'Imported' : 'Would import';
      log(`${state}: ${describeLine(line)}`);
    }
  };

  if (options.dryRun) {
    logStatuses(false);
    log(`Dry run — nothing was imported. ${check.new} transaction(s) would be imported.`);
    return 0;
  }

  const result = await postJson(
    `${baseUrl}/api/transactions/import`,
    { text: batch, skipDuplicates: true },
    token,
    'Balance import',
  );
  logStatuses(true);

  let summary;
  if (check.duplicates === 0) {
    const oldest = candidates.map((line) => line.split('\t')[0]).sort()[0];
    summary = `WARNING: imported ${result.imported}; 0 of ${check.total} scraped transactions matched the workbook — ` +
      `the scrape may not reach back far enough; manually check for missing transactions before ${oldest}.`;
    if (options.notifyUrl && !(await sendNotification(options, summary))) {
      log('Notification could not be sent (continuing).');
    }
  } else if (result.imported === 0) {
    summary = `Nothing new — all ${check.total} scraped transactions are already in the workbook.`;
  } else {
    summary = `Imported ${result.imported} new transaction${result.imported === 1 ? '' : 's'}; ` +
      `${result.skipped} already in the workbook.`;
  }
  log(summary);
  return 0;
}

const main = async () => {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(`ERROR: ${e.message}`);
    console.error(USAGE);
    process.exitCode = 1;
    return;
  }
  if (options.help) {
    console.log(USAGE);
    return;
  }
  try {
    await run(options);
  } catch (e) {
    console.error(`ERROR: ${e.message}`);
    process.exitCode = 1;
  }
};

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  await main();
}
