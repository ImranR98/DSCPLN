'use strict'

const { fractionDigitsFor, hasSubCentPrecision, currencyColor, setBreakableText } = DSCPLNFormat

const $ = (id) => document.getElementById(id)

const els = {
    refreshButton: $('refreshButton'),
    themeButton: $('themeButton'),
    contextLabel: $('contextLabel'),
    updatedLabel: $('updatedLabel'),
    pretendBanner: $('pretendBanner'),
    pretendBannerDate: $('pretendBannerDate'),
    bannerTodayButton: $('bannerTodayButton'),
    pretendButton: $('pretendButton'),
    pretendDialog: $('pretendDialog'),
    pretendForm: $('pretendForm'),
    pretendFormError: $('pretendFormError'),
    pretendCancelButton: $('pretendCancelButton'),
    pretendApplyButton: $('pretendApplyButton'),
    monthCard: $('monthCard'),
    monthHeading: $('monthHeading'),
    monthName: $('monthName'),
    monthSpend: $('monthSpend'),
    monthOf: $('monthOf'),
    monthBudget: $('monthBudget'),
    monthProgress: $('monthProgress'),
    monthProgressFill: $('monthProgressFill'),
    monthRemaining: $('monthRemaining'),
    monthDaily: $('monthDaily'),
    monthDaysLeft: $('monthDaysLeft'),
    monthPace: $('monthPace'),
    monthPaceMarker: $('monthPaceMarker'),
    monthSpentThis: $('monthSpentThis'),
    monthSpentPrev: $('monthSpentPrev'),
    monthSpentAvg: $('monthSpentAvg'),
    monthEarnThis: $('monthEarnThis'),
    monthEarnPrev: $('monthEarnPrev'),
    monthEarnAvg: $('monthEarnAvg'),
    primaryBudgetButton: $('primaryBudgetButton'),
    otherCurrencies: $('otherCurrencies'),
    historyCard: $('historyCard'),
    historyRange: $('historyRange'),
    historyChart: $('historyChart'),
    historyTooltip: $('historyTooltip'),
    expensesList: $('expensesList'),
    expensesMeta: $('expensesMeta'),
    expensesEmpty: $('expensesEmpty'),
    addTransactionButton: $('addTransactionButton'),
    importButton: $('importButton'),
    importDialog: $('importDialog'),
    importForm: $('importForm'),
    importTextarea: $('importTextarea'),
    importHint: $('importHint'),
    importFormError: $('importFormError'),
    importCancelButton: $('importCancelButton'),
    importSubmitButton: $('importSubmitButton'),
    pretendDateInput: $('pretendDateInput'),
    pretendTodayButton: $('pretendTodayButton'),
    budgetDialog: $('budgetDialog'),
    budgetForm: $('budgetForm'),
    monthlyBudgetInput: $('monthlyBudgetInput'),
    firstDayBiasInput: $('firstDayBiasInput'),
    budgetCurrencyNote: $('budgetCurrencyNote'),
    budgetFormError: $('budgetFormError'),
    budgetCancelButton: $('budgetCancelButton'),
    budgetSaveButton: $('budgetSaveButton'),
    transactionDialog: $('transactionDialog'),
    transactionForm: $('transactionForm'),
    transactionDialogTitle: $('transactionDialogTitle'),
    transactionKindInputs: [...document.querySelectorAll('input[name="kind"]')],
    transactionAmountInput: $('transactionAmountInput'),
    transactionDetailsInput: $('transactionDetailsInput'),
    detailsSuggestions: $('detailsSuggestions'),
    transactionDateInput: $('transactionDateInput'),
    transactionCategorySelect: $('transactionCategorySelect'),
    transactionCategoryHint: $('transactionCategoryHint'),
    transactionCurrencySelect: $('transactionCurrencySelect'),
    transactionNotesInput: $('transactionNotesInput'),
    transactionFormError: $('transactionFormError'),
    transactionCancelButton: $('transactionCancelButton'),
    transactionSaveButton: $('transactionSaveButton'),
    deleteDialog: $('deleteDialog'),
    deleteDialogText: $('deleteDialogText'),
    deleteDialogError: $('deleteDialogError'),
    deleteCancelButton: $('deleteCancelButton'),
    deleteConfirmButton: $('deleteConfirmButton'),
    toasts: $('toasts'),
}

const THEME_KEY = 'dscpln-theme'
const THEME_ORDER = ['auto', 'light', 'dark']
const REFRESH_STALE_MS = 60 * 1000
const INCOME_GROUP = 'Money In'

const ICONS = {
    auto: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 0 0 18z" fill="currentColor" stroke="none"/></svg>',
    light: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
    dark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>',
    edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
    delete: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M6 6l1 14h10l1-14"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
    alert: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v4M12 16h.01"/></svg>',
}

const monthFormat = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' })
const dayFormat = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
const fullDayFormat = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' })
const timeFormat = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' })

const prefersDark = window.matchMedia('(prefers-color-scheme: dark)')

const state = {
    today: startOfDay(new Date()),
    viewDate: startOfDay(new Date()),
    data: null,
    lastFetchAt: 0,
    theme: readTheme(),
    editingBudgetCurrency: null,
    editingTransaction: null,
    pendingDelete: null,
    categoryTouched: false,
}

let suggestionTimer = null
let detailsSuggestionTimer = null
let detailsSuggestionSequence = 0
let detailsSuggestions = []
let detailsSuggestionIndex = -1
let historyResizeTimer = null
let fetchSequence = 0

