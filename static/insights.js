'use strict'

// Insights: date-range filters and comparisons, the read-only transactions
// panel, the range chart and the per-currency sections.
const { dates, formats, moneyFor, currencyColor, setBreakableText, requestJson, initTheme, showToast } = DSCPLN

const IM = DSCPLN.math
const TX = DSCPLN.transactions

const $ = (id) => document.getElementById(id)

const els = {
    themeButton: $('themeButton'),
    startDate: $('startDate'),
    endDate: $('endDate'),
    comparisonSelect: $('comparisonSelect'),
    monthChip: $('monthChip'),
    monthPickerInput: $('monthPickerInput'),
    compareNote: $('compareNote'),
    rangeLabel: $('rangeLabel'),
    transactionsCard: $('transactionsCard'),
    transactionsList: $('transactionsList'),
    transactionsMeta: $('transactionsMeta'),
    transactionsEmpty: $('transactionsEmpty'),
    historyCard: $('historyCard'),
    historyChart: $('historyChart'),
    historyTooltip: $('historyTooltip'),
    historyRange: $('historyRange'),
    content: $('insightsContent'),
    toasts: $('toasts'),
}

const COMPARISON_MODES = ['prev', 'yoy', 'avg3', 'avg6', 'avg12']

const CATEGORY_PALETTE = ['#2f6fed', '#16a34a', '#d97706', '#8b5cf6', '#0891b2', '#db2777', '#65a30d', '#e11d48', '#0d9488', '#7c3aed', '#ca8a04', '#4f46e5']

const state = {
    range: null,
    comparison: 'prev',
    reference: null,
    transactions: [],
    fractionalCurrencies: new Set(),
    symbols: new Map(),
    excluded: new Map(),
    comparisonData: null,
}

let fetchSequence = 0

// Local shorthand for core's DOM builder.
const el = (tag, className, text, ...children) => DSCPLN.el(tag, { class: className, text }, ...children)

const categoryColor = (name) => DSCPLN.colorFrom(CATEGORY_PALETTE, String(name || ''))

const money = moneyFor(
    (code) => state.fractionalCurrencies.has(code),
    (code) => state.symbols.get(code))

function toast(message, type = 'error') {
    showToast(els.toasts, message, type)
}

/* ---------- Ranges & presets ---------- */

// Statistics never count dates after today; the selected range still drives
// the date inputs, URL and chart axis.
function elapsedRange() {
    return IM.elapsedRange(state.range.start, state.range.end, dates.startOfDay(new Date()))
}

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
    const range = state.reference && state.reference.transactionRange
    if (!range || !range.first || !range.last) {
        return null
    }
    return { start: IM.parseIsoDate(range.first), end: IM.parseIsoDate(range.last) }
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

function quickRange(name) {
    const build = QUICK_RANGES[name]
    return build ? build() : null
}

function isFullMonth(range) {
    return isWholeMonths(range) &&
        range.start.getMonth() === range.end.getMonth() &&
        range.start.getFullYear() === range.end.getFullYear()
}

function isWholeMonths(range) {
    return IM.isWholeMonthsRange(range.start, range.end)
}

const formatDateRange = (start, end) =>
    `${formats.dayMonth.format(start)} ${formats.year.format(start)} – ${formats.dayMonth.format(end)} ${formats.year.format(end)}`

// A compact date range ("1 Oct – 7 Oct"), with the year when it is not the
// selected range's year (so last-year comparisons stay unambiguous).
function shortRange(window) {
    const start = formats.dayMonth.format(window.start)
    const end = formats.dayMonth.format(window.end)
    const body = window.start.getTime() === window.end.getTime() ? start : `${start} – ${end}`
    return window.start.getFullYear() === state.range.start.getFullYear() ?
        body : `${body} ${formats.year.format(window.start)}`
}

