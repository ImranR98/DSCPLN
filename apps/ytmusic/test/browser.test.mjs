import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { once } from 'node:events'
import { createYtmusicApp } from '../server.mjs'

async function launchBrowser() {
  const { chromium } = await import('playwright-core')
  try {
    return await chromium.launch()
  } catch {
    return null
  }
}

test('shell UI: header, settings with browserJson and Test auth', async (t) => {
  const browser = await launchBrowser()
  if (!browser) {
    t.skip('chromium not available (playwright browsers missing)')
    return
  }
  t.after(() => browser.close())

  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ytmusic-ui-'))
  const app = createYtmusicApp({
    dataDir,
    commands: () => [[process.execPath, '-e', 'console.log("stub")']],
    testAuth: async () => ({ playlists: 3 }),
  })
  await app.start()
  const server = app.app.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => {
    app.stop()
    server.close()
    fs.rmSync(dataDir, { recursive: true, force: true })
  })
  const base = `http://127.0.0.1:${server.address().port}`

  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', (err) => errors.push(err.message))
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text())
  })

  await page.goto(base)
  await page.waitForSelector('[data-testid="run-now"]')
  assert.equal(await page.title(), 'D$CPLN ⋅ YTMusic Downloads')

  await page.click('[aria-label="Settings"]')
  await page.waitForSelector('dialog[open]')
  const browserJson = page.locator('dialog[open] textarea').first()
  assert.equal(await browserJson.count(), 1)
  assert.equal(await page.locator('dialog[open] input').first().count(), 1)

  await browserJson.fill('{"cookie":"fresh"}')
  await page.click('[data-testid="test-auth"]')
  await page.waitForFunction(() => document.querySelector('dialog[open] p.status-ok')?.textContent?.includes('Auth OK'))

  assert.deepEqual(errors, [])
})