function startOfDay(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

function toDateInputValue(date) {
    const pad = (n) => String(n).padStart(2, '0')
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function parseDateInputValue(value) {
    const parts = value.split('-').map(Number)
    if (parts.length !== 3 || parts.some((p) => !Number.isInteger(p))) return null
    const date = new Date(parts[0], parts[1] - 1, parts[2])
    if (date.getFullYear() !== parts[0] || date.getMonth() !== parts[1] - 1 || date.getDate() !== parts[2]) return null
    return date
}

function parseIsoDate(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value || '')
    return match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : null
}

function isSameDay(a, b) {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

function toNumber(value) {
    const n = Number.parseFloat(value)
    return Number.isFinite(n) ? n : 0
}

// Currencies whose data needs more than cents (e.g. XMR) keep significant
// digits even for values of 1 or more; everything else uses plain 2 decimals.
let fractionalCurrencies = new Set()
let fractionalCurrenciesSource = null

function isFractionalCurrency(code) {
    const history = (state.data && state.data.history) || []
    if (fractionalCurrenciesSource !== history) {
        fractionalCurrencies = new Set()
        for (const entry of history) {
            for (const [currencyCode, totals] of Object.entries(entry.currencies || {})) {
                if (hasSubCentPrecision(totals.spend) || hasSubCentPrecision(totals.income)) {
                    fractionalCurrencies.add(currencyCode)
                }
            }
        }
        fractionalCurrenciesSource = history
    }
    return code ? fractionalCurrencies.has(code) : false
}

function money(value, code) {
    return DSCPLNFormat.money(value, code, Boolean(code) && isFractionalCurrency(code))
}

function applyCurrencyAccent(element, code) {
    const color = currencyColor(code)
    if (color) element.style.setProperty('--currency', color)
}

function getSelectedKind() {
    const selected = els.transactionKindInputs.find((input) => input.checked)
    return selected ? selected.value : 'expense'
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

function toast(message, type = 'success') {
    const el = document.createElement('div')
    el.className = `toast toast--${type}`
    el.setAttribute('role', 'status')
    const icon = document.createElement('span')
    icon.className = 'toast__icon'
    icon.innerHTML = type === 'error' ? ICONS.alert : ICONS.check
    const text = document.createElement('span')
    text.textContent = message
    el.append(icon, text)
    els.toasts.appendChild(el)
    window.setTimeout(() => {
        el.classList.add('toast--leaving')
        window.setTimeout(() => el.remove(), 350)
    }, 3200)
}

function refreshToday() {
    const newToday = startOfDay(new Date())
    if (isSameDay(state.viewDate, state.today)) state.viewDate = newToday
    state.today = newToday
}

async function fetchData({ silent = false } = {}) {
    const sequence = ++fetchSequence
    refreshToday()
    if (!state.data && !silent) document.body.classList.add('is-loading')
    try {
        const params = new URLSearchParams({ date: toDateInputValue(state.viewDate) })
        const response = await fetch(`/data?${params}`, {
            headers: { Accept: 'application/json' },
        })
        if (!response.ok) throw new Error(`Request failed (${response.status})`)
        const data = await response.json()
        if (sequence !== fetchSequence) return
        state.data = data
        state.lastFetchAt = Date.now()
        render()
    } catch (e) {
        if (sequence === fetchSequence) {
            console.error(e)
            toast('Could not load data. Check the server logs.', 'error')
        }
    } finally {
        if (sequence === fetchSequence) {
            document.body.classList.remove('is-loading')
        }
    }
}

function render() {
    if (!state.data) return
    renderContext()
    renderMonth(primaryCurrency())
    renderOtherCurrencies()
    renderHistory()
    renderExpenses()
    syncControls()
}

function primaryCurrency() {
    const currencies = state.data.currencies || []
    return currencies.find((currency) => currency.primary) || currencies[0] || null
}

function renderContext() {
    const viewingToday = isSameDay(state.viewDate, state.today)
    els.contextLabel.textContent = `${viewingToday ? 'Today' : 'Viewing'} · ${dayFormat.format(state.viewDate)}`
    els.updatedLabel.textContent = state.lastFetchAt ? `Updated ${timeFormat.format(new Date(state.lastFetchAt))}` : ''
    els.pretendBanner.hidden = viewingToday
    if (!viewingToday) els.pretendBannerDate.textContent = fullDayFormat.format(state.viewDate)
}

function setCardState(card, spent, budget) {
    card.classList.remove('card--ok', 'card--warn', 'card--over', 'card--none')
    if (budget <= 0) card.classList.add('card--none')
    else if (spent >= budget) card.classList.add('card--over')
    else if (spent / budget >= 0.8) card.classList.add('card--warn')
    else card.classList.add('card--ok')
}

function setProgress(bar, fill, spent, budget) {
    const pct = budget > 0 ? Math.min((spent / budget) * 100, 100) : 0
    fill.style.width = `${pct.toFixed(1)}%`
    bar.setAttribute('aria-valuenow', String(Math.round(pct)))
    bar.setAttribute('aria-valuetext', budget > 0 ? `${Math.round(pct)}% of budget used` : 'No budget set')
}

function setPace(el, budget, spent, fraction, code) {
    if (budget <= 0) {
        el.textContent = ''
        el.className = 'pace'
        return
    }
    const delta = budget * fraction - spent
    el.textContent = `${money(Math.abs(delta), code)} ${delta >= 0 ? 'less' : 'more'} than expected`
    el.className = `pace ${delta >= 0 ? 'pace--ok' : 'pace--over'}`
}

function renderMonth(currency) {
    const budget = currency ? toNumber(currency.monthlyBudget) : 0
    const spent = currency ? toNumber(currency.monthsSpend) : 0
    const code = currency ? currency.code : null
    const date = state.viewDate
    const daysInMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()
    const day = date.getDate()
    const daysLeft = Math.max(1, daysInMonth - day + 1)
    const remaining = budget - spent

    els.monthHeading.textContent = currency ? currency.code : 'Main'
    applyCurrencyAccent(els.monthCard, code)
    els.monthName.textContent = monthFormat.format(date)
    setBreakableText(els.monthSpend, money(spent, code))
    setBreakableText(els.monthBudget, budget > 0 ? money(budget, code) : 'no budget')
    if (budget <= 0) {
        els.monthRemaining.textContent = '—'
        els.monthDaily.textContent = '—'
        els.monthRemaining.classList.remove('is-over')
    } else if (remaining >= 0) {
        setBreakableText(els.monthRemaining, money(remaining, code))
        setBreakableText(els.monthDaily, money(remaining / daysLeft, code))
        els.monthRemaining.classList.remove('is-over')
    } else {
        setBreakableText(els.monthRemaining, money(remaining, code))
        setBreakableText(els.monthDaily, money(0, code))
        els.monthRemaining.classList.add('is-over')
    }
    els.monthDaysLeft.textContent = String(daysLeft)
    setBreakableText(els.monthSpentThis, money(spent, code))
    setBreakableText(els.monthSpentPrev, money(currency ? toNumber(currency.previousMonthsSpend) : 0, code))
    setBreakableText(els.monthSpentAvg, money(currency ? toNumber(currency.trailingSpendAverage) : 0, code))
    setBreakableText(els.monthEarnThis, `+${money(currency ? toNumber(currency.monthsIncome) : 0, code)}`)
    setBreakableText(els.monthEarnPrev, `+${money(currency ? toNumber(currency.previousMonthsIncome) : 0, code)}`)
    setBreakableText(els.monthEarnAvg, `+${money(currency ? toNumber(currency.trailingIncomeAverage) : 0, code)}`)

    const expected = currency && currency.monthsExpectedSpend != null ? toNumber(currency.monthsExpectedSpend) : budget * (day / daysInMonth)
    setPace(els.monthPace, budget, spent, budget > 0 ? expected / budget : 0, code)
    setProgress(els.monthProgress, els.monthProgressFill, spent, budget)
    setCardState(els.monthCard, spent, budget)
    const paceFraction = budget > 0 ? Math.min(1, Math.max(0, expected / budget)) : 0
    els.monthPaceMarker.hidden = budget <= 0
    els.monthPaceMarker.style.left = `${(paceFraction * 100).toFixed(1)}%`
}

function buildCurrencyCard(currency) {
    const card = document.createElement('section')
    card.className = 'currency-card'
    card.setAttribute('aria-label', `${currency.code} budget`)
    applyCurrencyAccent(card, currency.code)

    const code = currency.code
    const budget = toNumber(currency.monthlyBudget)
    const spent = toNumber(currency.monthsSpend)
    const remaining = budget - spent

    const header = document.createElement('div')
    header.className = 'currency-card__header'
    const title = document.createElement('span')
    title.className = 'currency-badge'
    const codeEl = document.createElement('span')
    codeEl.textContent = code
    title.append(codeEl)
    const editButton = document.createElement('button')
    editButton.type = 'button'
    editButton.className = 'icon-button icon-button--small'
    editButton.title = `Edit ${code} budget`
    editButton.setAttribute('aria-label', `Edit ${code} budget`)
    editButton.innerHTML = ICONS.edit
    editButton.addEventListener('click', () => openBudgetDialog(code))
    header.append(title, editButton)

    const figure = document.createElement('p')
    figure.className = 'currency-card__figure'
    const spendEl = document.createElement('span')
    spendEl.className = 'currency-card__spend'
    setBreakableText(spendEl, money(spent, code))
    const budgetEl = document.createElement('span')
    budgetEl.className = 'currency-card__budget'
    setBreakableText(budgetEl, budget > 0 ? `of ${money(budget, code)}` : 'no budget')
    figure.append(spendEl, budgetEl)

    const progress = document.createElement('div')
    progress.className = 'progress progress--sm'
    progress.setAttribute('role', 'progressbar')
    progress.setAttribute('aria-valuemin', '0')
    progress.setAttribute('aria-valuemax', '100')
    const fill = document.createElement('div')
    fill.className = 'progress__fill'
    const pct = budget > 0 ? Math.min((spent / budget) * 100, 100) : 0
    fill.style.width = `${pct.toFixed(1)}%`
    progress.setAttribute('aria-valuenow', String(Math.round(pct)))
    progress.setAttribute('aria-valuetext', budget > 0 ? `${Math.round(pct)}% of budget used` : 'No budget set')
    progress.appendChild(fill)
    setCardState(card, spent, budget)

    const meta = document.createElement('div')
    meta.className = 'currency-card__meta'
    const earned = document.createElement('span')
    earned.className = 'currency-card__earned'
    earned.textContent = `+${money(toNumber(currency.monthsIncome), code)} in`
    if (budget > 0) {
        const left = document.createElement('span')
        if (remaining >= 0) {
            left.textContent = `${money(remaining, code)} left`
        } else {
            left.textContent = `${money(-remaining, code)} over`
            left.className = 'currency-card__over'
        }
        meta.append(left, earned)
    } else {
        meta.append(earned)
    }

    card.append(header, figure, progress, meta)
    return card
}

function renderOtherCurrencies() {
    const currencies = (state.data.currencies || []).filter((currency) => !currency.primary && currency.hasActivity)
    els.otherCurrencies.textContent = ''
    els.otherCurrencies.hidden = currencies.length === 0
    for (const currency of currencies) {
        els.otherCurrencies.appendChild(buildCurrencyCard(currency))
    }
}

const SVG_NS = 'http://www.w3.org/2000/svg'
const monthYearFormat = new Intl.DateTimeFormat(undefined, { month: 'short', year: 'numeric' })
const compactNumberFormat = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 })

function svgElement(tag, attributes = {}) {
    const element = document.createElementNS(SVG_NS, tag)
    for (const [name, value] of Object.entries(attributes)) {
        element.setAttribute(name, value)
    }
    return element
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

function tickMoney(value) {
    const amount = Number.isFinite(value) ? value : 0
    const absolute = Math.abs(amount)
    if (absolute >= 1000) {
        return `$${compactNumberFormat.format(amount)}`
    }
    if (absolute >= 1) {
        return `$${Math.round(amount).toLocaleString()}`
    }
    const decimals = fractionDigitsFor(amount, 3)
    return `$${amount.toFixed(decimals).replace(/0+$/, '').replace(/\.$/, '')}`
}

function historyMonthLabel(entry, index) {
    const date = new Date(entry.year, entry.month - 1, 1)
    const base = monthYearFormat.formatToParts(date).find((part) => part.type === 'month').value
    if (index === 0 || entry.month === 1) {
        return `${base} '${String(entry.year).slice(-2)}`
    }
    return base
}

function buildHistoryTooltip(monthIndex, activeCurrencies) {
    const entry = state.data.history[monthIndex]
    const container = document.createElement('div')
    const title = document.createElement('strong')
    title.className = 'history-tooltip__title'
    title.textContent = monthYearFormat.format(new Date(entry.year, entry.month - 1, 1))
    container.appendChild(title)
    for (const code of activeCurrencies) {
        const totals = entry.currencies[code] || { spend: 0, income: 0 }
        const row = document.createElement('div')
        row.className = 'history-tooltip__row'
        const codeEl = document.createElement('span')
        codeEl.className = 'history-tooltip__code'
        const dot = document.createElement('span')
        dot.className = 'history-tooltip__dot'
        const color = currencyColor(code)
        if (color) dot.style.background = color
        const codeText = document.createElement('span')
        codeText.textContent = code
        codeEl.append(dot, codeText)
        const outEl = document.createElement('span')
        outEl.className = 'history-tooltip__out'
        outEl.textContent = `${money(toNumber(totals.spend), code)} out`
        const inEl = document.createElement('span')
        inEl.className = 'history-tooltip__in'
        inEl.textContent = `+${money(toNumber(totals.income), code)} in`
        row.append(codeEl, outEl, inEl)
        container.appendChild(row)
    }
    return container
}

function measureTextWidth(text, className) {
    const span = document.createElement('span')
    span.className = className
    span.textContent = text
    span.style.position = 'absolute'
    span.style.visibility = 'hidden'
    span.style.whiteSpace = 'nowrap'
    els.historyCard.appendChild(span)
    const width = span.getBoundingClientRect().width
    span.remove()
    return width
}

function renderHistory() {
    const history = state.data.history || []
    const codes = (state.data.currencies || []).map((currency) => currency.code)
    const active = codes.filter((code) => history.some((entry) => {
        const totals = entry.currencies && entry.currencies[code]
        return totals && (totals.spend > 0 || totals.income > 0)
    }))

    els.historyTooltip.hidden = true
    els.historyChart.textContent = ''
    els.historyCard.hidden = history.length === 0 || active.length === 0
    if (els.historyCard.hidden) {
        return
    }

    const first = history[0]
    const last = history[history.length - 1]
    els.historyRange.textContent = active.length ?
        `${monthYearFormat.format(new Date(first.year, first.month - 1, 1))} – ${monthYearFormat.format(new Date(last.year, last.month - 1, 1))}` :
        ''

    // The SVG is built in real pixels (viewBox matches the rendered width), so
    // text stays legible on small screens. Column widths that hold numbers are
    // measured from the actual text so long values can't be clipped.
    const width = Math.max(240, Math.round(els.historyChart.clientWidth || 720))
    const topPad = 6
    const laneHeight = 92
    const laneGap = 18
    const laneStride = laneHeight + laneGap
    const axisHeight = 26

    const laneMax = new Map()
    let maxTickWidth = 0
    for (const code of active) {
        const max = niceMax(Math.max(...history.map((entry) => {
            const totals = entry.currencies[code] || { spend: 0, income: 0 }
            return Math.max(totals.spend, totals.income)
        })))
        for (const factor of [0.5, 1]) {
            if (max > 0) {
                maxTickWidth = Math.max(maxTickWidth, measureTextWidth(tickMoney(max * factor), 'history__tick'))
            }
        }
        laneMax.set(code, max)
    }

    // The Total column is capped (30% of the chart) so long fractional-currency
    // values can't shrink the plot. Values that don't fit wrap onto their own
    // line beneath the "out"/"in" label.
    const totalColumnCap = Math.max(84, Math.round(width * 0.3))
    const totalTextWidth = totalColumnCap - 12
    const totalLinesByCode = new Map()
    let maxTotalLineWidth = 0
    const breakTotalText = (text, className, maxWidth) => {
        if (measureTextWidth(text, className) <= maxWidth) return [text]
        // Prefer breaking after the decimal point so the whole part stays intact.
        const dotIndex = text.lastIndexOf('.')
        if (dotIndex > 0) {
            const whole = text.slice(0, dotIndex + 1)
            const fraction = text.slice(dotIndex + 1)
            if (measureTextWidth(whole, className) <= maxWidth && measureTextWidth(fraction, className) <= maxWidth) {
                return [whole, fraction]
            }
        }
        // Otherwise split into the fewest balanced lines that each fit.
        const totalWidth = measureTextWidth(text, className)
        const lineCount = Math.ceil(totalWidth / maxWidth)
        const targetWidth = totalWidth / lineCount
        const parts = []
        let current = ''
        for (const char of text) {
            const candidate = current + char
            if (current && parts.length < lineCount - 1 && measureTextWidth(candidate, className) > targetWidth) {
                parts.push(current)
                current = char
            } else {
                current = candidate
            }
        }
        if (current) parts.push(current)
        return parts
    }
    for (const code of active) {
        const totalSpend = Number.parseFloat(history.reduce((sum, entry) =>
            sum + ((entry.currencies[code] || {}).spend || 0), 0).toPrecision(12))
        const totalIncome = Number.parseFloat(history.reduce((sum, entry) =>
            sum + ((entry.currencies[code] || {}).income || 0), 0).toPrecision(12))
        const lines = []
        for (const entry of [
            { label: 'out', value: money(totalSpend, code), isIn: false },
            { label: 'in', value: `+${money(totalIncome, code)}`, isIn: true },
        ]) {
            const full = `${entry.label} ${entry.value}`
            if (measureTextWidth(full, 'history__total') <= totalTextWidth) {
                lines.push({ text: full, isIn: entry.isIn })
            } else {
                lines.push({ text: entry.label, isIn: entry.isIn })
                for (const part of breakTotalText(entry.value, 'history__total', totalTextWidth)) {
                    lines.push({ text: part, isIn: entry.isIn })
                }
            }
        }
        for (const line of lines) {
            maxTotalLineWidth = Math.max(maxTotalLineWidth, measureTextWidth(line.text, 'history__total'))
        }
        totalLinesByCode.set(code, lines)
    }

    const leftPad = Math.max(40, Math.ceil(maxTickWidth) + 10)
    const rightPad = 6
    const totalColumnWidth = Math.min(Math.max(84, Math.ceil(maxTotalLineWidth) + 12), totalColumnCap)
    const plotWidth = Math.max(40, width - leftPad - rightPad - totalColumnWidth)
    const dividerX = leftPad + plotWidth
    const columnWidth = plotWidth / history.length
    const labelStep = columnWidth < 12 ? 6 : columnWidth < 20 ? 4 : columnWidth < 30 ? 3 : columnWidth < 40 ? 2 : 1
    const groupWidth = columnWidth * 0.7
    const barGap = 1.5
    const barWidth = Math.max(1, (groupWidth - barGap) / 2)
    const height = topPad + active.length * laneStride - laneGap + axisHeight

    const svg = svgElement('svg', {
        viewBox: `0 0 ${width} ${height}`,
        class: 'history__svg',
        role: 'img',
        'aria-label': `Monthly money in and out over the last ${history.length} months for ${active.join(', ')}`,
    })

    const band = svgElement('rect', {
        class: 'history__band',
        y: topPad,
        width: columnWidth,
        height: active.length * laneStride - laneGap,
    })
    band.style.display = 'none'
    svg.appendChild(band)

    active.forEach((code, laneIndex) => {
        const laneTop = topPad + laneIndex * laneStride
        const plotTop = laneTop + 24
        const baseline = laneTop + laneHeight - 8
        const plotHeight = baseline - plotTop
        const max = laneMax.get(code)

        const laneColor = currencyColor(code) || 'var(--accent)'
        const laneDot = svgElement('circle', {
            cx: 3.5,
            cy: laneTop + 6,
            r: 3.5,
            class: 'history__lane-dot',
            fill: laneColor,
        })
        svg.appendChild(laneDot)

        const laneLabel = svgElement('text', { x: 12, y: laneTop + 10, class: 'history__lane-label' })
        laneLabel.textContent = code
        svg.appendChild(laneLabel)

        for (const factor of [0, 0.5, 1]) {
            const y = baseline - plotHeight * factor
            svg.appendChild(svgElement('line', {
                x1: leftPad,
                x2: dividerX,
                y1: y,
                y2: y,
                class: factor === 0 ? 'history__baseline' : 'history__grid',
            }))
            if (factor > 0 && max > 0) {
                const tick = svgElement('text', { x: leftPad - 6, y: y + 3.5, class: 'history__tick' })
                tick.textContent = tickMoney(max * factor)
                svg.appendChild(tick)
            }
        }

        history.forEach((entry, monthIndex) => {
            const totals = entry.currencies[code] || { spend: 0, income: 0 }
            const groupLeft = leftPad + monthIndex * columnWidth + (columnWidth - groupWidth) / 2
            const outHeight = max > 0 ? (totals.spend / max) * plotHeight : 0
            const inHeight = max > 0 ? (totals.income / max) * plotHeight : 0
            if (outHeight > 0) {
                const bar = svgElement('rect', {
                    x: groupLeft,
                    y: baseline - outHeight,
                    width: barWidth,
                    height: outHeight,
                    rx: Math.min(2.5, barWidth / 2).toFixed(2),
                    class: 'history__bar',
                })
                bar.style.fill = laneColor
                svg.appendChild(bar)
            }
            if (inHeight > 0) {
                const bar = svgElement('rect', {
                    x: groupLeft + barWidth + barGap,
                    y: baseline - inHeight,
                    width: barWidth,
                    height: inHeight,
                    rx: Math.min(2.5, barWidth / 2).toFixed(2),
                    class: 'history__bar history__bar--in',
                })
                bar.style.fill = laneColor
                bar.style.stroke = laneColor
                svg.appendChild(bar)
            }
            if (laneIndex === active.length - 1 && monthIndex % labelStep === 0) {
                const label = svgElement('text', {
                    x: leftPad + monthIndex * columnWidth + columnWidth / 2,
                    y: height - 8,
                    class: 'history__label',
                })
                label.textContent = historyMonthLabel(entry, monthIndex)
                svg.appendChild(label)
            }
        })

        const totalLines = totalLinesByCode.get(code)
        const totalLineHeight = 14
        const totalStartY = laneTop + (laneHeight - totalLines.length * totalLineHeight) / 2 + 11
        totalLines.forEach((line, lineIndex) => {
            const totalText = svgElement('text', {
                x: width - rightPad,
                y: totalStartY + lineIndex * totalLineHeight,
                class: line.isIn ? 'history__total history__total--in' : 'history__total',
            })
            totalText.textContent = line.text
            svg.appendChild(totalText)
        })
    })

    svg.appendChild(svgElement('line', {
        x1: dividerX,
        x2: dividerX,
        y1: topPad,
        y2: topPad + active.length * laneStride - laneGap,
        class: 'history__divider',
    }))
    const totalHeader = svgElement('text', {
        x: dividerX + totalColumnWidth / 2,
        y: height - 7,
        class: 'history__label',
    })
    totalHeader.textContent = 'Total'
    svg.appendChild(totalHeader)

    history.forEach((entry, monthIndex) => {
        const hit = svgElement('rect', {
            x: leftPad + monthIndex * columnWidth,
            y: topPad,
            width: columnWidth,
            height: active.length * laneStride - laneGap,
            class: 'history__hit',
        })
        const show = (event) => {
            band.style.display = ''
            band.setAttribute('x', leftPad + monthIndex * columnWidth)
            els.historyTooltip.textContent = ''
            els.historyTooltip.appendChild(buildHistoryTooltip(monthIndex, active))
            els.historyTooltip.hidden = false
            const cardRect = els.historyCard.getBoundingClientRect()
            const tooltipWidth = els.historyTooltip.offsetWidth
            const tooltipHeight = els.historyTooltip.offsetHeight
            const relativeX = event.clientX - cardRect.left
            const relativeY = event.clientY - cardRect.top
            const left = Math.max(4, Math.min(relativeX + 12, cardRect.width - tooltipWidth - 4))
            const top = Math.max(4, Math.min(relativeY + 12, cardRect.height - tooltipHeight - 4))
            els.historyTooltip.style.left = `${left}px`
            els.historyTooltip.style.top = `${top}px`
        }
        hit.addEventListener('mouseenter', show)
        hit.addEventListener('mousemove', show)
        hit.addEventListener('mouseleave', () => {
            band.style.display = 'none'
            els.historyTooltip.hidden = true
        })
        svg.appendChild(hit)
    })

    els.historyChart.appendChild(svg)
}

function buildExpenseActions(transaction) {
    const actions = document.createElement('span')
    actions.className = 'expense__actions'

    const editButton = document.createElement('button')
    editButton.type = 'button'
    editButton.className = 'icon-button'
    editButton.title = 'Edit'
    editButton.setAttribute('aria-label', `Edit ${transaction.details || 'transaction'}`)
    editButton.innerHTML = ICONS.edit
    editButton.addEventListener('click', () => openEditTransactionDialog(transaction))

    const deleteButton = document.createElement('button')
    deleteButton.type = 'button'
    deleteButton.className = 'icon-button icon-button--danger'
    deleteButton.title = 'Delete'
    deleteButton.setAttribute('aria-label', `Delete ${transaction.details || 'transaction'}`)
    deleteButton.innerHTML = ICONS.delete
    deleteButton.addEventListener('click', () => openDeleteTransactionDialog(transaction))

    actions.append(editButton, deleteButton)
    return actions
}

function expenseDateLabel(date) {
    const yesterday = new Date(state.today.getFullYear(), state.today.getMonth(), state.today.getDate() - 1)
    if (isSameDay(date, state.today)) return 'Today'
    if (isSameDay(date, yesterday)) return 'Yesterday'
    return dayFormat.format(date)
}

function buildExpenseRow(transaction, writable) {
    const li = document.createElement('li')
    li.className = 'expense'
    if (transaction.kind === 'income') {
        li.classList.add('expense--income')
    }
    applyCurrencyAccent(li, transaction.currency)
    const date = parseIsoDate(transaction.date)
    if (date && date > state.viewDate) {
        li.classList.add('expense--future')
        li.title = 'Dated after the viewed date'
    }

    const main = document.createElement('span')
    main.className = 'expense__main'
    const descEl = document.createElement('span')
    descEl.className = 'expense__desc'
    descEl.textContent = transaction.details || '—'
    if (transaction.notes) {
        const notesEl = document.createElement('span')
        notesEl.className = 'expense__notes'
        notesEl.textContent = transaction.notes
        descEl.appendChild(notesEl)
    }
    const metaEl = document.createElement('span')
    metaEl.className = 'expense__meta'
    if (date) {
        const dateEl = document.createElement('span')
        dateEl.className = 'expense__date'
        dateEl.textContent = expenseDateLabel(date)
        metaEl.appendChild(dateEl)
    }
    const currencyEl = document.createElement('span')
    currencyEl.className = 'expense__currency'
    currencyEl.textContent = transaction.currency || ''
    currencyEl.hidden = !transaction.currency
    const categoryEl = document.createElement('span')
    categoryEl.className = 'expense__category'
    categoryEl.textContent = transaction.category || ''
    metaEl.append(currencyEl, categoryEl)
    main.append(descEl, metaEl)

    const amountEl = document.createElement('span')
    amountEl.className = transaction.kind === 'income' ? 'expense__amount expense__amount--in' : 'expense__amount'
    const amount = transaction.kind === 'income' ? transaction.moneyIn : transaction.expenses
    setBreakableText(amountEl, transaction.kind === 'income' ?
        `+${money(amount || 0, transaction.currency)}` :
        money(amount || 0, transaction.currency))
    li.append(main)
    if (writable) {
        li.append(buildExpenseActions(transaction))
    }
    li.append(amountEl)
    return li
}

function renderExpenses() {
    const transactions = state.data.transactions || []
    const count = transactions.length
    const writable = state.data.writable !== false

    els.addTransactionButton.hidden = !writable
    els.importButton.hidden = !writable
    els.expensesList.textContent = ''
    els.expensesList.hidden = count === 0
    els.expensesMeta.textContent = count ? `${count} ${count === 1 ? 'transaction' : 'transactions'}` : ''
    els.expensesEmpty.hidden = count > 0

    for (const transaction of transactions) {
        els.expensesList.appendChild(buildExpenseRow(transaction, writable))
    }
}

async function responseErrorMessage(response, fallback) {
    try {
        const text = (await response.text()).trim()
        return text || fallback
    } catch (e) {
        return fallback
    }
}

function renderCategoryOptions(kind) {
    const groups = (state.data.categories || []).filter((entry) =>
        kind === 'income' ? entry.group === INCOME_GROUP : entry.group !== INCOME_GROUP)
    const previous = els.transactionCategorySelect.value
    els.transactionCategorySelect.textContent = ''
    const placeholder = document.createElement('option')
    placeholder.value = ''
    placeholder.textContent = 'Select a category'
    placeholder.disabled = true
    placeholder.selected = true
    els.transactionCategorySelect.appendChild(placeholder)
    let restored = false
    for (const entry of groups) {
        const optgroup = document.createElement('optgroup')
        optgroup.label = entry.group
        for (const category of entry.categories) {
            const option = document.createElement('option')
            option.value = category
            option.textContent = category
            optgroup.appendChild(option)
            if (category === previous) {
                restored = true
            }
        }
        els.transactionCategorySelect.appendChild(optgroup)
    }
    if (restored && previous) {
        els.transactionCategorySelect.value = previous
    }
}

function renderCurrencyOptions() {
    const currencies = state.data.currencies || []
    els.transactionCurrencySelect.textContent = ''
    for (const currency of currencies) {
        const option = document.createElement('option')
        option.value = currency.code
        option.textContent = currency.code
        els.transactionCurrencySelect.appendChild(option)
    }
}

function hideDetailsSuggestions() {
    detailsSuggestions = []
    detailsSuggestionIndex = -1
    els.detailsSuggestions.hidden = true
    els.detailsSuggestions.textContent = ''
    els.transactionDetailsInput.setAttribute('aria-expanded', 'false')
    els.transactionDetailsInput.removeAttribute('aria-activedescendant')
}

function scheduleDetailsSuggestion() {
    window.clearTimeout(detailsSuggestionTimer)
    detailsSuggestionTimer = window.setTimeout(fetchDetailsSuggestions, 150)
}

async function fetchDetailsSuggestions() {
    const sequence = ++detailsSuggestionSequence
    try {
        const params = new URLSearchParams({ q: els.transactionDetailsInput.value, kind: getSelectedKind() })
        const response = await fetch(`/details-suggestions?${params}`, { headers: { Accept: 'application/json' } })
        if (!response.ok || sequence !== detailsSuggestionSequence || !els.transactionDialog.open) {
            return
        }
        const data = await response.json()
        renderDetailsSuggestions(data.suggestions || [])
    } catch (e) {
        // Autocomplete is best-effort; ignore failures.
    }
}

function renderDetailsSuggestions(suggestions) {
    detailsSuggestions = suggestions
    detailsSuggestionIndex = -1
    els.detailsSuggestions.textContent = ''
    if (suggestions.length === 0) {
        hideDetailsSuggestions()
        return
    }
    suggestions.forEach((suggestion, index) => {
        const item = document.createElement('li')
        item.className = 'autocomplete__option'
        item.id = `detailsSuggestion-${index}`
        item.setAttribute('role', 'option')
        item.setAttribute('aria-selected', 'false')
        const detailsEl = document.createElement('span')
        detailsEl.className = 'autocomplete__option-details'
        detailsEl.textContent = suggestion.details
        const categoryEl = document.createElement('span')
        categoryEl.className = 'autocomplete__option-category'
        categoryEl.textContent = suggestion.category || ''
        item.append(detailsEl, categoryEl)
        // Keep focus in the input while tapping/clicking (prevents the blur
        // that would close the menu); selection happens on click, so a touch
        // that turns into a scroll gesture doesn't select a suggestion.
        item.addEventListener('mousedown', (event) => event.preventDefault())
        item.addEventListener('click', () => selectDetailsSuggestion(index))
        els.detailsSuggestions.appendChild(item)
    })
    els.detailsSuggestions.hidden = false
    els.transactionDetailsInput.setAttribute('aria-expanded', 'true')
}

function setActiveDetailsSuggestion(index) {
    detailsSuggestionIndex = index
    const options = [...els.detailsSuggestions.children]
    options.forEach((option, optionIndex) => {
        const active = optionIndex === index
        option.classList.toggle('is-active', active)
        option.setAttribute('aria-selected', active ? 'true' : 'false')
    })
    const active = options[index]
    if (active) {
        els.transactionDetailsInput.setAttribute('aria-activedescendant', active.id)
        active.scrollIntoView({ block: 'nearest' })
    } else {
        els.transactionDetailsInput.removeAttribute('aria-activedescendant')
    }
}

function selectDetailsSuggestion(index) {
    const suggestion = detailsSuggestions[index]
    if (!suggestion) {
        return
    }
    els.transactionDetailsInput.value = suggestion.details
    if (!state.categoryTouched && suggestion.category) {
        const hasOption = [...els.transactionCategorySelect.options]
            .some((option) => option.value === suggestion.category)
        if (hasOption) {
            els.transactionCategorySelect.value = suggestion.category
        }
        state.categoryTouched = true
        els.transactionCategoryHint.hidden = true
    }
    hideDetailsSuggestions()
    els.transactionDetailsInput.focus()
}

function scheduleCategorySuggestion() {
    window.clearTimeout(suggestionTimer)
    suggestionTimer = window.setTimeout(fetchCategorySuggestions, 250)
}

async function fetchCategorySuggestions() {
    const details = els.transactionDetailsInput.value.trim()
    if (details.length < 3) {
        els.transactionCategoryHint.hidden = true
        return
    }
    try {
        const response = await fetch(`/category-suggestions?q=${encodeURIComponent(details)}&kind=${getSelectedKind()}`)
        if (!response.ok) {
            return
        }
        const result = await response.json()
        const suggestions = result.suggestions || []
        if (!suggestions.length) {
            els.transactionCategoryHint.hidden = true
            return
        }
        const top = suggestions[0]
        if (result.confident && !state.categoryTouched) {
            els.transactionCategorySelect.value = top.category
            els.transactionCategoryHint.textContent = `Suggested: ${top.category} (${Math.round(top.score * 100)}% match)`
        } else {
            els.transactionCategoryHint.textContent = `Suggestions: ${suggestions.slice(0, 3).map((s) => s.category).join(', ')}`
        }
        els.transactionCategoryHint.hidden = false
    } catch (e) {
        console.error(e)
    }
}

function openAddTransactionDialog() {
    if (!state.data || state.data.writable === false) return
    state.editingTransaction = null
    state.categoryTouched = false
    els.transactionDialogTitle.textContent = 'Add transaction'
    els.transactionForm.reset()
    renderCategoryOptions('expense')
    renderCurrencyOptions()
    const primary = primaryCurrency()
    els.transactionCurrencySelect.value = primary ? primary.code : ''
    els.transactionDateInput.value = toDateInputValue(state.viewDate)
    els.transactionCategoryHint.hidden = true
    els.transactionFormError.hidden = true
    hideDetailsSuggestions()
    els.transactionDialog.showModal()
    els.transactionDetailsInput.focus()
}

function openEditTransactionDialog(transaction) {
    state.editingTransaction = transaction
    state.categoryTouched = true
    els.transactionDialogTitle.textContent = 'Edit transaction'
    for (const input of els.transactionKindInputs) {
        input.checked = input.value === transaction.kind
    }
    renderCategoryOptions(transaction.kind)
    renderCurrencyOptions()
    els.transactionAmountInput.value = transaction.kind === 'income' ? transaction.moneyIn : transaction.expenses
    els.transactionDetailsInput.value = transaction.details || ''
    const date = parseIsoDate(transaction.date)
    els.transactionDateInput.value = date ? toDateInputValue(date) : toDateInputValue(state.viewDate)
    els.transactionCategorySelect.value = transaction.category || ''
    els.transactionCurrencySelect.value = transaction.currency || ''
    els.transactionNotesInput.value = transaction.notes || ''
    els.transactionCategoryHint.hidden = true
    els.transactionFormError.hidden = true
    hideDetailsSuggestions()
    els.transactionDialog.showModal()
    els.transactionAmountInput.focus()
}

async function submitTransaction(event) {
    event.preventDefault()
    const editing = state.editingTransaction
    const payload = {
        kind: getSelectedKind(),
        amount: Number.parseFloat(els.transactionAmountInput.value),
        details: els.transactionDetailsInput.value,
        date: els.transactionDateInput.value,
        category: els.transactionCategorySelect.value,
        currency: els.transactionCurrencySelect.value,
        notes: els.transactionNotesInput.value,
    }
    els.transactionSaveButton.disabled = true
    try {
        const response = await fetch(editing ? `/transactions/${encodeURIComponent(editing.id)}` : '/transactions', {
            method: editing ? 'PUT' : 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        })
        if (!response.ok) {
            const message = await responseErrorMessage(response, `Save failed (${response.status})`)
            if (response.status === 409) {
                els.transactionDialog.close()
                toast(message, 'error')
                await fetchData({ silent: true })
                return
            }
            els.transactionFormError.textContent = message
            els.transactionFormError.hidden = false
            return
        }
        els.transactionDialog.close()
        toast(editing ? 'Transaction updated' : 'Transaction added')
        await fetchData({ silent: true })
    } catch (e) {
        console.error(e)
        els.transactionFormError.textContent = 'Could not save the transaction. Check the server logs.'
        els.transactionFormError.hidden = false
    } finally {
        els.transactionSaveButton.disabled = false
    }
}

function openImportDialog() {
    if (!state.data || state.data.writable === false) return
    const columns = state.data.transactionColumns && state.data.transactionColumns.length ?
        state.data.transactionColumns :
        ['Date', 'Details', 'Money In', 'Expenses', 'Currency', 'Type', 'Notes']
    els.importHint.textContent = `One transaction per line, tab-separated, in this column order: ${columns.join(' · ')}. Fill either Money In or Expenses.`
    els.importTextarea.value = ''
    els.importFormError.hidden = true
    els.importDialog.showModal()
    els.importTextarea.focus()
}

async function submitImport(event) {
    event.preventDefault()
    const text = els.importTextarea.value
    if (!text.trim()) {
        els.importFormError.textContent = 'Paste at least one transaction line.'
        els.importFormError.hidden = false
        return
    }
    els.importSubmitButton.disabled = true
    try {
        const response = await fetch('/transactions/import', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text }),
        })
        if (!response.ok) {
            const message = await responseErrorMessage(response, `Import failed (${response.status})`)
            els.importFormError.textContent = message
            els.importFormError.hidden = false
            return
        }
        const result = await response.json()
        els.importDialog.close()
        toast(`Imported ${result.imported} ${result.imported === 1 ? 'transaction' : 'transactions'}`)
        await fetchData({ silent: true })
    } catch (e) {
        console.error(e)
        els.importFormError.textContent = 'Could not import transactions. Check the server logs.'
        els.importFormError.hidden = false
    } finally {
        els.importSubmitButton.disabled = false
    }
}

