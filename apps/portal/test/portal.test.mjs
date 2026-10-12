import test from 'node:test'
import { launchBrowser } from '@dscpln/test-kit'
import assert from 'node:assert/strict'
import path from 'node:path'
import { once } from 'node:events'
import { fileURLToPath } from 'node:url'
import { createApp } from '@dscpln/server-kit'

const here = path.dirname(fileURLToPath(import.meta.url))
const STATIC_DIR = path.join(here, '..', 'static')

const EXPECTED_LINKS = ['/balance', '/pipelines', '/watxt', '/tasks', '/contacts', '/compose', '/ytmusic']


test('portal renders every function link and loads the ui kit', async (t) => {
  const browser = await launchBrowser()
  if (!browser) {
    t.skip('chromium not available (playwright browsers missing)')
    return
  }
  t.after(() => browser.close())

  const app = createApp({ title: 'Portal', pageTitle: 'D$CPLN', basePath: '', staticDir: STATIC_DIR })
  const server = app.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => new Promise((resolve) => server.close(resolve)))
  const base = `http://127.0.0.1:${server.address().port}`

  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', (err) => errors.push(err.message))
  page.on('console', (msg) => {
    // Health pings to the (not running) sibling apps are expected 404s.
    if (msg.type() === 'error' && !msg.text().includes('Failed to load resource')) errors.push(msg.text())
  })

  await page.goto(`${base}/`)
  await page.waitForSelector('[data-testid="card-balance"]')
  const links = await page.$$eval('[data-testid^="card-"]', (cards) => cards.map((card) => card.getAttribute('href')))
  assert.deepEqual(links, EXPECTED_LINKS)
  assert.equal(await page.title(), 'D$CPLN')

  const header = await page.textContent('h1')
  assert.match(header, /D\$CPLN/)

  // The theme toggle is the canary that the Svelte kit mounted.
  await page.waitForFunction(() => document.querySelector('[data-testid="theme-toggle"]')?.innerHTML?.includes('<svg'))
  assert.deepEqual(errors, [])
})

test('portal health pill turns unreachable when an app is down', async (t) => {
  const browser = await launchBrowser()
  if (!browser) {
    t.skip('chromium not available (playwright browsers missing)')
    return
  }
  t.after(() => browser.close())

  const app = createApp({ title: 'Portal', pageTitle: 'D$CPLN', basePath: '', staticDir: STATIC_DIR })
  const server = app.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => new Promise((resolve) => server.close(resolve)))
  const base = `http://127.0.0.1:${server.address().port}`

  const page = await browser.newPage()
  await page.goto(`${base}/`)
  await page.waitForFunction(
    () => document.querySelectorAll('[data-testid^="status-"].is-fail').length > 0,
    null,
    { timeout: 15_000 },
  )
})

test('portal shows the next scheduled run for scheduled apps', async (t) => {
  const browser = await launchBrowser()
  if (!browser) {
    t.skip('chromium not available (playwright browsers missing)')
    return
  }
  t.after(() => browser.close())

  const app = createApp({ title: 'Portal', pageTitle: 'D$CPLN', basePath: '', staticDir: STATIC_DIR })
  const server = app.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => new Promise((resolve) => server.close(resolve)))
  const base = `http://127.0.0.1:${server.address().port}`

  const page = await browser.newPage()
  const nextRun = Date.now() + 3 * 3600_000
  await page.route('**/contacts/api/health', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }))
  await page.route('**/contacts/api/state', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ paused: false, nextRun, missed: 0 }) }))

  await page.goto(`${base}/`)
  await page.waitForFunction(() => {
    const next = document.querySelector('[data-testid="next-contacts"]')
    return next?.textContent?.startsWith('next ')
  })
  const text = await page.$eval('[data-testid="next-contacts"]', (node) => node.textContent)
  assert.match(text, /^next /)
})

test('portal tiles show per-app detail lines', async (t) => {
  const browser = await launchBrowser()
  if (!browser) {
    t.skip('chromium not available (playwright browsers missing)')
    return
  }
  t.after(() => browser.close())

  const app = createApp({ title: 'Portal', pageTitle: 'D$CPLN', basePath: '', staticDir: STATIC_DIR })
  const server = app.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => new Promise((resolve) => server.close(resolve)))
  const base = `http://127.0.0.1:${server.address().port}`

  const page = await browser.newPage()
  const json = (body) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
  for (const path of ['balance', 'pipelines', 'watxt', 'tasks', 'contacts', 'compose', 'ytmusic']) {
    await page.route(`**/${path}/api/health`, (route) => route.fulfill(json({ ok: true })))
    await page.route(`**/${path}/api/state`, (route) => route.fulfill(json({ paused: false })))
  }
  await page.route('**/balance/status', (route) => route.fulfill(json({ overBudget: ['USD'] })))
  await page.route('**/pipelines/api/state', (route) =>
    route.fulfill(json({ paused: false, folders: [{ counts: { queued: 2, error: 1 } }] })))
  await page.route('**/watxt/api/state', (route) =>
    route.fulfill(json({ conversations: 3, messages: 42 })))
  await page.route('**/tasks/api/tasks', (route) =>
    route.fulfill(json({ groups: [{ tasks: [{ name: 'a', state: { ok: false } }, { name: 'b', state: { ok: true } }] }] })))
  await page.route('**/contacts/api/state', (route) =>
    route.fulfill(json({
      paused: false,
      lastRun: { endedAt: Date.now() - 3600_000, ok: true, summary: 'Exported 4 collections' },
      nextRun: Date.now() + 3600_000,
      missed: 1,
    })))

  await page.goto(`${base}/`)
  await page.waitForFunction(() =>
    document.querySelector('[data-testid="detail-contacts"]')?.textContent?.startsWith('last '))

  const detailOf = (path) => page.$eval(`[data-testid="detail-${path}"]`, (node) => node.textContent)
  assert.match(await detailOf('contacts'), /^last .* · OK$/)
  assert.match(await detailOf('balance'), /USD over budget/)
  assert.match(await detailOf('pipelines'), /2 active · 1 errors/)
  assert.match(await detailOf('watxt'), /3 conversations · 42 messages/)
  assert.match(await detailOf('tasks'), /2 tasks · 1 failing/)

  const next = await page.$eval('[data-testid="next-contacts"]', (node) => node.textContent)
  assert.match(next, /1 missed/)

})

