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
  await page.waitForSelector('#overviewCard')
  assert.equal(await page.title(), 'D$CPLN ⋅ YTMusic Downloads')

  await page.click('#settingsButton')
  await page.waitForSelector('sl-dialog[open]')
  assert.equal(await page.locator('sl-dialog[open] sl-textarea[data-path="browserJson"]').count(), 1)
  assert.equal(await page.locator('sl-dialog[open] sl-input[data-path="musicDir"]').count(), 1)

  await page.fill('sl-dialog[open] sl-textarea[data-path="browserJson"] textarea', '{"cookie":"fresh"}')
  await page.click('sl-dialog[open] sl-button:has-text("Test auth")')
  await page.waitForFunction(() => document.querySelector('sl-dialog[open] .msg.ok')?.textContent?.includes('Auth OK'))

  assert.deepEqual(errors, [])
})