function comparisonShortLabel(plan) {
    if (plan.kind === 'average') {
        return plan.count > 0 ? `${plan.count}-mo avg` : 'no prior data'
    }
    const window = plan.windows[0]
    if (window.start.getFullYear() !== state.comparisonData.statsRange.start.getFullYear()) {
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
        const span = `${formats.dayMonth.format(first.start)}–${formats.dayMonth.format(first.end)}`
        return plan.count === 1 ?
            `the same days of ${formats.monthYear.format(first.start)} (${span})` :
            `the average of the same days of each month ${formats.monthShort.format(first.start)}–${formats.monthShort.format(last.start)} ${formats.year.format(last.start)} (e.g. ${span})`
    }
    return `${plan.count}-month average of ${formats.monthShort.format(first.start)}–${formats.monthShort.format(last.end)} ${formats.year.format(last.end)}`
}

// The comparison note is deliberately one short line; the full explanation
// lives in its tooltip.
function setCompareNote(text, details) {
    els.compareNote.textContent = text
    els.compareNote.title = details || ''
}

function comparisonDetails(statsRange, statsPlan, partial) {
    const parts = [`Figures cover ${formatDateRange(statsRange.start, statsRange.end)}.`]
    if (statsPlan.kind === 'average') {
        parts.push(statsPlan.count === 0 ?
            'No earlier complete month has data for the average.' :
            `Compared with ${comparisonLongLabel(statsPlan)}.`)
    } else {
        const window = statsPlan.windows[0]
        const matching = IM.isWholeMonthsRange(window.start, window.end) ? '' :
            window.start.getFullYear() === statsRange.start.getFullYear() ?
                ' (matching calendar days of the previous month)' :
                ' (matching calendar days of the previous year)'
        parts.push(`Compared with ${comparisonLongLabel(statsPlan)}${matching}.`)
    }
    if (partial) {
        parts.push('Future dates are excluded.')
    }
    return parts.join(' ')
}

function updateCompareNote() {
    if (!state.range || !state.comparisonData) {
        return
    }
    const statsRange = elapsedRange()
    if (state.range.start > dates.startOfDay(new Date())) {
        setCompareNote('This range has not started yet.', '')
        return
    }
    const statsPlan = IM.comparisonPlan(state.comparison, statsRange, state.comparisonData.earliest)
    const partial = IM.toIsoDate(statsRange.end) !== IM.toIsoDate(state.range.end)
    const comparison = statsPlan.count === 0 ? 'no earlier data' : comparisonBasisLabel(statsPlan)
    setCompareNote(`${shortRange(statsRange)} vs ${comparison}`,
        comparisonDetails(statsRange, statsPlan, partial))
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
        const range = state.comparisonData.statsRange
        const span = range.start.getDate() === range.end.getDate() ?
            `${range.start.getDate()}` :
            `${range.start.getDate()}–${range.end.getDate()}`
        return `${comparisonShortLabel(plan)} (${span})`
    }
    return shortRange(plan.windows[0])
}

function syncInputs() {
    els.startDate.value = IM.toIsoDate(state.range.start)
    els.endDate.value = IM.toIsoDate(state.range.end)
    els.monthChip.textContent = isFullMonth(state.range) ? formats.monthYear.format(state.range.start) : 'Pick a month'
    els.monthPickerInput.value = isFullMonth(state.range)
        ? `${state.range.start.getFullYear()}-${String(state.range.start.getMonth() + 1).padStart(2, '0')}`
        : ''
    els.rangeLabel.textContent = formatDateRange(state.range.start, state.range.end)
    for (const chip of document.querySelectorAll('.chip[data-range]')) {
        const range = quickRange(chip.dataset.range)
        const active = range &&
            IM.toIsoDate(range.start) === IM.toIsoDate(state.range.start) &&
            IM.toIsoDate(range.end) === IM.toIsoDate(state.range.end)
        chip.setAttribute('aria-pressed', active ? 'true' : 'false')
    }
    els.comparisonSelect.value = state.comparison
    updateCompareNote()
}

function syncUrl() {
    const params = new URLSearchParams({
        start: IM.toIsoDate(state.range.start),
        end: IM.toIsoDate(state.range.end),
        cmp: state.comparison,
    })
    history.replaceState(null, '', `${location.pathname}?${params}`)
}