function openDeleteTransactionDialog(transaction) {
    state.pendingDelete = transaction
    const amount = transaction.kind === 'income' ? transaction.moneyIn : transaction.expenses
    els.deleteDialogText.textContent = `${money(amount || 0, transaction.currency)} · ${transaction.details || 'No details'}`
    els.deleteDialogError.hidden = true
    els.deleteDialog.showModal()
}

async function confirmDeleteTransaction() {
    const transaction = state.pendingDelete
    if (!transaction) return
    els.deleteConfirmButton.disabled = true
    try {
        const response = await fetch(`/transactions/${encodeURIComponent(transaction.id)}`, { method: 'DELETE' })
        if (!response.ok) {
            const message = await responseErrorMessage(response, `Delete failed (${response.status})`)
            if (response.status === 409) {
                els.deleteDialog.close()
                state.pendingDelete = null
                toast(message, 'error')
                await fetchData({ silent: true })
                return
            }
            els.deleteDialogError.textContent = message
            els.deleteDialogError.hidden = false
            return
        }
        els.deleteDialog.close()
        state.pendingDelete = null
        toast('Transaction deleted')
        await fetchData({ silent: true })
    } catch (e) {
        console.error(e)
        els.deleteDialogError.textContent = 'Could not delete the transaction. Check the server logs.'
        els.deleteDialogError.hidden = false
    } finally {
        els.deleteConfirmButton.disabled = false
    }
}

