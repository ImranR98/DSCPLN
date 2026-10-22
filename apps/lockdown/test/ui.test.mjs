import test from 'node:test'
import assert from 'node:assert/strict'
import { launchBrowser, listen } from '@dscpln/test-kit'
import { createLockdownApp } from '../server.mjs'

const status = {
  ok: true,
  now: Date.now(),
  table: { name: 'dscpln_lockdown' },
  presets: {
    'vpn-only': { active: false, ports: [], expiresAt: null, remainingSeconds: null },
    'traefik-off': { active: false, ports: [], expiresAt: null, remainingSeconds: null },
    'srv0-tunnel-cut': { active: false, ports: [], expiresAt: null, remainingSeconds: null },
  },
  pending: {},
  limits: { minDurationSeconds: 600, maxDurationSeconds: 86400 },
}

test('the lockdown UI renders presets and confirms an action', async (t) => {
  const browser = await launchBrowser()
  if (!browser) {
    t.skip('Chromium is not available')
    return
  }
  t.after(() => browser.close())

  const calls = []
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, init })
    return {
      ok: true,
      status: 200,
      async text() { return JSON.stringify(status) },
    }
  }
  const { app } = createLockdownApp({
    auth: null,
    blockerUrl: 'http://blocker.test',
    blockerToken: 'test-token',
    fetchImpl,
    log: () => {},
  })
  const { base, close } = await listen(app)
  t.after(close)

  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', (err) => errors.push(err))
  await page.goto(base)
  await page.waitForSelector('[data-testid="preset-vpn-only"]')
  assert.equal(await page.locator('[data-testid="state-vpn-only"]').textContent(), 'Open')
  assert.match(await page.locator('body').innerText(), /Port blocks do not survive a srv0 reboot/)

  await page.click('[data-testid="open-vpn-only"]')
  await page.waitForSelector('[data-testid="confirmation"]')
  const confirm = page.locator('[data-testid="confirm-action"]')
  assert.equal(await confirm.isDisabled(), true)
  await page.fill('[data-testid="confirmation"]', 'BLOCK PUBLIC')
  assert.equal(await confirm.isEnabled(), true)
  await confirm.click()
  await page.waitForFunction(() => !document.querySelector('[data-testid="confirmation"]'))
  const blockCall = calls.find((call) => call.url === 'http://blocker.test/v1/block')
  assert.ok(blockCall)
  assert.equal(blockCall.init.headers.Authorization, 'Bearer test-token')
  assert.equal(errors.length, 0)
})
