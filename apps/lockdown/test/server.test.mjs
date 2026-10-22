import test from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createLockdownApp } from '../server.mjs'

const presets = [
  {
    id: 'public-web',
    label: 'Public web',
    short: 'Block public web ports',
    protocol: 'tcp',
    direction: 'input',
    ports: [80, 8443],
    allowIndefinite: true,
    defaultDurationSeconds: 1800,
    confirmation: 'BLOCK PUBLIC',
    danger: false,
    effect: 'Blocks public web ports.',
    warning: 'You may lose this page.',
  },
  {
    id: 'uplink-cut',
    label: 'Uplink cut',
    protocol: 'udp',
    direction: 'output',
    ports: [51820],
    allowIndefinite: false,
    defaultDurationSeconds: 600,
    confirmation: 'CUT UPLINK',
    danger: true,
    effect: 'Blocks the uplink.',
    warning: 'Remote access may stop.',
  },
]

async function fixture(t) {
  const calls = []
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, init })
    const status = {
      ok: true,
      now: 1_700_000_000_000,
      table: { name: 'dscpln_lockdown_test' },
      presets: {
        'public-web': { active: false, ports: [], expiresAt: null, remainingSeconds: null },
        'uplink-cut': { active: false, ports: [], expiresAt: null, remainingSeconds: null },
      },
      pending: {},
      limits: { minDurationSeconds: 600, maxDurationSeconds: 86400 },
    }
    return {
      ok: true,
      status: 200,
      async text() {
        return JSON.stringify(status)
      },
    }
  }
  const app = createLockdownApp({
    auth: null,
    presets,
    blockerUrl: 'http://blocker.test',
    blockerToken: 'test-token',
    fetchImpl,
    log: () => {},
  }).app
  const server = app.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => new Promise((resolve) => server.close(resolve)))
  return { base: `http://127.0.0.1:${server.address().port}`, calls }
}

const post = (base, path, body) => fetch(`${base}${path}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

test('status merges config metadata with blocker state', async (t) => {
  const { base, calls } = await fixture(t)
  const response = await fetch(`${base}/api/status`)
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(body.presets.length, 2)
  assert.equal(body.presets[0].label, 'Public web')
  assert.equal(body.presets[0].active, false)
  assert.equal(body.limits.maxDurationSeconds, 86400)
  assert.equal(calls[0].url, 'http://blocker.test/v1/status')
  assert.equal(calls[0].init.headers.Authorization, 'Bearer test-token')
})

test('block requires an allowed preset, confirmation and duration', async (t) => {
  const { base, calls } = await fixture(t)

  const badConfirmation = await post(base, '/api/block', {
    preset: 'public-web',
    durationSeconds: 600,
    confirmation: 'nope',
  })
  assert.equal(badConfirmation.status, 400)

  const badDuration = await post(base, '/api/block', {
    preset: 'uplink-cut',
    durationSeconds: 599,
    confirmation: 'CUT UPLINK',
  })
  assert.equal(badDuration.status, 400)

  const ok = await post(base, '/api/block', {
    preset: 'public-web',
    durationSeconds: null,
    confirmation: 'BLOCK PUBLIC',
  })
  assert.equal(ok.status, 202)
  assert.equal(calls.length, 1)
  const sent = JSON.parse(calls[0].init.body)
  assert.deepEqual(sent, {
    preset: 'public-web',
    durationSeconds: null,
    confirmation: 'BLOCK PUBLIC',
    delaySeconds: 3,
  })
})

test('clear proxies a confirmed clear request', async (t) => {
  const { base, calls } = await fixture(t)
  const response = await post(base, '/api/clear', { confirmation: 'CLEAR' })
  assert.equal(response.status, 200)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, 'http://blocker.test/v1/clear')
  assert.deepEqual(JSON.parse(calls[0].init.body), { preset: null, confirmation: 'CLEAR' })
})
