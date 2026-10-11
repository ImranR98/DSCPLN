import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { once } from 'node:events'
import { createComposeApp } from '../server.mjs'

async function launchBrowser() {
  const { chromium } = await import('playwright-core')
  try {
    return await chromium.launch()
  } catch {
    return null
  }
}

test('shell UI: header, archives card, targets editor and key panel', async (t) => {
  const browser = await launchBrowser()
  if (!browser) {
    t.skip('chromium not available (playwright browsers missing)')
    return
  }
  t.after(() => browser.close())

  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'compose-ui-'))
  const app = createComposeApp({ dataDir, commands: () => [[process.execPath, '-e', 'console.log("stub")']] })
  await app.start()
  const server = app.app.listen(0, '127.0.0.1')
  await once(server, 'listening')
  // Point the destination at the sandbox so the assertions do not depend on
  // whatever is in the real ~/Main/Infra/compose_state_backups. Use the store's
  // own merge-update: a raw PUT replaces the whole config (including the key).
  await app.config.update({ destination: path.join(dataDir, 'backups') })
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
  assert.equal(await page.title(), 'D$CPLN ⋅ Infra Compose State')

  const archivesCard = page.locator('article', { hasText: 'Archives' }).first()
  await archivesCard.waitFor()
  assert.match(await archivesCard.textContent(), /No archives yet/)

  await page.click('[aria-label="Settings"]')
  await page.waitForSelector('dialog[open]')
  // Fresh installs have no targets; the editor starts empty and Add target works.
  assert.equal(await page.locator('dialog[open] .target-row').count(), 0)
  await page.click('dialog[open] button:has-text("Add target")')
  await page.click('dialog[open] button:has-text("Add target")')
  assert.equal(await page.locator('dialog[open] .target-row').count(), 2)
  assert.match(await page.textContent('dialog[open] .code-block'), /ssh-ed25519/)
  assert.equal(await page.locator('dialog[open] button', { hasText: 'Regenerate key' }).count(), 1)

  assert.deepEqual(errors, [])
})
