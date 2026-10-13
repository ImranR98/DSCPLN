import test from 'node:test'
import assert from 'node:assert/strict'
import { colorFrom, formatBytes, formatDuration, formatNumber, humanAgo } from '../src/lib/format.js'

test('formatBytes scales and fixes decimals', () => {
  assert.equal(formatBytes(0), '0 B')
  assert.equal(formatBytes(1023), '1023 B')
  assert.equal(formatBytes(1024), '1.0 KiB')
  assert.equal(formatBytes(1536), '1.5 KiB')
  assert.equal(formatBytes(1024 ** 3), '1.0 GiB')
  assert.equal(formatBytes('nope'), '—')
})

test('formatDuration covers seconds, minutes and hours', () => {
  assert.equal(formatDuration(30), '30s')
  assert.equal(formatDuration(90), '2m')
  assert.equal(formatDuration(3600), '1h')
  assert.equal(formatDuration(5400), '1.5h')
  assert.equal(formatDuration(-1), '—')
  assert.equal(formatDuration(Number.NaN), '—')
})

test('humanAgo buckets by elapsed time', () => {
  const now = Date.now()
  assert.equal(humanAgo(now - 5_000), 'just now')
  assert.equal(humanAgo(now - 5 * 60_000), '5 min ago')
  assert.equal(humanAgo(now - 3 * 3_600_000), '3 hr ago')
  assert.equal(humanAgo(now - 2 * 86_400_000), '2 days ago')
  assert.equal(humanAgo(now - 90 * 86_400_000), '3 months ago')
  assert.equal(humanAgo(now - 400 * 86_400_000), '1 years ago')
  assert.equal(humanAgo('nope'), '—')
})

test('formatNumber formats and degrades gracefully', () => {
  assert.equal(formatNumber(1234.5, { useGrouping: false, maximumFractionDigits: 0 }), '1235')
  assert.equal(formatNumber(Number.POSITIVE_INFINITY), '—')
})

test('colorFrom is stable for a key and always picks from the palette', () => {
  const palette = ['a', 'b', 'c']
  const first = colorFrom(palette, 'EUR')
  assert.equal(colorFrom(palette, 'EUR'), first)
  assert.ok(palette.includes(colorFrom(palette, 'USD')))
})
