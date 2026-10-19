import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { extractTransactions, parseArgs, reportedTransactions, run } from '../examples/balance-import.mjs';

const SAMPLE = [
  '02:16:20 Logging in to the source',
  '<a bunch of other output that should not be relevant>',
  '02:16:28 Cutoff 2026-08-31 reached, stopping',
  '02:16:28 Scraped 117 transactions',
  '2026-09-01\tREDACTED\t19.22\t\tCAD\tInterest',
  '2026-09-01\tREDACTED\t\t500\tCAD\tInvestment Buy',
  '2026-10-05\tREDACTED\t13816.61\t\tCAD\tInvestment Sell ',
].join('\n');

const writeInput = (text) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-import-'));
  const file = path.join(dir, 'scrape.txt');
  fs.writeFileSync(file, text);
  return file;
};

const startStub = async (routes) => {
  const requests = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      const entry = { method: req.method, url: req.url, headers: req.headers, body: raw ? JSON.parse(raw) : null };
      requests.push(entry);
      const route = routes[`${req.method} ${req.url}`];
      const { status = 200, json = {} } = route ? route(entry) : { status: 404, json: { error: 'Not found' } };
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(json));
    });
  });
  server.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  return {
    base: `http://127.0.0.1:${server.address().port}`,
    requests,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
};

test('extracts import-shaped transaction lines and ignores the log noise', () => {
  assert.deepEqual(extractTransactions(SAMPLE), [
    '2026-09-01\tREDACTED\t19.22\t\tCAD\tInterest',
    '2026-09-01\tREDACTED\t\t500\tCAD\tInvestment Buy',
    '2026-10-05\tREDACTED\t13816.61\t\tCAD\tInvestment Sell',
  ]);
});

test('--after scopes extraction to the lines after its last match', () => {
  const lines = extractTransactions(SAMPLE, { after: 'Scraped \\d+ transactions' });
  assert.deepEqual(lines, extractTransactions(SAMPLE));
  assert.throws(() => extractTransactions(SAMPLE, { after: 'never printed' }), /not found/);
});

test('reads the scraper-reported pre-filter count when present', () => {
  assert.equal(reportedTransactions(SAMPLE), 117);
  assert.equal(reportedTransactions('no count here'), null);
});

test('parseArgs requires values and rejects unknown flags', () => {
  assert.deepEqual(parseArgs(['--input', 'x', '--dry-run']), { input: 'x', dryRun: true });
  assert.throws(() => parseArgs(['--input']), /needs a value/);
  assert.throws(() => parseArgs(['--nope']), /unknown argument/);
});

test('imports the missing lines and reports the normal summary', async () => {
  const logs = [];
  const stub = await startStub({
    'POST /api/transactions/check': () => ({
      json: {
        total: 3,
        duplicates: 1,
        new: 2,
        lines: [
          { line: 1, duplicate: true },
          { line: 2, duplicate: false },
          { line: 3, duplicate: false },
        ],
      },
    }),
    'POST /api/transactions/import': () => ({ status: 201, json: { imported: 2, skipped: 1, transactions: [] } }),
  });
  try {
    const code = await run({
      input: writeInput(SAMPLE),
      balanceUrl: stub.base,
      balanceToken: 'tok-123',
      log: (line) => logs.push(line),
    });
    assert.equal(code, 0);
    assert.equal(logs.at(-1), 'Imported 2 new transactions; 1 already in the workbook.');
    assert.deepEqual(logs.slice(2, 5), [
      'Skipped (already in workbook): 2026-09-01  REDACTED  +19.22 CAD  (Interest)',
      'Imported: 2026-09-01  REDACTED  -500 CAD  (Investment Buy)',
      'Imported: 2026-10-05  REDACTED  +13816.61 CAD  (Investment Sell)',
    ]);
    assert.equal(stub.requests.length, 2);
    assert.equal(stub.requests[0].headers.authorization, 'Bearer tok-123');
    assert.equal(stub.requests[1].body.skipDuplicates, true);
    assert.match(stub.requests[1].body.text, /^2026-09-01\tREDACTED\t19\.22/);
    assert.equal(stub.requests[1].body.text.split('\n').length, 3);
  } finally {
    await stub.close();
  }
});

test('preserves the Notes column in the check and import payloads', async () => {
  const logs = [];
  const stub = await startStub({
    'POST /api/transactions/check': () => ({
      json: {
        total: 2,
        duplicates: 1,
        new: 1,
        lines: [
          { line: 1, duplicate: true },
          { line: 2, duplicate: false },
        ],
      },
    }),
    'POST /api/transactions/import': () => ({ status: 201, json: { imported: 1, skipped: 1, transactions: [] } }),
  });
  try {
    const text = [
      '2026-09-01\tOld\t1\t\tCAD\tInterest\t',
      '2026-09-02\tSalary\t1234.56\t\tCAD\tJob\tImported from scraper',
    ].join('\n');
    const code = await run({
      input: writeInput(text),
      balanceUrl: stub.base,
      balanceToken: 't',
      log: (line) => logs.push(line),
    });
    assert.equal(code, 0);
    assert.match(stub.requests[0].body.text, /Imported from scraper$/m);
    assert.match(stub.requests[1].body.text, /Imported from scraper$/m);
    assert.equal(logs.at(-1), 'Imported 1 new transaction; 1 already in the workbook.');
  } finally {
    await stub.close();
  }
});

