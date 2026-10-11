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
  assert.equal(headers.Title, 'D$CPLN · Contacts + Calendar FAILED')
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
  assert.equal(calls[0].init.headers.Title, 'D$CPLN · YTMusic OK')
  assert.equal(calls[0].init.headers.Tags, 'white_check_mark')
})

test('non-latin-1 characters in a custom title are sanitized instead of losing the notification', async (t) => {
  const calls = mockFetch(t)
  const notifier = new Notifier({ ntfy: { url: 'http://ntfy.test/topic' } })
  const result = await notifier.notify('hello', { title: 'status ✓ done \u22c5' })
  assert.equal(result.ok, true)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].init.headers.Title, 'status ? done ?')
  assert.ok(latin1Safe(calls[0].init.headers.Title))
})

test('missing or invalid URL is reported without throwing', async () => {
  const notifier = new Notifier({ ntfy: { url: '' } })
  assert.deepEqual(await notifier.notifyResult({ ok: false, app: 'X', summary: 'boom' }), {
    ok: false,
    error: 'ntfy URL not configured',
  })
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
