// Generates all README screenshots from synthetic sandboxes.
// Run from the repo root:  node scripts/screenshots.mjs
//
// Boots every app with a synthetic sandbox (fake conversations, tasks, media,
// mock workbook) and writes docs/screenshots/*.png. Never point this at real
// data: it exists so the README images can be regenerated with no personal
// content in them.
//
// `--compare` captures into a temp dir instead and diffs each shot against the
// committed one with ImageMagick (prints pixel deltas; never rewrites files).
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { once } from 'node:events'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const COMMITTED = path.join(REPO, 'docs', 'screenshots')
const COMPARE = process.argv.includes('--compare')
const OUT = COMPARE ? fs.mkdtempSync(path.join(os.tmpdir(), 'dscpln-shots-')) : COMMITTED
fs.mkdirSync(OUT, { recursive: true })

const requireFromRoot = createRequire(path.join(REPO, 'package.json'))
const { chromium } = requireFromRoot('playwright-core')
const browser = await chromium.launch(process.env.CHROMIUM_PATH
  ? { executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox'] }
  : {})

const DEMO_ROOT = '/tmp/dscpln-demo'
fs.rmSync(DEMO_ROOT, { recursive: true, force: true })
fs.mkdirSync(DEMO_ROOT, { recursive: true })
const tmp = (prefix) => {
  const dir = path.join(DEMO_ROOT, prefix.replace(/^shot-|-$/g, '') || 'app')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}
const json = (body) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })

async function newPage() {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  page.on('pageerror', (err) => console.error('[pageerror]', err.message))
  return page
}

async function documentHeight(page) {
  return page.evaluate(() => Math.max(document.documentElement.scrollHeight, document.body.scrollHeight))
}

async function shoot(page, name) {
  // Capture the full document deterministically. Playwright's fullPage uses
  // Chromium's captureBeyondViewport, which intermittently clips to the
  // pre-resize viewport; instead grow the viewport to the document height
  // (waiting for the resize to apply) and take a normal screenshot.
  const viewport = page.viewportSize()
  let height = await documentHeight(page)
  for (let i = 0; i < 3 && height > viewport.height; i += 1) {
    await page.setViewportSize({ width: viewport.width, height })
    await page.waitForFunction((h) => window.innerHeight >= h, height, { timeout: 2000 }).catch(() => {})
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve())))
    const next = await documentHeight(page)
    if (next <= height) break
    height = next
  }
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: false })
  if (page.viewportSize().height !== viewport.height) {
    await page.setViewportSize(viewport)
  }
  console.log('shot', name)
}

async function shootViewport(page, name) {
  // Some pages are intentionally very tall; keep their README image at the
  // standard 1280×800 viewport rather than a full-document capture.
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: false })
  console.log('shot', name)
}

/* ---------------- portal ---------------- */
{
  const { createApp } = await import(path.join(REPO, 'packages/server-kit/app.mjs'))
  const app = createApp({ title: 'Portal', pageTitle: 'D$CPLN', basePath: '', staticDir: path.join(REPO, 'apps/portal/static') })
  const server = app.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const base = `http://127.0.0.1:${server.address().port}`
  const page = await newPage()
  for (const p of ['balance', 'pipelines', 'watxt', 'tasks']) {
    await page.route(`**/${p}/api/health`, (route) => route.fulfill(json({ ok: true })))
  }
  await page.route('**/balance/status', (route) => route.fulfill(json({
    overBudget: [],
    summary: {
      period: 'October 2026',
      code: 'CAD',
      symbol: '$',
      budget: 3000,
      spend: 1842.35,
      left: 1157.65,
      overBudget: false,
      transactions: 42,
      currencies: 2,
    },
  })))
  await page.route('**/pipelines/api/state', (route) => route.fulfill(json({ paused: false, folders: [{ counts: { queued: 2, review: 1 } }] })))
  await page.route('**/watxt/api/state', (route) => route.fulfill(json({ conversations: 12, messages: 8421 })))
  await page.route('**/tasks/api/tasks', (route) => route.fulfill(json({ groups: [{ tasks: [{ state: { ok: true } }, { state: { ok: true } }, { state: { ok: true } }] }] })))
  await page.goto(`${base}/`)
  await page.waitForSelector('[data-testid="card-balance"]')
  await shoot(page, 'portal')
  await page.close()
  await new Promise((resolve) => server.close(resolve))
}