test('warns and notifies when nothing matched the workbook', async () => {
  const logs = [];
  const stub = await startStub({
    'POST /api/transactions/check': () => ({ json: { total: 3, duplicates: 0, new: 3, lines: [] } }),
    'POST /api/transactions/import': () => ({ status: 201, json: { imported: 3, skipped: 0, transactions: [] } }),
    'POST /api/notify': () => ({ json: { ok: true } }),
  });
  try {
    const code = await run({
      input: writeInput(SAMPLE),
      balanceUrl: stub.base,
      balanceToken: 'tok-123',
      notifyUrl: stub.base,
      click: 'https://dscpln.example.com/balance',
      log: (line) => logs.push(line),
    });
    assert.equal(code, 0);
    const summary = logs.at(-1);
    assert.match(summary, /^WARNING: imported 3; 0 of 3 scraped transactions matched the workbook/);
    assert.match(summary, /before 2026-09-01\./);
    const notify = stub.requests.find((entry) => entry.url === '/api/notify');
    assert.equal(notify.body.message, summary);
    assert.equal(notify.body.priority, 'high');
    assert.deepEqual(notify.body.tags, ['warning']);
    assert.equal(notify.body.click, 'https://dscpln.example.com/balance');
  } finally {
    await stub.close();
  }
});

test('a failed notification does not fail the run or displace the summary', async () => {
  const logs = [];
  const stub = await startStub({
    'POST /api/transactions/check': () => ({ json: { total: 1, duplicates: 0, new: 1, lines: [] } }),
    'POST /api/transactions/import': () => ({ status: 201, json: { imported: 1, skipped: 0, transactions: [] } }),
    'POST /api/notify': () => ({ status: 502, json: { error: 'boom' } }),
  });
  try {
    const text = '2026-09-01\tX\t1\t\tCAD\tInterest\n';
    const code = await run({
      input: writeInput(text),
      balanceUrl: stub.base,
      balanceToken: 't',
      notifyUrl: stub.base,
      log: (line) => logs.push(line),
    });
    assert.equal(code, 0);
    assert.match(logs.join('\n'), /Notification could not be sent/);
    assert.match(logs.at(-1), /^WARNING:/);
  } finally {
    await stub.close();
  }
});

test('reports a fully-overlapping scrape without warning', async () => {
  const logs = [];
  const stub = await startStub({
    'POST /api/transactions/check': () => ({ json: { total: 3, duplicates: 3, new: 0, lines: [] } }),
    'POST /api/transactions/import': () => ({ status: 201, json: { imported: 0, skipped: 3, transactions: [] } }),
  });
  try {
    const code = await run({
      input: writeInput(SAMPLE),
      balanceUrl: stub.base,
      balanceToken: 't',
      notifyUrl: stub.base,
      log: (line) => logs.push(line),
    });
    assert.equal(code, 0);
    assert.equal(logs.at(-1), 'Nothing new — all 3 scraped transactions are already in the workbook.');
    assert.equal(stub.requests.some((entry) => entry.url === '/api/notify'), false);
  } finally {
    await stub.close();
  }
});

test('--dry-run checks but never imports', async () => {
  const logs = [];
  const stub = await startStub({
    'POST /api/transactions/check': () => ({
      json: {
        total: 3,
        duplicates: 1,
        new: 2,
        lines: [
          { line: 1, duplicate: true },
          { line: 2, duplicate: false },
          { line: 3, duplicate: false },
        ],
      },
    }),
  });
  try {
    const code = await run({
      input: writeInput(SAMPLE),
      balanceUrl: stub.base,
      balanceToken: 't',
      dryRun: true,
      log: (line) => logs.push(line),
    });
    assert.equal(code, 0);
    assert.equal(stub.requests.length, 1);
    assert.equal(logs.at(-1), 'Dry run — nothing was imported. 2 transaction(s) would be imported.');
    assert.equal(logs.some((line) => line.startsWith('Skipped (already in workbook):')), true);
    assert.equal(logs.filter((line) => line.startsWith('Would import:')).length, 2);
  } finally {
    await stub.close();
  }
});

test('fails when the output has no transaction lines', async () => {
  await assert.rejects(
    run({ input: writeInput('only logs\n'), balanceUrl: 'http://example.com', balanceToken: 't', log: () => {} }),
    /no transaction lines found/,
  );
});

test('fails when more lines were extracted than the scraper reported', async () => {
  const text = [
    'Scraped 2 transactions',
    '2026-09-01\ta\t1\t\tCAD\tInterest',
    '2026-09-02\tb\t1\t\tCAD\tInterest',
    '2026-09-03\tc\t1\t\tCAD\tInterest',
  ].join('\n');
  await assert.rejects(
    run({ input: writeInput(text), balanceUrl: 'http://example.com', balanceToken: 't', log: () => {} }),
    /reported only 2/,
  );
});

test('surfaces API errors with their message', async () => {
  const stub = await startStub({
    'POST /api/transactions/check': () => ({ status: 400, json: { error: 'Check failed:\nLine 1: Currency is required' } }),
  });
  try {
    await assert.rejects(
      run({ input: writeInput(SAMPLE), balanceUrl: stub.base, balanceToken: 't', log: () => {} }),
      /Balance check failed \(400\): Check failed:\nLine 1: Currency is required/,
    );
  } finally {
    await stub.close();
  }
});

test('validates required connection options', async () => {
  await assert.rejects(
    run({ input: writeInput(SAMPLE), balanceUrl: 'not-a-url', balanceToken: 't', log: () => {} }),
    /--balance-url/,
  );
  await assert.rejects(
    run({ input: writeInput(SAMPLE), balanceUrl: 'http://example.com', balanceToken: '', log: () => {} }),
    /--balance-token/,
  );
});
