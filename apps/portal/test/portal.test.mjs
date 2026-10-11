import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { once } from 'node:events'
import { fileURLToPath } from 'node:url'
import { createApp } from '@dscpln/server-kit'

const here = path.dirname(fileURLToPath(import.meta.url))
const STATIC_DIR = path.join(here, '..', 'static')

const EXPECTED_LINKS = ['/balance', '/media', '/watxt', '/tasks', '/contacts', '/compose', '/ytmusic']

async function launchBrowser() {
  const { chromium } = await import('playwright-core')
  try {
    return await chromium.launch()
  } catch {
    return null
  }
}

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
  await page.waitForSelector('.portal-card')
  const links = await page.$$eval('.portal-card', (cards) => cards.map((card) => card.getAttribute('href')))
  assert.deepEqual(links, EXPECTED_LINKS)
  assert.equal(await page.title(), 'D$CPLN')

  const header = await page.textContent('h1')
  assert.match(header, /D\$CPLN/)

  // The ui kit must actually load (theme button gets its icon from core.js).
  await page.waitForFunction(() => document.querySelector('#themeButton')?.innerHTML?.includes('<svg'))
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
    () => document.querySelectorAll('.portal-card__status.is-fail').length > 0,
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
    const next = document.querySelector('a.portal-card[href="/contacts"] .portal-card__next')
    return next?.textContent?.startsWith('next ')
  })
  const text = await page.$eval('a.portal-card[href="/contacts"] .portal-card__next', (node) => node.textContent)
  assert.match(text, /^next /)
})

