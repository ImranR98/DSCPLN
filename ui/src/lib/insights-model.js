// Pure computation for the Insights page: comparison plans, KPI tiles,
// category panels, movers and the per-currency section model. Everything here
// takes explicit inputs (no React, no globals) so it can be tested and read in
// isolation.

import { formats, startOfDay, toIso, parseIso, colorFrom } from '@dscpln/ui-kit'
import * as IM from './insights-math.js'
import { currencyColor } from './money.js'
import { formatCount } from './transactions.js'

const CATEGORY_PALETTE = ['#2f6fed', '#16a34a', '#d97706', '#8b5cf6', '#0891b2', '#db2777', '#65a30d', '#e11d48', '#0d9488', '#7c3aed', '#ca8a04', '#4f46e5']

export const categoryColor = (name) => colorFrom(CATEGORY_PALETTE, String(name || ''))

export { defaultExcludedFor } from './insights-math.js'

export const formatDateRange = (start, end) =>
  `${formats.dayMonth.format(start)} ${formats.year.format(start)} – ${formats.dayMonth.format(end)} ${formats.year.format(end)}`

export const isFullMonth = (window) =>
  IM.isWholeMonthsRange(window.start, window.end) &&
  window.start.getMonth() === window.end.getMonth() &&
  window.start.getFullYear() === window.end.getFullYear()

export const elapsedOf = (range) =>
  IM.elapsedRange(range.start, range.end, startOfDay(new Date()))

function shortRange(window, range) {
  const start = formats.dayMonth.format(window.start)
  const end = formats.dayMonth.format(window.end)
  const body = window.start.getTime() === window.end.getTime() ? start : `${start} – ${end}`
  return window.start.getFullYear() === range.start.getFullYear() ?
    body : `${body} ${formats.year.format(window.start)}`
}

export function comparisonShortLabel(plan, comparisonData) {
  if (plan.kind === 'average') {
    return plan.count > 0 ? `${plan.count}-mo avg` : 'no prior data'
  }
  const window = plan.windows[0]
  if (window.start.getFullYear() !== comparisonData.statsRange.start.getFullYear()) {
    return 'last year'
  }
  return IM.spansMultipleMonths(window.start, window.end) ? 'previous period' : 'previous month'
}

export function comparisonLongLabel(plan) {
  if (plan.windows.length === 0) {
    return 'no prior data'
  }
  const first = plan.windows[0]
  const last = plan.windows[plan.windows.length - 1]
  if (plan.kind !== 'average') {
    return formatDateRange(first.start, first.end)
  }
  if (IM.isWholeMonthsRange(first.start, first.end)) {
    return `${plan.count}-month average of ${formats.monthShort.format(first.start)}–${formats.monthShort.format(last.start)} ${formats.year.format(last.start)}`
  }
  if (!IM.spansMultipleMonths(first.start, first.end)) {
    const span = `${formats.dayMonth.format(first.start)}–${formats.dayMonth.format(last.end)}`
    return plan.count === 1 ?
      `the same days of ${formats.monthYear.format(first.start)} (${span})` :
      `the average of the same days of each month ${formats.monthShort.format(first.start)}–${formats.monthShort.format(last.start)} ${formats.year.format(last.start)} (e.g. ${span})`
  }
  return `${plan.count}-month average of ${formats.monthShort.format(first.start)}–${formats.monthShort.format(last.end)} ${formats.year.format(last.end)}`
}

export function comparisonDetails(statsRange, statsPlan, partial) {
  const parts = [`Figures cover ${formatDateRange(statsRange.start, statsRange.end)}.`]
  if (statsPlan.kind === 'average') {
    parts.push(statsPlan.count === 0
      ? 'No earlier complete month has data for the average.'
      : `Compared with ${comparisonLongLabel(statsPlan)}.`)
  } else {
    const window = statsPlan.windows[0]
    const matching = IM.isWholeMonthsRange(window.start, window.end) ? '' :
      window.start.getFullYear() === statsRange.start.getFullYear()
        ? ' (matching calendar days of the previous month)'
        : ' (matching calendar days of the previous year)'
    parts.push(`Compared with ${comparisonLongLabel(statsPlan)}${matching}.`)
  }
  if (partial) {
    parts.push('Future dates are excluded.')
  }
  return parts.join(' ')
}

