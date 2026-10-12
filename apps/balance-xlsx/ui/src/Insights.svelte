<script>
  import { onMount } from 'svelte'
  import { ChartNoAxesColumn, LayoutDashboard, Wrench } from 'lucide-svelte'
  import {
    formats,
    startOfDay,
    toIso,
    parseIso,
    breakable,
    colorFrom,
    showToast,
    ThemeToggle,
    Toasts,
  } from '@dscpln/ui-kit'
  import * as IM from './lib/insights-math.js'
  import { moneyFor, currencyColor } from './lib/money.js'
  import { renderMonthly } from './lib/chart.js'
  import { sortNewestFirst, formatCount } from './lib/transactions.js'
  import { requestJson } from './lib/request.js'
  import TransactionList from './TransactionList.svelte'
  import CumulativeChart from './CumulativeChart.svelte'

  const COMPARISON_MODES = ['prev', 'yoy', 'avg3', 'avg6', 'avg12']
  const CATEGORY_PALETTE = ['#2f6fed', '#16a34a', '#d97706', '#8b5cf6', '#0891b2', '#db2777', '#65a30d', '#e11d48', '#0d9488', '#7c3aed', '#ca8a04', '#4f46e5']
  const INCOME_GROUP = 'Money In'

  let reference = $state(null)
  let transactions = $state([])
  let range = $state(null)
  let comparison = $state('prev')
  let comparisonData = $state(null)
  let excluded = $state(new Map())
  let error = $state('')

  let fetchSequence = 0
  let monthInput = $state(null)
  let historyHost = $state(null)
  let historyTooltip = $state(null)
  let historyHidden = $state(true)
  let historyRange = $state('')

  const categoryColor = (name) => colorFrom(CATEGORY_PALETTE, String(name || ''))

  const fractionalCurrencies = $derived(new Set(
    (reference?.currencies || []).filter((entry) => entry.fractional).map((entry) => entry.code)))
  const symbols = $derived(new Map(
    (reference?.currencies || []).filter((entry) => entry.symbol).map((entry) => [entry.code, entry.symbol])))
  const money = $derived(moneyFor((code) => fractionalCurrencies.has(code), (code) => symbols.get(code)))

  $effect(() => {
    document.body.classList.toggle('is-loading', !reference)
  })

  /* ---------- Ranges & presets ---------- */

  function currentMonthRange(date = new Date()) {
    return { start: IM.startOfMonth(date), end: IM.endOfMonth(date) }
  }

  function lastMonthRange() {
    const today = new Date()
    const firstOfThisMonth = IM.startOfMonth(today)
    const lastMonthDay = IM.addDays(firstOfThisMonth, -1)
    return { start: IM.startOfMonth(lastMonthDay), end: lastMonthDay }
  }

  function lastFullMonthsRange(count) {
    return IM.lastCompleteMonths(count, new Date())
  }

  function ytdRange() {
    const today = new Date()
    return { start: new Date(today.getFullYear(), 0, 1), end: today }
  }

  function allTimeRange() {
    const transactionRange = reference && reference.transactionRange
    if (!transactionRange || !transactionRange.first || !transactionRange.last) {
      return null
    }
    return { start: IM.parseIsoDate(transactionRange.first), end: IM.parseIsoDate(transactionRange.last) }
  }

  const QUICK_RANGES = {
    'this-month': currentMonthRange,
    'last-month': lastMonthRange,
    'last-3': () => lastFullMonthsRange(3),
    'last-6': () => lastFullMonthsRange(6),
    'last-12': () => lastFullMonthsRange(12),
    ytd: ytdRange,
    'all-time': allTimeRange,
  }

  const quickRange = (name) => (QUICK_RANGES[name] ? QUICK_RANGES[name]() : null)

  function isFullMonth(window) {
    return IM.isWholeMonthsRange(window.start, window.end) &&
      window.start.getMonth() === window.end.getMonth() &&
      window.start.getFullYear() === window.end.getFullYear()
  }

  const formatDateRange = (start, end) =>
    `${formats.dayMonth.format(start)} ${formats.year.format(start)} – ${formats.dayMonth.format(end)} ${formats.year.format(end)}`

  // A compact date range ("1 Oct – 7 Oct"), with the year when it is not the
  // selected range's year (so last-year comparisons stay unambiguous).
  function shortRange(window) {
    const start = formats.dayMonth.format(window.start)
    const end = formats.dayMonth.format(window.end)
    const body = window.start.getTime() === window.end.getTime() ? start : `${start} – ${end}`
    return window.start.getFullYear() === range.start.getFullYear() ?
      body : `${body} ${formats.year.format(window.start)}`
  }

  function comparisonShortLabel(plan) {
    if (plan.kind === 'average') {
      return plan.count > 0 ? `${plan.count}-mo avg` : 'no prior data'
    }
    const window = plan.windows[0]
    if (window.start.getFullYear() !== comparisonData.statsRange.start.getFullYear()) {
      return 'last year'
    }
    return IM.spansMultipleMonths(window.start, window.end) ? 'previous period' : 'previous month'
  }

  function comparisonLongLabel(plan) {
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

  // The comparison note is deliberately one short line; the full explanation
  // lives in its tooltip.
  const compareNote = $derived.by(() => {
    if (!range || !comparisonData) {
      return { text: '', title: '' }
    }
    const statsRange = elapsedRange()
    if (range.start > startOfDay(new Date())) {
      return { text: 'This range has not started yet.', title: '' }
    }
    const statsPlan = IM.comparisonPlan(comparison, statsRange, comparisonData.earliest)
    const partial = toIso(statsRange.end) !== toIso(range.end)
    const baseline = statsPlan.count === 0 ? 'no earlier data' : comparisonBasisLabel(statsPlan)
    return {
      text: `${shortRange(statsRange)} vs ${baseline}`,
      title: comparisonDetails(statsRange, statsPlan, partial),
    }
  })

  function comparisonDetails(statsRange, statsPlan, partial) {
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
  function comparisonBasisLabel(plan) {
    if (plan.windows.length === 0) {
      return 'no prior data'
    }
    if (plan.kind === 'average') {
      const aligned = !IM.isWholeMonthsRange(plan.windows[0].start, plan.windows[0].end) &&
        !IM.spansMultipleMonths(plan.windows[0].start, plan.windows[0].end)
      if (!aligned) {
        return comparisonShortLabel(plan)
      }
      const statsRange = comparisonData.statsRange
      const span = statsRange.start.getDate() === statsRange.end.getDate()
        ? `${statsRange.start.getDate()}`
        : `${statsRange.start.getDate()}–${statsRange.end.getDate()}`
      return `${comparisonShortLabel(plan)} (${span})`
    }
    return shortRange(plan.windows[0])
  }

  function elapsedRange() {
    return IM.elapsedRange(range.start, range.end, startOfDay(new Date()))
  }

  const chips = $derived.by(() =>
    Object.keys(QUICK_RANGES).map((name) => {
      const preset = quickRange(name)
      const active = Boolean(preset) && Boolean(range) &&
        IM.toIsoDate(preset.start) === IM.toIsoDate(range.start) &&
        IM.toIsoDate(preset.end) === IM.toIsoDate(range.end)
      return { name, active }
    }))

  const monthChipLabel = $derived(range && isFullMonth(range) ? formats.monthYear.format(range.start) : 'Pick a month')
  const rangeLabel = $derived(range ? formatDateRange(range.start, range.end) : '')
  const monthInputValue = $derived(range && isFullMonth(range)
    ? `${range.start.getFullYear()}-${String(range.start.getMonth() + 1).padStart(2, '0')}`
    : '')

  function syncUrl() {
    const params = new URLSearchParams({
      start: IM.toIsoDate(range.start),
      end: IM.toIsoDate(range.end),
      cmp: comparison,
    })
    history.replaceState(null, '', `${location.pathname}?${params}`)
  }

  function setRange(start, end, { fetch = true } = {}) {
    if (!start || !end || start > end) {
      return
    }
    range = { start, end }
    syncUrl()
    if (fetch) {
      fetchData()
    }
  }

  function stateFromUrl() {
    const params = new URLSearchParams(location.search)
    const start = IM.parseIsoDate(params.get('start'))
    const end = IM.parseIsoDate(params.get('end'))
    const mode = COMPARISON_MODES.includes(params.get('cmp')) ? params.get('cmp') : 'prev'
    return {
      range: start && end && start <= end ? { start, end } : null,
      comparison: mode,
    }
  }

  /* ---------- Data ---------- */

  function transactionsIn(currency, window, excludedSet) {
    return IM.filterTransactions(transactions, {
      start: window.start,
      end: window.end,
      currency,
      excludedCategories: excludedSet,
    })
  }

  function rangeTransactions(window) {
    return IM.filterTransactions(transactions, {
      start: window.start,
      end: window.end,
    })
  }

  function excludedFor(code) {
    return excluded.get(code) ?? new Set(reference?.conversionCategories || [])
  }

  function updateExcluded(code, categories, include) {
    const next = new Map(excluded)
    const set = new Set(excludedFor(code))
    for (const category of categories) {
      if (include) {
        set.delete(category)
      } else {
        set.add(category)
      }
    }
    next.set(code, set)
    excluded = next
  }

  async function fetchData() {
    const sequence = ++fetchSequence
    try {
      // Statistics use the elapsed part of the range, while the chart and
      // forecast use the selected range so they can show the full comparison
      // periods. Plans fetched without the per-currency data-age clamp cover a
      // superset of the windows used for display.
      const statsRange = elapsedRange()
      const chartRange = range
      const statsPlan = IM.comparisonPlan(comparison, statsRange)
      const chartPlan = IM.comparisonPlan(comparison, chartRange)
      const today = startOfDay(new Date())
      let fetchStart = [...statsPlan.windows, ...chartPlan.windows].reduce((earliest, window) =>
        !earliest || window.start < earliest ? window.start : earliest, null)
      if (chartRange.start <= today && today <= chartRange.end) {
        const monthStart = IM.startOfMonth(today)
        if (!fetchStart || monthStart < fetchStart) {
          fetchStart = monthStart
        }
      }
      const params = new URLSearchParams({
        start: IM.toIsoDate(fetchStart || chartRange.start),
        end: IM.toIsoDate(chartRange.end),
      })
      const [referenceResult, transactionsResult] = await Promise.all([
        reference ? Promise.resolve(reference) : requestJson('/data'),
        requestJson(`/transactions?${params}`),
      ])
      if (sequence !== fetchSequence) {
        return
      }
      reference = referenceResult
      transactions = transactionsResult.transactions || []
      const firstMonths = new Map((referenceResult.currencies || []).map((entry) => [
        entry.code,
        entry.firstMonth ? IM.parseIsoDate(entry.firstMonth) : null,
      ]))
      // The note and basis labels use the earliest month any currency has
      // data; each section clamps further to its own currency's first month.
      const earliest = [...firstMonths.values()].reduce((min, date) =>
        date && (!min || date < min) ? date : min, null)
      comparisonData = {
        statsRange,
        chartRange,
        earliest,
        firstMonths,
      }
      error = ''
    } catch (e) {
      if (sequence === fetchSequence) {
        console.error(e)
        error = 'Could not load insights. Check the server logs.'
        showToast('Could not load insights')
      }
    }
  }

  /* ---------- Page model ---------- */

  const model = $derived.by(() => {
    if (!reference || !range || !comparisonData) {
      return null
    }
    const today = startOfDay(new Date())
    const statsRange = elapsedRange()
    const statTxs = rangeTransactions(statsRange)
    const rangeTxs = rangeTransactions(range)

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

    return {
      future: false,
      rangeTxs,
      history,
      sections: codes.map((code) => buildSection(code, byCurrency.get(code))),
    }
  })

  function daysElapsed() {
    const statsRange = comparisonData ? comparisonData.statsRange : elapsedRange()
    return Math.max(1, IM.daysInclusive(statsRange.start, statsRange.end))
  }

  // The comparison plans for one currency. Months before a currency's first
  // transaction are skipped so its averages only cover months with data.
  function sectionPlans(code) {
    const firstDataMonth = comparisonData.firstMonths.get(code) || null
    return {
      stats: IM.comparisonPlan(comparison, comparisonData.statsRange, firstDataMonth),
      chart: IM.comparisonPlan(comparison, comparisonData.chartRange, firstDataMonth),
    }
  }

  function comparisonForSection(code, excludedSet, plan) {
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
    const windowTxs = plan.windows.flatMap((window) => transactionsIn(code, window, excludedSet))
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

  function kpiTile(label, value, comparisonValue, options, plan) {
    const labelTitle = comparisonData
      ? `Current period: ${formatDateRange(comparisonData.statsRange.start, comparisonData.statsRange.end)}`
      : ''
    const delta = { text: '—', className: 'muted', title: '' }
    if (comparisonValue != null && !(value === 0 && comparisonValue === 0)) {
      const change = IM.delta(value, comparisonValue)
      const short = comparisonShortLabel(plan)
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

  function buildKpis(code, included, compared, plan) {
    const current = IM.totals(included)
    const days = daysElapsed()
    return [
      kpiTile('Spent', current.spend, compared.spend, { tone: 'spend', code }, plan),
      kpiTile('Earned', current.income, compared.income, { tone: 'income', code }, plan),
      kpiTile('Net', current.net, compared.net, {
        tone: 'income',
        code,
        // Net colors by sign and intensity; the delta colors by direction.
        color: netColor(current.net, current.spend, current.income),
      }, plan),
      kpiTile('Avg / day', current.spend / days, compared.dailySpend, { tone: 'spend', code }, plan),
      kpiTile('Avg earned / day', current.income / days, compared.dailyIncome, { tone: 'income', code }, plan),
      kpiTile('Transactions', current.count, compared.count, { tone: 'neutral' }, plan),
    ]
  }

  function buildCategoryList(all, kind, comparisonMap, excludedSet, code, plan) {
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

  function cumulativeBaseline(code, excludedSet, plan) {
    if (!plan || plan.windows.length === 0) {
      return { spend: [], income: [] }
    }
    const days = IM.daysInclusive(range.start, range.end)
    const filtered = IM.filterTransactions(transactions, { currency: code, excludedCategories: excludedSet })
    return IM.baselineFromPlan(filtered, plan, days)
  }

  function buildSection(code, rangeTxs) {
    const excludedSet = excludedFor(code)

    const included = rangeTxs.filter((transaction) => !excludedSet.has(transaction.category))
    const plans = sectionPlans(code)
    const compared = comparisonForSection(code, excludedSet, plans.stats)

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
    const baseline = cumulativeBaseline(code, excludedSet, plans.chart)
    const middle = daily[Math.floor((daily.length - 1) / 2)]
    // The solid lines end at today; the dashed baselines span the full range.
    const solidDays = IM.daysInclusive(range.start, elapsedRange().end)
    const short = comparisonShortLabel(plans.stats)
    const laneColor = currencyColor(code) || 'var(--accent)'

    const windowTxs = plans.chart.windows.flatMap((window) => transactionsIn(code, window, excludedSet))
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
      basisLabel: comparisonBasisLabel(plans.stats),
      basisTitle: comparisonLongLabel(plans.stats),
      kpis: buildKpis(code, included, compared, plans.stats),
      spending: buildCategoryList(rangeTxs, 'expense', compared.spendMap, excludedSet, code, plans.stats),
      earning: buildCategoryList(rangeTxs, 'income', compared.incomeMap, excludedSet, code, plans.stats),
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

  const rangeTxCount = $derived(model ? model.rangeTxs.length : 0)
  const sortedRangeTxs = $derived(model ? sortNewestFirst(model.rangeTxs) : [])

  $effect(() => {
    if (!historyHost || !historyTooltip || !model || model.future || model.history.hidden || !model.history.months) {
      historyHidden = true
      return
    }
    const rendered = renderMonthly(historyHost, historyTooltip, {
      months: model.history.months,
      codes: model.history.codes,
      money,
      symbolFor: (code) => symbols.get(code),
    })
    historyHidden = !rendered
    historyRange = model.history.rangeText
  })

  onMount(() => {
    const initial = stateFromUrl()
    comparison = initial.comparison
    range = initial.range || currentMonthRange()
    syncUrl()
    fetchData()
  })

  function openMonthPicker() {
    const input = monthInput
    if (!input) return
    input.value = monthInputValue
    if (typeof input.showPicker === 'function') {
      try {
        input.showPicker()
        return
      } catch {
        // fall through to focus/click
      }
    }
    input.focus()
    input.click()
  }

  function onMonthPicked() {
    const match = /^(\d{4})-(\d{2})$/.exec(monthInput.value)
    if (!match) {
      return
    }
    const date = new Date(Number(match[1]), Number(match[2]) - 1, 1)
    const window = currentMonthRange(date)
    setRange(window.start, window.end)
  }

  function onStartChange(event) {
    const start = IM.parseIsoDate(event.target.value)
    if (!start) return
    const end = range.end
    setRange(start, end < start ? start : end)
  }

  function onEndChange(event) {
    const end = IM.parseIsoDate(event.target.value)
    if (!end) return
    const start = range.start
    setRange(end < start ? end : start, end)
  }

  function onComparisonChange(event) {
    comparison = COMPARISON_MODES.includes(event.target.value) ? event.target.value : 'prev'
    syncUrl()
    fetchData()
  }
</script>

<header class="app-header">
  <div class="app-header__top">
    <h1><a class="app-header__brand" href="/">D<span class="accent">$</span>CPLN <span class="app-header__app">⋅ Balance XLSX</span></a></h1>
    <div class="app-header__actions">
      <a role="button" class="outline secondary icon-button" href="./" title="Dashboard" aria-label="Dashboard">
        <LayoutDashboard size={16} strokeWidth={1.8} />
      </a>
      <a role="button" class="outline secondary icon-button" href="settings" title="API settings" aria-label="API settings">
        <Wrench size={16} strokeWidth={1.8} />
      </a>
      <ThemeToggle />
    </div>
  </div>
  <div class="app-header__meta">
    <span>Insights</span>
    <span class="app-header__meta-tools">
      <span class="muted">{rangeLabel}</span>
    </span>
  </div>
</header>

<main class="insights">
  <section class="card insights-filters" aria-label="Date range and comparison">
    <div class="filters">
      <label class="field">
        <span class="field__label">Start</span>
        <input type="date" required value={range ? IM.toIsoDate(range.start) : ''} onchange={onStartChange} />
      </label>
      <label class="field">
        <span class="field__label">End</span>
        <input type="date" required value={range ? IM.toIsoDate(range.end) : ''} onchange={onEndChange} />
      </label>
      <label class="field">
        <span class="field__label">Compare with</span>
        <select value={comparison} onchange={onComparisonChange}>
          <option value="prev">Previous period</option>
          <option value="yoy">Same period last year</option>
          <option value="avg3">Trailing 3-month average</option>
          <option value="avg6">Trailing 6-month average</option>
          <option value="avg12">Trailing 12-month average</option>
        </select>
      </label>
    </div>
    <div class="quick-ranges" role="group" aria-label="Quick ranges">
      <button class="chip" type="button" data-range="this-month" aria-pressed={chips.find((chip) => chip.name === 'this-month')?.active} onclick={() => { const w = quickRange('this-month'); if (w) setRange(w.start, w.end) }}>This month</button>
      <button class="chip" type="button" data-range="last-month" aria-pressed={chips.find((chip) => chip.name === 'last-month')?.active} onclick={() => { const w = quickRange('last-month'); if (w) setRange(w.start, w.end) }}>Last month</button>
      <button class="chip" type="button" onclick={openMonthPicker}>{monthChipLabel}</button>
      <button class="chip" type="button" data-range="last-3" aria-pressed={chips.find((chip) => chip.name === 'last-3')?.active} onclick={() => { const w = quickRange('last-3'); if (w) setRange(w.start, w.end) }}>Last 3 full months</button>
      <button class="chip" type="button" data-range="last-6" aria-pressed={chips.find((chip) => chip.name === 'last-6')?.active} onclick={() => { const w = quickRange('last-6'); if (w) setRange(w.start, w.end) }}>Last 6 full months</button>
      <button class="chip" type="button" data-range="last-12" aria-pressed={chips.find((chip) => chip.name === 'last-12')?.active} onclick={() => { const w = quickRange('last-12'); if (w) setRange(w.start, w.end) }}>Last 12 full months</button>
      <button class="chip" type="button" data-range="ytd" aria-pressed={chips.find((chip) => chip.name === 'ytd')?.active} onclick={() => { const w = quickRange('ytd'); if (w) setRange(w.start, w.end) }}>Year to date</button>
      <button class="chip" type="button" data-range="all-time" aria-pressed={chips.find((chip) => chip.name === 'all-time')?.active} onclick={() => { const w = quickRange('all-time'); if (w) setRange(w.start, w.end) }}>All time</button>
    </div>
    <input bind:this={monthInput} class="visually-hidden" type="month" tabindex="-1" aria-hidden="true" onchange={onMonthPicked} />
    <p class="insights-note" title={compareNote.title}>{compareNote.text}</p>
  </section>

  <details class="card">
    <summary>
      <span>Transactions</span>
      <span class="muted">{rangeTxCount ? formatCount(rangeTxCount) : ''}</span>
    </summary>
    <TransactionList id="transactionsList" transactions={sortedRangeTxs} markFuture />
    <p class="muted" hidden={rangeTxCount > 0}>No transactions in this range.</p>
  </details>

  <section class="card" hidden={historyHidden}>
    <div class="card__header">
      <h2>Monthly totals</h2>
      <span class="card__header-tools">
        <span class="card__context">{historyRange}</span>
        <span class="chart-legend">
          <span class="chart-legend__item">
            <span class="chart-legend__swatch"></span>Out
          </span>
          <span class="chart-legend__item">
            <span class="chart-legend__swatch chart-legend__swatch--in"></span>In
          </span>
        </span>
      </span>
    </div>
    <div bind:this={historyHost} class="chart-host"></div>
    <div bind:this={historyTooltip} class="chart-tooltip" hidden></div>
  </section>

  <div id="insightsContent">
    {#if error}
      <section class="card">
        <p class="muted">{error}</p>
      </section>
    {:else if !model}
      <section class="card">
        <p class="muted">Loading insights…</p>
      </section>
    {:else if model.future}
      <section class="card">
        <p class="muted">This range is in the future. Statistics will appear once the period starts.</p>
      </section>
    {:else if model.sections.length === 0}
      <section class="card">
        <p class="muted">No transactions in this range.</p>
      </section>
    {:else}
      {#each model.sections as section (section.code)}
        <section class="card insights-section" data-currency={section.code} style={`--currency: ${section.color}`}>
          <div class="insights-section__header">
            <span class="currency-badge">
              <span class="insights-section__code">{section.code}</span>
            </span>
            <span class="muted insights-section__meta" title={section.basisTitle}>{section.count} · {section.basisLabel}</span>
          </div>

          <div class="kpi-grid">
            {#each section.kpis as kpi (kpi.label)}
              <div class="kpi">
                <span class="kpi__label" title={kpi.labelTitle}>{kpi.label}</span>
                <span class="kpi__value" style={kpi.valueColor ? `color: ${kpi.valueColor}` : undefined} use:breakable={kpi.valueText}></span>
                <span class="kpi__delta {kpi.delta.className}" title={kpi.delta.title}>{kpi.delta.text}</span>
              </div>
            {/each}
          </div>

          <div class="insights-grid">
            <div class="insights-panel">
              {#each [{ key: 'spending', title: 'Spending by category', list: section.spending }, { key: 'earning', title: 'Earned by category', list: section.earning }] as group (group.key)}
                {#if group.list}
                  <div class="panel__head">
                    <h3 class="panel__title">{group.title}</h3>
                    <div class="panel__controls">
                      <button class="link-button" type="button" onclick={() => updateExcluded(section.code, group.list.categories, true)}>All</button>
                      <button class="link-button" type="button" onclick={() => updateExcluded(section.code, group.list.categories, false)}>None</button>
                    </div>
                  </div>
                  <div class="category-list">
                    {#each group.list.rows as row (row.category)}
                      <label class="category-row{row.checked ? '' : ' category-row--excluded'}">
                        <input
                          type="checkbox"
                          checked={row.checked}
                          onchange={(event) => updateExcluded(section.code, [row.category], event.target.checked)}
                        />
                        <span class="category-dot" style={`background: ${row.color}`}></span>
                        <span class="category-row__name">
                          <span class="category-row__label">{row.category}</span>
                          <span class="category-row__share">{row.share}</span>
                        </span>
                        <span class="category-row__amount-wrap">
                          <span class="category-row__amount" use:breakable={row.amountText}></span>
                          {#if row.delta}
                            <span class="category-row__delta {row.delta.className}" title={row.delta.title}>{row.delta.text}</span>
                          {/if}
                        </span>
                        <span class="category-row__bar">
                          <span class="category-row__bar-fill" style={`width: ${row.barPercent}%; background: ${row.color}`}></span>
                        </span>
                      </label>
                    {/each}
                  </div>
                {/if}
              {/each}
            </div>

            <div class="insights-panel">
              <h3 class="panel__title">Cumulative spent &amp; earned</h3>
              <CumulativeChart data={section.chartData} />
              <div class="series-legend">
                {#each section.legend as item (item.label)}
                  <span class="series-legend__item{item.baseline ? ' series-legend__item--baseline' : ''}">
                    <span class="series-legend__swatch{item.baseline ? ' series-legend__swatch--line' : ''}" style={`background: ${item.color}`}></span>
                    {item.label}
                  </span>
                {/each}
              </div>
              <div class="forecast">
                {#if section.forecast.length === 0}
                  <p class="muted">Not enough data to forecast this range.</p>
                {:else}
                  {#each section.forecast as row (row.label)}
                    <div class="forecast__row">
                      <span>{row.label}</span>
                      <strong title={row.title} use:breakable={row.value}></strong>
                    </div>
                  {/each}
                {/if}
              </div>
            </div>
          </div>

          <div class="movers">
            {#if !section.hasComparison}
              <p class="muted">{section.noComparisonText}</p>
            {:else}
              {#each section.movers as block (block.title)}
                <div class="movers__block">
                  <h3 class="panel__title">{block.title}</h3>
                  <div class="movers__grid">
                    {#each [{ key: 'increases', heading: 'Increases', entries: block.increases, empty: 'None.' }, { key: 'decreases', heading: 'Decreases', entries: block.decreases, empty: 'None.' }] as column (column.key)}
                      <div class="movers__column">
                        <h4 class="movers__heading">{column.heading}</h4>
                        {#if column.entries.length === 0}
                          <p class="muted">{column.empty}</p>
                        {:else}
                          <ul class="movers__list">
                            {#each column.entries as entry (entry.category)}
                              <li class="movers__item">
                                <span class="category-dot" style={`background: ${entry.color}`}></span>
                                <span class="movers__name">{entry.category}</span>
                                <span class="movers__amount {entry.amountClass}" use:breakable={entry.amountText}></span>
                                <span class="movers__pct muted">{entry.pctText}</span>
                              </li>
                            {/each}
                          </ul>
                        {/if}
                      </div>
                    {/each}
                  </div>
                </div>
              {/each}
            {/if}
          </div>
        </section>
      {/each}
    {/if}
  </div>
</main>

<Toasts />
