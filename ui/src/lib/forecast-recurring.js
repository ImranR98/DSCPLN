// Recurring-transaction detection and scheduling for the Forecasts page.
// Pure functions: group historical transactions by a normalized merchant key,
// infer a cadence, and generate future occurrence dates. Detected items are
// advisory; the scenario sheet only stores user adjustments.

import { addDays, parseIsoDate, startOfMonth, toIsoDate } from './insights-math.js'

const MONTH_NAMES = new Set([
  'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december',
  'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sep', 'sept', 'oct', 'nov', 'dec',
])
const WEEKDAY_NAMES = new Set(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'])

const DAY_MS = 24 * 60 * 60 * 1000

const dayDiff = (a, b) => Math.round((b - a) / DAY_MS)

const addMonthsClamped = (date, months) => {
  const target = new Date(date.getFullYear(), date.getMonth() + months, 1)
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate()
  return new Date(target.getFullYear(), target.getMonth(), Math.min(date.getDate(), lastDay))
}

const monthKey = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`

const cleanNumber = (value) => Number.parseFloat(Number(value).toPrecision(12))

const median = (values) => {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

const mean = (values) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0

const stddev = (values) => {
  if (values.length < 2) return 0
  const average = mean(values)
  return Math.sqrt(values.reduce((sum, value) => sum + (value - average) ** 2, 0) / values.length)
}

const coefficientOfVariation = (values) => {
  const average = mean(values)
  return average > 0 ? stddev(values) / average : 0
}

export const normalizeRecurringDetails = (details) => {
  let text = String(details == null ? '' : details)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
  text = text.replace(/\b(?:19|20)\d{2}[-/.]\d{1,2}(?:[-/.]\d{1,2})?\b/g, ' ')
  text = text.replace(/\b(?:19|20)\d{2}\b/g, ' ')
  text = text.replace(/\b\d{1,2}[/.-]\d{1,2}(?:[/.-]\d{2,4})?\b/g, ' ')
  text = text.replace(/\b\d{1,2}:\d{2}(?::\d{2})?\b/g, ' ')
  text = text.replace(/\b\d{3,}\b/g, ' ')
  text = text.replace(/\b[a-z0-9]+\b/g, (token) => (
    MONTH_NAMES.has(token) || WEEKDAY_NAMES.has(token) ? ' ' : token
  ))
  return text.replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim()
}

export const recurringKey = ({ kind, category, details }) => {
  const normalized = normalizeRecurringDetails(details) || normalizeRecurringDetails(category)
  return `${kind}|${category}|${normalized}`
}

const CADENCE_FACTOR = {
  weekly: 52 / 12,
  biweekly: 26 / 12,
  semimonthly: 2,
  monthly: 1,
  quarterly: 1 / 3,
  annual: 1 / 12,
}

const CADENCE_DAYS = {
  weekly: 7,
  biweekly: 14,
  semimonthly: 15,
  monthly: 30,
  quarterly: 91,
  annual: 365,
}

export const monthlyEquivalent = (item) => {
  const amount = Number(item.amount)
  return Number.isFinite(amount) && amount > 0 ? amount * (CADENCE_FACTOR[item.cadence] || 1) : 0
}

const clusterDays = (dates) => {
  const counts = new Map()
  for (const date of dates) {
    const day = date.getDate()
    counts.set(day, (counts.get(day) || 0) + 1)
  }
  const candidates = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])
  if (candidates.length === 0) return []
  const best = candidates[0][0]
  const cluster = dates.filter((date) => Math.abs(date.getDate() - best) <= 1)
  const remaining = dates.filter((date) => Math.abs(date.getDate() - best) > 1)
  const second = remaining.length ? clusterDays(remaining) : []
  return [{ day: best, count: cluster.length }, ...second]
}

const intervalMatch = (intervals, expected, tolerance) => {
  if (intervals.length === 0) return 0
  return intervals.filter((value) => Math.abs(value - expected) <= tolerance).length / intervals.length
}

const nextMonthlyDate = (last, anchorDay) => {
  const next = addMonthsClamped(last, 1)
  const lastDay = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate()
  return new Date(next.getFullYear(), next.getMonth(), Math.min(anchorDay, lastDay))
}

const nextSemiMonthlyDate = (last, anchorDays) => {
  if (!anchorDays.length) return addDays(last, 15)
  const candidates = []
  for (let offset = 0; offset <= 2; offset += 1) {
    const month = new Date(last.getFullYear(), last.getMonth() + offset, 1)
    const lastDay = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate()
    for (const day of anchorDays) {
      candidates.push(new Date(month.getFullYear(), month.getMonth(), Math.min(day, lastDay)))
    }
  }
  return candidates.filter((date) => date > last).sort((a, b) => a - b)[0] || addDays(last, 15)
}

const nextOccurrence = (item, date) => {
  switch (item.cadence) {
    case 'weekly':
    case 'biweekly':
      return addDays(date, item.intervalDays || CADENCE_DAYS[item.cadence])
    case 'semimonthly':
      return nextSemiMonthlyDate(date, item.anchorDays || [])
    case 'quarterly':
      return addMonthsClamped(date, 3)
    case 'annual':
      return addMonthsClamped(date, 12)
    case 'monthly':
    default:
      return nextMonthlyDate(date, item.anchorDays?.[0] || date.getDate())
  }
}

const candidateFor = ({ cadence, dates, intervals, kind, asOf, anchorDays = [] }) => {
  const expected = cadence === 'monthly' ? median(intervals) :
    cadence === 'semimonthly' ? 15 : CADENCE_DAYS[cadence]
  const tolerance = cadence === 'monthly' ? 5 :
    cadence === 'semimonthly' ? 3 :
      cadence === 'quarterly' ? 15 :
        cadence === 'annual' ? 50 : 2
  const matches = intervalMatch(intervals, expected, tolerance)
  const amountCv = coefficientOfVariation(dates.map((entry) => entry.amount))
  const age = dayDiff(dates[dates.length - 1].date, asOf)
  const staleAfter = cadence === 'annual' ? 550 : Math.max((expected || 30) * 1.8, (expected || 30) + 12)
  if (age > staleAfter) return null
  const recency = Math.max(0, 1 - age / staleAfter)
  const confidence = 0.55 * matches + 0.25 * Math.max(0, 1 - Math.min(1, amountCv / 0.6)) + 0.2 * recency
  const minCount = cadence === 'annual' ? 2 : 3
  const minMatch = cadence === 'annual' ? 0.8 : 0.65
  const maxCv = kind === 'expense' ? 0.35 : 0.55
  if (dates.length < minCount || matches < minMatch || amountCv > maxCv) return null
  if (confidence < (cadence === 'annual' ? 0.55 : 0.6)) return null
  return { cadence, intervalDays: Math.round(expected), anchorDays, matches, amountCv, confidence, expected }
}

const analyzeGroup = (group, asOf) => {
  const entries = group.entries.slice().sort((a, b) => (a.date === b.date ? 0 : a.date < b.date ? -1 : 1))
  if (entries.length < 2) return null
  const intervals = entries.slice(1).map((entry, index) => dayDiff(entries[index].date, entry.date))
  const medianInterval = median(intervals)
  const clusters = clusterDays(entries.map((entry) => entry.date))
  const anchors = clusters.map((cluster) => cluster.day)
  const twoAnchors = anchors.length >= 2 && Math.abs(anchors[0] - anchors[1]) >= 12 && Math.abs(anchors[0] - anchors[1]) <= 18

  const candidates = []
  if (medianInterval >= 330 && medianInterval <= 400) {
    candidates.push(candidateFor({ cadence: 'annual', dates: entries, intervals, kind: group.kind, asOf, anchorDays: [entries[entries.length - 1].date.getDate()] }))
  }
  if (medianInterval >= 80 && medianInterval <= 100) {
    candidates.push(candidateFor({ cadence: 'quarterly', dates: entries, intervals, kind: group.kind, asOf, anchorDays: [entries[entries.length - 1].date.getDate()] }))
  }
  if (medianInterval >= 25 && medianInterval <= 35) {
    candidates.push(candidateFor({ cadence: 'monthly', dates: entries, intervals, kind: group.kind, asOf, anchorDays: [clusters[0]?.day || entries[entries.length - 1].date.getDate()] }))
  }
  if (twoAnchors && medianInterval >= 12 && medianInterval <= 18) {
    candidates.push(candidateFor({ cadence: 'semimonthly', dates: entries, intervals, kind: group.kind, asOf, anchorDays: anchors.slice(0, 2) }))
  }
  if (medianInterval >= 12 && medianInterval <= 16 && !twoAnchors) {
    candidates.push(candidateFor({ cadence: 'biweekly', dates: entries, intervals, kind: group.kind, asOf, anchorDays: [entries[entries.length - 1].date.getDate()] }))
  }
  if (medianInterval >= 6 && medianInterval <= 8) {
    candidates.push(candidateFor({ cadence: 'weekly', dates: entries, intervals, kind: group.kind, asOf, anchorDays: [entries[entries.length - 1].date.getDate()] }))
  }

  const best = candidates.filter(Boolean).sort((a, b) => b.confidence - a.confidence)[0]
  if (!best) return null
  const lastDate = entries[entries.length - 1].date
  let nextDate = lastDate
  for (let guard = 0; guard < 24 && nextDate < asOf; guard += 1) {
    nextDate = nextOccurrence({ cadence: best.cadence, intervalDays: best.intervalDays, anchorDays: best.anchorDays }, nextDate)
  }
  if (nextDate < asOf) return null
  const recentAmounts = entries.slice(-6).map((entry) => entry.amount)
  const amount = cleanNumber(median(recentAmounts))
  const labels = new Map()
  for (const entry of entries) {
    labels.set(entry.label, (labels.get(entry.label) || 0) + 1)
  }
  const label = [...labels.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] || group.category
  return {
    key: `${group.kind}|${group.category}|${group.detailsKey || normalizeRecurringDetails(group.category)}`,
    kind: group.kind,
    category: group.category,
    detailsKey: group.detailsKey || normalizeRecurringDetails(group.category),
    label,
    amount,
    cadence: best.cadence,
    intervalDays: best.intervalDays,
    anchorDays: best.anchorDays,
    lastDate: toIsoDate(lastDate),
    nextDate: toIsoDate(nextDate),
    count: entries.length,
    confidence: Math.round(best.confidence * 100) / 100,
    amountCv: Math.round(best.amountCv * 1000) / 1000,
    monthlyEquivalent: monthlyEquivalent({ amount, cadence: best.cadence }),
    include: true,
  }
}

export const detectRecurring = ({ transactions = [], currency, asOf, excludedCategories = [], lookbackMonths = 24 }) => {
  const end = parseIsoDate(asOf)
  if (!end || !currency) return []
  const start = addMonthsClamped(startOfMonth(end), -(lookbackMonths - 1))
  const excluded = new Set(excludedCategories || [])
  const groups = new Map()
  for (const transaction of transactions) {
    if (transaction.currency !== currency || excluded.has(transaction.category)) continue
    const date = parseIsoDate(transaction.date)
    if (!date || date > end || date < start) continue
    const amount = Number(transaction.kind === 'income' ? transaction.moneyIn : transaction.expenses)
    if (!Number.isFinite(amount) || amount <= 0) continue
    const detailsKey = normalizeRecurringDetails(transaction.details)
    const key = `${transaction.kind}|${transaction.category}|${detailsKey || normalizeRecurringDetails(transaction.category)}`
    if (!groups.has(key)) {
      groups.set(key, {
        kind: transaction.kind,
        category: transaction.category,
        detailsKey,
        entries: [],
      })
    }
    groups.get(key).entries.push({
      date,
      amount,
      label: String(transaction.details || transaction.category || '').trim(),
    })
  }
  const items = []
  for (const group of groups.values()) {
    const item = analyzeGroup(group, end)
    if (item) items.push(item)
  }
  return items.sort((a, b) => a.kind.localeCompare(b.kind) || a.category.localeCompare(b.category) || a.label.localeCompare(b.label))
}

const adjustmentKey = (adjustment) => recurringKey({
  kind: adjustment.kind,
  category: adjustment.category,
  details: adjustment.details || adjustment.label || adjustment.category,
})

export const applyRecurringAdjustments = ({ items = [], adjustments = [] }) => {
  const byKey = new Map()
  for (const adjustment of adjustments || []) {
    if (!adjustment || !adjustment.kind || !adjustment.category) continue
    byKey.set(adjustmentKey(adjustment), adjustment)
  }
  const used = new Set()
  const adjusted = items.map((item) => {
    const adjustment = byKey.get(item.key)
    if (!adjustment) return item
    used.add(item.key)
    const include = adjustment.include !== false
    const amount = adjustment.amount != null && Number.isFinite(Number(adjustment.amount))
      ? Number(adjustment.amount)
      : item.amount
    const cadence = adjustment.cadence || item.cadence
    let nextDate = item.nextDate
    if (adjustment.nextDate) {
      const parsed = parseIsoDate(adjustment.nextDate)
      if (parsed) nextDate = adjustment.nextDate
    }
    let anchorDays = item.anchorDays
    if (cadence !== item.cadence || adjustment.nextDate) {
      const parsed = parseIsoDate(nextDate)
      if (cadence === 'semimonthly' && parsed) {
        const day = parsed.getDate()
        anchorDays = [day, day + 15 <= 31 ? day + 15 : Math.max(1, day - 15)]
      } else if (parsed) {
        anchorDays = [parsed.getDate()]
      }
    }
    return {
      ...item,
      detectedAmount: item.amount,
      detectedCadence: item.cadence,
      detectedNextDate: item.nextDate,
      detectedAnchorDays: item.anchorDays,
      include,
      amount,
      cadence,
      intervalDays: CADENCE_DAYS[cadence] || item.intervalDays,
      anchorDays,
      nextDate,
      monthlyEquivalent: monthlyEquivalent({ amount, cadence }),
      adjusted: true,
    }
  })
  const staleAdjustments = (adjustments || []).filter((adjustment) => {
    if (!adjustment || !adjustment.kind || !adjustment.category) return false
    return !used.has(adjustmentKey(adjustment))
  })
  return { items: adjusted, staleAdjustments }
}

export const recurringOccurrences = (item, startIso, endIso) => {
  const start = parseIsoDate(startIso)
  const end = parseIsoDate(endIso)
  const next = parseIsoDate(item.nextDate)
  if (!start || !end || !next || next > end) return []
  if (item.cadence === 'semimonthly') {
    const anchors = item.anchorDays?.length ? item.anchorDays : [next.getDate(), next.getDate() + 15 <= 31 ? next.getDate() + 15 : Math.max(1, next.getDate() - 15)]
    const dates = []
    const cursor = new Date(next.getFullYear(), next.getMonth(), 1)
    while (cursor <= end) {
      const lastDay = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate()
      for (const day of anchors) {
        const date = new Date(cursor.getFullYear(), cursor.getMonth(), Math.min(day, lastDay))
        if (date >= start && date >= next && date <= end) {
          dates.push(toIsoDate(date))
        }
      }
      cursor.setMonth(cursor.getMonth() + 1)
    }
    return [...new Set(dates)].sort()
  }
  const dates = []
  let cursor = next
  for (let guard = 0; guard < 2000 && cursor <= end; guard += 1) {
    if (cursor >= start) dates.push(toIsoDate(cursor))
    cursor = nextOccurrence(item, cursor)
  }
  return dates
}

export { CADENCE_FACTOR, CADENCE_DAYS, monthKey }
