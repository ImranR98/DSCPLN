import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { once } from 'node:events'
import { createContactsApp, mergeCollections } from '../server.mjs'
import { startFakeDav } from '../fixtures/fake-dav.mjs'

const stubCommands = () => [[process.execPath, '-e', 'console.log("stub: exported collections")']]

async function withApp(fn, options = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'contacts-'))
  const app = createContactsApp({ dataDir, basePath: '', commands: stubCommands, ...options })
  await app.start()
  const server = app.app.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const base = `http://127.0.0.1:${server.address().port}`
  try {
    await fn({ base, app, dataDir })
  } finally {
    app.stop()
    await new Promise((resolve) => server.close(resolve))
    fs.rmSync(dataDir, { recursive: true, force: true })
  }
}

test('serves the shell UI and standard API under the root', async () => {
  await withApp(async ({ base }) => {
    const page = await fetch(`${base}/`)
    assert.equal(page.status, 200)
    assert.match(await page.text(), /<title>D\$CPLN ⋅ Contacts \+ Calendar<\/title>/)

    const state = await (await fetch(`${base}/api/state`)).json()
    assert.equal(state.config.schedule.at, '03:00')
    assert.deepEqual(state.config.schedule.days, [0])
    assert.equal(state.run.running, false)
    assert.ok(state.nextRun, 'next run is computed from the schedule')

    const health = await (await fetch(`${base}/api/health`)).json()
    assert.equal(health.ok, true)
    assert.equal(health.app, 'Contacts + Calendar')
  })
})

test('config validation rejects bad URLs and times', async () => {
  await withApp(async ({ base }) => {
    const bad = await fetch(`${base}/api/config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nextcloudUrl: 'not-a-url' }),
    })
    assert.equal(bad.status, 400)
    assert.match((await bad.json()).error, /must start with http/)

    const badTime = await fetch(`${base}/api/config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ schedule: { enabled: true, at: '25:00' } }),
    })
    assert.equal(badTime.status, 400)

    const good = await fetch(`${base}/api/config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nextcloudUrl: 'http://nextcloud:80', username: 'imran' }),
    })
    assert.equal(good.status, 200)
    assert.equal((await good.json()).username, 'imran')
  })
})

test('discover merges saved choices and run records state + log', async (t) => {
  const dav = await startFakeDav()
  t.after(() => dav.close())
  await withApp(async ({ base, dataDir }) => {
    await fetch(`${base}/api/config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nextcloudUrl: dav.url,
        username: 'imran',
        appPassword: 'app-pass',
        destination: path.join(dataDir, 'Manual'),
        collections: [{ href: '/remote.php/dav/calendars/imran/personal/', filename: 'Events.ics', enabled: true }],
      }),
    })

    const discovered = await fetch(`${base}/api/discover`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    assert.equal(discovered.status, 200)
    const body = await discovered.json()
    assert.equal(body.collections.length, 3)
    const personal = body.collections.find((c) => c.displayName === 'Personal')
    assert.equal(personal.filename, 'Events.ics', 'saved filename survives rediscovery')
    assert.equal(personal.enabled, true)
    const fresh = body.collections.find((c) => c.displayName === 'TODO')
    assert.equal(fresh.enabled, true, 'newly discovered collections are enabled by default')
    assert.equal(fresh.filename, 'TODO.ics', 'known collections keep the historical file names')
    assert.equal(body.collections.find((c) => c.displayName === 'My Contacts').filename, 'My Contacts.vcf')

    const run = await fetch(`${base}/api/run`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
    assert.equal(run.status, 200)
    const finished = await waitFor(async () => {
      const state = await (await fetch(`${base}/api/state`)).json()
      return state.lastRun ? state : null
    })
    assert.equal(finished.lastRun.ok, true)
    assert.match(finished.lastRun.summary, /Exported 1 collection/)

    const log = await (await fetch(`${base}/api/log`)).json()
    assert.ok(log.lines.some((line) => line.includes('stub: exported collections')))
  })
})

test('base path: mounts under BASE_PATH with injected base tag', async () => {
  await withApp(async ({ base }) => {
    const page = await fetch(`${base}/contacts`)
    assert.equal(page.status, 200)
    assert.match(await page.text(), /<base href="\/contacts\/">/)
    const health = await (await fetch(`${base}/contacts/api/health`)).json()
    assert.equal(health.basePath, '/contacts')
    const ui = await fetch(`${base}/contacts/ui/shell.js`)
    assert.equal(ui.status, 200)
  }, { basePath: '/contacts' })
})

async function waitFor(fn, timeoutMs = 10_000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const value = await fn()
    if (value) return value
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error('timeout waiting for condition')
}
