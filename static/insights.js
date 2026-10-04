'use strict'

const { money: formatMoneyRaw, currencyColor, setBreakableText, hasSubCentPrecision } = DSCPLNFormat
const IM = DSCPLNInsights

const $ = (id) => document.getElementById(id)

const els = {
    themeButton: $('themeButton'),
    startDate: $('startDate'),
    endDate: $('endDate'),
    monthPicker: $('monthPicker'),
    rangeLabel: $('rangeLabel'),
    content: $('insightsContent'),
    toasts: $('toasts'),
}

const THEME_KEY = 'dscpln-theme'
const THEME_ORDER = ['auto', 'light', 'dark']

const ICONS = {
    auto: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 0 0 18z" fill="currentColor" stroke="none"/></svg>',
    light: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
    dark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>',
}

const CATEGORY_PALETTE = ['#2f6fed', '#16a34a', '#d97706', '#8b5cf6', '#0891b2', '#db2777', '#65a30d', '#e11d48', '#0d9488', '#7c3aed', '#ca8a04', '#4f46e5']
const monthShortFormat = new Intl.DateTimeFormat(undefined, { month: 'short' })
const dayMonthFormat = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' })
const yearFormat = new Intl.DateTimeFormat(undefined, { year: 'numeric' })
const compactNumberFormat = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 })

const prefersDark = window.matchMedia('(prefers-color-scheme: dark)')

const state = {
    theme: readTheme(),
    range: null,
    reference: null,
    transactions: [],
    fractionalCurrencies: new Set(),
    excluded: new Map(),
}

const pendingCharts = []
let fetchSequence = 0
let resizeTimer = null

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

/* ---------- Range handling ---------- */

// Defaults to the previous month: the current month is incomplete, so
// period-over-period comparisons would be misleading.
function defaultRange() {
    return lastMonthRange()
}

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

function monthsBackRange(count) {
    const today = new Date()
    return { start: new Date(today.getFullYear(), today.getMonth() - (count - 1), 1), end: today }
}

function ytdRange() {
    const today = new Date()
    return { start: new Date(today.getFullYear(), 0, 1), end: today }
}

function quickRange(name) {
    if (name === 'this-month') return currentMonthRange()
    if (name === 'last-month') return lastMonthRange()
    if (name === 'last-3') return monthsBackRange(3)
    if (name === 'last-6') return monthsBackRange(6)
    if (name === 'last-12') return monthsBackRange(12)
    if (name === 'ytd') return ytdRange()
    return null
}

function isFullMonth(range) {
    return IM.toIsoDate(range.start) === IM.toIsoDate(IM.startOfMonth(range.start)) &&
        IM.toIsoDate(range.end) === IM.toIsoDate(IM.endOfMonth(range.end)) &&
        range.start.getMonth() === range.end.getMonth() &&
        range.start.getFullYear() === range.end.getFullYear()
}

function syncInputs() {
    els.startDate.value = IM.toIsoDate(state.range.start)
    els.endDate.value = IM.toIsoDate(state.range.end)
    els.monthPicker.value = isFullMonth(state.range)
        ? `${state.range.start.getFullYear()}-${String(state.range.start.getMonth() + 1).padStart(2, '0')}`
        : ''
    els.rangeLabel.textContent = `${dayMonthFormat.format(state.range.start)} ${yearFormat.format(state.range.start)} – ${dayMonthFormat.format(state.range.end)} ${yearFormat.format(state.range.end)}`
    for (const chip of document.querySelectorAll('.chip')) {
        const range = quickRange(chip.dataset.range)
        const active = range &&
            IM.toIsoDate(range.start) === IM.toIsoDate(state.range.start) &&
            IM.toIsoDate(range.end) === IM.toIsoDate(state.range.end)
        chip.setAttribute('aria-pressed', active ? 'true' : 'false')
    }
}