function syncControls() {
    els.primaryBudgetButton.disabled = !state.data
}

function viewToday() {
    if (els.pretendDialog.open) {
        els.pretendDialog.close()
    }
    state.viewDate = startOfDay(new Date())
    syncControls()
    fetchData({ silent: true })
}

function openPretendDialog() {
    els.pretendDateInput.value = toDateInputValue(state.viewDate)
    els.pretendFormError.hidden = true
    els.pretendDialog.showModal()
}

function submitPretendForm(event) {
    event.preventDefault()
    const parsed = parseDateInputValue(els.pretendDateInput.value)
    if (!parsed) {
        els.pretendFormError.textContent = 'Enter a valid date.'
        els.pretendFormError.hidden = false
        return
    }
    els.pretendDialog.close()
    state.viewDate = startOfDay(parsed)
    syncControls()
    fetchData({ silent: true })
}

function openBudgetDialog(currencyCode) {
    if (!state.data) return
    const currency = (state.data.currencies || []).find((entry) => entry.code === currencyCode)
    state.editingBudgetCurrency = currencyCode
    els.monthlyBudgetInput.value = currency ? toNumber(currency.monthlyBudget) : 0
    els.firstDayBiasInput.value = currency ? toNumber(currency.firstDayBias) : 0
    els.budgetCurrencyNote.textContent = `Editing the ${currencyCode} budget.`
    updateBudgetFormValidity()
    els.budgetDialog.showModal()
}