// A short statement of what the KPI figures are compared with.
export function comparisonBasisLabel(plan, comparisonData, range) {
  if (plan.windows.length === 0) {
    return 'no prior data'
  }
  if (plan.kind === 'average') {
    const aligned = !IM.isWholeMonthsRange(plan.windows[0].start, plan.windows[0].end) &&
      !IM.spansMultipleMonths(plan.windows[0].start, plan.windows[0].end)
    if (!aligned) {
      return comparisonShortLabel(plan, comparisonData)
    }
    const statsRange = comparisonData.statsRange
    const span = statsRange.start.getDate() === statsRange.end.getDate()
      ? `${statsRange.start.getDate()}`
      : `${statsRange.start.getDate()}–${statsRange.end.getDate()}`
    return `${comparisonShortLabel(plan, comparisonData)} (${span})`
  }
  return shortRange(plan.windows[0], range)
}

function netColor(net, spend, income) {
  if (net === 0) {
    return null
  }
  const smaller = Math.min(Math.abs(spend), Math.abs(income))
  const ratio = smaller > 0 ? Math.min(1, Math.abs(net) / smaller) : 1
  const percent = Math.round(25 + 75 * ratio)
  const base = net > 0 ? 'var(--ok)' : 'var(--over)'
  return `color-mix(in srgb, ${base} ${percent}%, var(--text-muted))`
}

function kpiTile(label, value, comparisonValue, options, plan, { money, comparisonData }) {
  const labelTitle = comparisonData
    ? `Current period: ${formatDateRange(comparisonData.statsRange.start, comparisonData.statsRange.end)}`
    : ''
  const delta = { text: '—', className: 'muted', title: '' }
  if (comparisonValue != null && !(value === 0 && comparisonValue === 0)) {
    const change = IM.delta(value, comparisonValue)
    const short = comparisonShortLabel(plan, comparisonData)
    if (change.pct == null) {
      const amount = options.code ? money(Math.abs(change.amount), options.code) : String(IM.clean(Math.abs(change.amount)))
      delta.text = `${change.amount > 0 ? '+' : change.amount < 0 ? '−' : ''}${amount} vs ${short}`
    } else {
      delta.text = `${change.pct > 0 ? '+' : ''}${change.pct.toFixed(0)}% vs ${short}`
    }
    delta.title = comparisonLongLabel(plan)
    if (options.tone === 'spend') {
      delta.className = change.amount === 0 ? 'muted' : change.amount > 0 ? 'kpi__delta--bad' : 'kpi__delta--good'
    } else if (options.tone === 'income') {
      delta.className = change.amount === 0 ? 'muted' : change.amount > 0 ? 'kpi__delta--good' : 'kpi__delta--bad'
    }
  }
  return {
    label,
    labelTitle,
    valueText: options.code ? money(value, options.code) : String(value),
    valueColor: options.color || null,
    delta,
  }
}

export function buildKpis(code, included, compared, plan, { money, comparisonData, daysElapsed }) {
  const current = IM.totals(included)
  const days = daysElapsed()
  return [
    kpiTile('Spent', current.spend, compared.spend, { tone: 'spend', code }, plan, { money, comparisonData }),
    kpiTile('Earned', current.income, compared.income, { tone: 'income', code }, plan, { money, comparisonData }),
    kpiTile('Net', current.net, compared.net, {
      tone: 'income',
      code,
      // Net colors by sign and intensity; the delta colors by direction.
      color: netColor(current.net, current.spend, current.income),
    }, plan, { money, comparisonData }),
    kpiTile('Avg / day', current.spend / days, compared.dailySpend, { tone: 'spend', code }, plan, { money, comparisonData }),
    kpiTile('Avg earned / day', current.income / days, compared.dailyIncome, { tone: 'income', code }, plan, { money, comparisonData }),
    kpiTile('Transactions', current.count, compared.count, { tone: 'neutral' }, plan, { money, comparisonData }),
  ]
}

