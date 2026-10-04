'use strict'

const $ = (id) => document.getElementById(id)

const els = {
    refreshButton: $('refreshButton'),
    themeButton: $('themeButton'),
    contextLabel: $('contextLabel'),
    updatedLabel: $('updatedLabel'),
    pretendBanner: $('pretendBanner'),
    pretendBannerDate: $('pretendBannerDate'),
    bannerTodayButton: $('bannerTodayButton'),
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
    monthPace: $('monthPace'),
    monthSpentThis: $('monthSpentThis'),
    monthSpentPrev: $('monthSpentPrev'),
    monthSpentAvg: $('monthSpentAvg'),
    monthEarnThis: $('monthEarnThis'),
    monthEarnPrev: $('monthEarnPrev'),
    monthEarnAvg: $('monthEarnAvg'),
    primaryBudgetButton: $('primaryBudgetButton'),
    otherCurrencies: $('otherCurrencies'),
    expensesList: $('expensesList'),
    expensesMeta: $('expensesMeta'),
    expensesEmpty: $('expensesEmpty'),
    addTransactionButton: $('addTransactionButton'),
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
}

const moneyFormat = new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
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
let pretendDateTimer = null
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

function money(value) {
    return `$${moneyFormat.format(value)}`
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
    el.textContent = message
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

function setPace(el, budget, spent, fraction) {
    if (budget <= 0) {
        el.textContent = ''
        el.className = 'pace'
        return
    }
    const delta = budget * fraction - spent
    el.textContent = `${money(Math.abs(delta))} ${delta >= 0 ? 'less' : 'more'} than expected`
    el.className = `pace ${delta >= 0 ? 'pace--ok' : 'pace--over'}`
}

function renderMonth(currency) {
    const budget = currency ? toNumber(currency.monthlyBudget) : 0
    const spent = currency ? toNumber(currency.monthsSpend) : 0
    const date = state.viewDate
    const daysInMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()
    const day = date.getDate()
    const daysLeft = Math.max(1, daysInMonth - day + 1)
    const remaining = budget - spent

    els.monthHeading.textContent = currency ? currency.code : 'Main'
    els.monthName.textContent = monthFormat.format(date)
    els.monthSpend.textContent = money(spent)
    els.monthBudget.textContent = budget > 0 ? money(budget) : 'no budget'
    if (budget <= 0) {
        els.monthRemaining.textContent = 'Set a budget to track your spending.'
        els.monthDaily.textContent = ''
    } else if (remaining >= 0) {
        els.monthRemaining.textContent = `${money(remaining)} left`
        els.monthDaily.textContent = `${money(remaining / daysLeft)}/day · ${daysLeft} ${daysLeft === 1 ? 'day' : 'days'} left`
    } else {
        els.monthRemaining.textContent = `${money(-remaining)} over`
        els.monthDaily.textContent = ''
    }
    els.monthSpentThis.textContent = money(spent)
    els.monthSpentPrev.textContent = money(currency ? toNumber(currency.previousMonthsSpend) : 0)
    els.monthSpentAvg.textContent = money(currency ? toNumber(currency.trailingSpendAverage) : 0)
    els.monthEarnThis.textContent = `+${money(currency ? toNumber(currency.monthsIncome) : 0)}`
    els.monthEarnPrev.textContent = `+${money(currency ? toNumber(currency.previousMonthsIncome) : 0)}`
    els.monthEarnAvg.textContent = `+${money(currency ? toNumber(currency.trailingIncomeAverage) : 0)}`

    const expected = currency && currency.monthsExpectedSpend != null ? toNumber(currency.monthsExpectedSpend) : budget * (day / daysInMonth)
    setPace(els.monthPace, budget, spent, budget > 0 ? expected / budget : 0)
    setProgress(els.monthProgress, els.monthProgressFill, spent, budget)
    setCardState(els.monthCard, spent, budget)
}

function buildCurrencyCard(currency) {
    const card = document.createElement('section')
    card.className = 'card card--compact currency-card'
    card.setAttribute('aria-label', `${currency.code} budget`)

    const header = document.createElement('div')
    header.className = 'card__header'
    const title = document.createElement('h2')
    title.textContent = currency.code
    const editButton = document.createElement('button')
    editButton.type = 'button'
    editButton.className = 'icon-button icon-button--small'
    editButton.title = `Edit ${currency.code} budget`
    editButton.setAttribute('aria-label', `Edit ${currency.code} budget`)
    editButton.innerHTML = ICONS.edit
    editButton.addEventListener('click', () => openBudgetDialog(currency.code))
    header.append(title, editButton)

    const budget = toNumber(currency.monthlyBudget)
    const spent = toNumber(currency.monthsSpend)
    const remaining = budget - spent

    const figure = document.createElement('p')
    figure.className = 'figure'
    const spendEl = document.createElement('span')
    spendEl.className = 'figure__spend'
    spendEl.textContent = money(spent)
    const ofEl = document.createElement('span')
    ofEl.className = 'figure__of'
    ofEl.textContent = budget > 0 ? 'of' : ''
    const budgetEl = document.createElement('span')
    budgetEl.className = 'figure__budget'
    budgetEl.textContent = budget > 0 ? money(budget) : 'no budget'
    figure.append(spendEl, ofEl, budgetEl)

    const progress = document.createElement('div')
    progress.className = 'progress'
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

    const stats = document.createElement('div')
    stats.className = 'card__stats'
    const statsMain = document.createElement('span')
    if (budget <= 0) {
        statsMain.textContent = 'No budget'
    } else {
        statsMain.textContent = remaining >= 0 ? `${money(remaining)} left` : `${money(-remaining)} over`
    }
    const pace = document.createElement('span')
    pace.className = 'pace'
    if (budget > 0 && currency.monthsExpectedSpend != null) {
        const delta = toNumber(currency.monthsExpectedSpend) - spent
        pace.textContent = `${money(Math.abs(delta))} ${delta >= 0 ? 'less' : 'more'} than expected`
        pace.className = `pace ${delta >= 0 ? 'pace--ok' : 'pace--over'}`
    }
    stats.append(statsMain, pace)

    const grid = document.createElement('div')
    grid.className = 'mini-grid'
    const addCell = (text, className) => {
        const cell = document.createElement('span')
        cell.className = className
        cell.textContent = text
        grid.appendChild(cell)
    }
    addCell('', 'mini-grid__label')
    addCell('This month', 'mini-grid__header')
    addCell('Last month', 'mini-grid__header')
    addCell('12-mo avg', 'mini-grid__header')
    addCell('Spent', 'mini-grid__label')
    addCell(money(spent), 'mini-grid__value')
    addCell(money(toNumber(currency.previousMonthsSpend)), 'mini-grid__value')
    addCell(money(toNumber(currency.trailingSpendAverage)), 'mini-grid__value')
    addCell('Earned', 'mini-grid__label')
    addCell(`+${money(toNumber(currency.monthsIncome))}`, 'mini-grid__value mini-grid__value--in')
    addCell(`+${money(toNumber(currency.previousMonthsIncome))}`, 'mini-grid__value mini-grid__value--in')
    addCell(`+${money(toNumber(currency.trailingIncomeAverage))}`, 'mini-grid__value mini-grid__value--in')

    card.append(header, figure, progress, stats, grid)
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

function buildExpenseRow(transaction, writable) {
    const li = document.createElement('li')
    li.className = 'expense'
    if (transaction.kind === 'income') {
        li.classList.add('expense--income')
    }
    const date = parseIsoDate(transaction.date)
    if (date && isSameDay(date, state.viewDate)) {
        li.classList.add('expense--today')
    } else if (date && date > state.viewDate) {
        li.classList.add('expense--future')
        li.title = 'Dated after the viewed date'
    }
    const dateEl = document.createElement('span')
    dateEl.className = 'expense__date'
    dateEl.textContent = date ? `${date.getMonth() + 1}/${date.getDate()}` : ''
    const descEl = document.createElement('span')
    descEl.className = 'expense__desc'
    descEl.textContent = transaction.details || '—'
    if (transaction.notes) {
        const notesEl = document.createElement('span')
        notesEl.className = 'expense__notes'
        notesEl.textContent = transaction.notes
        descEl.appendChild(notesEl)
    }
    const categoryEl = document.createElement('span')
    categoryEl.className = 'expense__category'
    categoryEl.textContent = transaction.category || ''
    const amountEl = document.createElement('span')
    amountEl.className = transaction.kind === 'income' ? 'expense__amount expense__amount--in' : 'expense__amount'
    const amount = transaction.kind === 'income' ? transaction.moneyIn : transaction.expenses
    amountEl.textContent = transaction.kind === 'income' ? `+${money(amount || 0)}` : money(amount || 0)
    li.append(dateEl, descEl, categoryEl, amountEl)
    if (writable) {
        li.append(buildExpenseActions(transaction))
    }
    return li
}

function renderExpenses() {
    const transactions = state.data.transactions || []
    const count = transactions.length
    const writable = state.data.writable !== false

    els.addTransactionButton.hidden = !writable
    els.expensesList.textContent = ''
    els.expensesList.hidden = count === 0
    els.expensesMeta.textContent = count ? `${count} ${count === 1 ? 'transaction' : 'transactions'}` : ''
    els.expensesEmpty.hidden = count > 0

    const currencies = state.data.currencies || []
    const known = new Set(currencies.map((currency) => currency.code))
    const groups = []
    for (const currency of currencies) {
        const items = transactions.filter((transaction) => transaction.currency === currency.code)
        if (items.length) {
            groups.push({ code: currency.code, items })
        }
    }
    const unknown = transactions.filter((transaction) => !known.has(transaction.currency))
    if (unknown.length) {
        groups.push({ code: '', items: unknown })
    }

    for (const group of groups) {
        const outCents = group.items.reduce((sum, transaction) => sum + Math.round((transaction.expenses || 0) * 100), 0)
        const inCents = group.items.reduce((sum, transaction) => sum + Math.round((transaction.moneyIn || 0) * 100), 0)
        const header = document.createElement('li')
        header.className = 'expense-group'
        header.textContent = `${group.code ? `${group.code} · ` : ''}${money(outCents / 100)} out${inCents > 0 ? ` · +${money(inCents / 100)} in` : ''}`
        els.expensesList.appendChild(header)
        for (const transaction of group.items.slice().reverse()) {
            els.expensesList.appendChild(buildExpenseRow(transaction, writable))
        }
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

function openDeleteTransactionDialog(transaction) {
    state.pendingDelete = transaction
    const amount = transaction.kind === 'income' ? transaction.moneyIn : transaction.expenses
    els.deleteDialogText.textContent = `${money(amount || 0)} · ${transaction.details || 'No details'}`
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
    const viewingToday = isSameDay(state.viewDate, state.today)
    els.pretendDateInput.value = toDateInputValue(state.viewDate)
    els.pretendTodayButton.disabled = viewingToday
    els.primaryBudgetButton.disabled = !state.data
}

function viewToday() {
    window.clearTimeout(pretendDateTimer)
    state.viewDate = startOfDay(new Date())
    syncControls()
    fetchData({ silent: true })
}

function applyPretendDate() {
    const parsed = parseDateInputValue(els.pretendDateInput.value)
    if (!parsed) {
        els.pretendDateInput.value = toDateInputValue(state.viewDate)
        return
    }
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
    })
}
els.transactionDetailsInput.addEventListener('input', () => {
    if (state.categoryTouched === false) {
        els.transactionCategorySelect.value = ''
    }
    scheduleCategorySuggestion()
})
els.transactionCategorySelect.addEventListener('change', () => {
    state.categoryTouched = true
    els.transactionCategoryHint.hidden = true
})

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

els.pretendDateInput.addEventListener('change', () => {
    window.clearTimeout(pretendDateTimer)
    pretendDateTimer = window.setTimeout(applyPretendDate, 150)
})
els.pretendTodayButton.addEventListener('click', viewToday)
els.bannerTodayButton.addEventListener('click', viewToday)

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