function getBudgetFormValues() {
    return {
        monthlyBudget: Number.parseFloat(els.monthlyBudgetInput.value),
        firstDayBias: Number.parseFloat(els.firstDayBiasInput.value),
    }
}

function updateBudgetFormValidity() {
    const { monthlyBudget, firstDayBias } = getBudgetFormValues()
    let error = ''
    if (!Number.isFinite(monthlyBudget) || monthlyBudget <= 0) {
        error = 'Monthly budget must be greater than 0.'
    } else if (!Number.isFinite(firstDayBias) || firstDayBias < 0) {
        error = 'First day bias must be 0 or greater.'
    } else if (firstDayBias > monthlyBudget) {
        error = 'First day bias cannot be greater than the monthly budget.'
    }
    els.budgetFormError.textContent = error
    els.budgetFormError.hidden = !error
    els.budgetSaveButton.disabled = Boolean(error)
    return !error
}

async function submitBudget(event) {
    event.preventDefault()
    if (!updateBudgetFormValidity()) return
    const { monthlyBudget, firstDayBias } = getBudgetFormValues()
    els.budgetSaveButton.disabled = true
    try {
        const response = await fetch('/budget', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ monthlyBudget, firstDayBias, currency: state.editingBudgetCurrency }),
        })
        if (!response.ok) throw new Error(`Save failed (${response.status})`)
        els.budgetDialog.close()
        toast('Budget updated')
        await fetchData({ silent: true })
    } catch (e) {
        console.error(e)
        toast('Could not save the budget', 'error')
    } finally {
        updateBudgetFormValidity()
    }
}

