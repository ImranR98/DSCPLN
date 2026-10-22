// Lockdown configuration and request validation.
//
// The public app deliberately has no built-in host topology. Deployments mount
// a private config that defines the presets, ports and human-facing copy.

import crypto from 'node:crypto'
import fs from 'node:fs'

export const MIN_DURATION_SECONDS = 10 * 60
export const MAX_DURATION_SECONDS = 24 * 60 * 60

const ID_RE = /^[a-z0-9][a-z0-9-]{0,31}$/
const PROTOCOLS = new Set(['tcp', 'udp'])
const DIRECTIONS = new Set(['input', 'output'])

export const DEFAULT_CONFIG_PATH = process.env.LOCKDOWN_CONFIG || '/config/config.json'

export function validateConfig(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.presets)) {
    throw new Error('config.presets must be an array')
  }
  if (!raw.presets.length) throw new Error('config.presets must contain at least one preset')
  if (raw.presets.length > 24) throw new Error('config.presets must contain at most 24 presets')

  const ids = new Set()
  const presets = raw.presets.map((entry, index) => {
    if (!entry || typeof entry !== 'object') throw new Error(`presets[${index}] must be an object`)
    const id = String(entry.id ?? '').trim()
    if (!ID_RE.test(id)) throw new Error(`presets[${index}].id must match ${ID_RE}`)
    if (ids.has(id)) throw new Error(`duplicate preset id: ${id}`)
    ids.add(id)

    const label = String(entry.label ?? '').trim()
    if (!label) throw new Error(`presets[${index}].label is required`)
    const short = String(entry.short ?? label).trim()
    const confirmation = String(entry.confirmation ?? '').trim()
    if (!confirmation) throw new Error(`presets[${index}].confirmation is required`)
    if (confirmation.length > 64) throw new Error(`presets[${index}].confirmation is too long`)

    const protocol = String(entry.protocol ?? 'tcp').toLowerCase()
    if (!PROTOCOLS.has(protocol)) throw new Error(`presets[${index}].protocol must be tcp or udp`)
    const direction = String(entry.direction ?? 'input').toLowerCase()
    if (!DIRECTIONS.has(direction)) throw new Error(`presets[${index}].direction must be input or output`)

    if (!Array.isArray(entry.ports) || !entry.ports.length) {
      throw new Error(`presets[${index}].ports must be a non-empty array`)
    }
    if (entry.ports.length > 32) throw new Error(`presets[${index}].ports has too many entries`)
    const ports = entry.ports.map((port, portIndex) => {
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error(`presets[${index}].ports[${portIndex}] must be a TCP/UDP port`)
      }
      return port
    })
    if (new Set(ports).size !== ports.length) throw new Error(`presets[${index}].ports contains duplicates`)

    const allowIndefinite = Boolean(entry.allowIndefinite)
    let defaultDurationSeconds = entry.defaultDurationSeconds
    if (defaultDurationSeconds === undefined || defaultDurationSeconds === null) {
      defaultDurationSeconds = allowIndefinite ? 1800 : MIN_DURATION_SECONDS
    }
    if (!Number.isInteger(defaultDurationSeconds) ||
      defaultDurationSeconds < MIN_DURATION_SECONDS ||
      defaultDurationSeconds > MAX_DURATION_SECONDS) {
      throw new Error(`presets[${index}].defaultDurationSeconds must be between 10 minutes and 24 hours`)
    }

    return {
      id,
      label,
      short,
      protocol,
      direction,
      ports,
      allowIndefinite,
      defaultDurationSeconds,
      confirmation,
      danger: Boolean(entry.danger),
      effect: String(entry.effect ?? '').trim(),
      warning: String(entry.warning ?? '').trim(),
    }
  })

  return {
    presets,
    limits: { minDurationSeconds: MIN_DURATION_SECONDS, maxDurationSeconds: MAX_DURATION_SECONDS },
  }
}

export function loadConfig(file = DEFAULT_CONFIG_PATH) {
  let text
  try {
    text = fs.readFileSync(file, 'utf8')
  } catch (err) {
    throw new Error(`cannot read Lockdown config ${file}: ${err.message}`, { cause: err })
  }
  let raw
  try {
    raw = JSON.parse(text)
  } catch (err) {
    throw new Error(`invalid JSON in Lockdown config ${file}: ${err.message}`, { cause: err })
  }
  return addDerived(validateConfig(raw))
}

export function addDerived(config) {
  const hash = crypto.createHash('sha256').update(JSON.stringify(config.presets)).digest('hex').slice(0, 10)
  return {
    ...config,
    tableName: `dscpln_lockdown_${hash}`,
    presetMap: Object.fromEntries(config.presets.map((preset) => [preset.id, preset])),
  }
}

export function setNameFor(presetId) {
  return `p_${presetId.replaceAll('-', '_')}`
}

export function presetPortText(preset) {
  return preset.ports.map((port) => `${preset.protocol.toUpperCase()} ${port}`).join(', ')
}

export function validateBlockRequest(config, body = {}) {
  const preset = config.presetMap[String(body.preset ?? '')]
  if (!preset) throw new Error('unknown port preset')
  let durationSeconds = body.durationSeconds
  if (durationSeconds === null || durationSeconds === undefined) {
    if (!preset.allowIndefinite) throw new Error(`${preset.label} requires a duration`)
    durationSeconds = null
  } else {
    if (!Number.isInteger(durationSeconds)) throw new Error('duration must be an integer number of seconds')
    if (durationSeconds < MIN_DURATION_SECONDS) throw new Error('duration must be at least 10 minutes')
    if (durationSeconds > MAX_DURATION_SECONDS) throw new Error('duration cannot exceed 24 hours')
  }
  const confirmation = String(body.confirmation ?? '')
  if (confirmation !== preset.confirmation) {
    throw new Error(`confirmation must be "${preset.confirmation}"`)
  }
  return { preset: preset.id, durationSeconds, confirmation }
}

export function validateClearRequest(config, body = {}) {
  const preset = body.preset == null ? null : String(body.preset)
  if (preset !== null && !config.presetMap[preset]) throw new Error('unknown port preset')
  const confirmation = String(body.confirmation ?? '')
  if (confirmation !== 'CLEAR') throw new Error('confirmation must be "CLEAR"')
  return { preset, confirmation }
}

export function configForClient(config) {
  return {
    presets: config.presets,
    limits: config.limits,
  }
}
