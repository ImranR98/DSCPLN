import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ApiError,
  apiUrl,
  getJson,
  postJson,
  putJson,
  deleteJson,
  ping,
  uploadFile,
} from '../src/lib/api.js'

const jsonResponse = (body, { status = 200, statusText = 'OK' } = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  statusText,
  text: async () => body,
})

const withFetch = async (impl, fn) => {
  const original = globalThis.fetch
  globalThis.fetch = impl
  try {
    return await fn()
  } finally {
    globalThis.fetch = original
  }
}

test('apiUrl resolves against the document base, absolute URLs pass through', () => {
  assert.equal(apiUrl(), '/')
  assert.equal(apiUrl('data'), '/data')
  assert.equal(apiUrl('/data'), '/data')
  assert.equal(apiUrl('https://example.test/x'), 'https://example.test/x')
  assert.equal(apiUrl('//example.test/x'), '//example.test/x')

  globalThis.document = { baseURI: 'http://example.test/tasks/' }
  try {
    assert.equal(apiUrl('data'), 'http://example.test/tasks/data')
    assert.equal(apiUrl('/data'), 'http://example.test/tasks/data')
  } finally {
    delete globalThis.document
  }
})

test('ApiError carries the status and the name', () => {
  const error = new ApiError('nope', 409)
  assert.ok(error instanceof Error)
  assert.equal(error.name, 'ApiError')
  assert.equal(error.message, 'nope')
  assert.equal(error.status, 409)
  assert.equal(new ApiError('x').status, 0)
})

test('getJson parses JSON and empty bodies', async () => {
  await withFetch(async () => jsonResponse('{"a":1}'), async () => {
    assert.deepEqual(await getJson('/data'), { a: 1 })
  })
  await withFetch(async () => jsonResponse(''), async () => {
    assert.equal(await getJson('/data'), null)
  })
})

test('getJson throws ApiError with the server message', async () => {
  await withFetch(async () => jsonResponse('{"error":"bad request"}', { status: 400, statusText: 'Bad Request' }), async () => {
    await assert.rejects(getJson('/data'), (error) => error instanceof ApiError && error.status === 400 && error.message === 'bad request')
  })
  await withFetch(async () => jsonResponse('plain failure', { status: 500, statusText: 'Internal Server Error' }), async () => {
    await assert.rejects(getJson('/data'), (error) => error.status === 500 && error.message === 'plain failure')
  })
  await withFetch(async () => jsonResponse('', { status: 409, statusText: 'Conflict' }), async () => {
    await assert.rejects(getJson('/data'), (error) => error.status === 409 && error.message === '409 Conflict')
  })
})

test('postJson/putJson/deleteJson send the right method, body and headers', async () => {
  const calls = []
  await withFetch(async (url, options) => {
    calls.push({ url, options })
    return jsonResponse('{"ok":true}')
  }, async () => {
    await postJson('/save', { a: 1 })
    await putJson('/save', { b: 2 })
    await deleteJson('/save')
  })

  assert.equal(calls[0].url, '/save')
  assert.equal(calls[0].options.method, 'POST')
  assert.equal(calls[0].options.headers['Content-Type'], 'application/json')
  assert.equal(calls[0].options.body, '{"a":1}')
  assert.ok(calls[0].options.signal instanceof AbortSignal)

  assert.equal(calls[1].options.method, 'PUT')
  assert.equal(calls[1].options.body, '{"b":2}')

  assert.equal(calls[2].options.method, 'DELETE')
  assert.equal(calls[2].options.headers, undefined)
  assert.equal(calls[2].options.body, undefined)
})

test('ping reports reachability', async () => {
  await withFetch(async () => jsonResponse('', { status: 200 }), async () => {
    assert.equal(await ping('/health'), true)
  })
  await withFetch(async () => {
    throw new Error('connection refused')
  }, async () => {
    assert.equal(await ping('/health'), false)
  })
})

class FakeXHR {
  static instances = []

  constructor() {
    this.upload = {}
    FakeXHR.instances.push(this)
  }

  open(method, url) {
    this.method = method
    this.url = url
  }

  send(file) {
    this.sent = file
  }

  abort() {
    this.onabort?.()
  }
}

test('uploadFile reports progress and resolves the parsed body', async () => {
  const original = globalThis.XMLHttpRequest
  globalThis.XMLHttpRequest = FakeXHR
  FakeXHR.instances = []
  const progress = []
  try {
    const promise = uploadFile('/upload', { name: 'a.txt' }, { onProgress: (fraction) => progress.push(fraction) })
    const xhr = FakeXHR.instances[0]
    assert.equal(xhr.method, 'POST')
    assert.equal(xhr.url, '/upload')

    xhr.upload.onprogress({ lengthComputable: true, loaded: 5, total: 10 })
    xhr.upload.onprogress({ lengthComputable: false, loaded: 5, total: 10 })
    xhr.status = 200
    xhr.responseText = '{"stored":true}'
    xhr.onload()
    assert.deepEqual(await promise, { stored: true })
    assert.deepEqual(progress, [0.5])
  } finally {
    globalThis.XMLHttpRequest = original
  }
})

test('uploadFile rejects with the server error', async () => {
  const original = globalThis.XMLHttpRequest
  globalThis.XMLHttpRequest = FakeXHR
  FakeXHR.instances = []
  try {
    const promise = uploadFile('/upload', { name: 'a.txt' })
    const xhr = FakeXHR.instances[0]
    xhr.status = 413
    xhr.responseText = '{"error":"too large"}'
    xhr.onload()
    await assert.rejects(promise, (error) => error instanceof ApiError && error.status === 413 && error.message === 'too large')
  } finally {
    globalThis.XMLHttpRequest = original
  }
})

test('uploadFile.abort() rejects with a cancelled error', async () => {
  const original = globalThis.XMLHttpRequest
  globalThis.XMLHttpRequest = FakeXHR
  FakeXHR.instances = []
  try {
    const promise = uploadFile('/upload', { name: 'a.txt' })
    assert.equal(typeof promise.abort, 'function')
    promise.abort()
    await assert.rejects(promise, (error) => error instanceof ApiError && error.message === 'Upload cancelled')
  } finally {
    globalThis.XMLHttpRequest = original
  }
})