els.refreshButton.addEventListener('click', () => {
    els.refreshButton.classList.add('is-spinning')
    window.setTimeout(() => els.refreshButton.classList.remove('is-spinning'), 600)
    fetchData({ silent: true })
})

els.themeButton.addEventListener('click', () => {
    state.theme = THEME_ORDER[(THEME_ORDER.indexOf(state.theme) + 1) % THEME_ORDER.length]
    saveTheme(state.theme)
    applyTheme()
})

els.primaryBudgetButton.addEventListener('click', () => {
    const primary = primaryCurrency()
    if (primary) {
        openBudgetDialog(primary.code)
    }
})
els.budgetCancelButton.addEventListener('click', () => els.budgetDialog.close())
els.budgetForm.addEventListener('submit', submitBudget)
els.budgetForm.addEventListener('input', updateBudgetFormValidity)
els.budgetDialog.addEventListener('click', (event) => {
    if (event.target === els.budgetDialog) els.budgetDialog.close()
})

els.addTransactionButton.addEventListener('click', openAddTransactionDialog)
els.importButton.addEventListener('click', openImportDialog)
els.importForm.addEventListener('submit', submitImport)
els.importCancelButton.addEventListener('click', () => els.importDialog.close())
els.importDialog.addEventListener('click', (event) => {
    if (event.target === els.importDialog) els.importDialog.close()
})
els.transactionForm.addEventListener('submit', submitTransaction)
els.transactionCancelButton.addEventListener('click', () => els.transactionDialog.close())
els.transactionDialog.addEventListener('click', (event) => {
    if (event.target === els.transactionDialog) els.transactionDialog.close()
})

