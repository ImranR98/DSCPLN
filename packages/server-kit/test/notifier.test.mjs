import test from 'node:test'
import assert from 'node:assert/strict'
import { Notifier } from '../notifier.mjs'
import { clickFor } from '../scheduled-app.mjs'

const latin1Safe = (value) => Buffer.from(value, 'latin1').toString('latin1') === value

function mockFetch(t) {
  const calls = []
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    calls.push({ url, init })
    return { ok: true, status: 200 }
  })
  return calls
}

test('failure notifications are forced and carry a latin-1 safe title', async (t) => {
  const calls = mockFetch(t)
  const notifier = new Notifier({ ntfy: { url: 'http://ntfy.test/topic', token: 'tk', notifySuccess: false } })
  const result = await notifier.notifyResult({ ok: false, app: 'Contacts + Calendar', summary: 'Failed (exit 1)' })
  assert.equal(result.ok, true)
  assert.equal(calls.length, 1)
  const { headers, body } = calls[0].init
  assert.equal(headers.Title, 'D$CPLN - Contacts + Calendar FAILED')
  assert.ok(latin1Safe(headers.Title))
  assert.equal(headers.Priority, 'high')
  assert.equal(headers.Tags, 'warning')
  assert.equal(body, 'Failed (exit 1)')
})

test('success notifications are skipped unless notifySuccess is on', async (t) => {
  const calls = mockFetch(t)
  const quiet = new Notifier({ ntfy: { url: 'http://ntfy.test/topic', notifySuccess: false } })
  assert.deepEqual(await quiet.notifyResult({ ok: true, app: 'YTMusic', summary: 'Downloaded' }), { ok: true, skipped: true })
  assert.equal(calls.length, 0)

  const loud = new Notifier({ ntfy: { url: 'http://ntfy.test/topic', notifySuccess: true } })
  await loud.notifyResult({ ok: true, app: 'YTMusic', summary: 'Downloaded' })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].init.headers.Title, 'D$CPLN - YTMusic OK')
  assert.equal(calls[0].init.headers.Tags, 'white_check_mark')
})

test('non-ASCII characters in a custom title are sanitized instead of losing the notification', async (t) => {
  const calls = mockFetch(t)
  const notifier = new Notifier({ ntfy: { url: 'http://ntfy.test/topic' } })
  const result = await notifier.notify('hello', { title: 'status ✓ done \u22c5 \u00b7 é' })
  assert.equal(result.ok, true)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].init.headers.Title, 'status ? done ? ? ?')
  assert.ok(latin1Safe(calls[0].init.headers.Title))
})

test('missing or invalid URL is reported without throwing', async () => {
  const notifier = new Notifier({ ntfy: { url: '' } })
  assert.deepEqual(await notifier.notifyResult({ ok: false, app: 'X', summary: 'boom' }), {
    ok: false,
    error: 'notifications are not configured',
  })
  const invalid = new Notifier({ ntfy: { url: 'not-a-url' } })
  assert.deepEqual(await invalid.notify('boom', { force: true }), {
    ok: false,
    error: 'notification endpoint URL is invalid',
  })
})

test('relay mode posts one JSON payload to the portal instead of ntfy', async (t) => {
  const calls = mockFetch(t)
  const notifier = new Notifier({
    app: 'Contacts + Calendar',
    relayUrl: 'http://portal:8080/',
    notifySuccess: true,
    click: 'https://dscpln.example/contacts',
  })
  const result = await notifier.notify('Exported 3 collections', {
    title: 'D$CPLN - Contacts + Calendar OK',
    priority: 'default',
    tags: ['white_check_mark'],
  })
  assert.equal(result.ok, true)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, 'http://portal:8080/api/notify')
  assert.equal(calls[0].init.method, 'POST')
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    app: 'Contacts + Calendar',
    message: 'Exported 3 collections',
    title: 'D$CPLN - Contacts + Calendar OK',
    priority: 'default',
    tags: ['white_check_mark'],
    click: 'https://dscpln.example/contacts',
  })
})

test('relay errors surface the portal response without throwing', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => ({
    ok: false,
    status: 502,
    text: async () => 'ntfy returned 401',
  }))
  const notifier = new Notifier({ relayUrl: 'http://portal:8080' })
  assert.deepEqual(await notifier.notify('x'), {
    ok: false,
    error: 'notification relay returned 502: ntfy returned 401',
  })
})

test('relay mode still gates success notifications on notifySuccess', async (t) => {
  const calls = mockFetch(t)
  const quiet = new Notifier({ relayUrl: 'http://portal:8080', notifySuccess: false })
  assert.deepEqual(await quiet.notifyResult({ ok: true, app: 'YTMusic', summary: 'Downloaded' }), {
    ok: true,
    skipped: true,
  })
  assert.equal(calls.length, 0)

  await quiet.notifyResult({ ok: false, app: 'YTMusic', summary: 'Failed' })
  assert.equal(calls.length, 1)
  const payload = JSON.parse(calls[0].init.body)
  assert.equal(payload.title, 'D$CPLN - YTMusic FAILED')
  assert.deepEqual(payload.tags, ['warning'])
})

test('notifications carry a click-through to the app when configured', async (t) => {
  const calls = mockFetch(t)
  const notifier = new Notifier({
    ntfy: { url: 'http://ntfy.test/topic' },
    click: 'https://dscpln.example/contacts',
  })
  await notifier.notify('done', { title: 'x' })
  assert.equal(calls[0].init.headers.Click, 'https://dscpln.example/contacts')

  const relative = new Notifier({ ntfy: { url: 'http://ntfy.test/topic' }, click: '/contacts' })
  await relative.notify('done', { title: 'x' })
  assert.equal(calls[1].init.headers.Click, undefined)
})

test('clickFor builds the public app URL from origin and base path', () => {
  assert.equal(clickFor('/contacts', 'https://dscpln.example/'), 'https://dscpln.example/contacts')
  assert.equal(clickFor('/x/', 'https://dscpln.example//'), 'https://dscpln.example/x')
  assert.equal(clickFor('', 'https://dscpln.example'), 'https://dscpln.example')
  assert.equal(clickFor('/x', ''), '')
  assert.equal(clickFor('/x', 'not a url'), '')
  assert.equal(clickFor('/x', ''), '')
})