/* ---------------- balance (dashboard + insights + forecasts) ---------------- */
{
  const dir = tmp('shot-balance-')
  fs.copyFileSync(path.join(REPO, 'apps/balance-xlsx/mock-data.xlsx'), path.join(dir, 'Balance.xlsx'))
  execFileSync('git', ['init', '-q'], { cwd: dir })
  const { default: createProvider } = await import(path.join(REPO, 'apps/balance-xlsx/dataProviders/excelDataProvider.mjs'))
  const provider = createProvider({ workbookFile: path.join(dir, 'Balance.xlsx') }, dir)
  await provider.saveForecast({
    scenario: {
      sheetName: null,
      revision: 0,
      name: 'Base plan',
      currency: 'CAD',
      asOf: '',
      horizonMonths: 24,
      baselineMonths: 6,
      notes: 'Demo scenario for the README screenshot.',
      target: { label: 'Savings target', amount: 50000, date: null },
      accounts: [
        { name: 'Chequing', balance: 12000, include: true },
        { name: 'Savings', balance: 8000, include: true },
      ],
      events: [
        { date: '2027-01-15', details: 'Plane tickets', kind: 'expense', amount: 2500, notes: '' },
        { date: '2027-04-01', details: 'Tax refund', kind: 'income', amount: 1200, notes: '' },
      ],
      overrides: { income: {}, expense: {} },
      excludedCategories: ['Investment Buy', 'Investment Sell'],
      recurringAdjustments: [{
        kind: 'expense',
        category: 'Food Weekly',
        details: 'groceries',
        label: 'Groceries',
        include: true,
        amount: 150,
        cadence: null,
        nextDate: null,
      }],
      changes: [{ from: '2027-01', kind: 'expense', category: 'Rent', amount: 1500 }],
    },
  })
  const config = {
    port: 0,
    dataProvider: 'excelDataProvider',
    providers: { excelDataProvider: { workbookFile: path.join(dir, 'Balance.xlsx'), transactionsSheet: 'Transactions', constantsSheet: 'Constants' } },
    api: { stateFile: path.join(dir, 'api-state.json') },
    configDir: dir,
  }
  const { createApp } = await import(path.join(REPO, 'apps/balance-xlsx/server.mjs'))
  const { app } = createApp(config)
  const server = app.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const base = `http://127.0.0.1:${server.address().port}`
  const page = await newPage()
  await page.goto(`${base}/`)
  await page.waitForFunction(() => document.querySelector('#monthSpend')?.textContent?.trim() !== '—')
  await shoot(page, 'balance-dashboard')
  await page.goto(`${base}/insights`)
  await page.waitForFunction(() => document.querySelector('#insightsContent')?.children.length > 0)
  await page.waitForTimeout(800)
  await shoot(page, 'balance-insights')
  await page.goto(`${base}/forecasts`)
  await page.waitForSelector('[data-testid="forecast-asof"]')
  await page.waitForFunction(() => document.querySelector('[data-testid="forecast-chart-card"] svg'))
  await shootViewport(page, 'balance-forecasts')
  await page.close()
  await new Promise((resolve) => server.close(resolve))
}

