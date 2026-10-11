import test from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import { once } from 'node:events'
import { asyncRoute, readBody, sameOrigin, sendJson } from '../http.mjs'

async function withServer(routes) {
  const app = express()
  app.use(routes)
  // eslint-disable-next-line no-unused-vars -- express needs the 4-arg shape
  app.use((err, req, res, next) => res.status(err.statusCode ?? 500).json({ error: err.message }))
  const server = app.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const base = `http://127.0.0.1:${server.address().port}`
  return { base, close: () => new Promise((resolve) => server.close(resolve)) }
}

test('sendJson sets the status and body', async () => {
  const { base, close } = await withServer((req, res) => sendJson(res, 201, { ok: true }))
  try {
    const response = await fetch(`${base}/anything`)
    assert.equal(response.status, 201)
    assert.deepEqual(await response.json(), { ok: true })
  } finally {
    await close()
  }
})

test('readBody returns text and enforces the limit', async () => {
  const { base, close } = await withServer(asyncRoute(async (req, res) => sendJson(res, 200, { body: await readBody(req, 8) })))
  try {
    const ok = await fetch(`${base}/`, { method: 'POST', body: 'seven!!' })
    assert.deepEqual(await ok.json(), { body: 'seven!!' })

    const tooBig = await fetch(`${base}/`, { method: 'POST', body: 'way too many bytes' })
    assert.equal(tooBig.status, 413)
    assert.match((await tooBig.json()).error, /too large/)
  } finally {
    await close()
  }
})

test('sameOrigin allows missing or matching origins and rejects others', () => {
  assert.equal(sameOrigin({ headers: {} }), true)
  assert.equal(sameOrigin({ headers: { origin: 'https://app.test', host: 'app.test' } }), true)
  assert.equal(sameOrigin({ headers: { origin: 'https://evil.test', host: 'app.test' } }), false)
  assert.equal(sameOrigin({ headers: { origin: 'not a url', host: 'app.test' } }), false)
})

test('asyncRoute forwards rejections to the error handler', async () => {
  const { base, close } = await withServer(asyncRoute(async () => {
    throw Object.assign(new Error('nope'), { statusCode: 418 })
  }))
  try {
    const response = await fetch(`${base}/`)
    assert.equal(response.status, 418)
    assert.deepEqual(await response.json(), { error: 'nope' })
  } finally {
    await close()
  }
})
