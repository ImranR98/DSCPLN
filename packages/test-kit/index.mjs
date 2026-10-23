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
// Playwright's bundled browser is preferred; a system Chromium is a useful
// fallback in CI images where the browser payload has not been installed.
// CI sets REQUIRE_BROWSER=1 so a missing browser fails the job instead of
// silently skipping every UI test.
export async function launchBrowser(options = { headless: true }) {
  let chromium
  try {
    ({ chromium } = await import('playwright-core'))
  } catch {
    if (process.env.REQUIRE_BROWSER === '1') {
      throw new Error('playwright-core is required (REQUIRE_BROWSER=1) but is not installed')
    }
    return null
  }
  const args = [...(options.args || [])]
  if (!args.includes('--no-sandbox')) args.push('--no-sandbox')
  const attempts = options.executablePath
    ? [options.executablePath]
    : [undefined, process.env.CHROMIUM_PATH, '/usr/bin/chromium-browser', '/usr/bin/chromium', '/usr/bin/google-chrome'].filter(Boolean)
  for (const executablePath of attempts) {
    try {
      return await chromium.launch({ ...options, args, ...(executablePath ? { executablePath } : {}) })
    } catch {
      // Try the next candidate.
    }
  }
  if (process.env.REQUIRE_BROWSER === '1') {
    throw new Error('Chromium is required (REQUIRE_BROWSER=1) but no executable could be launched')
  }
  return null
}

// True when a browser can be launched (used for `{ skip: !CAN_RUN }`).
export async function browserAvailable() {
  const browser = await launchBrowser()
  if (!browser) return false
  await browser.close()
  return true
}

// True when a command exists on PATH (for tests that need ffmpeg/exiftool...).
// CI sets REQUIRE_TEST_TOOLS=1 so a missing tool fails the job instead of
// skipping the tests that depend on it.
export function have(cmd) {
  try {
    execFileSync('which', [cmd], { stdio: 'ignore' })
    return true
  } catch {
    if (process.env.REQUIRE_TEST_TOOLS === '1') {
      throw new Error(`Required test tool is not on PATH: ${cmd}`)
    }
    return false
  }
}
