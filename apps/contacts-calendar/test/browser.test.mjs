import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { once } from 'node:events'
import { createContactsApp } from '../server.mjs'

async function launchBrowser() {
  const { chromium } = await import('playwright-core')
  try {
    return await chromium.launch()
  } catch {
    return null
  }
}

test('shell UI: header, overview, settings fields and Discover', async (t) => {
  const browser = await launchBrowser()
  if (!browser) {
    t.skip('chromium not available (playwright browsers missing)')
    return
  }
  t.after(() => browser.close())

  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'contacts-ui-'))
  const app = createContactsApp({ dataDir, commands: () => [[process.execPath, '-e', 'console.log("stub")']] })
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
  assert.equal(await page.title(), 'D$CPLN ⋅ Contacts + Calendar')
  assert.match(await page.textContent('h1'), /Contacts \+ Calendar/)

  // Default schedule (Sunday 03:00) renders as the next run.
  await page.waitForFunction(() => document.querySelector('#overviewCard .card__context')?.textContent?.includes('next'))

  await page.click('#settingsButton')
  await page.waitForSelector('sl-dialog[open]')
  const labels = await page.$$eval('sl-dialog[open] sl-input[data-path], sl-dialog[open] sl-textarea[data-path]',
    (els) => els.map((el) => el.getAttribute('data-path')))
  assert.ok(labels.includes('nextcloudUrl'))
  assert.ok(labels.includes('destination'))
  assert.ok(labels.includes('git.message'))
  assert.equal(await page.locator('sl-dialog[open] sl-button', { hasText: 'Discover' }).count(), 1)

  assert.deepEqual(errors, [])
})
