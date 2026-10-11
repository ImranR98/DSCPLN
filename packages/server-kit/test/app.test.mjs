import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createApp } from '../app.mjs'
import { configStore } from '../config-store.mjs'
import { stateStore } from '../state-store.mjs'
import { Runner } from '../runner.mjs'

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kit-app-'))
  const staticDir = path.join(root, 'static')
  fs.mkdirSync(staticDir, { recursive: true })
  fs.writeFileSync(path.join(staticDir, 'index.html'), '<!doctype html><html><head><title>Old</title></head><body><main></main></body></html>')
  fs.writeFileSync(path.join(staticDir, 'settings.html'), '<!doctype html><html><head><title>Old</title></head><body>settings</body></html>')
  fs.writeFileSync(path.join(staticDir, 'app.js'), 'console.log("app")')
  return {
    root,
    staticDir,
    configFile: path.join(root, 'config.json'),
    stateFile: path.join(root, 'state.json'),
  }
}

async function withServer(app, fn) {
  const server = app.listen(0, '127.0.0.1')
  await new Promise((resolve) => server.once('listening', resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  try {
    return await fn(base)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
}

function makeApp(fx, { basePath = '/media' } = {}) {
  const config = configStore(fx.configFile, { defaults: { schedule: { at: '03:00' } } })
  const state = stateStore(fx.stateFile)
  const runner = new Runner({ logDir: path.join(fx.root, 'logs') })
  return {
    config,
    state,
    runner,
    app: createApp({
      title: 'Test App',
      basePath,
      staticDir: fx.staticDir,
      config,
      state,
      runner,
      run: async () => ({ started: true }),
      routes: (router) => {
        router.get('/hello', (req, res) => res.json({ hello: 'world' }))
      },
    }),
  }
}

test('base path: pages, health, ui kit and injected base tag', async () => {
  const fx = fixture()
  const { app } = makeApp(fx, { basePath: '/media' })
  await withServer(app, async (base) => {
    const index = await fetch(`${base}/media`)
    assert.equal(index.status, 200)
    const html = await index.text()
    assert.match(html, /<base href="\/media\/">/)
    assert.match(html, /window\.DSCPLN_BASE="\/media"/)
    assert.match(html, /<title>D\$CPLN ⋅ Test App<\/title>/)
    assert.ok(!html.includes('<title>Old</title>'))

    const trailing = await fetch(`${base}/media/`)
    assert.equal(trailing.status, 200)

    const settings = await fetch(`${base}/media/settings`)
    assert.equal(settings.status, 200)
    assert.match(await settings.text(), /settings<\/body>/)

    const health = await fetch(`${base}/media/api/health`)
    assert.deepEqual(await health.json(), { ok: true, app: 'Test App', basePath: '/media' })

    const rootHealth = await fetch(`${base}/api/health`)
    assert.equal(rootHealth.status, 200)

    const appJs = await fetch(`${base}/media/app.js`)
    assert.equal(appJs.status, 200)

    const route = await fetch(`${base}/media/hello`)
    assert.deepEqual(await route.json(), { hello: 'world' })

    const missingApi = await fetch(`${base}/media/api/nope`)
    assert.equal(missingApi.status, 404)
    assert.deepEqual(await missingApi.json(), { error: 'Not found' })

    const missingPage = await fetch(`${base}/media/nope`)
    assert.equal(missingPage.status, 404)
  })
})

test('root base path works the same', async () => {
  const fx = fixture()
  const { app } = makeApp(fx, { basePath: '' })
  await withServer(app, async (base) => {
    const index = await fetch(`${base}/`)
    assert.match(await index.text(), /<base href="\/">/)
    const health = await fetch(`${base}/api/health`)
    assert.equal(health.status, 200)
  })
})

test('CSRF origin check rejects cross-origin mutations', async () => {
  const fx = fixture()
  const { app } = makeApp(fx)
  await withServer(app, async (base) => {
    const port = new URL(base).port
    const evil = await fetch(`${base}/media/api/config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Origin: 'http://evil.example' },
      body: JSON.stringify({ schedule: { at: '04:00' } }),
    })
    assert.equal(evil.status, 403)

    const good = await fetch(`${base}/media/api/config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Origin: `http://127.0.0.1:${port}` },
      body: JSON.stringify({ schedule: { at: '04:00' } }),
    })
    assert.equal(good.status, 200)
    assert.equal((await good.json()).schedule.at, '04:00')

    const noOrigin = await fetch(`${base}/media/api/config`)
    assert.equal(noOrigin.status, 200)
  })
})

test('standard state/run/cancel/pause/log routes', async () => {
  const fx = fixture()
  const { app, state, config } = makeApp(fx)
  await state.load()
  await config.load()
  await withServer(app, async (base) => {
    const stateRes = await fetch(`${base}/media/api/state`)
    const body = await stateRes.json()
    assert.equal(body.paused, false)
    assert.equal(body.config.schedule.at, '03:00')
    assert.equal(body.run.running, false)

    const run = await fetch(`${base}/media/api/run`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
    assert.equal(run.status, 200)

    const pause = await fetch(`${base}/media/api/pause`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ paused: true }) })
    assert.deepEqual(await pause.json(), { paused: true })

    const log = await fetch(`${base}/media/api/log`)
    assert.deepEqual(await log.json(), { lines: [], running: false })
  })
})

test('json config errors surface with status 400', async () => {
  const fx = fixture()
  const config = configStore(fx.configFile, {
    defaults: {},
    validate: (cfg) => {
      if (!cfg.name) {
        const err = new Error('name is required')
        err.statusCode = 400
        throw err
      }
    },
  })
  const app = createApp({ title: 'T', basePath: '/x', config })
  await withServer(app, async (base) => {
    const res = await fetch(`${base}/x/api/config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    })
    assert.equal(res.status, 400)
    assert.deepEqual(await res.json(), { error: 'name is required' })
  })
})

test('malformed percent-encoding does not crash the app', async () => {
  const fx = fixture()
  const { app } = makeApp(fx, { basePath: '/media' })
  await withServer(app, async (base) => {
    const bad = await fetch(`${base}/media/%`)
    assert.equal(bad.status, 400)
    const bad2 = await fetch(`${base}/media/%zz`)
    assert.equal(bad2.status, 400)
    const health = await fetch(`${base}/media/api/health`)
    assert.equal(health.status, 200, 'the server must still be alive')
  })
})

test('secret fields are masked on read and kept when saved as the mask', async () => {
  const fx = fixture()
  const config = configStore(fx.configFile, {
    defaults: { appPassword: '', name: 'x' },
    secrets: ['appPassword'],
  })
  const app = createApp({ title: 'T', basePath: '', config })
  await withServer(app, async (base) => {
    await fetch(`${base}/api/config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appPassword: 'hunter2', name: 'x' }),
    })
    const masked = await (await fetch(`${base}/api/config`)).json()
    assert.equal(masked.appPassword, '••••••••')
    assert.equal(config.get().appPassword, 'hunter2')

    // Saving the mask back keeps the stored secret.
    await fetch(`${base}/api/config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appPassword: '••••••••', name: 'x' }),
    })
    assert.equal(config.get().appPassword, 'hunter2')

    // An explicit empty string clears it.
    await fetch(`${base}/api/config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appPassword: '', name: 'x' }),
    })
    assert.equal(config.get().appPassword, '')

    const state = await (await fetch(`${base}/api/state`)).json()
    assert.notEqual(state.config.appPassword, 'hunter2')
  })
})
