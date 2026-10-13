import test from 'node:test'
import assert from 'node:assert/strict'
import { getPath, setPath } from '../src/lib/paths.js'

test('getPath walks dotted paths', () => {
  const object = { ntfy: { url: 'https://ntfy.test', topics: ['a'] } }
  assert.equal(getPath(object, 'ntfy.url'), 'https://ntfy.test')
  assert.deepEqual(getPath(object, 'ntfy.topics'), ['a'])
  assert.equal(getPath(object, 'ntfy.missing'), undefined)
  assert.equal(getPath(object, 'nope.deep.path'), undefined)
  assert.equal(getPath(null, 'a'), undefined)
})

test('setPath creates intermediate objects and returns the root', () => {
  const object = {}
  const result = setPath(object, 'ntfy.url', 'https://ntfy.test')
  assert.equal(result, object)
  assert.deepEqual(object, { ntfy: { url: 'https://ntfy.test' } })

  setPath(object, 'ntfy.url', 'https://other.test')
  assert.equal(object.ntfy.url, 'https://other.test')

  setPath(object, 'a.b.c', 1)
  assert.deepEqual(object.a, { b: { c: 1 } })
})
