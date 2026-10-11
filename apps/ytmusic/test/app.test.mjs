import { waitFor } from '@dscpln/test-kit'
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { once } from 'node:events'
import { createYtmusicApp, summarizeDownload } from '../server.mjs'

const stubCommands = () => [[process.execPath, '-e', 'console.log("stub: downloaded")']]
const stubAuth = async ({ browserJson }) => {
  if (!browserJson) throw new Error('paste browser.json contents first')
  return { playlists: 7 }
}

async function withApp(fn, options = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ytmusic-app-'))
  const app = createYtmusicApp({ dataDir, basePath: '', commands: stubCommands, testAuth: stubAuth, ...options })
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

test('serves the shell UI, schedule defaults and health', async () => {
  await withApp(async ({ base }) => {
    const page = await fetch(`${base}/`)
    assert.equal(page.status, 200)
    assert.match(await page.text(), /<title>D\$CPLN ⋅ YTMusic Downloads<\/title>/)

    const state = await (await fetch(`${base}/api/state`)).json()
    assert.equal(state.config.schedule.at, '05:00')
    assert.deepEqual(state.config.schedule.days, [])
    assert.ok(state.nextRun)
    assert.equal((await (await fetch(`${base}/api/health`)).json()).app, 'YTMusic Downloads')
  })
})

test('config validation rejects bad browserJson and times', async () => {
  await withApp(async ({ base }) => {
    const badJson = await fetch(`${base}/api/config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ browserJson: '{nope' }),
    })
    assert.equal(badJson.status, 400)
    assert.match((await badJson.json()).error, /not valid JSON/)

    const badTime = await fetch(`${base}/api/config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ schedule: { enabled: true, at: 'noon' } }),
    })
    assert.equal(badTime.status, 400)
  })
})

test('test-auth reports success and failure paths', async () => {
  await withApp(async ({ base }) => {
    const missing = await fetch(`${base}/api/test-auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    })
    assert.equal(missing.status, 502)

    const ok = await fetch(`${base}/api/test-auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ browserJson: '{"cookie":"x"}' }),
    })
    assert.equal(ok.status, 200)
    assert.deepEqual(await ok.json(), { ok: true, playlists: 7 })
  })
})

test('run records state and logs under BASE_PATH', async () => {
  await withApp(async ({ base }) => {
    const run = await fetch(`${base}/ytmusic/api/run`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
    assert.equal(run.status, 200)
    const state = await waitFor(async () => {
      const body = await (await fetch(`${base}/ytmusic/api/state`)).json()
      return body.lastRun ? body : null
    })
    assert.equal(state.lastRun.ok, true)
    assert.match(state.lastRun.summary, /Downloaded into/)
    const log = await (await fetch(`${base}/ytmusic/api/log`)).json()
    assert.ok(log.lines.some((line) => line.includes('stub: downloaded')))
  }, { basePath: '/ytmusic' })
})


test('summarizeDownload reports counts from the run log', () => {
  assert.equal(summarizeDownload('Downloaded 3 new tracks\n'), 'Downloaded 3 new tracks')
  assert.equal(summarizeDownload('Downloaded 0 new tracks\n'), 'No new tracks')
  assert.equal(
    summarizeDownload('Downloaded 2 new tracks\nNumber of unsorted songs was 468, is now 470.'),
    'Downloaded 2 new tracks · 470 unsorted',
  )
  assert.equal(summarizeDownload('no counters here', { musicDir: '/m' }), 'Downloaded into /m')
  assert.equal(summarizeDownload('', {}), 'Downloaded into the music directory')
})
