import test from 'node:test'
import assert from 'node:assert/strict'
import {
  addDays,
  daysBetween,
  endOfMonth,
  parseIso,
  sameDay,
  startOfDay,
  startOfMonth,
  toIso,
} from '../src/lib/dates.js'

test('parseIso accepts real calendar dates and rejects invalid ones', () => {
  const date = parseIso('2026-02-28')
  assert.equal(date.getFullYear(), 2026)
  assert.equal(date.getMonth(), 1)
  assert.equal(date.getDate(), 28)
  assert.equal(parseIso('2026-02-30'), null)
  assert.equal(parseIso(''), null)
  assert.equal(parseIso(null), null)
})

test('toIso round-trips local dates with padding', () => {
  assert.equal(toIso(new Date(2026, 0, 5)), '2026-01-05')
  assert.equal(toIso(parseIso('2026-12-31')), '2026-12-31')
})

test('addDays crosses month and year boundaries', () => {
  assert.equal(toIso(addDays(new Date(2026, 0, 31), 1)), '2026-02-01')
  assert.equal(toIso(addDays(new Date(2025, 11, 31), 1)), '2026-01-01')
})

test('startOfMonth and endOfMonth honor leap years', () => {
  assert.equal(toIso(startOfMonth(new Date(2026, 5, 17))), '2026-06-01')
  assert.equal(toIso(endOfMonth(new Date(2024, 1, 10))), '2024-02-29')
  assert.equal(toIso(endOfMonth(new Date(2025, 1, 10))), '2025-02-28')
  assert.equal(toIso(startOfMonth(new Date(2026, 5, 17))), '2026-06-01')
})

test('sameDay and startOfDay compare local dates', () => {
  assert.equal(sameDay(new Date(2026, 3, 7, 1), new Date(2026, 3, 7, 23)), true)
  assert.equal(sameDay(new Date(2026, 3, 7), new Date(2026, 3, 8)), false)
  assert.equal(toIso(startOfDay(new Date(2026, 3, 7, 15, 30))), '2026-04-07')
})

test('daysBetween counts inclusively', () => {
  assert.equal(daysBetween(new Date(2026, 0, 1), new Date(2026, 0, 1)), 1)
  assert.equal(daysBetween(new Date(2026, 0, 1), new Date(2026, 0, 31)), 31)
  assert.equal(daysBetween(new Date(2024, 1, 1), new Date(2024, 2, 1)), 30)
})
