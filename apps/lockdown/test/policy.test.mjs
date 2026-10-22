import test from 'node:test'
import assert from 'node:assert/strict'
import {
  MAX_DURATION_SECONDS,
  MIN_DURATION_SECONDS,
  PRESETS,
  validateBlockRequest,
  validateClearRequest,
} from '../policy.mjs'

test('presets expose only the intended host ports', () => {
  assert.deepEqual(PRESETS['vpn-only'].ports, [80, 8443])
  assert.deepEqual(PRESETS['traefik-off'].ports, [80, 443, 8443])
  assert.deepEqual(PRESETS['srv0-tunnel-cut'].ports, [51822])
})

test('vpn-only accepts an indefinite block', () => {
  assert.deepEqual(
    validateBlockRequest({ preset: 'vpn-only', durationSeconds: null, confirmation: 'BLOCK PUBLIC' }),
    { preset: 'vpn-only', durationSeconds: null, confirmation: 'BLOCK PUBLIC' },
  )
})

test('lockout presets reject indefinite blocks', () => {
  assert.throws(
    () => validateBlockRequest({ preset: 'traefik-off', durationSeconds: null, confirmation: 'CUT TRAEFIK' }),
    /requires a duration/,
  )
  assert.throws(
    () => validateBlockRequest({ preset: 'srv0-tunnel-cut', durationSeconds: null, confirmation: 'CUT TUNNEL' }),
    /requires a duration/,
  )
})

test('timed blocks are between 10 minutes and 24 hours', () => {
  assert.equal(
    validateBlockRequest({ preset: 'vpn-only', durationSeconds: MIN_DURATION_SECONDS, confirmation: 'BLOCK PUBLIC' }).durationSeconds,
    600,
  )
  assert.equal(
    validateBlockRequest({ preset: 'traefik-off', durationSeconds: MAX_DURATION_SECONDS, confirmation: 'CUT TRAEFIK' }).durationSeconds,
    86400,
  )
  assert.throws(
    () => validateBlockRequest({ preset: 'vpn-only', durationSeconds: 599, confirmation: 'BLOCK PUBLIC' }),
    /at least 10 minutes/,
  )
  assert.throws(
    () => validateBlockRequest({ preset: 'vpn-only', durationSeconds: 86401, confirmation: 'BLOCK PUBLIC' }),
    /cannot exceed 24 hours/,
  )
})

test('unknown presets and bad confirmations are rejected', () => {
  assert.throws(() => validateBlockRequest({ preset: '80', durationSeconds: 600, confirmation: 'x' }), /unknown port preset/)
  assert.throws(
    () => validateBlockRequest({ preset: 'vpn-only', durationSeconds: 600, confirmation: 'nope' }),
    /confirmation must be/,
  )
  assert.deepEqual(validateClearRequest({ confirmation: 'CLEAR' }), { preset: null, confirmation: 'CLEAR' })
  assert.throws(() => validateClearRequest({ preset: 'nope', confirmation: 'CLEAR' }), /unknown port preset/)
})
