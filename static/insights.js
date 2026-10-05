'use strict'

const { money: formatMoneyRaw, currencyColor, setBreakableText, hasSubCentPrecision } = DSCPLNFormat
const IM = DSCPLNInsights
const TX = DSCPLNTransactions

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

const THEME_KEY = 'dscpln-theme'
const THEME_ORDER = ['auto', 'light', 'dark']
const COMPARISON_MODES = ['prev', 'yoy', 'avg3', 'avg6', 'avg12']

const ICONS = {
    auto: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 0 0 18z" fill="currentColor" stroke="none"/></svg>',
    light: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
    dark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>',
}

const CATEGORY_PALETTE = ['#2f6fed', '#16a34a', '#d97706', '#8b5cf6', '#0891b2', '#db2777', '#65a30d', '#e11d48', '#0d9488', '#7c3aed', '#ca8a04', '#4f46e5']
const monthShortFormat = new Intl.DateTimeFormat(undefined, { month: 'short' })
const dayMonthFormat = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' })
const monthYearFormat = new Intl.DateTimeFormat(undefined, { month: 'short', year: 'numeric' })
const yearFormat = new Intl.DateTimeFormat(undefined, { year: 'numeric' })
const compactNumberFormat = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 })

const prefersDark = window.matchMedia('(prefers-color-scheme: dark)')

const state = {
    theme: readTheme(),
    range: null,
    comparison: 'prev',
    reference: null,
    transactions: [],
    fractionalCurrencies: new Set(),
    excluded: new Map(),
    comparisonData: null,
}

const pendingCharts = []
let fetchSequence = 0

function el(tag, className, text) {
    const node = document.createElement(tag)
    if (className) node.className = className
    if (text != null) node.textContent = text
    return node
}

function categoryColor(name) {
    let hash = 0
    for (const char of String(name || '')) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
    return CATEGORY_PALETTE[hash % CATEGORY_PALETTE.length]
}

function money(value, code) {
    return formatMoneyRaw(value, code, state.fractionalCurrencies.has(code))
}

function readTheme() {
    try {
        const theme = localStorage.getItem(THEME_KEY)
        return THEME_ORDER.includes(theme) ? theme : 'auto'
    } catch (e) {
        return 'auto'
    }
}

function saveTheme(theme) {
    try {
        localStorage.setItem(THEME_KEY, theme)
    } catch (e) { }
}

function applyTheme() {
    const dark = state.theme === 'dark' || (state.theme === 'auto' && prefersDark.matches)
    document.documentElement.dataset.theme = dark ? 'dark' : 'light'
    els.themeButton.innerHTML = ICONS[state.theme]
    els.themeButton.title = `Theme: ${state.theme}`
    els.themeButton.setAttribute('aria-label', `Theme: ${state.theme}. Click to change.`)
}

function toast(message, type = 'error') {
    const node = el('div', `toast toast--${type}`, message)
    node.setAttribute('role', 'status')
    els.toasts.appendChild(node)
    window.setTimeout(() => {
        node.classList.add('toast--leaving')
        window.setTimeout(() => node.remove(), 350)
    }, 4000)
}

/* ---------- Ranges & presets ---------- */

