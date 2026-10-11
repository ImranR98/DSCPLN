// Money formatting ported from the old kit: precision follows whether the
// currency needs sub-cent digits (e.g. XMR); the symbol comes from the
// workbook's currency symbols.

const formatters = new Map()

export function fractionDigits(value, significantDigits) {
  const absolute = Math.abs(value)
  if (!Number.isFinite(absolute) || absolute === 0) return 2
  return Math.min(12, Math.max(2, significantDigits - 1 - Math.floor(Math.log10(absolute))))
}

export function moneyFor(symbolFor = () => null) {
  return (value, code) => {
    const amount = Number.isFinite(value) ? value : 0
    const decimals = Math.abs(amount) < 1 ? fractionDigits(amount, 8) : 2
    let formatter = formatters.get(decimals)
    if (!formatter) {
      formatter = new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: decimals })
      formatters.set(decimals, formatter)
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

export function currencyColor(code) {
  if (!code) return null
  if (CURRENCY_COLORS[code]) return CURRENCY_COLORS[code]
  let hash = 0
  for (const char of String(code)) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return FALLBACK_COLORS[hash % FALLBACK_COLORS.length]
}
