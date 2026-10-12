// Generates all README screenshots from synthetic sandboxes.
// Run from the repo root:  node scripts/screenshots.mjs
//
// Boots every app with a synthetic sandbox (fake conversations, tasks, media,
// mock workbook) and writes docs/screenshots/*.png. Never point this at real
// data: it exists so the README images can be regenerated with no personal
// content in them.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { once } from 'node:events'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(REPO, 'docs', 'screenshots')
fs.mkdirSync(OUT, { recursive: true })

const requireFromRoot = createRequire(path.join(REPO, 'package.json'))
const { chromium } = requireFromRoot('playwright-core')
const browser = await chromium.launch()

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

async function shoot(page, name) {
  // Capture the full document deterministically: Chromium's captureBeyondViewport
  // intermittently clips to the viewport when the content is taller than it, so
  // resize the viewport to the document first and restore it afterwards.
  const viewport = page.viewportSize()
  const size = await page.evaluate(() => ({
    width: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
    height: Math.max(document.documentElement.scrollHeight, document.body.scrollHeight),
  }))
  if (size.height > viewport.height) {
    await page.setViewportSize({ width: viewport.width, height: size.height })
  }
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true })
  if (size.height > viewport.height) {
    await page.setViewportSize(viewport)
  }
  console.log('shot', name)
}

const ago = (minutes) => Date.now() - minutes * 60_000

function writeState(dir, { summary, minutesAgo = 65 }) {
  const endedAt = ago(minutesAgo)
  const startedAt = endedAt - 2000
  const run = { startedAt, endedAt, durationSec: 2, ok: true, summary, trigger: 'schedule' }
  const state = {
    lastRun: run,
    history: [run],
    nextRun: null,
    paused: false,
    missed: 0,
    lastScheduledRun: endedAt,
    runMarker: null,
    updatedAt: Date.now(),
  }
  fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify(state, null, 2))
}

/* ---------------- portal ---------------- */
{
  const { createApp } = await import(path.join(REPO, 'packages/server-kit/app.mjs'))
  const app = createApp({ title: 'Portal', pageTitle: 'D$CPLN', basePath: '', staticDir: path.join(REPO, 'apps/portal/static') })
  const server = app.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const base = `http://127.0.0.1:${server.address().port}`
  const page = await newPage()
  for (const p of ['balance', 'media', 'watxt', 'tasks', 'contacts', 'compose', 'ytmusic']) {
    await page.route(`**/${p}/api/health`, (route) => route.fulfill(json({ ok: true })))
  }
  await page.route('**/balance/status', (route) => route.fulfill(json({ overBudget: [] })))
  await page.route('**/pipelines/api/state', (route) => route.fulfill(json({ paused: false, folders: [{ counts: { queued: 2, review: 1 } }] })))
  await page.route('**/watxt/api/state', (route) => route.fulfill(json({ conversations: 12, messages: 8421 })))
  await page.route('**/tasks/api/tasks', (route) => route.fulfill(json({ groups: [{ tasks: [{ state: { ok: true } }, { state: { ok: true } }, { state: { ok: true } }] }] })))
  await page.route('**/contacts/api/state', (route) => route.fulfill(json({ paused: false, lastRun: { endedAt: ago(120), ok: true }, nextRun: Date.now() + 5 * 86400_000, missed: 0 })))
  await page.route('**/compose/api/state', (route) => route.fulfill(json({ paused: false, lastRun: { endedAt: ago(90), ok: true }, nextRun: Date.now() + 2 * 86400_000, missed: 0 })))
  await page.route('**/ytmusic/api/state', (route) => route.fulfill(json({ paused: false, lastRun: { endedAt: ago(400), ok: true }, nextRun: Date.now() + 15 * 3600_000, missed: 0 })))
  await page.goto(`${base}/`)
  await page.waitForSelector('[data-testid="detail-balance"]')
  await shoot(page, 'portal')
  await page.close()
  await new Promise((resolve) => server.close(resolve))
}