function setRange(start, end, { fetch = true } = {}) {
    if (!start || !end || start > end) {
        return
    }
    state.range = { start, end }
    syncUrl()
    syncInputs()
    if (fetch) {
        fetchData()
    }
}

function stateFromUrl() {
    const params = new URLSearchParams(location.search)
    const start = IM.parseIsoDate(params.get('start'))
    const end = IM.parseIsoDate(params.get('end'))
    const comparison = COMPARISON_MODES.includes(params.get('cmp')) ? params.get('cmp') : 'prev'
    return {
        range: start && end && start <= end ? { start, end } : null,
        comparison,
    }
}

/* ---------- Data ---------- */

function transactionsIn(currency, range, excluded) {
    return IM.filterTransactions(state.transactions, {
        start: range.start,
        end: range.end,
        currency,
        excludedCategories: excluded,
    })
}

function rangeTransactions(range = elapsedRange()) {
    return IM.filterTransactions(state.transactions, {
        start: range.start,
        end: range.end,
    })
}

async function fetchData() {
    const sequence = ++fetchSequence
    if (!state.reference) {
        document.body.classList.add('is-loading')
    }
    try {
        // Statistics use the elapsed part of the range, while the chart and
        // forecast use the selected range so they can show the full comparison
        // periods. Plans fetched without the per-currency data-age clamp cover a
        // superset of the windows used for display.
        const statsRange = elapsedRange()
        const chartRange = state.range
        const statsPlan = IM.comparisonPlan(state.comparison, statsRange)
        const chartPlan = IM.comparisonPlan(state.comparison, chartRange)
        const today = dates.startOfDay(new Date())
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
        const [reference, transactions] = await Promise.all([
            state.reference ? Promise.resolve(state.reference) : requestJson('/data'),
            requestJson(`/transactions?${params}`),
        ])
        if (sequence !== fetchSequence) {
            return
        }
        state.reference = reference
        state.transactions = transactions.transactions || []
        state.fractionalCurrencies = new Set(
            (reference.currencies || []).filter((entry) => entry.fractional).map((entry) => entry.code))
        state.symbols = new Map(
            (reference.currencies || []).filter((entry) => entry.symbol).map((entry) => [entry.code, entry.symbol]))
        const firstMonths = new Map((reference.currencies || []).map((entry) => [
            entry.code,
            entry.firstMonth ? IM.parseIsoDate(entry.firstMonth) : null,
        ]))
        // The note and basis labels use the earliest month any currency has
        // data; each section clamps further to its own currency's first month.
        const earliest = [...firstMonths.values()].reduce((min, date) =>
            date && (!min || date < min) ? date : min, null)
        state.comparisonData = {
            statsRange,
            chartRange,
            earliest,
            firstMonths,
        }
        syncInputs()
        renderContent()
    } catch (e) {
        if (sequence === fetchSequence) {
            console.error(e)
            els.content.textContent = ''
            const card = el('section', 'card')
            card.appendChild(el('p', 'muted', 'Could not load insights. Check the server logs.'))
            els.content.appendChild(card)
            toast('Could not load insights')
        }
    } finally {
        if (sequence === fetchSequence) {
            document.body.classList.remove('is-loading')
        }
    }
}

/* ---------- Panels ---------- */

function renderTransactionsPanel(rangeTxs) {
    els.transactionsCard.hidden = false
    els.transactionsMeta.textContent = rangeTxs.length ? TX.formatCount(rangeTxs.length) : ''
    els.transactionsEmpty.hidden = rangeTxs.length > 0
    TX.renderList(els.transactionsList, rangeTxs, { writable: false, markFuture: true })
}

