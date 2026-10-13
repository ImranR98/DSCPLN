import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import {
  browserAvailable,
  have,
  launchBrowser,
  listen,
  tempDir,
  waitFor,
  withApp,
} from '../index.mjs'

test('tempDir creates a fresh writable directory', async () => {
  const first = tempDir()
  const second = tempDir()
  assert.notEqual(first, second)
  const fs = await import('node:fs')
  assert.ok(fs.existsSync(first))
  assert.ok(fs.statSync(first).isDirectory())
})

test('listen serves the app until close()', async () => {
  const app = http.createServer((req, res) => {
    res.setHeader('content-type', 'application/json')
    res.end('{"ok":true}')
  })
  const { base, close } = await listen(app)
  try {
    assert.match(base, /^http:\/\/127\.0\.0\.1:\d+$/)
    const response = await fetch(`${base}/anything`)
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { ok: true })
  } finally {
    await close()
  }
})

test('withApp closes the server even when the callback throws', async () => {
  const app = http.createServer((req, res) => res.end('ok'))
  let seen = null
  await assert.rejects(withApp(app, async (base) => {
    seen = base
    throw new Error('boom')
  }), /boom/)
  assert.ok(seen)
  await assert.rejects(fetch(`${seen}/`))
})

test('waitFor polls until the predicate matches', async () => {
  let attempts = 0
  const value = await waitFor(async () => ++attempts, (n) => n >= 3, { intervalMs: 5 })
  assert.equal(value, 3)

  await assert.rejects(
    waitFor(async () => false, Boolean, { timeoutMs: 30, intervalMs: 5 }),
    /waitFor timed out/,
  )
})

test('have detects commands on PATH', () => {
  assert.equal(have('node'), true)
  assert.equal(have('definitely-not-a-real-command-xyz'), false)
})

test('launchBrowser returns a browser or null, and browserAvailable agrees', async () => {
  const browser = await launchBrowser()
  if (browser) {
    await browser.close()
    assert.equal(await browserAvailable(), true)
  } else {
    assert.equal(await browserAvailable(), false)
  }
})