/* ---------------- balance (dashboard + insights) ---------------- */
{
  const dir = tmp('shot-balance-')
  fs.copyFileSync(path.join(REPO, 'apps/balance-xlsx/mock-data.xlsx'), path.join(dir, 'Balance.xlsx'))
  execFileSync('git', ['init', '-q'], { cwd: dir })
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
    ntfy: { url: '', token: '', notifySuccess: true },
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

/* ---------------- contacts ---------------- */
{
  const dir = tmp('shot-contacts-')
  fs.mkdirSync(path.join(dir, 'Backups/Manual'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({
    nextcloudUrl: 'http://nextcloud',
    username: 'alice',
    appPassword: 'app-password-placeholder',
    destination: path.join(dir, 'Backups/Manual'),
    collections: [
      { href: '/remote.php/dav/calendars/alice/personal/', type: 'calendar', displayName: 'Personal', enabled: true, filename: 'Personal.ics' },
      { href: '/remote.php/dav/calendars/alice/todo/', type: 'calendar', displayName: 'TODO', enabled: true, filename: 'TODO.ics' },
      { href: '/remote.php/dav/addressbooks/users/alice/contacts/', type: 'addressbook', displayName: 'Contacts', enabled: true, filename: 'Contacts.vcf' },
    ],
    git: { enabled: true, message: '' },
    schedule: { enabled: true, days: [0], at: '03:00', catchUp: true },
    ntfy: { url: '', token: '', notifySuccess: true },
  }, null, 2))
  writeState(dir, { summary: 'Exported 3 collections' })
  const { createContactsApp } = await import(path.join(REPO, 'apps/contacts-calendar/server.mjs'))
  const app = createContactsApp({ dataDir: dir })
  await app.start()
  const server = app.app.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const base = `http://127.0.0.1:${server.address().port}`
  const page = await newPage()
  await page.goto(base)
  await page.waitForSelector('[data-testid="run-now"]')
  await shoot(page, 'contacts')
  await page.click('[aria-label="Settings"]')
  await page.waitForSelector('dialog[open] .collection-row', { timeout: 10000 })
  await page.locator('dialog[open]').screenshot({ path: path.join(OUT, 'contacts-settings.png') })
  console.log('shot contacts-settings')
  await page.close()
  await new Promise((resolve) => server.close(resolve))
}

/* ---------------- compose state ---------------- */
{
  const dir = tmp('shot-compose-')
  const destination = path.join(dir, 'compose_state_backups')
  fs.mkdirSync(destination, { recursive: true })
  for (const name of ['host-a-backup-20260105_040000.tar', 'host-b-backup-20260105_040100.tar']) {
    fs.writeFileSync(path.join(destination, name), Buffer.alloc(2048, 3))
  }
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({
    targets: [
      { name: 'host-a', mode: 'local', host: '', user: '', path: '~/Infra/compose_live_state' },
      { name: 'host-b', mode: 'ssh', host: 'host-b.example.com', user: 'root', path: '/srv/compose_live_state' },
    ],
    destination,
    retention: 1,
    ntfy: { url: '', token: '', notifySuccess: true },
    schedule: { enabled: true, days: [0], at: '04:00', catchUp: true },
  }, null, 2))
  writeState(dir, { summary: 'Backed up 2 targets: host-a, host-b' })
  const { createComposeApp } = await import(path.join(REPO, 'apps/compose-state/server.mjs'))
  const app = createComposeApp({ dataDir: dir })
  await app.start()
  const server = app.app.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const base = `http://127.0.0.1:${server.address().port}`
  const page = await newPage()
  await page.goto(base)
  await page.waitForSelector('[data-testid="run-now"]')
  await page.waitForTimeout(600)
  await shoot(page, 'compose')
  await page.close()
  await new Promise((resolve) => server.close(resolve))
}

/* ---------------- ytmusic ---------------- */
{
  const dir = tmp('shot-ytmusic-')
  fs.mkdirSync(path.join(dir, 'Music'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({
    musicDir: path.join(dir, 'Music'),
    browserJson: '{"cookie":"placeholder"}',
    ntfy: { url: '', token: '', notifySuccess: false },
    schedule: { enabled: true, days: [], at: '05:00', catchUp: true },
  }, null, 2))
  writeState(dir, { summary: 'Downloaded 3 new tracks · 12 unsorted' })
  const { createYtmusicApp } = await import(path.join(REPO, 'apps/ytmusic/server.mjs'))
  const app = createYtmusicApp({ dataDir: dir })
  await app.start()
  const server = app.app.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const base = `http://127.0.0.1:${server.address().port}`
  const page = await newPage()
  await page.goto(base)
  await page.waitForSelector('[data-testid="run-now"]')
  await shoot(page, 'ytmusic')
  await page.close()
  await new Promise((resolve) => server.close(resolve))
}

await browser.close()
console.log('all screenshots written to', OUT)
