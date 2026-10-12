// Money helpers ported from the old balance UI (DSCPLN core): number parsing,
// floating-point cleaning, precision-aware money formatting and stable
// per-currency accent colors.

const moneyFormatters = new Map()

export const number = (value) => {
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : 0
}

// Trims floating point noise without forcing a fixed number of decimals.
export const clean = (value) => Number.parseFloat(Number(value).toPrecision(12))

// Enough decimals to keep `significantDigits` significant, at least 2 and
// at most 12, without excessive trailing zeros.
export function fractionDigits(value, significantDigits) {
  const absolute = Math.abs(value)
  if (!Number.isFinite(absolute) || absolute === 0) return 2
  return Math.min(12, Math.max(2, significantDigits - 1 - Math.floor(Math.log10(absolute))))
}

// Returns a `money(value, code)` formatter whose precision follows whether
// the currency needs sub-cent digits (e.g. XMR). `symbolFor` supplies the
// currency's symbol; currencies without one render with no prefix (their
// code is shown elsewhere in the UI).
export function moneyFor(isFractional = () => false, symbolFor = () => null) {
  return (value, code) => {
    const amount = Number.isFinite(value) ? value : 0
    const decimals = isFractional(code)
      ? fractionDigits(amount, 12)
      : Math.abs(amount) < 1
        ? fractionDigits(amount, 8)
        : 2
    let formatter = moneyFormatters.get(decimals)
    if (!formatter) {
      formatter = new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: decimals })
      moneyFormatters.set(decimals, formatter)
    }
    const symbol = (code && symbolFor(code)) || ''
    return `${amount < 0 ? '−' : ''}${symbol}${formatter.format(Math.abs(amount))}`
  }
}

const CURRENCY_COLORS = {
  CAD: '#dc2626',
  USD: '#16a34a',
  GBP: '#2563eb',
  TZS: '#d4a017',
  XMR: '#ea7a1a',
}
const FALLBACK_COLORS = ['#7c3aed', '#0891b2', '#db2777', '#65a30d', '#9333ea', '#0d9488', '#f59e0b', '#4f46e5']

// Stable accent per currency (known codes get hand-picked colors).
export function currencyColor(code) {
  if (!code) return null
  if (CURRENCY_COLORS[code]) return CURRENCY_COLORS[code]
  let hash = 0
  for (const char of String(code)) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return FALLBACK_COLORS[hash % FALLBACK_COLORS.length]
}
