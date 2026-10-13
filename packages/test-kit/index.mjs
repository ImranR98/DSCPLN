// Shared test helpers. Every app's tests spin up an ephemeral server, use a
// temp dir and poll for async state; these are the common shapes. The browser
// helpers keep Chromium optional: they return null and the test skips instead
// of failing when Playwright/Chromium is unavailable.

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { once } from 'node:events'

export function tempDir(prefix = 'dscpln-test-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix))
}

export async function listen(app) {
  const server = app.listen(0, '127.0.0.1')
  await once(server, 'listening')
  return {
    server,
    base: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  }
}

// Runs `fn(base)` against an ephemeral server and always closes it.
export async function withApp(app, fn) {
  const { base, close } = await listen(app)
  try {
    return await fn(base)
  } finally {
    await close()
  }
}

export async function waitFor(probe, predicate = (value) => Boolean(value), { timeoutMs = 10_000, intervalMs = 100 } = {}) {
  const start = Date.now()
  let last
  while (Date.now() - start < timeoutMs) {
    last = await probe()
    if (predicate(last)) return last
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
  throw new Error(`waitFor timed out after ${timeoutMs}ms; last=${JSON.stringify(last)}`)
}

// Launches Chromium, or returns null when Playwright/Chromium is unavailable.
export async function launchBrowser(options = { headless: true }) {
  let chromium
  try {
    ({ chromium } = await import('playwright-core'))
  } catch {
    return null
  }
  try {
    return await chromium.launch(options)
  } catch {
    return null
  }
}

// True when a browser can be launched (used for `{ skip: !CAN_RUN }`).
export async function browserAvailable() {
  const browser = await launchBrowser()
  if (!browser) return false
  await browser.close()
  return true
}

// True when a command exists on PATH (for tests that need ffmpeg/exiftool...).
export function have(cmd) {
  try {
    execFileSync('which', [cmd], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}