export function buildCategoryList(all, kind, comparisonMap, excludedSet, code, plan, money) {
  const rows = IM.aggregateByCategory(all, kind)
  if (rows.length === 0) {
    return null
  }
  const max = Math.max(...rows.map((row) => row.amount))
  const total = rows
    .filter((row) => !excludedSet.has(row.category))
    .reduce((sum, row) => sum + row.amount, 0)
  return {
    categories: rows.map((row) => row.category),
    rows: rows.map((row) => {
      const comparisonAmount = comparisonMap[row.category] || 0
      const change = IM.delta(row.amount, comparisonAmount)
      let delta = null
      if (change.pct != null) {
        delta = {
          text: `${change.amount > 0 ? '+' : ''}${change.pct.toFixed(0)}%`,
          className: change.amount > 0 ? 'is-up' : change.amount < 0 ? 'is-down' : 'muted',
          title: `vs ${comparisonLongLabel(plan)}`,
        }
      } else if (row.amount > 0) {
        delta = { text: 'new', className: 'is-up', title: `vs ${comparisonLongLabel(plan)}` }
      }
      return {
        category: row.category,
        color: categoryColor(row.category),
        checked: !excludedSet.has(row.category),
        share: total > 0 ? `${Math.round((row.amount / total) * 100)}%` : '0%',
        amountText: money(row.amount, code),
        delta,
        barPercent: max > 0 ? Math.max(2, (row.amount / max) * 100) : 0,
      }
    }),
  }
}

// Builds the per-currency section model (KPIs, category panels, cumulative
// chart data, forecast and movers). `ctx` carries the page-level inputs.
function buildSection(code, rangeTxs, ctx) {
  const { reference, range, comparison, comparisonData, transactions, excluded, symbols, money, daysElapsed } = ctx
  const excludedSet = excluded.get(code) ?? IM.defaultExcludedFor(reference)

  const included = rangeTxs.filter((transaction) => !excludedSet.has(transaction.category))
  const plans = sectionPlans(code, { comparison, comparisonData })
  const compared = comparisonForSection(code, excludedSet, plans.stats, { transactions })

  const daily = IM.dailySeries(included, range.start, range.end)
  let runningSpend = 0
  let runningIncome = 0
  const spendCumulative = daily.map((day) => {
    runningSpend += day.spend
    return IM.clean(runningSpend)
  })
  const incomeCumulative = daily.map((day) => {
    runningIncome += day.income
    return IM.clean(runningIncome)
  })
  const baseline = cumulativeBaseline(code, excludedSet, plans.chart, { transactions, range })
  const middle = daily[Math.floor((daily.length - 1) / 2)]
  // The solid lines end at today; the dashed baselines span the full range.
  const solidDays = IM.daysInclusive(range.start, elapsedOf(range).end)
  const short = comparisonShortLabel(plans.stats, comparisonData)
  const laneColor = currencyColor(code) || 'var(--accent)'

  const windowTxs = plans.chart.windows.flatMap((window) => transactionsIn(code, window, excludedSet, transactions))
  const windowTotals = IM.totals(windowTxs)
  const forecast = []
  if (plans.chart.windows.length > 0 && plans.chart.days > 0 && (windowTotals.spend > 0 || windowTotals.income > 0)) {
    const factor = 30 / plans.chart.days
    forecast.push({
      label: `Next 30 days (based on ${comparisonLongLabel(plans.chart)})`,
      value: `${money(windowTotals.spend * factor, code)} out · ${money(windowTotals.income * factor, code)} in`,
      title: 'Extrapolates the comparison period’s average daily rate over 30 days.',
    })
  }

  const movers = []
  const addMovers = (title, currentMap, comparisonMap) => {
    const entries = IM.categoryMovers(currentMap, comparisonMap, 3)
    if (entries.increases.length === 0 && entries.decreases.length === 0) {
      return
    }
    const mapEntry = (entry) => ({
      category: entry.category,
      color: categoryColor(entry.category),
      amountText: `${entry.delta.amount > 0 ? '+' : '−'}${money(Math.abs(entry.delta.amount), code)}`,
      amountClass: entry.delta.amount > 0 ? 'is-up' : 'is-down',
      pctText: entry.delta.pct == null ? 'new' : `${entry.delta.pct > 0 ? '+' : ''}${entry.delta.pct.toFixed(0)}%`,
    })
    movers.push({
      title,
      increases: entries.increases.map(mapEntry),
      decreases: entries.decreases.map(mapEntry),
    })
  }
  addMovers('Spending changes', IM.categoryTotalsMap(included, 'expense'), compared.spendMap)
  addMovers('Earning changes', IM.categoryTotalsMap(included, 'income'), compared.incomeMap)

  return {
    code,
    color: currencyColor(code) || 'var(--accent)',
    count: formatCount(included.length),
    basisLabel: comparisonBasisLabel(plans.stats, comparisonData, range),
    basisTitle: comparisonLongLabel(plans.stats),
    kpis: buildKpis(code, included, compared, plans.stats, { money, comparisonData, daysElapsed }),
    spending: buildCategoryList(rangeTxs, 'expense', compared.spendMap, excludedSet, code, plans.stats, money),
    earning: buildCategoryList(rangeTxs, 'income', compared.incomeMap, excludedSet, code, plans.stats, money),
    chartData: {
      daily,
      spendCumulative: spendCumulative.slice(0, solidDays),
      incomeCumulative: incomeCumulative.slice(0, solidDays),
      baselineSpend: baseline.spend,
      baselineIncome: baseline.income,
      currency: code,
      symbol: symbols.get(code),
      axisLabels: [
        formats.dayMonth.format(range.start),
        middle ? formats.dayMonth.format(parseIso(middle.date)) : '',
        formats.dayMonth.format(range.end),
      ],
    },
    legend: [
      { label: 'Spent', color: laneColor, baseline: false },
      { label: 'Earned', color: 'var(--ok)', baseline: false },
      { label: `Spent vs ${short}`, color: laneColor, baseline: true },
      { label: `Earned vs ${short}`, color: 'var(--ok)', baseline: true },
    ],
    forecast,
    hasComparison: compared.hasData,
    noComparisonText: `No comparison data for ${comparisonLongLabel(plans.stats)}.`,
    movers,
  }
}

