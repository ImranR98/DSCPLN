import test from 'node:test'
import { launchBrowser, tempDir } from '@dscpln/test-kit'
import assert from 'node:assert/strict'
import http from 'node:http'
import { once } from 'node:events'
import { createPortalApp } from '../server.mjs'

const EXPECTED_LINKS = ['/balance', '/pipelines', '/watxt', '/tasks', '/contacts', '/compose', '/ytmusic']

async function portalFixture(t) {
  const portal = createPortalApp({ dataDir: tempDir('portal-test-'), log: () => {} })
  await portal.start()
  const server = portal.app.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => new Promise((resolve) => server.close(resolve)))
  return { ...portal, base: `http://127.0.0.1:${server.address().port}` }
}

// Minimal ntfy stand-in: captures POSTs and answers with `status`.
async function mockNtfy(t, { status = 200 } = {}) {
  const received = []
  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (chunk) => { body += chunk })
    req.on('end', () => {
      received.push({ headers: req.headers, body })
      res.writeHead(status, { 'Content-Type': 'application/json' }).end(status === 200 ? '{}' : '{"error":"denied"}')
    })
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => new Promise((resolve) => server.close(resolve)))
  return { url: `http://127.0.0.1:${server.address().port}/topic`, received }
}

const putConfig = (base, body) =>
  fetch(`${base}/api/config`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

const postNotify = (base, body, path = '/api/notify') =>
  fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

test('portal config masks the ntfy token and keeps it when the mask is saved back', async (t) => {
  const { base } = await portalFixture(t)
  const initial = await (await fetch(`${base}/api/config`)).json()
  assert.deepEqual(initial.ntfy, { url: '', token: '' })

  await putConfig(base, { ntfy: { url: 'https://ntfy.example/topic', token: 'tk_secret' } })
  const masked = await (await fetch(`${base}/api/config`)).json()
  assert.equal(masked.ntfy.url, 'https://ntfy.example/topic')
  assert.equal(masked.ntfy.token, '••••••••')

  await putConfig(base, { ntfy: { url: 'https://ntfy.example/topic', token: '••••••••' } })
  const stillMasked = await (await fetch(`${base}/api/config`)).json()
  assert.equal(stillMasked.ntfy.token, '••••••••')

  const rejected = await putConfig(base, { ntfy: { url: 'ftp://bad', token: '' } })
  assert.equal(rejected.status, 400)
})

test('portal relays app notifications to the configured ntfy topic', async (t) => {
  const mock = await mockNtfy(t)
  const { base } = await portalFixture(t)
  await putConfig(base, { ntfy: { url: mock.url, token: 'tk_test' } })

  const response = await postNotify(base, {
    app: 'File Pipelines',
    message: 'Camera: PXL_1234.jpg -> 2026-10-14-09-39-48-(PXL_1234).jpg',
    title: 'D$CPLN - File Pipelines',
    priority: 'low',
    tags: ['white_check_mark'],
    click: 'https://dscpln.example/pipelines',
  })
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { ok: true })
  assert.equal(mock.received.length, 1)
  const { headers, body } = mock.received[0]
  assert.equal(headers.title, 'D$CPLN - File Pipelines')
  assert.equal(headers.priority, 'low')
  assert.equal(headers.tags, 'white_check_mark')
  assert.equal(headers.click, 'https://dscpln.example/pipelines')
  assert.equal(headers.authorization, 'Bearer tk_test')
  assert.match(body, /PXL_1234\.jpg/)
})

test('portal relay reports missing config, bad payloads and ntfy failures', async (t) => {
  const { base } = await portalFixture(t)
  const unconfigured = await postNotify(base, { message: 'hello' })
  assert.equal(unconfigured.status, 400)
  assert.match((await unconfigured.json()).error, /not configured/)

  const mock = await mockNtfy(t, { status: 401 })
  await putConfig(base, { ntfy: { url: mock.url, token: '' } })
  const noMessage = await postNotify(base, {})
  assert.equal(noMessage.status, 400)

  const upstream = await postNotify(base, { message: 'hello' })
  assert.equal(upstream.status, 502)
  assert.match((await upstream.json()).error, /ntfy returned 401/)
})

test('portal test endpoint accepts a draft URL but refuses other private hosts', async (t) => {
  const mock = await mockNtfy(t)
  const { base } = await portalFixture(t)
  await putConfig(base, { ntfy: { url: mock.url, token: '' } })

  const sent = await postNotify(base, { url: mock.url, token: 'tk_draft' }, '/api/notify/test')
  assert.equal(sent.status, 200)
  assert.equal(mock.received.length, 1)
  assert.equal(mock.received[0].headers.authorization, 'Bearer tk_draft')
  assert.equal(mock.received[0].body, 'Portal test notification')

  const ssrf = await postNotify(base, { url: 'http://10.1.2.3:3000/topic', token: 'tk_draft' }, '/api/notify/test')
  assert.equal(ssrf.status, 400)
  assert.match((await ssrf.json()).error, /private address/)
})

test('portal renders every function link and loads the ui kit', async (t) => {
  const browser = await launchBrowser()
  if (!browser) {
    t.skip('chromium not available (playwright browsers missing)')
    return
  }
  t.after(() => browser.close())

  const { base } = await portalFixture(t)
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

  // The theme toggle is the canary that the shared kit mounted.
  await page.waitForFunction(() => document.querySelector('[data-testid="theme-toggle"]')?.innerHTML?.includes('<svg'))
  assert.deepEqual(errors, [])
})

test('portal notification settings dialog saves and tests through ntfy', async (t) => {
  const browser = await launchBrowser()
  if (!browser) {
    t.skip('chromium not available (playwright browsers missing)')
    return
  }
  t.after(() => browser.close())

  const mock = await mockNtfy(t)
  const { base } = await portalFixture(t)
  const page = await browser.newPage()
  await page.goto(`${base}/`)
  await page.waitForSelector('[data-testid="settings-open"]')

  await page.click('[data-testid="settings-open"]')
  await page.waitForSelector('dialog[open]')
  await page.fill('.settings-body input[placeholder^="http"]', mock.url)
  await page.fill('.settings-body input[type="password"]', 'tk_browser')
  await page.click('.dialog-actions button:not(.outline)')
  await page.waitForSelector('dialog[open]', { state: 'hidden' })

  const saved = await (await fetch(`${base}/api/config`)).json()
  assert.equal(saved.ntfy.url, mock.url)
  assert.equal(saved.ntfy.token, '••••••••')

  // Reopen: the token comes back masked and the test button can use it.
  await page.click('[data-testid="settings-open"]')
  await page.waitForSelector('dialog[open]')
  assert.equal(await page.inputValue('.settings-body input[type="password"]'), '••••••••')
  await page.click('[data-testid="notify-test"]')
  await page.waitForFunction(() =>
    document.querySelector('[data-testid="notify-test-status"]')?.textContent?.includes('Test notification sent'))
  assert.equal(mock.received.length, 1)
  assert.equal(mock.received[0].body, 'Portal test notification')
})

test('portal health pill turns unreachable when an app is down', async (t) => {
  const browser = await launchBrowser()
  if (!browser) {
    t.skip('chromium not available (playwright browsers missing)')
    return
  }
  t.after(() => browser.close())

  const { base } = await portalFixture(t)
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

  const { base } = await portalFixture(t)
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

  const { base } = await portalFixture(t)
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
