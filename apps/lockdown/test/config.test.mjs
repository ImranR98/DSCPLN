import test from 'node:test'
import assert from 'node:assert/strict'
import {
  MAX_DURATION_SECONDS,
  MIN_DURATION_SECONDS,
  addDerived,
  validateBlockRequest,
  validateClearRequest,
  validateConfig,
} from '../config.mjs'

const raw = {
  presets: [
    {
      id: 'public-web',
      label: 'Public web',
      short: 'Block public web ports',
      protocol: 'tcp',
      direction: 'input',
      ports: [80, 8443],
      allowIndefinite: true,
      defaultDurationSeconds: 1800,
      confirmation: 'BLOCK PUBLIC',
      effect: 'Blocks public web ports.',
      warning: 'You may lose this page.',
    },
    {
      id: 'uplink-cut',
      label: 'Uplink cut',
      protocol: 'udp',
      direction: 'output',
      ports: [51820],
      allowIndefinite: false,
      defaultDurationSeconds: 600,
      confirmation: 'CUT UPLINK',
    },
  ],
}

test('config validates and derives stable preset metadata', () => {
  const config = addDerived(validateConfig(raw))
  assert.deepEqual(config.presets[0].ports, [80, 8443])
  assert.equal(config.presets[0].protocol, 'tcp')
  assert.equal(config.presets[1].direction, 'output')
  assert.equal(config.presets[0].allowIndefinite, true)
  assert.match(config.tableName, /^dscpln_lockdown_[0-9a-f]{10}$/)
  assert.match(addDerived(validateConfig(raw)).tableName, /^dscpln_lockdown_/)
})

test('vpn-style indefinite blocks are allowed only when configured', () => {
  const config = addDerived(validateConfig(raw))
  assert.deepEqual(
    validateBlockRequest(config, { preset: 'public-web', durationSeconds: null, confirmation: 'BLOCK PUBLIC' }),
    { preset: 'public-web', durationSeconds: null, confirmation: 'BLOCK PUBLIC' },
  )
  assert.throws(
    () => validateBlockRequest(config, { preset: 'uplink-cut', durationSeconds: null, confirmation: 'CUT UPLINK' }),
    /requires a duration/,
  )
})

test('timed blocks are between 10 minutes and 24 hours', () => {
  const config = addDerived(validateConfig(raw))
  assert.equal(
    validateBlockRequest(config, {
      preset: 'public-web',
      durationSeconds: MIN_DURATION_SECONDS,
      confirmation: 'BLOCK PUBLIC',
    }).durationSeconds,
    600,
  )
  assert.equal(
    validateBlockRequest(config, {
      preset: 'public-web',
      durationSeconds: MAX_DURATION_SECONDS,
      confirmation: 'BLOCK PUBLIC',
    }).durationSeconds,
    86400,
  )
  assert.throws(
    () => validateBlockRequest(config, { preset: 'public-web', durationSeconds: 599, confirmation: 'BLOCK PUBLIC' }),
    /at least 10 minutes/,
  )
  assert.throws(
    () => validateBlockRequest(config, { preset: 'public-web', durationSeconds: 86401, confirmation: 'BLOCK PUBLIC' }),
    /cannot exceed 24 hours/,
  )
})

test('unknown presets and bad confirmations are rejected', () => {
  const config = addDerived(validateConfig(raw))
  assert.throws(() => validateBlockRequest(config, { preset: '80', durationSeconds: 600, confirmation: 'x' }), /unknown port preset/)
  assert.throws(
    () => validateBlockRequest(config, { preset: 'public-web', durationSeconds: 600, confirmation: 'nope' }),
    /confirmation must be/,
  )
  assert.deepEqual(validateClearRequest(config, { confirmation: 'CLEAR' }), { preset: null, confirmation: 'CLEAR' })
  assert.throws(() => validateClearRequest(config, { preset: 'nope', confirmation: 'CLEAR' }), /unknown port preset/)
})

test('duplicate ids, bad ports and bad durations are rejected', () => {
  assert.throws(() => validateConfig({ presets: [raw.presets[0], raw.presets[0]] }), /duplicate preset id/)
  assert.throws(() => validateConfig({ presets: [{ ...raw.presets[0], ports: [0] }] }), /TCP\/UDP port/)
  assert.throws(() => validateConfig({ presets: [{ ...raw.presets[0], ports: [80, 80] }] }), /contains duplicates/)
  assert.throws(() => validateConfig({ presets: [{ ...raw.presets[0], defaultDurationSeconds: 1 }] }), /between 10 minutes and 24 hours/)
  assert.throws(() => validateConfig({ presets: [] }), /at least one preset/)
})
