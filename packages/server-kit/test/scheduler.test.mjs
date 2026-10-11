import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeSpec, occurrenceAfter, occurrenceBefore, parseAt, Scheduler } from '../scheduler.mjs'

const at = (y, m, d, hh, mm = 0) => new Date(y, m - 1, d, hh, mm, 0, 0)

test('parseAt accepts HH:MM and rejects junk', () => {
  assert.deepEqual(parseAt('03:05'), { hours: 3, minutes: 5 })
  assert.deepEqual(parseAt('23:59'), { hours: 23, minutes: 59 })
  assert.equal(parseAt('24:00'), null)
  assert.equal(parseAt('nope'), null)
  assert.equal(parseAt(null), null)
})

test('normalizeSpec cleans days and formats at', () => {
  const spec = normalizeSpec({ enabled: 1, days: [3, 1, 3, 9, -1], at: '7:05', catchUp: false })
  assert.deepEqual(spec, { enabled: true, days: [1, 3], at: '07:05', catchUp: false })
  assert.deepEqual(normalizeSpec({ at: '03:00' }).days, [])
})

test('daily occurrences', () => {
  const spec = { at: '03:00', days: [] }
  assert.equal(occurrenceBefore(spec, at(2026, 1, 10, 2, 59)), at(2026, 1, 9, 3).getTime())
  assert.equal(occurrenceBefore(spec, at(2026, 1, 10, 3, 0)), at(2026, 1, 10, 3).getTime())
  assert.equal(occurrenceAfter(spec, at(2026, 1, 10, 3, 0)), at(2026, 1, 11, 3).getTime())
  assert.equal(occurrenceAfter(spec, at(2026, 1, 10, 2, 59)), at(2026, 1, 10, 3).getTime())
})

test('weekday-restricted occurrences', () => {
  // 2026-01-10 is a Saturday; 2026-01-11 Sunday (day 0)
  const spec = { at: '04:00', days: [0] }
  assert.equal(occurrenceBefore(spec, at(2026, 1, 10, 12)), at(2026, 1, 4, 4).getTime())
  assert.equal(occurrenceAfter(spec, at(2026, 1, 10, 12)), at(2026, 1, 11, 4).getTime())
  assert.equal(occurrenceBefore(spec, at(2026, 1, 11, 4)), at(2026, 1, 11, 4).getTime())
})

test('scheduler: no fire on first tick, fires once at the occurrence', async () => {
  let current = at(2026, 1, 10, 8, 0)
  const fired = []
  const scheduler = new Scheduler({
    getSpec: () => ({ enabled: true, at: '03:00', days: [], catchUp: true }),
    onDue: (ts) => fired.push(ts),
    now: () => current.getTime(),
  })
  await scheduler.tick()
  assert.equal(fired.length, 0, 'first tick adopts latest occurrence')

  current = at(2026, 1, 11, 2, 59)
  await scheduler.tick()
  assert.equal(fired.length, 0)

  current = at(2026, 1, 11, 3, 1)
  await scheduler.tick()
  assert.equal(fired.length, 1)
  assert.equal(fired[0], at(2026, 1, 11, 3).getTime())

  current = at(2026, 1, 11, 3, 30)
  await scheduler.tick()
  assert.equal(fired.length, 1, 'same occurrence does not fire twice')
})

test('scheduler: busy run marks the occurrence missed', async () => {
  let current = at(2026, 1, 10, 8, 0)
  const fired = []
  const missed = []
  const scheduler = new Scheduler({
    getSpec: () => ({ enabled: true, at: '03:00', days: [], catchUp: true }),
    onDue: (ts) => fired.push(ts),
    onMissed: (ts) => missed.push(ts),
    isBusy: () => true,
    now: () => current.getTime(),
  })
  await scheduler.tick()
  current = at(2026, 1, 11, 3, 1)
  await scheduler.tick()
  assert.equal(fired.length, 0)
  assert.deepEqual(missed, [at(2026, 1, 11, 3).getTime()])
  current = at(2026, 1, 12, 3, 1)
  await scheduler.tick()
  assert.deepEqual(missed, [at(2026, 1, 11, 3).getTime(), at(2026, 1, 12, 3).getTime()])
})

test('scheduler: catch-up after downtime, no catch-up when disabled', async () => {
  const store = {
    value: at(2026, 1, 10, 3).getTime(),
    lastScheduledRun() { return this.value },
    async setLastScheduledRun(ts) { this.value = ts },
  }
  const fired = []
  const scheduler = new Scheduler({
    getSpec: () => ({ enabled: true, at: '03:00', days: [], catchUp: true }),
    onDue: (ts) => fired.push(ts),
    now: () => at(2026, 1, 13, 9, 0).getTime(),
    store,
  })
  await scheduler.tick()
  assert.deepEqual(fired, [at(2026, 1, 13, 3).getTime()])
  assert.equal(store.value, at(2026, 1, 13, 3).getTime())

  const staleFired = []
  const noCatchUp = new Scheduler({
    getSpec: () => ({ enabled: true, at: '03:00', days: [], catchUp: false }),
    onDue: (ts) => staleFired.push(ts),
    now: () => at(2026, 1, 20, 9, 0).getTime(),
    store: {
      value: at(2026, 1, 10, 3).getTime(),
      lastScheduledRun() { return this.value },
      async setLastScheduledRun(ts) { this.value = ts },
    },
  })
  await noCatchUp.tick()
  assert.equal(staleFired.length, 0, 'old occurrence without catchUp is skipped')
})

test('scheduler: nextRunAt follows the spec', () => {
  const scheduler = new Scheduler({
    getSpec: () => ({ enabled: true, at: '05:00', days: [] }),
    onDue: () => {},
    now: () => at(2026, 1, 10, 6, 0).getTime(),
  })
  assert.equal(scheduler.nextRunAt(), at(2026, 1, 11, 5).getTime())
  const disabled = new Scheduler({
    getSpec: () => ({ enabled: false, at: '05:00', days: [] }),
    onDue: () => {},
    now: () => at(2026, 1, 10, 6, 0).getTime(),
  })
  assert.equal(disabled.nextRunAt(), null)
})