function currentMonthRange(date = new Date()) {
    const start = IM.startOfMonth(date)
    const monthEnd = IM.endOfMonth(date)
    const today = new Date()
    const isThisMonth = start.getFullYear() === today.getFullYear() && start.getMonth() === today.getMonth()
    const end = isThisMonth && today < monthEnd ? today : monthEnd
    return { start, end }
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

function quickRange(name) {
    if (name === 'this-month') return currentMonthRange()
    if (name === 'last-month') return lastMonthRange()
    if (name === 'last-3') return lastFullMonthsRange(3)
    if (name === 'last-6') return lastFullMonthsRange(6)
    if (name === 'last-12') return lastFullMonthsRange(12)
    if (name === 'ytd') return ytdRange()
    if (name === 'all-time') return allTimeRange()
    return null
}

function isFullMonth(range) {
    return IM.toIsoDate(range.start) === IM.toIsoDate(IM.startOfMonth(range.start)) &&
        IM.toIsoDate(range.end) === IM.toIsoDate(IM.endOfMonth(range.end)) &&
        range.start.getMonth() === range.end.getMonth() &&
        range.start.getFullYear() === range.end.getFullYear()
}

function isWholeMonths(range) {
    return IM.toIsoDate(range.start) === IM.toIsoDate(IM.startOfMonth(range.start)) &&
        IM.toIsoDate(range.end) === IM.toIsoDate(IM.endOfMonth(range.end))
}

function comparisonShortLabel() {
    const window = IM.comparisonWindow(state.comparison, state.range)
    if (window.kind === 'average') {
        return `${window.count}-mo avg`
    }
    return state.comparison === 'yoy' ? 'last year' : 'previous period'
}

function comparisonLongLabel() {
    const window = IM.comparisonWindow(state.comparison, state.range)
    if (window.kind === 'average') {
        return `${window.count}-month average of ${monthShortFormat.format(window.start)}–${monthShortFormat.format(window.end)} ${yearFormat.format(window.end)}`
    }
    return `${dayMonthFormat.format(window.start)} ${yearFormat.format(window.start)} – ${dayMonthFormat.format(window.end)} ${yearFormat.format(window.end)}`
}

function updateCompareNote() {
    if (!state.range) {
        return
    }
    const window = IM.comparisonWindow(state.comparison, state.range)
    const rangeDays = IM.daysInclusive(state.range.start, state.range.end)
    const rangeLabel = `${dayMonthFormat.format(state.range.start)} ${yearFormat.format(state.range.start)} – ${dayMonthFormat.format(state.range.end)} ${yearFormat.format(state.range.end)}`
    let text
    if (window.kind === 'average') {
        text = `Comparing ${rangeLabel} (${rangeDays} days) with the ${window.count}-month average (${monthShortFormat.format(window.start)}–${monthShortFormat.format(window.end)} ${yearFormat.format(window.end)}), scaled per day.`
    } else {
        text = `Comparing ${rangeLabel} (${rangeDays} days) with ${comparisonLongLabel()} (${IM.daysInclusive(window.start, window.end)} days).`
    }
    if (!isWholeMonths(state.range)) {
        text += ' The selected range covers partial months.'
    }
    els.compareNote.textContent = text
}

function syncInputs() {
    els.startDate.value = IM.toIsoDate(state.range.start)
    els.endDate.value = IM.toIsoDate(state.range.end)
    els.monthChip.textContent = isFullMonth(state.range) ? monthYearFormat.format(state.range.start) : 'Pick a month'
    els.monthPickerInput.value = isFullMonth(state.range)
        ? `${state.range.start.getFullYear()}-${String(state.range.start.getMonth() + 1).padStart(2, '0')}`
        : ''
    els.rangeLabel.textContent = `${dayMonthFormat.format(state.range.start)} ${yearFormat.format(state.range.start)} – ${dayMonthFormat.format(state.range.end)} ${yearFormat.format(state.range.end)}`
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

function detectFractional(transactions) {
    const codes = new Set()
    for (const transaction of transactions) {
        const amount = transaction.kind === 'income' ? transaction.moneyIn : transaction.expenses
        if (hasSubCentPrecision(amount)) {
            codes.add(transaction.currency)
        }
    }
    return codes
}

function transactionsIn(currency, range, excluded) {
    const start = IM.toIsoDate(range.start)
    const end = IM.toIsoDate(range.end)
    return state.transactions.filter((transaction) =>
        transaction.currency === currency &&
        transaction.date >= start &&
        transaction.date <= end &&
        !(excluded && excluded.has(transaction.category)))
}

function rangeTransactions() {
    const start = IM.toIsoDate(state.range.start)
    const end = IM.toIsoDate(state.range.end)
    return state.transactions.filter((transaction) => transaction.date >= start && transaction.date <= end)
}

async function fetchData() {
    const sequence = ++fetchSequence
    if (!state.reference) {
        document.body.classList.add('is-loading')
    }
    try {
        // The selected comparison window drives every comparison on the page,
        // including the forecast, so it is the only extra data we fetch.
        const window = IM.comparisonWindow(state.comparison, state.range)
        const params = new URLSearchParams({
            start: IM.toIsoDate(window.start),
            end: IM.toIsoDate(state.range.end),
        })
        const [reference, transactions] = await Promise.all([
            state.reference ? Promise.resolve(state.reference) : fetch('/data').then((response) => {
                if (!response.ok) throw new Error(`Request failed (${response.status})`)
                return response.json()
            }),
            fetch(`/transactions?${params}`).then((response) => {
                if (!response.ok) throw new Error(`Request failed (${response.status})`)
                return response.json()
            }),
        ])
        if (sequence !== fetchSequence) {
            return
        }
        state.reference = reference
        state.transactions = transactions.transactions || []
        state.fractionalCurrencies = detectFractional(state.transactions)
        state.comparisonData = {
            window,
            factor: IM.comparisonFactor(window, state.range),
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
    TX.renderList(els.transactionsList, rangeTxs, { writable: false, markFuture: false })
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
    els.historyRange.textContent = `${monthYearFormat.format(state.range.start)} – ${monthYearFormat.format(state.range.end)}`
    const codes = (state.reference.currencies || []).map((currency) => currency.code)
    if (!DSCPLNHistory.render(els.historyChart, els.historyTooltip, { months, codes })) {
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
    const raw = IM.totals(transactionsIn(code, data.window, excluded))
    const factor = data.factor
    return {
        kind: data.window.kind,
        spend: raw.spend * factor,
        income: raw.income * factor,
        net: raw.net * factor,
        count: data.window.kind === 'range' ? raw.count : null,
        spendMap: scaleMap(IM.categoryTotalsMap(transactionsIn(code, data.window, excluded), 'expense'), factor),
        incomeMap: scaleMap(IM.categoryTotalsMap(transactionsIn(code, data.window, excluded), 'income'), factor),
    }
}

function renderContent() {
    pendingCharts.length = 0
    const rangeTxs = rangeTransactions()
    renderTransactionsPanel(rangeTxs)
    renderHistoryPanel(rangeTxs)
    els.content.textContent = ''

    if (rangeTxs.length === 0) {
        const card = el('section', 'card')
        card.appendChild(el('p', 'muted', 'No transactions in this range.'))
        els.content.appendChild(card)
        window.requestAnimationFrame(drawPendingCharts)
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
    window.requestAnimationFrame(drawPendingCharts)
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
    header.appendChild(el('span', 'muted', TX.formatCount(rangeTxs.length)))
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
        kpiTile('Avg / day', days > 0 ? current.spend / days : 0,
            days > 0 ? comparison.spend / days : 0, { tone: 'spend', code }),
        kpiTile('Avg earned / day', days > 0 ? current.income / days : 0,
            days > 0 ? comparison.income / days : 0, { tone: 'income', code }),
        kpiTile('Transactions', current.count, comparison.count, { tone: 'neutral' })
    )
    return grid
}

function daysElapsed() {
    return Math.max(1, IM.daysInclusive(state.range.start, state.range.end))
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
        renderContent()
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
        renderContent()
    })

    const dot = el('span', 'category-row__dot')
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
    const sameMonth = state.range.start.getFullYear() === state.range.end.getFullYear() &&
        state.range.start.getMonth() === state.range.end.getMonth()

    panel.appendChild(el('h3', 'panel__title', sameMonth ? 'Cumulative spent & earned' : 'Monthly totals'))
    const chartHost = el('div', 'insights-chart-host')
    panel.appendChild(chartHost)

    if (sameMonth) {
        const monthStart = IM.startOfMonth(state.range.start)
        const monthEnd = IM.endOfMonth(state.range.start)
        const daily = IM.dailySeries(included, monthStart, monthEnd)
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
        pendingCharts.push({
            host: chartHost,
            draw: (width) => drawCumulativeChart(chartHost, width, {
                daily, spendCumulative, incomeCumulative,
                baselineSpend: baseline.spend, baselineIncome: baseline.income,
                currency: code,
            }),
        })
        const short = comparisonShortLabel()
        const laneColor = currencyColor(code) || 'var(--accent)'
        const legend = el('div', 'chart-legend')
        const items = [
            { label: 'Spent', color: laneColor },
            { label: 'Earned', color: 'var(--ok)' },
            { label: `Spent vs ${short}`, color: laneColor, baseline: true },
            { label: `Earned vs ${short}`, color: 'var(--ok)', baseline: true },
        ]
        for (const item of items) {
            const entry = el('span', `chart-legend__item${item.baseline ? ' chart-legend__item--baseline' : ''}`)
            const swatch = el('span', `chart-legend__swatch${item.baseline ? ' chart-legend__swatch--line' : ''}`)
            swatch.style.background = item.color
            entry.append(swatch, el('span', '', item.label))
            legend.appendChild(entry)
        }
        panel.appendChild(legend)
    } else {
        const byMonth = new Map(IM.monthlySeries(included).map((entry) => [entry.month, entry]))
        const months = IM.monthPartials(state.range.start, state.range.end).map((entry) => {
            const key = `${entry.year}-${String(entry.month).padStart(2, '0')}`
            return byMonth.get(key) || { month: key, spend: 0, income: 0 }
        })
        pendingCharts.push({
            host: chartHost,
            draw: (width) => drawMonthlyChart(chartHost, width, months, code),
        })
    }

    panel.appendChild(buildForecast(code, excluded))
    return panel
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
    const window = data.window
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
    const today = new Date()
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
        wrap.appendChild(forecastRow('Projected month-end spend', money(projected.spend, code)))
        wrap.appendChild(forecastRow('Projected month-end income', money(projected.income, code)))
    }

    const data = state.comparisonData
    const window = data.window
    const windowTotals = IM.totals(transactionsIn(code, window, excluded))
    const windowDays = IM.daysInclusive(window.start, window.end)
    if (windowDays > 0 && (windowTotals.spend > 0 || windowTotals.income > 0)) {
        const factor = 30 / windowDays
        const label = window.kind === 'average' ?
            `Next 30 days (avg of ${monthShortFormat.format(window.start)}–${monthShortFormat.format(window.end)} ${yearFormat.format(window.end)})` :
            `Next 30 days (based on ${dayMonthFormat.format(window.start)}–${dayMonthFormat.format(window.end)} ${yearFormat.format(window.end)})`
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
                const dot = el('span', 'category-row__dot')
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

/* ---------- Charts ---------- */

const SVG_NS = 'http://www.w3.org/2000/svg'

function svgEl(tag, attributes = {}) {
    const node = document.createElementNS(SVG_NS, tag)
    for (const [name, value] of Object.entries(attributes)) {
        node.setAttribute(name, value)
    }
    return node
}

function niceMax(value) {
    if (!Number.isFinite(value) || value <= 0) {
        return 0
    }
    const exponent = Math.floor(Math.log10(value))
    const base = 10 ** exponent
    const fraction = value / base
    const nice = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10
    return nice * base
}

function compactMoney(value) {
    const absolute = Math.abs(value)
    if (absolute >= 1000) {
        return `$${compactNumberFormat.format(value)}`
    }
    if (absolute >= 1) {
        return `$${Math.round(value).toLocaleString()}`
    }
    return `$${value.toFixed(2)}`
}

function drawPendingCharts() {
    for (const chart of pendingCharts) {
        const width = Math.max(240, Math.round(chart.host.clientWidth || 480))
        chart.draw(width)
    }
}

function drawCumulativeChart(host, width, data) {
    host.textContent = ''
    const height = 210
    const pad = { top: 12, right: 10, bottom: 26, left: 48 }
    const plotWidth = width - pad.left - pad.right
    const plotHeight = height - pad.top - pad.bottom
    const baselineSpend = data.baselineSpend || []
    const baselineIncome = data.baselineIncome || []
    const max = niceMax(Math.max(
        ...data.spendCumulative,
        ...data.incomeCumulative,
        ...baselineSpend,
        ...baselineIncome,
        0
    )) || 1
    const svg = svgEl('svg', {
        viewBox: `0 0 ${width} ${height}`,
        class: 'insights-chart',
        role: 'img',
        'aria-label': `Cumulative spend and earned for ${data.currency}`,
    })
    const x = (index) => pad.left + (index / (data.daily.length - 1 || 1)) * plotWidth
    const y = (value) => pad.top + plotHeight - (value / max) * plotHeight

    for (const factor of [0, 0.5, 1]) {
        const lineY = y(max * factor)
        svg.appendChild(svgEl('line', {
            x1: pad.left, x2: pad.left + plotWidth, y1: lineY, y2: lineY,
            class: factor === 0 ? 'history__baseline' : 'history__grid',
        }))
        const tick = svgEl('text', { x: pad.left - 6, y: lineY + 3.5, class: 'history__tick' })
        tick.textContent = compactMoney(max * factor)
        svg.appendChild(tick)
    }

    if (baselineSpend.length > 0) {
        const points = baselineSpend.map((value, index) => `${x(index)},${y(value)}`).join(' ')
        svg.appendChild(svgEl('polyline', { points, class: 'insights-chart__baseline' }))
    }
    if (baselineIncome.length > 0) {
        const points = baselineIncome.map((value, index) => `${x(index)},${y(value)}`).join(' ')
        svg.appendChild(svgEl('polyline', { points, class: 'insights-chart__baseline insights-chart__baseline--earned' }))
    }

    const spendPoints = data.spendCumulative.map((value, index) => `${x(index)},${y(value)}`)
    if (spendPoints.length > 0) {
        svg.appendChild(svgEl('polyline', { points: spendPoints.join(' '), class: 'insights-chart__line' }))
    }
    const incomePoints = data.incomeCumulative.map((value, index) => `${x(index)},${y(value)}`)
    if (incomePoints.length > 0) {
        svg.appendChild(svgEl('polyline', { points: incomePoints.join(' '), class: 'insights-chart__line insights-chart__line--earned' }))
    }

    const labelIndexes = [0, Math.floor((data.daily.length - 1) / 2), data.daily.length - 1]
    for (const index of labelIndexes) {
        const label = svgEl('text', {
            x: x(index), y: height - 8, class: 'history__label',
            'text-anchor': index === 0 ? 'start' : index === data.daily.length - 1 ? 'end' : 'middle',
        })
        label.textContent = String(index + 1)
        svg.appendChild(label)
    }
    host.appendChild(svg)
}

function drawMonthlyChart(host, width, months, currency) {
    host.textContent = ''
    const height = 210
    const pad = { top: 12, right: 10, bottom: 30, left: 48 }
    const plotWidth = width - pad.left - pad.right
    const plotHeight = height - pad.top - pad.bottom
    const max = niceMax(Math.max(0, ...months.map((month) => Math.max(month.spend, month.income)))) || 1
    const svg = svgEl('svg', {
        viewBox: `0 0 ${width} ${height}`,
        class: 'insights-chart',
        role: 'img',
        'aria-label': `Monthly spend and income for ${currency}`,
    })
    const slot = plotWidth / months.length
    const barWidth = Math.max(2, Math.min(14, (slot * 0.3)))
    const y = (value) => pad.top + plotHeight - (value / max) * plotHeight
    const baseY = y(0)

    for (const factor of [0, 0.5, 1]) {
        const lineY = y(max * factor)
        svg.appendChild(svgEl('line', {
            x1: pad.left, x2: pad.left + plotWidth, y1: lineY, y2: lineY,
            class: factor === 0 ? 'history__baseline' : 'history__grid',
        }))
        const tick = svgEl('text', { x: pad.left - 6, y: lineY + 3.5, class: 'history__tick' })
        tick.textContent = compactMoney(max * factor)
        svg.appendChild(tick)
    }

    const color = currencyColor(currency) || 'var(--accent)'
    const labelStep = Math.max(1, Math.ceil(months.length / Math.max(2, Math.floor(plotWidth / 44))))
    const labeled = []
    for (let index = months.length - 1; index >= 0; index -= labelStep) {
        labeled.unshift(index)
    }
    months.forEach((month, index) => {
        const center = pad.left + slot * index + slot / 2
        const spendHeight = (month.spend / max) * plotHeight
        const incomeHeight = (month.income / max) * plotHeight
        if (spendHeight > 0) {
            const bar = svgEl('rect', {
                x: center - barWidth - 1, y: baseY - spendHeight, width: barWidth, height: spendHeight,
                rx: Math.min(2, barWidth / 2).toFixed(2), class: 'history__bar',
            })
            bar.style.fill = color
            svg.appendChild(bar)
        }
        if (incomeHeight > 0) {
            const bar = svgEl('rect', {
                x: center + 1, y: baseY - incomeHeight, width: barWidth, height: incomeHeight,
                rx: Math.min(2, barWidth / 2).toFixed(2), class: 'history__bar history__bar--in',
            })
            bar.style.fill = color
            bar.style.stroke = color
            svg.appendChild(bar)
        }
        if (labeled.includes(index)) {
            const [year, monthNumber] = month.month.split('-').map(Number)
            const date = new Date(year, monthNumber - 1, 1)
            const label = svgEl('text', {
                x: center, y: height - 8, class: 'history__label',
                'text-anchor': index === months.length - 1 ? 'end' : index === 0 ? 'start' : 'middle',
            })
            const showYear = monthNumber === 1 || index === labeled[0]
            label.textContent = `${monthShortFormat.format(date)}${showYear ? ` '${String(year).slice(-2)}` : ''}`
            svg.appendChild(label)
        }
    })
    host.appendChild(svg)
}

/* ---------- Wiring ---------- */

els.themeButton.addEventListener('click', () => {
    state.theme = THEME_ORDER[(THEME_ORDER.indexOf(state.theme) + 1) % THEME_ORDER.length]
    saveTheme(state.theme)
    applyTheme()
})

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
    if (isFullMonth(state.range)) {
        input.value = `${state.range.start.getFullYear()}-${String(state.range.start.getMonth() + 1).padStart(2, '0')}`
    }
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

prefersDark.addEventListener('change', () => {
    if (state.theme === 'auto') {
        applyTheme()
    }
})

applyTheme()
const initial = stateFromUrl()
state.comparison = initial.comparison
state.range = initial.range || lastMonthRange()
syncInputs()
fetchData()
