// Shared test helpers. Every app's tests spin up an ephemeral server, use a
// temp dir and poll for async state; these are the common shapes.

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
