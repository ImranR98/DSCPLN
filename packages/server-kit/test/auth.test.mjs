import test from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import { once } from 'node:events'
import { authFromEnv, isAuthorized, proxyAuth } from '../auth.mjs'

async function withServer(config, fn) {
  const app = express()
  if (config) app.use(proxyAuth(config))
  // express 5 removed bare '*' routes; a catch-all middleware works on both.
  app.use((req, res) => res.json({ ok: true }))
  const server = app.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const base = `http://127.0.0.1:${server.address().port}`
  try {
    return await fn(base)
  } finally {
    server.close()
    await once(server, 'close')
  }
}

test('proxyAuth rejects requests without the identity header', async () => {
  await withServer({ header: 'Remote-User', exempt: ['/api/health'] }, async (base) => {
    const res = await fetch(`${base}/tasks/api/state`)
    assert.equal(res.status, 401)
    assert.deepEqual(await res.json(), { error: 'authentication required' })
  })
})

test('proxyAuth accepts the header and exempt paths', async () => {
  await withServer({ header: 'Remote-User', exempt: ['/api/health'] }, async (base) => {
    const health = await fetch(`${base}/tasks/api/health`)
    assert.equal(health.status, 200)

    const authed = await fetch(`${base}/tasks/api/state`, { headers: { 'Remote-User': 'imran' } })
    assert.equal(authed.status, 200)

    const blank = await fetch(`${base}/tasks/api/state`, { headers: { 'Remote-User': '   ' } })
    assert.equal(blank.status, 401)
  })
})

test('proxyAuth lets OPTIONS preflights through', async () => {
  await withServer({ header: 'Remote-User', exempt: [] }, async (base) => {
    const res = await fetch(`${base}/anything`, { method: 'OPTIONS' })
    assert.equal(res.status, 200)
  })
})

test('no middleware means no guard (local/dev default)', async () => {
  await withServer(null, async (base) => {
    assert.equal((await fetch(`${base}/api/state`)).status, 200)
  })
})

test('isAuthorized matches exact and suffix exemptions with a custom header', () => {
  const config = { header: 'X-User', exempt: ['/api/health', '/balance/api/categories'] }
  const req = (path, headers = {}) => ({ path, headers })
  assert.equal(isAuthorized(req('/tasks/api/health'), config), true)
  assert.equal(isAuthorized(req('/balance/api/categories'), config), true)
  assert.equal(isAuthorized(req('/balance/api/data', { 'x-user': 'me' }), config), true)
  assert.equal(isAuthorized(req('/balance/api/data'), config), false)
  assert.equal(isAuthorized(req('/x', { 'remote-user': 'me' }), config), false)
})

test('a bare prefix segment exempts the whole subtree (balance keeps /api script-callable)', () => {
  const config = { header: 'Remote-User', exempt: ['/api/health', '/api'] }
  const req = (path, headers = {}) => ({ path, headers })
  assert.equal(isAuthorized(req('/balance/api/data'), config), true)
  assert.equal(isAuthorized(req('/balance/api/token'), config), true)
  assert.equal(isAuthorized(req('/balance/settings'), config), false)
  assert.equal(isAuthorized(req('/balance/settings', { 'remote-user': 'me' }), config), true)
})

test('isAuthorized tolerates raw upgrade requests (no req.path)', () => {
  assert.equal(isAuthorized({ headers: { 'remote-user': 'me' } }, { header: 'Remote-User', exempt: [] }), true)
  assert.equal(isAuthorized({ headers: {} }, { header: 'Remote-User', exempt: ['/api/health'] }), false)
})

test('authFromEnv: off by default, configured for proxy-header, rejects unknown modes', () => {
  assert.equal(authFromEnv({}), null)
  assert.equal(authFromEnv({ AUTH_MODE: 'off' }), null)
  assert.deepEqual(authFromEnv({ AUTH_MODE: 'proxy-header' }), { header: 'Remote-User', exempt: ['/api/health'] })
  assert.deepEqual(
    authFromEnv({ AUTH_MODE: 'PROXY-HEADER', AUTH_HEADER: 'X-User', AUTH_EXEMPT_PATHS: '/a,/b' }),
    { header: 'X-User', exempt: ['/api/health', '/a', '/b'] },
  )
  assert.throws(() => authFromEnv({ AUTH_MODE: 'open' }), /not supported/)
})