function renderHistoryPanel(rangeTxs) {
    if (!IM.spansMultipleMonths(state.range.start, state.range.end) || rangeTxs.length === 0) {
        els.historyCard.hidden = true
        return
    }
    const conversionCategories = new Set(state.reference.conversionCategories || [])
    const months = IM.monthPartials(state.range.start, state.range.end).map((entry) => ({
        ...entry,
        currencies: {},
    }))
    const monthIndex = new Map(months.map((entry, index) => [`${entry.year}|${entry.month}`, index]))
    for (const currency of state.reference.currencies || []) {
        for (const month of months) {
            month.currencies[currency.code] = { spend: 0, income: 0 }
        }
    }
    for (const transaction of rangeTxs) {
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
    els.historyCard.hidden = false
    els.historyRange.textContent = `${formats.monthYear.format(state.range.start)} – ${formats.monthYear.format(state.range.end)}`
    const codes = (state.reference.currencies || []).map((currency) => currency.code)
    const rendered = DSCPLN.chart.renderMonthly(els.historyChart, els.historyTooltip, {
        months,
        codes,
        money,
        symbolFor: (code) => state.symbols.get(code),
    })
    if (!rendered) {
        els.historyCard.hidden = true
    }
}

function scaleMap(map, factor) {
    const scaled = {}
    for (const [key, value] of Object.entries(map)) {
        scaled[key] = value * factor
    }
    return scaled
}

// The comparison plans for one currency. Months before a currency's first
// transaction are skipped so its averages only cover months with data.
function sectionPlans(code) {
    const data = state.comparisonData
    const firstDataMonth = data.firstMonths.get(code) || null
    return {
        stats: IM.comparisonPlan(state.comparison, data.statsRange, firstDataMonth),
        chart: IM.comparisonPlan(state.comparison, data.chartRange, firstDataMonth),
    }
}

function comparisonForSection(code, excluded, plan) {
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
    const windowTxs = plan.windows.flatMap((window) => transactionsIn(code, window, excluded))
    const raw = IM.totals(windowTxs)
    const factor = plan.factor
    return {
        kind: plan.kind,
        hasData: raw.count > 0,
        spend: raw.spend * factor,
        income: raw.income * factor,
        net: raw.net * factor,
        count: raw.count * factor,
        dailySpend: plan.days > 0 ? raw.spend / plan.days : 0,
        dailyIncome: plan.days > 0 ? raw.income / plan.days : 0,
        spendMap: scaleMap(IM.categoryTotalsMap(windowTxs, 'expense'), factor),
        incomeMap: scaleMap(IM.categoryTotalsMap(windowTxs, 'income'), factor),
    }
}

function renderContent() {
    const today = dates.startOfDay(new Date())
    const statTxs = rangeTransactions()
    renderTransactionsPanel(rangeTransactions(state.range))
    if (state.range.start > today) {
        els.historyCard.hidden = true
        els.content.textContent = ''
        els.content.appendChild(el('section', 'card', '',
            el('p', 'muted', 'This range is in the future. Statistics will appear once the period starts.')))
        return
    }
    renderHistoryPanel(statTxs)
    renderSections(statTxs)
}

// Rebuilds only the per-currency sections (used by category toggles, which
// shouldn't re-render the transactions panel or the range chart).
function renderSections(rangeTxs) {
    els.content.textContent = ''

    if (rangeTxs.length === 0) {
        els.content.appendChild(el('section', 'card', '', el('p', 'muted', 'No transactions in this range.')))
        return
    }

    const byCurrency = new Map()
    for (const transaction of rangeTxs) {
        if (!byCurrency.has(transaction.currency)) {
            byCurrency.set(transaction.currency, [])
        }
        byCurrency.get(transaction.currency).push(transaction)
    }

    const primary = (state.reference.currencies || []).find((entry) => entry.primary)
    const volume = (code) => {
        const total = IM.totals(byCurrency.get(code))
        return total.spend + total.income
    }
    const codes = [...byCurrency.keys()].sort((a, b) => {
        if (primary && a === primary.code) return -1
        if (primary && b === primary.code) return 1
        return volume(b) - volume(a)
    })

    for (const code of codes) {
        els.content.appendChild(buildSection(code, byCurrency.get(code)))
    }
}

/* ---------- Currency sections ---------- */

function buildSection(code, rangeTxs) {
    const currency = (state.reference.currencies || []).find((entry) => entry.code === code) || { code }
    let excluded = state.excluded.get(code)
    if (!excluded) {
        excluded = new Set(state.reference.conversionCategories || [])
        state.excluded.set(code, excluded)
    }

    const included = rangeTxs.filter((transaction) => !excluded.has(transaction.category))
    const plans = sectionPlans(code)
    const comparison = comparisonForSection(code, excluded, plans.stats)

    const section = el('section', 'card insights-section')
    section.dataset.currency = code
    section.style.setProperty('--currency', currencyColor(code) || 'var(--accent)')

    const header = el('div', 'insights-section__header')
    const badge = el('span', 'currency-badge')
    badge.appendChild(el('span', 'insights-section__code', code))
    header.appendChild(badge)
    const meta = el('span', 'muted insights-section__meta',
        `${TX.formatCount(included.length)} · ${comparisonBasisLabel(plans.stats)}`)
    meta.title = comparisonLongLabel(plans.stats)
    header.appendChild(meta)
    section.appendChild(header)

    section.appendChild(buildKpis(code, included, comparison, plans.stats))
    section.appendChild(buildColumns(code, included, rangeTxs, comparison, excluded, plans))
    section.appendChild(buildMovers(code, included, comparison, plans.stats))
    return section
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

function buildKpis(code, included, comparison, plan) {
    const current = IM.totals(included)
    const days = daysElapsed()
    const grid = el('div', 'kpi-grid')
    grid.append(
        kpiTile('Spent', current.spend, comparison.spend, { tone: 'spend', code, plan }),
        kpiTile('Earned', current.income, comparison.income, { tone: 'income', code, plan }),
        kpiTile('Net', current.net, comparison.net, {
            tone: 'income',
            code,
            plan,
            // Net colors by sign and intensity; the delta colors by direction.
            color: netColor(current.net, current.spend, current.income),
        }),
        kpiTile('Avg / day', current.spend / days, comparison.dailySpend, { tone: 'spend', code, plan }),
        kpiTile('Avg earned / day', current.income / days, comparison.dailyIncome, { tone: 'income', code, plan }),
        kpiTile('Transactions', current.count, comparison.count, { tone: 'neutral', plan })
    )
    return grid
}

function daysElapsed() {
    const range = state.comparisonData ? state.comparisonData.statsRange : elapsedRange()
    return Math.max(1, IM.daysInclusive(range.start, range.end))
}

function kpiTile(label, value, comparisonValue, options = {}) {
    const tile = el('div', 'kpi')
    const labelEl = el('span', 'kpi__label', label)
    const range = state.comparisonData && state.comparisonData.statsRange
    if (range) {
        labelEl.title = `Current period: ${formatDateRange(range.start, range.end)}`
    }
    tile.appendChild(labelEl)
    const valueEl = el('span', 'kpi__value')
    setBreakableText(valueEl, options.code ? money(value, options.code) : String(value))
    if (options.color) {
        valueEl.style.color = options.color
    }
    tile.appendChild(valueEl)

    const delta = el('span', 'kpi__delta')
    if (comparisonValue == null || (value === 0 && comparisonValue === 0)) {
        delta.textContent = '—'
        delta.classList.add('muted')
    } else {
        const change = IM.delta(value, comparisonValue)
        const short = comparisonShortLabel(options.plan)
        if (change.pct == null) {
            const amount = options.code ?
                money(Math.abs(change.amount), options.code) :
                String(IM.clean(Math.abs(change.amount)))
            delta.textContent = `${change.amount > 0 ? '+' : change.amount < 0 ? '−' : ''}${amount} vs ${short}`
        } else {
            delta.textContent = `${change.pct > 0 ? '+' : ''}${change.pct.toFixed(0)}% vs ${short}`
        }
        delta.title = comparisonLongLabel(options.plan)
        if (options.tone === 'spend') {
            delta.classList.add(change.amount === 0 ? 'muted' : change.amount > 0 ? 'kpi__delta--bad' : 'kpi__delta--good')
        } else if (options.tone === 'income') {
            delta.classList.add(change.amount === 0 ? 'muted' : change.amount > 0 ? 'kpi__delta--good' : 'kpi__delta--bad')
        } else {
            delta.classList.add('muted')
        }
    }
    tile.appendChild(delta)
    return tile
}

function buildColumns(code, included, all, comparison, excluded, plans) {
    const grid = el('div', 'insights-grid')
    grid.append(
        buildCategories(all, comparison, excluded, code, plans.stats),
        buildTrendAndForecast(code, included, excluded, plans)
    )
    return grid
}

function buildCategories(all, comparison, excluded, code, plan) {
    const panel = el('div', 'insights-panel')
    const toggleAll = (categories, include) => {
        for (const category of categories) {
            if (include) {
                excluded.delete(category)
            } else {
                excluded.add(category)
            }
        }
        state.excluded.set(code, excluded)
        renderSections(rangeTransactions())
    }

    const addList = (title, kind, comparisonMap) => {
        const rows = IM.aggregateByCategory(all, kind)
        if (rows.length === 0) {
            return
        }
        const max = Math.max(...rows.map((row) => row.amount))
        const total = rows
            .filter((row) => !excluded.has(row.category))
            .reduce((sum, row) => sum + row.amount, 0)

        const head = el('div', 'panel__head')
        head.appendChild(el('h3', 'panel__title', title))
        const controls = el('div', 'panel__controls')
        const allButton = el('button', 'link-button', 'All')
        const noneButton = el('button', 'link-button', 'None')
        allButton.type = 'button'
        noneButton.type = 'button'
        const categories = rows.map((row) => row.category)
        allButton.addEventListener('click', () => toggleAll(categories, true))
        noneButton.addEventListener('click', () => toggleAll(categories, false))
        controls.append(allButton, noneButton)
        head.appendChild(controls)
        panel.appendChild(head)

        const list = el('div', 'category-list')
        for (const row of rows) {
            list.appendChild(buildCategoryRow(row, max, total, comparisonMap[row.category] || 0, excluded, code, plan))
        }
        panel.appendChild(list)
    }

    addList('Spending by category', 'expense', comparison.spendMap)
    addList('Earned by category', 'income', comparison.incomeMap)
    return panel
}

function buildCategoryRow(row, max, total, comparisonAmount, excluded, code, plan) {
    const item = document.createElement('label')
    item.className = 'category-row'
    if (excluded.has(row.category)) {
        item.classList.add('category-row--excluded')
    }

    const check = document.createElement('input')
    check.type = 'checkbox'
    check.checked = !excluded.has(row.category)
    check.addEventListener('change', () => {
        if (check.checked) {
            excluded.delete(row.category)
        } else {
            excluded.add(row.category)
        }
        state.excluded.set(code, excluded)
        renderSections(rangeTransactions())
    })

    const dot = el('span', 'category-dot')
    dot.style.background = categoryColor(row.category)

    const name = el('span', 'category-row__name')
    name.appendChild(el('span', 'category-row__label', row.category))
    name.appendChild(el('span', 'category-row__share', total > 0 ? `${Math.round((row.amount / total) * 100)}%` : '0%'))

    const amountWrap = el('span', 'category-row__amount-wrap')
    const amount = el('span', 'category-row__amount')
    setBreakableText(amount, money(row.amount, code))
    amountWrap.appendChild(amount)
    const delta = IM.delta(row.amount, comparisonAmount)
    if (delta.pct != null) {
        const deltaEl = el('span', `category-row__delta ${delta.amount > 0 ? 'is-up' : delta.amount < 0 ? 'is-down' : 'muted'}`,
            `${delta.amount > 0 ? '+' : ''}${delta.pct.toFixed(0)}%`)
        deltaEl.title = `vs ${comparisonLongLabel(plan)}`
        amountWrap.appendChild(deltaEl)
    } else if (row.amount > 0) {
        const deltaEl = el('span', 'category-row__delta is-up', 'new')
        deltaEl.title = `vs ${comparisonLongLabel(plan)}`
        amountWrap.appendChild(deltaEl)
    }

    const bar = el('span', 'category-row__bar')
    const fill = el('span', 'category-row__bar-fill')
    fill.style.width = `${max > 0 ? Math.max(2, (row.amount / max) * 100) : 0}%`
    fill.style.background = categoryColor(row.category)
    bar.appendChild(fill)

    item.append(check, dot, name, amountWrap, bar)
    return item
}

function buildTrendAndForecast(code, included, excluded, plans) {
    const panel = el('div', 'insights-panel')
    panel.appendChild(el('h3', 'panel__title', 'Cumulative spent & earned'))
    const chartHost = el('div', 'insights-chart-host')
    panel.appendChild(chartHost)

    const daily = IM.dailySeries(included, state.range.start, state.range.end)
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
    const baseline = cumulativeBaseline(code, excluded, plans.chart)
    const middle = daily[Math.floor((daily.length - 1) / 2)]
    // The solid lines end at today; the dashed baselines span the full range.
    const solidDays = IM.daysInclusive(state.range.start, elapsedRange().end)
    DSCPLN.chart.renderCumulative(chartHost, {
        daily,
        spendCumulative: spendCumulative.slice(0, solidDays),
        incomeCumulative: incomeCumulative.slice(0, solidDays),
        baselineSpend: baseline.spend, baselineIncome: baseline.income,
        currency: code,
        symbol: state.symbols.get(code),
        axisLabels: [
            formats.dayMonth.format(state.range.start),
            middle ? formats.dayMonth.format(dates.parseIso(middle.date)) : '',
            formats.dayMonth.format(state.range.end),
        ],
    })

    const short = comparisonShortLabel(plans.stats)
    const laneColor = currencyColor(code) || 'var(--accent)'
    panel.appendChild(el('div', 'series-legend', '',
        legendItem('Spent', laneColor),
        legendItem('Earned', 'var(--ok)'),
        legendItem(`Spent vs ${short}`, laneColor, true),
        legendItem(`Earned vs ${short}`, 'var(--ok)', true)))

    panel.appendChild(buildForecast(code, excluded, plans.chart))
    return panel
}

function legendItem(label, color, baseline = false) {
    const swatch = el('span', `series-legend__swatch${baseline ? ' series-legend__swatch--line' : ''}`)
    swatch.style.background = color
    return el('span', `series-legend__item${baseline ? ' series-legend__item--baseline' : ''}`, '', swatch, label)
}

function cumulativeBaseline(code, excluded, plan) {
    const empty = { spend: [], income: [] }
    if (!plan || plan.windows.length === 0) {
        return empty
    }
    const days = IM.daysInclusive(state.range.start, state.range.end)
    const transactions = IM.filterTransactions(state.transactions, { currency: code, excludedCategories: excluded })
    return IM.baselineFromPlan(transactions, plan, days)
}

function buildForecast(code, excluded, chartPlan) {
    const wrap = el('div', 'forecast')
    const today = dates.startOfDay(new Date())
    const includesToday = state.range.start <= today && state.range.end >= today

    if (chartPlan.windows.length > 0 && chartPlan.days > 0) {
        const windowTxs = chartPlan.windows.flatMap((window) => transactionsIn(code, window, excluded))
        const windowTotals = IM.totals(windowTxs)
        if (windowTotals.spend > 0 || windowTotals.income > 0) {
            const factor = 30 / chartPlan.days
            wrap.appendChild(forecastRow(`Next 30 days (based on ${comparisonLongLabel(chartPlan)})`,
                `${money(windowTotals.spend * factor, code)} out · ${money(windowTotals.income * factor, code)} in`,
                'Extrapolates the comparison period’s average daily rate over 30 days.'))
        }
    }
    if (wrap.children.length === 0) {
        wrap.appendChild(el('p', 'muted', 'Not enough data to forecast this range.'))
    }
    return wrap
}

function forecastRow(label, value, title) {
    const row = el('div', 'forecast__row')
    row.appendChild(el('span', '', label))
    const strong = el('strong')
    if (title) {
        strong.title = title
    }
    setBreakableText(strong, value)
    row.appendChild(strong)
    return row
}

function buildMovers(code, included, comparison, plan) {
    const wrap = el('div', 'movers')
    if (!comparison.hasData) {
        wrap.appendChild(el('p', 'muted', `No comparison data for ${comparisonLongLabel(plan)}.`))
        return wrap
    }
    const addBlock = (title, currentMap, comparisonMap) => {
        const movers = IM.categoryMovers(currentMap, comparisonMap, 3)
        if (movers.increases.length === 0 && movers.decreases.length === 0) {
            return
        }
        const block = el('div', 'movers__block')
        block.appendChild(el('h3', 'panel__title', title))
        const grid = el('div', 'movers__grid')
        const addColumn = (heading, entries, emptyText) => {
            const column = el('div', 'movers__column')
            column.appendChild(el('h4', 'movers__heading', heading))
            if (entries.length === 0) {
                column.appendChild(el('p', 'muted', emptyText))
                return column
            }
            const list = el('ul', 'movers__list')
            for (const entry of entries) {
                const item = el('li', 'movers__item')
                const dot = el('span', 'category-dot')
                dot.style.background = categoryColor(entry.category)
                item.appendChild(dot)
                item.appendChild(el('span', 'movers__name', entry.category))
                item.appendChild(el('span', `movers__amount ${entry.delta.amount > 0 ? 'is-up' : 'is-down'}`,
                    `${entry.delta.amount > 0 ? '+' : '−'}${money(Math.abs(entry.delta.amount), code)}`))
                item.appendChild(el('span', 'movers__pct muted',
                    entry.delta.pct == null ? 'new' : `${entry.delta.pct > 0 ? '+' : ''}${entry.delta.pct.toFixed(0)}%`))
                list.appendChild(item)
            }
            column.appendChild(list)
            return column
        }
        grid.append(
            addColumn('Increases', movers.increases, 'None.'),
            addColumn('Decreases', movers.decreases, 'None.')
        )
        block.appendChild(grid)
        wrap.appendChild(block)
    }

    addBlock('Spending changes', IM.categoryTotalsMap(included, 'expense'), comparison.spendMap)
    addBlock('Earning changes', IM.categoryTotalsMap(included, 'income'), comparison.incomeMap)
    if (wrap.children.length === 0) {
        return document.createDocumentFragment()
    }
    return wrap
}

/* ---------- Wiring ---------- */

els.startDate.addEventListener('change', () => {
    const start = IM.parseIsoDate(els.startDate.value)
    if (!start) {
        return
    }
    const end = IM.parseIsoDate(els.endDate.value) || state.range.end
    setRange(start, end < start ? start : end)
})

els.endDate.addEventListener('change', () => {
    const end = IM.parseIsoDate(els.endDate.value)
    if (!end) {
        return
    }
    const start = IM.parseIsoDate(els.startDate.value) || state.range.start
    setRange(end < start ? end : start, end)
})

els.comparisonSelect.addEventListener('change', () => {
    state.comparison = COMPARISON_MODES.includes(els.comparisonSelect.value) ? els.comparisonSelect.value : 'prev'
    syncUrl()
    updateCompareNote()
    fetchData()
})

els.monthChip.addEventListener('click', () => {
    const input = els.monthPickerInput
    input.value = isFullMonth(state.range)
        ? `${state.range.start.getFullYear()}-${String(state.range.start.getMonth() + 1).padStart(2, '0')}`
        : ''
    if (typeof input.showPicker === 'function') {
        try {
            input.showPicker()
            return
        } catch (e) { }
    }
    input.focus()
    input.click()
})

els.monthPickerInput.addEventListener('change', () => {
    const match = /^(\d{4})-(\d{2})$/.exec(els.monthPickerInput.value)
    if (!match) {
        return
    }
    const date = new Date(Number(match[1]), Number(match[2]) - 1, 1)
    const range = currentMonthRange(date)
    setRange(range.start, range.end)
})

for (const chip of document.querySelectorAll('.chip[data-range]')) {
    chip.addEventListener('click', () => {
        const range = quickRange(chip.dataset.range)
        if (range) {
            setRange(range.start, range.end)
        }
    })
}

initTheme(els.themeButton)
const initial = stateFromUrl()
state.comparison = initial.comparison
state.range = initial.range || currentMonthRange()
syncInputs()
fetchData()