for (const input of els.transactionKindInputs) {
    input.addEventListener('change', () => {
        state.categoryTouched = false
        renderCategoryOptions(getSelectedKind())
        scheduleCategorySuggestion()
        if (!els.detailsSuggestions.hidden) {
            scheduleDetailsSuggestion()
        }
    })
}
els.transactionDetailsInput.addEventListener('input', () => {
    if (state.categoryTouched === false) {
        els.transactionCategorySelect.value = ''
    }
    scheduleCategorySuggestion()
    scheduleDetailsSuggestion()
})
els.transactionDetailsInput.addEventListener('focus', scheduleDetailsSuggestion)
els.transactionDetailsInput.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
        if (!els.detailsSuggestions.hidden) {
            event.preventDefault()
            hideDetailsSuggestions()
        }
        return
    }
    if (els.detailsSuggestions.hidden) {
        return
    }
    if (event.key === 'ArrowDown') {
        event.preventDefault()
        setActiveDetailsSuggestion(Math.min(detailsSuggestionIndex + 1, detailsSuggestions.length - 1))
    } else if (event.key === 'ArrowUp') {
        event.preventDefault()
        setActiveDetailsSuggestion(Math.max(detailsSuggestionIndex - 1, 0))
    } else if (event.key === 'Enter' && detailsSuggestionIndex >= 0) {
        event.preventDefault()
        selectDetailsSuggestion(detailsSuggestionIndex)
    }
})
els.transactionDetailsInput.addEventListener('blur', (event) => {
    if (event.relatedTarget && els.detailsSuggestions.contains(event.relatedTarget)) {
        return
    }
    window.setTimeout(() => {
        if (!els.detailsSuggestions.contains(document.activeElement)) {
            hideDetailsSuggestions()
        }
    }, 120)
})
els.transactionCategorySelect.addEventListener('change', () => {
    state.categoryTouched = true
    els.transactionCategoryHint.hidden = true
})
els.transactionDialog.addEventListener('close', hideDetailsSuggestions)