function transactionsIn(currency, window, excludedSet, transactions) {
  return IM.filterTransactions(transactions, {
    start: window.start,
    end: window.end,
    currency,
    excludedCategories: excludedSet,
  })
}

function rangeTransactions(window, transactions) {
  return IM.filterTransactions(transactions, {
    start: window.start,
    end: window.end,
  })
}

// The comparison plans for one currency. Months before a currency's first
// transaction are skipped so its averages only cover months with data.
function sectionPlans(code, { comparison, comparisonData }) {
  const firstDataMonth = comparisonData.firstMonths.get(code) || null
  return {
    stats: IM.comparisonPlan(comparison, comparisonData.statsRange, firstDataMonth),
    chart: IM.comparisonPlan(comparison, comparisonData.chartRange, firstDataMonth),
  }
}

function comparisonForSection(code, excludedSet, plan, { transactions }) {
  if (plan.windows.length === 0) {
    return {
      kind: plan.kind,
      hasData: false,
      spend: null,
      income: null,
      net: null,
      count: null,
      dailySpend: null,
      dailyIncome: null,
      spendMap: {},
      incomeMap: {},
    }
  }
  const windowTxs = plan.windows.flatMap((window) => transactionsIn(code, window, excludedSet, transactions))
  const raw = IM.totals(windowTxs)
  const factor = plan.factor
  const scaleMap = (map) => {
    const scaled = {}
    for (const [key, value] of Object.entries(map)) {
      scaled[key] = value * factor
    }
    return scaled
  }
  return {
    kind: plan.kind,
    hasData: raw.count > 0,
    spend: raw.spend * factor,
    income: raw.income * factor,
    net: raw.net * factor,
    count: raw.count * factor,
    dailySpend: plan.days > 0 ? raw.spend / plan.days : 0,
    dailyIncome: plan.days > 0 ? raw.income / plan.days : 0,
    spendMap: scaleMap(IM.categoryTotalsMap(windowTxs, 'expense')),
    incomeMap: scaleMap(IM.categoryTotalsMap(windowTxs, 'income')),
  }
}