function setRange(start, end, { fetch = true } = {}) {
    if (!start || !end || start > end) {
        return
    }
    state.range = { start, end }
    const params = new URLSearchParams({ start: IM.toIsoDate(start), end: IM.toIsoDate(end) })
    history.replaceState(null, '', `${location.pathname}?${params}`)
    syncInputs()
    if (fetch) {
        fetchData()
    }
}

function rangeFromUrl() {
    const params = new URLSearchParams(location.search)
    const start = IM.parseIsoDate(params.get('start'))
    const end = IM.parseIsoDate(params.get('end'))
    return start && end && start <= end ? { start, end } : null
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

async function fetchData() {
    const sequence = ++fetchSequence
    if (!state.reference) {
        document.body.classList.add('is-loading')
    }
    try {
        const previous = IM.previousRange(state.range.start, state.range.end)
        const trailingStart = new Date(state.range.end.getFullYear(), state.range.end.getMonth() - 3, 1)
        const fetchStart = previous.start < trailingStart ? previous.start : trailingStart
        const params = new URLSearchParams({
            start: IM.toIsoDate(fetchStart),
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

function transactionsIn(currency, range, excluded) {
    const start = IM.toIsoDate(range.start)
    const end = IM.toIsoDate(range.end)
    return state.transactions.filter((transaction) =>
        transaction.currency === currency &&
        transaction.date >= start &&
        transaction.date <= end &&
        !(excluded && excluded.has(transaction.category)))
}

/* ---------- Rendering ---------- */

function renderContent() {
    pendingCharts.length = 0
    els.content.textContent = ''
    const rangeTxs = state.transactions.filter((transaction) => {
        const end = IM.toIsoDate(state.range.end)
        const start = IM.toIsoDate(state.range.start)
        return transaction.date >= start && transaction.date <= end
    })
    if (rangeTxs.length === 0) {
        const card = el('section', 'card')
        card.appendChild(el('p', 'muted', 'No transactions in this range.'))
        els.content.appendChild(card)
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

function buildSection(code, rangeTxs) {
    const currency = (state.reference.currencies || []).find((entry) => entry.code === code) || { code }
    const excluded = state.excluded.get(code) || new Set()
    state.excluded.set(code, excluded)

    const included = rangeTxs.filter((transaction) => !excluded.has(transaction.category))
    const previousRange = IM.previousRange(state.range.start, state.range.end)
    const previousIncluded = transactionsIn(code, previousRange, excluded)
    const previousAll = transactionsIn(code, previousRange, null)

    const section = el('section', 'card insights-section')
    section.dataset.currency = code
    section.style.setProperty('--currency', currencyColor(code) || 'var(--accent)')

    const header = el('div', 'insights-section__header')
    const badge = el('span', 'currency-badge')
    badge.appendChild(el('span', 'insights-section__code', code))
    header.appendChild(badge)
    const metaParts = []
    metaParts.push(`${rangeTxs.length} ${rangeTxs.length === 1 ? 'transaction' : 'transactions'}`)
    if (currency.monthlyBudget > 0) {
        metaParts.push(`${money(currency.monthlyBudget, code)} budget`)
    }
    header.appendChild(el('span', 'muted', metaParts.join(' · ')))
    section.appendChild(header)

    section.appendChild(buildKpis(code, included, previousIncluded))
    section.appendChild(buildColumns(code, included, rangeTxs, previousAll, excluded, currency))
    section.appendChild(buildMovers(code, included, previousIncluded))
    return section
}

function buildKpis(code, included, previousIncluded) {
    const current = IM.totals(included)
    const previous = IM.totals(previousIncluded)
    const elapsedDays = daysElapsed()
    const grid = el('div', 'kpi-grid')
    grid.append(
        kpiTile('Spent', current.spend, previous.spend, { tone: 'spend', code }),
        kpiTile('Earned', current.income, previous.income, { tone: 'income', code }),
        kpiTile('Net', current.net, previous.net, { tone: 'income', code }),
        kpiTile('Avg / day', elapsedDays > 0 ? current.spend / elapsedDays : 0,
            elapsedDays > 0 ? previous.spend / elapsedDays : 0, { tone: 'spend', code }),
        kpiTile('Transactions', current.count, previous.count, { tone: 'neutral' })
    )
    return grid
}

function daysElapsed() {
    const today = new Date()
    const start = state.range.start
    const end = state.range.end > today ? today : state.range.end
    if (end < start) {
        return 0
    }
    return IM.daysInclusive(start, end)
}

function kpiTile(label, value, previousValue, options) {
    const tile = el('div', 'kpi')
    tile.appendChild(el('span', 'kpi__label', label))
    const valueEl = el('span', 'kpi__value')
    setBreakableText(valueEl, options.code ? money(value, options.code) : String(value))
    tile.appendChild(valueEl)

    const delta = IM.delta(value, previousValue)
    const node = el('span', 'kpi__delta')
    if (previousValue <= 0 && value <= 0) {
        node.textContent = '—'
        node.classList.add('muted')
    } else if (delta.pct == null) {
        node.textContent = value > 0 ? 'new' : '—'
        node.classList.add('muted')
    } else {
        const up = delta.amount > 0
        node.textContent = `${up ? '+' : ''}${delta.pct.toFixed(0)}% vs prev`
        if (options.tone === 'spend') {
            node.classList.add(delta.amount === 0 ? 'muted' : up ? 'kpi__delta--bad' : 'kpi__delta--good')
        } else if (options.tone === 'income') {
            node.classList.add(delta.amount === 0 ? 'muted' : up ? 'kpi__delta--good' : 'kpi__delta--bad')
        } else {
            node.classList.add('muted')
        }
    }
    tile.appendChild(node)
    return tile
}

function buildColumns(code, included, all, previousAll, excluded, currency) {
    const grid = el('div', 'insights-grid')
    grid.append(
        buildCategories(all, previousAll, excluded, code),
        buildTrendAndForecast(code, included, currency)
    )
    return grid
}

function buildCategories(all, previousAll, excluded, code) {
    const panel = el('div', 'insights-panel')
    const toggleAll = (kind, categories, include) => {
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

    const addList = (title, kind) => {
        const rows = IM.aggregateByCategory(all, kind)
        if (rows.length === 0) {
            return
        }
        const max = Math.max(...rows.map((row) => row.amount))
        const total = rows
            .filter((row) => !excluded.has(row.category))
            .reduce((sum, row) => sum + row.amount, 0)
        const previousMap = IM.categoryTotalsMap(previousAll, kind)

        const head = el('div', 'panel__head')
        head.appendChild(el('h3', 'panel__title', title))
        const controls = el('div', 'panel__controls')
        const allButton = el('button', 'link-button', 'All')
        const noneButton = el('button', 'link-button', 'None')
        allButton.type = 'button'
        noneButton.type = 'button'
        const categories = rows.map((row) => row.category)
        allButton.addEventListener('click', () => toggleAll(kind, categories, true))
        noneButton.addEventListener('click', () => toggleAll(kind, categories, false))
        controls.append(allButton, noneButton)
        head.appendChild(controls)
        panel.appendChild(head)

        const list = el('div', 'category-list')
        for (const row of rows) {
            list.appendChild(buildCategoryRow(row, max, total, previousMap[row.category] || 0, excluded, code))
        }
        panel.appendChild(list)
    }

    addList('Spending by category', 'expense')
    addList('Earned by category', 'income')
    return panel
}

function buildCategoryRow(row, max, total, previousAmount, excluded, code) {
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
    const delta = IM.delta(row.amount, previousAmount)
    if (delta.pct != null) {
        amountWrap.appendChild(el('span', `category-row__delta ${delta.amount > 0 ? 'is-up' : delta.amount < 0 ? 'is-down' : 'muted'}`,
            `${delta.amount > 0 ? '+' : ''}${delta.pct.toFixed(0)}%`))
    }

    const bar = el('span', 'category-row__bar')
    const fill = el('span', 'category-row__bar-fill')
    fill.style.width = `${max > 0 ? Math.max(2, (row.amount / max) * 100) : 0}%`
    fill.style.background = categoryColor(row.category)
    bar.appendChild(fill)

    item.append(check, dot, name, amountWrap, bar)
    return item
}

function buildTrendAndForecast(code, included, currency) {
    const panel = el('div', 'insights-panel')
    const sameMonth = state.range.start.getFullYear() === state.range.end.getFullYear() &&
        state.range.start.getMonth() === state.range.end.getMonth()

    panel.appendChild(el('h3', 'panel__title', sameMonth ? 'Cumulative spend' : 'Monthly totals'))
    const chartHost = el('div', 'insights-chart-host')
    panel.appendChild(chartHost)

    if (sameMonth) {
        const monthStart = IM.startOfMonth(state.range.start)
        const monthEnd = IM.endOfMonth(state.range.start)
        const daily = IM.dailySeries(included, monthStart, monthEnd)
        let running = 0
        const cumulative = daily.map((day) => {
            running += day.spend
            return IM.clean(running)
        })
        const budget = currency.monthlyBudget > 0 ? currency.monthlyBudget : 0
        const pace = budget > 0
            ? daily.map((day, index) => IM.monthExpectedSpend(budget, currency.firstDayBias || 0, index + 1, daily.length))
            : null
        pendingCharts.push({
            host: chartHost,
            draw: (width) => drawCumulativeChart(chartHost, width, {
                daily, cumulative, pace, budget, currency: code,
            }),
        })
    } else {
        const byMonth = new Map(IM.monthlySeries(included).map((entry) => [entry.month, entry]))
        const months = []
        const cursor = IM.startOfMonth(state.range.start)
        const last = IM.startOfMonth(state.range.end)
        while (cursor <= last) {
            const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`
            months.push(byMonth.get(key) || { month: key, spend: 0, income: 0 })
            cursor.setMonth(cursor.getMonth() + 1)
        }
        pendingCharts.push({
            host: chartHost,
            draw: (width) => drawMonthlyChart(chartHost, width, months, code),
        })
    }

    panel.appendChild(buildForecast(code, included, currency))
    return panel
}

function buildForecast(code, included, currency) {
    const wrap = el('div', 'forecast')
    const today = new Date()
    const includesToday = state.range.start <= today && state.range.end >= today
    const budget = currency.monthlyBudget || 0

    if (includesToday) {
        const monthStart = IM.startOfMonth(today)
        const monthTxs = included.filter((transaction) =>
            transaction.date >= IM.toIsoDate(monthStart) && transaction.date <= IM.toIsoDate(today))
        const monthTotals = IM.totals(monthTxs)
        const daysInMonth = IM.endOfMonth(today).getDate()
        const elapsed = Math.max(1, today.getDate())
        const projected = IM.projectMonthEnd({
            spend: monthTotals.spend, income: monthTotals.income, elapsedDays: elapsed, daysInMonth,
        })
        wrap.appendChild(forecastRow('Projected month-end spend', money(projected.spend, code)))
        wrap.appendChild(forecastRow('Projected month-end income', money(projected.income, code)))
        if (budget > 0) {
            const difference = IM.clean(projected.spend - budget)
            const value = el('strong', difference > 0 ? 'is-over' : 'is-ok',
                `${money(Math.abs(difference), code)} ${difference > 0 ? 'over' : 'under'}`)
            const row = el('div', 'forecast__row')
            row.appendChild(el('span', '', 'Projected vs budget'))
            row.appendChild(value)
            wrap.appendChild(row)
        }
    }

    const trailingStart = new Date(state.range.end.getFullYear(), state.range.end.getMonth() - 3, 1)
    const monthStart = IM.startOfMonth(state.range.end)
    const trailing = state.transactions.filter((transaction) =>
        transaction.currency === code &&
        transaction.date >= IM.toIsoDate(trailingStart) &&
        transaction.date < IM.toIsoDate(monthStart))
    const average = IM.trailingAverage(trailing, state.range.end, 3)
    if (average.spend > 0 || average.income > 0) {
        wrap.appendChild(forecastRow('Next 30 days (3-mo avg)', `${money(average.spend, code)} out · ${money(average.income, code)} in`))
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

function buildMovers(code, included, previousIncluded) {
    const currentMap = IM.categoryTotalsMap(included, 'expense')
    const previousMap = IM.categoryTotalsMap(previousIncluded, 'expense')
    const movers = IM.categoryMovers(currentMap, previousMap, 3)
    if (movers.increases.length === 0 && movers.decreases.length === 0) {
        return document.createDocumentFragment()
    }
    const wrap = el('div', 'movers')
    const addColumn = (title, entries, emptyText) => {
        const column = el('div', 'movers__column')
        column.appendChild(el('h3', 'panel__title', title))
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
    wrap.append(
        addColumn('Biggest increases', movers.increases, 'No increases.'),
        addColumn('Biggest decreases', movers.decreases, 'No decreases.')
    )
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
    const max = niceMax(Math.max(
        ...data.cumulative,
        data.budget || 0,
        ...(data.pace || [0])
    )) || 1
    const svg = svgEl('svg', {
        viewBox: `0 0 ${width} ${height}`,
        class: 'insights-chart',
        role: 'img',
        'aria-label': `Cumulative spend for ${data.currency}`,
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

    const today = new Date()
    const inCurrentMonth = today.getFullYear() === state.range.start.getFullYear() &&
        today.getMonth() === state.range.start.getMonth()
    const drawnDays = inCurrentMonth
        ? Math.max(1, Math.min(today.getDate(), data.daily.length))
        : data.daily.length

    if (data.pace) {
        const points = data.pace.map((value, index) => `${x(index)},${y(value)}`).join(' ')
        svg.appendChild(svgEl('polyline', { points, class: 'insights-chart__pace' }))
    }

    const linePoints = data.cumulative.slice(0, drawnDays).map((value, index) => `${x(index)},${y(value)}`)
    if (linePoints.length > 0) {
        const area = `M ${x(0)},${y(0)} L ${linePoints.join(' L ')} L ${x(drawnDays - 1)},${y(0)} Z`
        svg.appendChild(svgEl('path', { d: area, class: 'insights-chart__area' }))
        svg.appendChild(svgEl('polyline', { points: linePoints.join(' '), class: 'insights-chart__line' }))
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
    const max = niceMax(Math.max(...months.map((month) => Math.max(month.spend, month.income)))) || 1
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

els.monthPicker.addEventListener('change', () => {
    const match = /^(\d{4})-(\d{2})$/.exec(els.monthPicker.value)
    if (!match) {
        return
    }
    const date = new Date(Number(match[1]), Number(match[2]) - 1, 1)
    const range = currentMonthRange(date)
    setRange(range.start, range.end)
})

for (const chip of document.querySelectorAll('.chip')) {
    chip.addEventListener('click', () => {
        const range = quickRange(chip.dataset.range)
        if (range) {
            setRange(range.start, range.end)
        }
    })
}

window.addEventListener('resize', () => {
    window.clearTimeout(resizeTimer)
    resizeTimer = window.setTimeout(() => {
        if (pendingCharts.length > 0) {
            drawPendingCharts()
        }
    }, 150)
})

prefersDark.addEventListener('change', () => {
    if (state.theme === 'auto') {
        applyTheme()
    }
})

applyTheme()
state.range = rangeFromUrl() || defaultRange()
syncInputs()
fetchData()