els.deleteConfirmButton.addEventListener('click', confirmDeleteTransaction)
els.deleteCancelButton.addEventListener('click', () => {
    state.pendingDelete = null
    els.deleteDialog.close()
})
els.deleteDialog.addEventListener('click', (event) => {
    if (event.target === els.deleteDialog) {
        state.pendingDelete = null
        els.deleteDialog.close()
    }
})

els.pretendButton.addEventListener('click', openPretendDialog)
els.pretendForm.addEventListener('submit', submitPretendForm)
els.pretendCancelButton.addEventListener('click', () => els.pretendDialog.close())
els.pretendDialog.addEventListener('click', (event) => {
    if (event.target === els.pretendDialog) els.pretendDialog.close()
})
els.pretendTodayButton.addEventListener('click', viewToday)
els.bannerTodayButton.addEventListener('click', viewToday)

window.addEventListener('resize', () => {
    window.clearTimeout(historyResizeTimer)
    historyResizeTimer = window.setTimeout(() => {
        if (state.data && !els.historyCard.hidden) {
            renderHistory()
        }
    }, 150)
})

prefersDark.addEventListener('change', () => {
    if (state.theme === 'auto') applyTheme()
})

document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && Date.now() - state.lastFetchAt > REFRESH_STALE_MS) {
        fetchData({ silent: true })
    }
})

applyTheme()
syncControls()
fetchData()
