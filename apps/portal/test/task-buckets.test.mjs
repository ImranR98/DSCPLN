import assert from 'node:assert/strict'
import test from 'node:test'
import { TASK_STALE_MS, taskBucket } from '../ui/src/taskBuckets.js'

const DAY_MS = 24 * 60 * 60 * 1000
const NOW = Date.UTC(2026, 9, 20, 12)
const ts = (ms) => ms / 1000

test('task buckets use the 7-day threshold and put errors first', () => {
  assert.equal(taskBucket({ name: 'recent', state: { ok: true, ts: ts(NOW - DAY_MS) } }, NOW).key, 'recent')
  assert.equal(taskBucket({ name: 'stale', state: { ok: true, ts: ts(NOW - TASK_STALE_MS) } }, NOW).key, 'stale')
  assert.equal(taskBucket({ name: 'never', state: null, running: false }, NOW).key, 'stale')
  assert.equal(taskBucket({ name: 'running', state: null, running: true }, NOW).key, 'recent')
  assert.equal(taskBucket({ name: 'failed', state: { ok: false, ts: ts(NOW - DAY_MS) } }, NOW).key, 'errors')
  assert.equal(taskBucket({ name: 'old failed', state: { ok: false, ts: ts(NOW - 8 * DAY_MS) } }, NOW).key, 'errors')
})