function cumulativeBaseline(code, excludedSet, plan, { transactions, range }) {
  if (!plan || plan.windows.length === 0) {
    return { spend: [], income: [] }
  }
  const days = IM.daysInclusive(range.start, range.end)
  const filtered = IM.filterTransactions(transactions, { currency: code, excludedCategories: excludedSet })
  return IM.baselineFromPlan(filtered, plan, days)
}

// The whole page model: null until loaded, a future-range marker, or the
// per-currency sections sorted by activity (primary currency first).
export function buildInsightsModel({ reference, range, comparison, comparisonData, transactions, excluded, symbols, money }) {
  if (!reference || !range || !comparisonData) {
    return null
  }
  const today = startOfDay(new Date())
  const statsRange = elapsedOf(range)
  const statTxs = rangeTransactions(statsRange, transactions)
  const rangeTxs = rangeTransactions(range, transactions)

  const history = {
    hidden: !IM.spansMultipleMonths(range.start, range.end) || statTxs.length === 0,
    rangeText: `${formats.monthYear.format(range.start)} – ${formats.monthYear.format(range.end)}`,
    months: null,
    codes: (reference.currencies || []).map((currency) => currency.code),
  }
  if (!history.hidden) {
    const conversionCategories = new Set(reference.conversionCategories || [])
    const months = IM.monthPartials(range.start, range.end).map((entry) => ({ ...entry, currencies: {} }))
    const monthIndex = new Map(months.map((entry, index) => [`${entry.year}|${entry.month}`, index]))
    for (const currency of reference.currencies || []) {
      for (const month of months) {
        month.currencies[currency.code] = { spend: 0, income: 0 }
      }
    }
    for (const transaction of statTxs) {
      if (conversionCategories.has(transaction.category)) {
        continue
      }
      const [year, month] = transaction.date.split('-').map(Number)
      const slot = monthIndex.get(`${year}|${month}`)
      if (slot == null) {
        continue
      }
      const totals = months[slot].currencies[transaction.currency]
      if (!totals) {
        continue
      }
      if (transaction.kind === 'income') {
        totals.income += transaction.moneyIn || 0
      } else {
        totals.spend += transaction.expenses || 0
      }
    }
    history.months = months
  }

  if (range.start > today) {
    return {
      future: true,
      rangeTxs,
      history: { ...history, hidden: true },
      sections: [],
    }
  }

  const byCurrency = new Map()
  for (const transaction of statTxs) {
    if (!byCurrency.has(transaction.currency)) {
      byCurrency.set(transaction.currency, [])
    }
    byCurrency.get(transaction.currency).push(transaction)
  }

  const primary = (reference.currencies || []).find((entry) => entry.primary)
  const volume = (code) => {
    const total = IM.totals(byCurrency.get(code))
    return total.spend + total.income
  }
  const codes = [...byCurrency.keys()].sort((a, b) => {
    if (primary && a === primary.code) return -1
    if (primary && b === primary.code) return 1
    return volume(b) - volume(a)
  })

  const daysElapsed = () => Math.max(1, IM.daysInclusive(statsRange.start, statsRange.end))
  const ctx = { reference, range, comparison, comparisonData, transactions, excluded, symbols, money, daysElapsed }

  return {
    future: false,
    rangeTxs,
    history,
    sections: codes.map((code) => buildSection(code, byCurrency.get(code), ctx)),
  }
}

// The one-line comparison summary shown above the sections (the full
// explanation lives in the tooltip).
export function buildCompareNote(range, comparisonData, comparison) {
  if (!range || !comparisonData) {
    return { text: '', title: '' }
  }
  const statsRange = elapsedOf(range)
  if (range.start > startOfDay(new Date())) {
    return { text: 'This range has not started yet.', title: '' }
  }
  const statsPlan = IM.comparisonPlan(comparison, statsRange, comparisonData.earliest)
  const partial = toIso(statsRange.end) !== toIso(range.end)
  const baseline = statsPlan.count === 0 ? 'no earlier data' : comparisonBasisLabel(statsPlan, comparisonData, range)
  return {
    text: `${shortRange(statsRange, range)} vs ${baseline}`,
    title: comparisonDetails(statsRange, statsPlan, partial),
  }
}