/* ---------------- media sync ---------------- */
{
  const root = tmp('shot-media-')
  const mkFiles = (dir, names) => {
    fs.mkdirSync(dir, { recursive: true })
    for (const name of names) fs.writeFileSync(path.join(dir, name), Buffer.alloc(64 * 1024, 7))
  }
  const cameraSrc = path.join(root, 'phone/Camera')
  const shotsSrc = path.join(root, 'phone/Screenshots')
  mkFiles(cameraSrc, ['IMG_20240115_101112.jpg', 'IMG_20240114_221005.jpg', 'VID_20240112_135501.mp4'])
  mkFiles(shotsSrc, ['Screenshot_20240115-090102.png', 'Screenshot_20240113-181500.png'])
  fs.mkdirSync(path.join(root, 'media/Camera'), { recursive: true })
  fs.mkdirSync(path.join(root, 'media/Screenshots'), { recursive: true })
  const configPath = path.join(root, 'config.json')
  fs.writeFileSync(configPath, JSON.stringify({
    configVersion: 1,
    bindHost: '127.0.0.1',
    port: 0,
    concurrency: 1,
    paused: false,
    dryRun: false,
    trashRetentionDays: 30,
    settleSeconds: 60,
    maxAutoRetries: 3,
    stagingDir: path.join(root, '.file-pipelines/staging'),
    reviewDir: path.join(root, '.file-pipelines/review'),
    trashDir: path.join(root, '.file-pipelines/trash'),
    logDir: path.join(root, '.file-pipelines/logs'),
    syncLockFile: path.join(root, '.file-pipelines/lock.json'),
    lockHeartbeatSeconds: 300,
    lockStaleSeconds: 900,
    notifySuccess: true,
    folders: [
      { name: 'Camera', source: cameraSrc, destination: path.join(root, 'media/Camera'), method: 'standardize', settleSeconds: 3600 },
      { name: 'Screenshots', source: shotsSrc, destination: path.join(root, 'media/Screenshots'), method: 'standardize', settleSeconds: 3600 },
    ],
  }, null, 2))
  const { Daemon } = await import(path.join(REPO, 'apps/file-pipelines/src/daemon.js'))
  const daemon = new Daemon(configPath, {})
  await daemon.start()
  const base = `http://127.0.0.1:${daemon.api.server.address().port}`
  const page = await newPage()
  await page.goto(base)
  await page.waitForSelector('.folder-card', { timeout: 15000 })
  await page.waitForTimeout(600)
  await shoot(page, 'file-pipelines')
  await page.close()
  await daemon.stop()
}

/* ---------------- whatsapp txt ---------------- */
{
  const dir = tmp('shot-watxt-')
  const write = (name, messages) => {
    const rows = messages.map(([y, mo, d, h, mi, sender, body]) => ({
      date: new Date(y, mo - 1, d, h, mi).toISOString(), sender, type: 'text', body,
    }))
    fs.writeFileSync(path.join(dir, name), JSON.stringify(rows, null, 2) + '\n')
  }
  write('20240115 - Alice.json', [
    [2024, 1, 15, 9, 2, 'Alice', 'Morning! Did the new sync run?'],
    [2024, 1, 15, 9, 3, 'You', 'Yep — 1,204 files archived overnight.'],
    [2024, 1, 15, 9, 5, 'Alice', 'Nice. Any failures in the report?'],
    [2024, 1, 15, 9, 6, 'You', 'Two screenshots were duplicates, nothing lost.'],
  ])
  write('20240114 - Project Team.json', [
    [2024, 1, 14, 17, 30, 'Bob', 'Deploy is green on staging.'],
    [2024, 1, 14, 17, 32, 'Priya', 'I will run the migration tonight.'],
  ])
  write('20240112 - Book Club.json', [
    [2024, 1, 12, 20, 0, 'Dana', 'Next pick is up — see the poll.'],
    [2024, 1, 12, 20, 1, 'You', 'Voted.'],
  ])
  const { createApp, createState } = await import(path.join(REPO, 'apps/whatsapp-txt/server.mjs'))
  const state = createState(dir, { watch: false })
  const app = createApp(state)
  const server = app.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const base = `http://127.0.0.1:${server.address().port}`
  const page = await newPage()
  await page.goto(base)
  await page.waitForSelector('#conversation-list li')
  await page.locator('#conversation-list li').first().click()
  await page.waitForSelector('.message')
  await shoot(page, 'whatsapp')
  await page.close()
  await new Promise((resolve) => server.close(resolve))
}

