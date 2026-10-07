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
    excluded: new Map(),
    comparisonData: null,
}

let fetchSequence = 0

// Local shorthand for core's DOM builder.
const el = (tag, className, text, ...children) => DSCPLN.el(tag, { class: className, text }, ...children)

const categoryColor = (name) => DSCPLN.colorFrom(CATEGORY_PALETTE, String(name || ''))

const money = moneyFor((code) => state.fractionalCurrencies.has(code))

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

function comparisonShortLabel() {
    const range = elapsedRange()
    const window = IM.comparisonWindow(state.comparison, range)
    if (window.kind === 'average') {
        return `${window.count}-mo avg`
    }
    if (window.start.getFullYear() !== range.start.getFullYear()) {
        return 'last year'
    }
    return IM.spansMultipleMonths(range.start, range.end) ? 'previous period' : 'previous month'
}

function comparisonLongLabel() {
    const window = IM.comparisonWindow(state.comparison, elapsedRange())
    if (window.kind === 'average') {
        return `${window.count}-month average of ${formats.monthShort.format(window.start)}–${formats.monthShort.format(window.end)} ${formats.year.format(window.end)}`
    }
    return formatDateRange(window.start, window.end)
}

function updateCompareNote() {
    if (!state.range) {
        return
    }
    const range = elapsedRange()
    const window = IM.comparisonWindow(state.comparison, range)
    const rangeDays = IM.daysInclusive(range.start, range.end)
    const rangeLabel = formatDateRange(range.start, range.end)
    let text
    if (window.kind === 'average') {
        text = `Comparing ${rangeLabel} (${rangeDays} days) with the ${window.count}-month average (${formats.monthShort.format(window.start)}–${formats.monthShort.format(window.end)} ${formats.year.format(window.end)}), scaled per day.`
    } else {
        text = `Comparing ${rangeLabel} (${rangeDays} days) with ${comparisonLongLabel()} (${IM.daysInclusive(window.start, window.end)} days).`
    }
    if (window.kind !== 'average' && !isWholeMonths(range)) {
        const sameYear = window.start.getFullYear() === range.start.getFullYear()
        text += sameYear ?
            ' Partial months are compared with the matching calendar days of the previous month.' :
            ' Partial months are compared with the matching calendar days of the previous year.'
    }
    if (IM.toIsoDate(range.end) !== IM.toIsoDate(state.range.end)) {
        const monthToDate = range.start.getDate() === 1 &&
            range.start.getMonth() === range.end.getMonth() &&
            range.start.getFullYear() === range.end.getFullYear()
        const through = `${formats.dayMonth.format(range.end)} ${formats.year.format(range.end)}`
        text += monthToDate ?
            ` Figures are month to date (through ${through}); future dates are excluded.` :
            ` Figures are through ${through}; future dates are excluded.`
    }
    els.compareNote.textContent = text
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
        // Statistics use the elapsed part of the range, while the chart's
        // baselines use the selected range so they can show the full
        // comparison period.
        const statsRange = elapsedRange()
        const window = IM.comparisonWindow(state.comparison, statsRange)
        const chartWindow = IM.comparisonWindow(state.comparison, state.range)
        // Fetch enough to cover both comparison windows, the forecast's
        // month-to-date data and the full selected range.
        const today = dates.startOfDay(new Date())
        let fetchStart = window.start < chartWindow.start ? window.start : chartWindow.start
        if (state.range.start <= today && today <= state.range.end) {
            const monthStart = IM.startOfMonth(today)
            if (monthStart < fetchStart) {
                fetchStart = monthStart
            }
        }
        const params = new URLSearchParams({
            start: IM.toIsoDate(fetchStart),
            end: IM.toIsoDate(state.range.end),
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
        state.comparisonData = {
            window,
            chartWindow,
            factor: IM.comparisonFactor(window, statsRange),
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
    if (!DSCPLN.chart.renderMonthly(els.historyChart, els.historyTooltip, { months, codes, money })) {
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

function comparisonForSection(code, excluded) {
    const data = state.comparisonData
    const windowTxs = transactionsIn(code, data.window, excluded)
    const raw = IM.totals(windowTxs)
    const factor = data.factor
    const windowDays = IM.daysInclusive(data.window.start, data.window.end)
    return {
        kind: data.window.kind,
        hasData: raw.count > 0,
        spend: raw.spend * factor,
        income: raw.income * factor,
        net: raw.net * factor,
        count: data.window.kind === 'range' ? raw.count : null,
        dailySpend: windowDays > 0 ? raw.spend / windowDays : 0,
        dailyIncome: windowDays > 0 ? raw.income / windowDays : 0,
        spendMap: scaleMap(IM.categoryTotalsMap(windowTxs, 'expense'), factor),
        incomeMap: scaleMap(IM.categoryTotalsMap(windowTxs, 'income'), factor),
    }
}

function renderContent() {
    const statTxs = rangeTransactions()
    renderTransactionsPanel(rangeTransactions(state.range))
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
    const comparison = comparisonForSection(code, excluded)

    const section = el('section', 'card insights-section')
    section.dataset.currency = code
    section.style.setProperty('--currency', currencyColor(code) || 'var(--accent)')

    const header = el('div', 'insights-section__header')
    const badge = el('span', 'currency-badge')
    badge.appendChild(el('span', 'insights-section__code', code))
    header.appendChild(badge)
    header.appendChild(el('span', 'muted', TX.formatCount(included.length)))
    section.appendChild(header)

    section.appendChild(buildKpis(code, included, comparison))
    section.appendChild(buildColumns(code, included, rangeTxs, comparison, excluded))
    section.appendChild(buildMovers(code, included, comparison))
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

function buildKpis(code, included, comparison) {
    const current = IM.totals(included)
    const days = daysElapsed()
    const grid = el('div', 'kpi-grid')
    grid.append(
        kpiTile('Spent', current.spend, comparison.spend, { tone: 'spend', code }),
        kpiTile('Earned', current.income, comparison.income, { tone: 'income', code }),
        kpiTile('Net', current.net, comparison.net, {
            tone: 'income',
            code,
            color: netColor(current.net, current.spend, current.income),
        }),
        kpiTile('Avg / day', current.spend / days, comparison.dailySpend, { tone: 'spend', code }),
        kpiTile('Avg earned / day', current.income / days, comparison.dailyIncome, { tone: 'income', code }),
        kpiTile('Transactions', current.count, comparison.count, { tone: 'neutral' })
    )
    return grid
}

function daysElapsed() {
    const range = elapsedRange()
    return Math.max(1, IM.daysInclusive(range.start, range.end))
}

function kpiTile(label, value, comparisonValue, options = {}) {
    const tile = el('div', 'kpi')
    tile.appendChild(el('span', 'kpi__label', label))
    const valueEl = el('span', 'kpi__value')
    setBreakableText(valueEl, options.code ? money(value, options.code) : String(value))
    if (options.color) {
        valueEl.style.color = options.color
    }
    tile.appendChild(valueEl)

    const delta = el('span', 'kpi__delta')
    if (comparisonValue == null || (comparisonValue <= 0 && value <= 0)) {
        delta.textContent = '—'
        delta.classList.add('muted')
    } else {
        const change = IM.delta(value, comparisonValue)
        const up = change.amount > 0
        const short = comparisonShortLabel()
        delta.textContent = change.pct == null ? `new vs ${short}` : `${up ? '+' : ''}${change.pct.toFixed(0)}% vs ${short}`
        delta.title = comparisonLongLabel()
        if (options.tone === 'spend') {
            delta.classList.add(change.amount === 0 ? 'muted' : up ? 'kpi__delta--bad' : 'kpi__delta--good')
        } else if (options.tone === 'income') {
            delta.classList.add(change.amount === 0 ? 'muted' : up ? 'kpi__delta--good' : 'kpi__delta--bad')
        } else {
            delta.classList.add('muted')
        }
    }
    tile.appendChild(delta)
    return tile
}

function buildColumns(code, included, all, comparison, excluded) {
    const grid = el('div', 'insights-grid')
    grid.append(
        buildCategories(all, comparison, excluded, code),
        buildTrendAndForecast(code, included, comparison, excluded)
    )
    return grid
}

function buildCategories(all, comparison, excluded, code) {
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
            list.appendChild(buildCategoryRow(row, max, total, comparisonMap[row.category] || 0, excluded, code))
        }
        panel.appendChild(list)
    }

    addList('Spending by category', 'expense', comparison.spendMap)
    addList('Earned by category', 'income', comparison.incomeMap)
    return panel
}

function buildCategoryRow(row, max, total, comparisonAmount, excluded, code) {
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
        deltaEl.title = `vs ${comparisonLongLabel()}`
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

function buildTrendAndForecast(code, included, comparison, excluded) {
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
    const baseline = cumulativeBaseline(code, excluded)
    const middle = daily[Math.floor((daily.length - 1) / 2)]
    // The solid lines end at today; the dashed baselines span the full range.
    const solidDays = IM.daysInclusive(state.range.start, elapsedRange().end)
    DSCPLN.chart.renderCumulative(chartHost, {
        daily,
        spendCumulative: spendCumulative.slice(0, solidDays),
        incomeCumulative: incomeCumulative.slice(0, solidDays),
        baselineSpend: baseline.spend, baselineIncome: baseline.income,
        currency: code,
        axisLabels: [
            formats.dayMonth.format(state.range.start),
            middle ? formats.dayMonth.format(dates.parseIso(middle.date)) : '',
            formats.dayMonth.format(state.range.end),
        ],
    })

    const short = comparisonShortLabel()
    const laneColor = currencyColor(code) || 'var(--accent)'
    panel.appendChild(el('div', 'series-legend', '',
        legendItem('Spent', laneColor),
        legendItem('Earned', 'var(--ok)'),
        legendItem(`Spent vs ${short}`, laneColor, true),
        legendItem(`Earned vs ${short}`, 'var(--ok)', true)))

    panel.appendChild(buildForecast(code, excluded))
    return panel
}

function legendItem(label, color, baseline = false) {
    const swatch = el('span', `series-legend__swatch${baseline ? ' series-legend__swatch--line' : ''}`)
    swatch.style.background = color
    return el('span', `series-legend__item${baseline ? ' series-legend__item--baseline' : ''}`, '', swatch, label)
}

// Resamples a cumulative series to `targetLength` points so comparisons with
// a different number of days (e.g. September vs August) still align.
function resampleSeries(values, targetLength) {
    if (values.length === 0) {
        return []
    }
    return Array.from({ length: targetLength }, (_, index) => {
        const position = Math.round(((index + 1) / targetLength) * values.length) - 1
        return values[Math.max(0, Math.min(values.length - 1, position))]
    })
}

function cumulativeBaseline(code, excluded) {
    const data = state.comparisonData
    const empty = { spend: [], income: [] }
    if (!data) {
        return empty
    }
    const window = data.chartWindow || data.window
    const days = IM.daysInclusive(state.range.start, state.range.end)
    if (window.kind === 'average') {
        const totals = IM.totals(transactionsIn(code, window, excluded))
        const windowDays = IM.daysInclusive(window.start, window.end)
        const spendPerDay = windowDays > 0 ? totals.spend / windowDays : 0
        const incomePerDay = windowDays > 0 ? totals.income / windowDays : 0
        return {
            spend: Array.from({ length: days }, (_, index) => IM.clean(spendPerDay * (index + 1))),
            income: Array.from({ length: days }, (_, index) => IM.clean(incomePerDay * (index + 1))),
        }
    }
    const daily = IM.dailySeries(transactionsIn(code, window, excluded), window.start, window.end)
    let runningSpend = 0
    let runningIncome = 0
    const spend = daily.map((day) => {
        runningSpend += day.spend
        return IM.clean(runningSpend)
    })
    const income = daily.map((day) => {
        runningIncome += day.income
        return IM.clean(runningIncome)
    })
    return {
        spend: resampleSeries(spend, days),
        income: resampleSeries(income, days),
    }
}

function buildForecast(code, excluded) {
    const wrap = el('div', 'forecast')
    const today = dates.startOfDay(new Date())
    const includesToday = state.range.start <= today && state.range.end >= today

    if (includesToday) {
        const monthStart = IM.startOfMonth(today)
        const monthTxs = state.transactions.filter((transaction) =>
            transaction.currency === code &&
            transaction.date >= IM.toIsoDate(monthStart) &&
            transaction.date <= IM.toIsoDate(today) &&
            !excluded.has(transaction.category))
        const monthTotals = IM.totals(monthTxs)
        const daysInMonth = IM.endOfMonth(today).getDate()
        const elapsed = Math.max(1, today.getDate())
        const projected = IM.projectMonthEnd({
            spend: monthTotals.spend, income: monthTotals.income, elapsedDays: elapsed, daysInMonth,
        })
        wrap.appendChild(forecastRow('Projected month-end spend (month to date)', money(projected.spend, code)))
        wrap.appendChild(forecastRow('Projected month-end income (month to date)', money(projected.income, code)))
    }

    const data = state.comparisonData
    const window = data.window
    const windowTotals = IM.totals(transactionsIn(code, window, excluded))
    const windowDays = IM.daysInclusive(window.start, window.end)
    if (windowDays > 0 && (windowTotals.spend > 0 || windowTotals.income > 0)) {
        const factor = 30 / windowDays
        const label = window.kind === 'average' ?
            `Next 30 days (avg of ${formats.monthShort.format(window.start)}–${formats.monthShort.format(window.end)} ${formats.year.format(window.end)})` :
            `Next 30 days (based on ${formats.dayMonth.format(window.start)}–${formats.dayMonth.format(window.end)} ${formats.year.format(window.end)})`
        wrap.appendChild(forecastRow(label,
            `${money(windowTotals.spend * factor, code)} out · ${money(windowTotals.income * factor, code)} in`))
    }
    if (wrap.children.length === 0) {
        wrap.appendChild(el('p', 'muted', 'Not enough data to forecast this range.'))
    }
    return wrap
}

function forecastRow(label, value) {
    const row = el('div', 'forecast__row')
    row.appendChild(el('span', '', label))
    const strong = el('strong')
    setBreakableText(strong, value)
    row.appendChild(strong)
    return row
}

function buildMovers(code, included, comparison) {
    const wrap = el('div', 'movers')
    if (!comparison.hasData) {
        wrap.appendChild(el('p', 'muted', `No comparison data for ${comparisonLongLabel()}.`))
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
