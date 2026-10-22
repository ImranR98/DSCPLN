// Lockdown presets and request validation. Keep this module free of host
// access so the UI server and the privileged blocker share the same policy.

export const MIN_DURATION_SECONDS = 10 * 60
export const MAX_DURATION_SECONDS = 24 * 60 * 60

export const PRESETS = {
  'vpn-only': {
    id: 'vpn-only',
    label: 'VPN-only',
    short: 'Block public ports',
    ports: [80, 8443],
    protocol: 'tcp',
    allowIndefinite: true,
    confirmation: 'BLOCK PUBLIC',
    effect: 'Stops public HTTP and HTTPS access through vps0. TCP 443 remains available over VPN and LAN.',
    warning: 'If you are using the public path, this page will disconnect. Reconnect over VPN or LAN to undo it.',
  },
  'traefik-off': {
    id: 'traefik-off',
    label: 'Cut Traefik',
    short: 'Block all Traefik ingress',
    ports: [80, 443, 8443],
    protocol: 'tcp',
    allowIndefinite: false,
    confirmation: 'CUT TRAEFIK',
    effect: 'Stops all Traefik ingress on srv0, including this page over VPN and LAN.',
    warning: 'You cannot undo this remotely. The timer is the only recovery path unless srv0 reboots.',
  },
  'srv0-tunnel-cut': {
    id: 'srv0-tunnel-cut',
    label: 'Cut srv0 tunnel',
    short: 'Block the public-exposure tunnel',
    ports: [51822],
    protocol: 'udp',
    allowIndefinite: false,
    confirmation: 'CUT TUNNEL',
    effect: 'Blocks srv0 from reaching the vps0 public-exposure hub, which also carries the VPN endpoint.',
    warning: 'Public and VPN access to srv0 will stop. This page remains reachable only from the LAN until the timer expires.',
  },
}

export const PRESET_IDS = Object.freeze(Object.keys(PRESETS))

export function isInteger(value) {
  return Number.isInteger(value) && Number.isFinite(value)
}

export function validateDuration(preset, durationSeconds) {
  if (durationSeconds === null || durationSeconds === undefined) {
    if (!PRESETS[preset].allowIndefinite) {
      throw new Error(`${PRESETS[preset].label} requires a duration`)
    }
    return null
  }
  if (!isInteger(durationSeconds)) throw new Error('duration must be an integer number of seconds')
  if (durationSeconds < MIN_DURATION_SECONDS) throw new Error('duration must be at least 10 minutes')
  if (durationSeconds > MAX_DURATION_SECONDS) throw new Error('duration cannot exceed 24 hours')
  return durationSeconds
}

export function validateBlockRequest(body = {}) {
  const preset = String(body.preset ?? '')
  if (!PRESETS[preset]) throw new Error('unknown port preset')
  const durationSeconds = validateDuration(preset, body.durationSeconds)
  const confirmation = String(body.confirmation ?? '')
  if (confirmation !== PRESETS[preset].confirmation) {
    throw new Error(`confirmation must be "${PRESETS[preset].confirmation}"`)
  }
  return { preset, durationSeconds, confirmation }
}

export function validateClearRequest(body = {}) {
  const preset = body.preset == null ? null : String(body.preset)
  if (preset !== null && !PRESETS[preset]) throw new Error('unknown port preset')
  const confirmation = String(body.confirmation ?? '')
  if (confirmation !== 'CLEAR') throw new Error('confirmation must be "CLEAR"')
  return { preset, confirmation }
}

export function presetPorts(preset) {
  return PRESETS[preset]?.ports ?? []
}

export function formatDuration(seconds) {
  if (seconds === null || seconds === undefined) return 'until cleared'
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`
  const hours = seconds / 3600
  return `${Number.isInteger(hours) ? hours : hours.toFixed(1)} hr`
}
