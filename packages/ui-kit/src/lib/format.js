// Display formatters shared by every app. Times are local; "—" stands in for
// missing values so tables and tiles never render undefined.

export const formats = {
  monthShort: new Intl.DateTimeFormat(undefined, { month: 'short' }),
  monthYear: new Intl.DateTimeFormat(undefined, { month: 'short', year: 'numeric' }),
  monthName: new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }),
  weekday: new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' }),
  dayMonth: new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }),
  time: new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }),
  year: new Intl.DateTimeFormat(undefined, { year: 'numeric' }),
  compact: new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }),
}

// Stable color for a key (used for currency/category chips and charts).
export function colorFrom(palette, key) {
  let hash = 0
  for (const char of String(key)) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return palette[hash % palette.length]
}

const timeFormat = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit' })
const dateTimeFormat = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
const dateFormat = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' })

export const formatTime = (ms) => (Number.isFinite(ms) ? timeFormat.format(new Date(ms)) : '—')
export const formatDateTime = (ms) => (Number.isFinite(ms) ? dateTimeFormat.format(new Date(ms)) : '—')
export const formatDate = (ms) => (Number.isFinite(ms) ? dateFormat.format(new Date(ms)) : '—')

export function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '—'
  if (seconds < 60) return `${Math.round(seconds)}s`
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`
  return `${(seconds / 3600).toFixed(seconds % 3600 === 0 ? 0 : 1)}h`
}

const BYTE_UNITS = ['B', 'KiB', 'MiB', 'GiB', 'TiB']

export function formatBytes(value) {
  let n = Number(value)
  if (!Number.isFinite(n)) return '—'
  let i = 0
  while (n >= 1024 && i < BYTE_UNITS.length - 1) {
    n /= 1024
    i += 1
  }
  return `${n.toFixed(i === 0 ? 0 : 1)} ${BYTE_UNITS[i]}`
}

export function humanAgo(ms) {
  const delta = (Date.now() - Number(ms)) / 1000
  if (!Number.isFinite(delta)) return '—'
  if (delta < 60) return 'just now'
  const ago = (value, one, many) => `${value} ${value === 1 ? one : many} ago`
  if (delta < 3600) return ago(Math.floor(delta / 60), 'min', 'min')
  if (delta < 86400) return ago(Math.floor(delta / 3600), 'hr', 'hr')
  if (delta < 30 * 86400) return ago(Math.floor(delta / 86400), 'day', 'days')
  if (delta < 365 * 86400) return ago(Math.floor(delta / (30 * 86400)), 'month', 'months')
  return ago(Math.floor(delta / (365 * 86400)), 'year', 'years')
}

export function formatNumber(value, options) {
  const n = Number(value)
  if (!Number.isFinite(n)) return '—'
  return new Intl.NumberFormat(undefined, options).format(n)
}
