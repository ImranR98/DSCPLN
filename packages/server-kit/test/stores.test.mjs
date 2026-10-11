import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { configStore } from '../config-store.mjs'
import { stateStore } from '../state-store.mjs'
import { ValidationError } from '../atomic.mjs'

const tmpFile = (name) => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'kit-test-')), name)

test('configStore: defaults, file creation, mode 0600', async () => {
  const file = tmpFile('config.json')
  const store = configStore(file, {
    defaults: { schedule: { enabled: true, at: '03:00' }, name: 'x' },
  })
  const cfg = await store.load()
  assert.equal(cfg.name, 'x')
  assert.equal(cfg.schedule.at, '03:00')
  const stat = await fsp.stat(file)
  assert.equal(stat.mode & 0o777, 0o600)
})

test('configStore: normalize/validate and change events', async () => {
  const file = tmpFile('config.json')
  const events = []
  const store = configStore(file, {
    defaults: { count: 0 },
    normalize: (raw) => ({ ...raw, count: Number(raw.count) }),
    validate: (cfg) => {
      if (cfg.count < 0) throw new ValidationError('count must be >= 0')
    },
  })
  store.onChange((cfg) => events.push(cfg.count))
  await store.load()
  await store.save({ count: '3' })
  assert.equal(store.get().count, 3)
  await assert.rejects(() => store.save({ count: -1 }), ValidationError)
  assert.equal(store.get().count, 3, 'invalid save leaves the old config')
  assert.deepEqual(events, [3], 'only successful saves emit')
})

test('configStore: update merges one level deep', async () => {
  const file = tmpFile('config.json')
  const store = configStore(file, { defaults: { schedule: { enabled: false, at: '04:00' } } })
  await store.load()
  await store.update({ schedule: { enabled: true } })
  assert.deepEqual(store.get().schedule, { enabled: true, at: '04:00' })
})

test('stateStore: records runs, bounds history, tracks schedule', async () => {
  const file = tmpFile('state.json')
  const store = stateStore(file, { historyLimit: 3 })
  await store.load()
  for (let i = 1; i <= 5; i++) {
    await store.recordRun({ ok: i % 2 === 0, summary: `run ${i}`, durationSec: i })
  }
  const snap = store.snapshot()
  assert.equal(snap.history.length, 3)
  assert.equal(snap.history[0].summary, 'run 5')
  assert.equal(snap.lastRun.summary, 'run 5')
  await store.setPaused(true)
  assert.equal(store.snapshot().paused, true)
  await store.markMissed()
  await store.markMissed()
  assert.equal(store.snapshot().missed, 2)
  await store.setLastScheduledRun(1234)
  assert.equal(store.lastScheduledRun(), 1234)

  const reloaded = stateStore(file)
  await reloaded.load()
  assert.equal(reloaded.snapshot().paused, true)
  assert.equal(reloaded.snapshot().lastRun.summary, 'run 5')
})