/* ---------------- task runner ---------------- */
{
  const sandbox = tmp('shot-tasks-')
  process.env.BACKUPCTL_STATE_DIR = path.join(sandbox, 'state')
  process.env.BACKUPCTL_TMP_DIR = path.join(sandbox, 'tmp-root')
  const bctl = await import(path.join(REPO, 'apps/task-runner/server.mjs'))
  const configPath = path.join(sandbox, 'config.mjs')
  fs.writeFileSync(configPath, `export default ${JSON.stringify({
    maindir: path.join(sandbox, 'Backups'),
    groups: [
      {
        name: 'Everyday',
        defaults: { state_dir: path.join(sandbox, 'state') },
        tasks: [
          { name: 'Disk usage', script: 'echo "wrote disk-usage.txt"', summary_last_line: true },
          { name: 'Filed downloads', uploads: true, glob: '*', move: { dest: path.join(sandbox, 'Backups/Manual') } },
          { name: 'List git remotes', capture: true, commands: ['echo origin'] },
        ],
      },
      {
        name: 'Imports',
        defaults: { state_dir: path.join(sandbox, 'state') },
        tasks: [
          { name: 'App exports', uploads: true, glob: '*.zip', ingest: { suffix: 'basename "$PWD"', dest: path.join(sandbox, 'Backups/Imports') } },
        ],
      },
    ],
  })};`)
  await bctl.boot(configPath)
  const ok = (name, summary) => {
    const task = bctl.TASK_LIST.find((t) => t.name === name)
    bctl.saveTaskState(task, bctl.LOCAL, true, summary, '')
  }
  ok('Disk usage', 'wrote disk-usage.txt')
  ok('Filed downloads', '2 files filed')
  const app = bctl.createApp()
  const server = app.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const base = `http://127.0.0.1:${server.address().port}`
  const page = await newPage()
  await page.goto(base)
  await page.waitForSelector('[data-testid^="task-"]')
  await page.waitForTimeout(600)
  await shoot(page, 'task-runner')
  await page.close()
  await new Promise((resolve) => server.close(resolve))
}

await browser.close()

if (COMPARE) {
  compareWithCommitted(OUT, COMMITTED)
  console.log('\ncaptured to', OUT, '(committed files untouched)')
} else {
  console.log('all screenshots written to', OUT)
}

function compareWithCommitted(capturedDir, baselineDir) {
  const names = fs.readdirSync(capturedDir).filter((name) => name.endsWith('.png')).sort()
  let changed = 0
  let total = 0
  for (const name of names) {
    const captured = path.join(capturedDir, name)
    const baseline = path.join(baselineDir, name)
    if (!fs.existsSync(baseline)) {
      console.log(`${name}: no committed baseline`)
      changed += 1
      continue
    }
    const result = spawnSync('magick', ['compare', '-metric', 'AE', '-fuzz', '2%', captured, baseline, 'null:'], { encoding: 'utf8' })
    if (result.error) {
      throw new Error('ImageMagick (`magick`) is required for --compare', { cause: result.error })
    }
    const count = Number.parseFloat((result.stderr ?? '').trim().split(/\s+/)[0])
    if (!Number.isFinite(count)) {
      console.log(`${name}: dimension mismatch or unreadable (${(result.stderr ?? '').trim().split('\n')[0]})`)
      changed += 1
      continue
    }
    total += count
    if (count > 0) {
      const pixels = Math.round(Number.parseFloat(execFileSync('magick', ['identify', '-format', '%[fx:w*h]', baseline], { encoding: 'utf8' })))
      const percent = pixels > 0 ? ((count / pixels) * 100).toFixed(2) : '?'
      console.log(`${name}: ${count} px differ (${percent}%)`)
      changed += 1
    } else {
      console.log(`${name}: identical`)
    }
  }
  console.log(`\n${changed}/${names.length} screenshots differ (${total} px total)`)
}
