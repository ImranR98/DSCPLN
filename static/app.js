'use strict'

const $ = (id) => document.getElementById(id)

const els = {
    refreshButton: $('refreshButton'),
    themeButton: $('themeButton'),
    editBudgetButton: $('editBudgetButton'),
    contextLabel: $('contextLabel'),
    currencySelect: $('currencySelect'),
    updatedLabel: $('updatedLabel'),
    pretendBanner: $('pretendBanner'),
    pretendBannerDate: $('pretendBannerDate'),
    bannerTodayButton: $('bannerTodayButton'),
    monthCard: $('monthCard'),
    monthName: $('monthName'),
    monthSpend: $('monthSpend'),
    monthOf: $('monthOf'),
    monthBudget: $('monthBudget'),
    monthProgress: $('monthProgress'),
    monthProgressFill: $('monthProgressFill'),
    monthRemaining: $('monthRemaining'),
    monthDaily: $('monthDaily'),
    monthPace: $('monthPace'),
    monthCurrencyNote: $('monthCurrencyNote'),
    weekCard: $('weekCard'),
    weekRange: $('weekRange'),
    weekSpend: $('weekSpend'),
    weekOf: $('weekOf'),
    weekBudget: $('weekBudget'),
    weekProgress: $('weekProgress'),
    weekProgressFill: $('weekProgressFill'),
    weekRemaining: $('weekRemaining'),
    weekDaysLeft: $('weekDaysLeft'),
    weekPace: $('weekPace'),
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
    budgetFormError: $('budgetFormError'),
    budgetCancelButton: $('budgetCancelButton'),
    budgetSaveButton: $('budgetSaveButton'),
    transactionDialog: $('transactionDialog'),
    transactionForm: $('transactionForm'),
    transactionDialogTitle: $('transactionDialogTitle'),
    transactionAmountInput: $('transactionAmountInput'),
    transactionDescriptionInput: $('transactionDescriptionInput'),
    transactionCurrencyInput: $('transactionCurrencyInput'),
    currencyOptions: $('currencyOptions'),
    transactionDateInput: $('transactionDateInput'),
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
const shortDayFormat = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' })
const timeFormat = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' })

const prefersDark = window.matchMedia('(prefers-color-scheme: dark)')

const state = {
    today: startOfDay(new Date()),
    viewDate: startOfDay(new Date()),
    data: null,
    lastFetchAt: 0,
    fetching: false,
    theme: readTheme(),
    currency: null,
    editingTransaction: null,
    pendingDelete: null,
}

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
    if (state.fetching) return
    state.fetching = true
    refreshToday()
    if (!state.data && !silent) document.body.classList.add('is-loading')
    try {
        const params = new URLSearchParams({ date: toDateInputValue(state.viewDate) })
        if (state.currency) params.set('currency', state.currency)
        const response = await fetch(`/data?${params}`, {
            headers: { Accept: 'application/json' },
        })
        if (!response.ok) throw new Error(`Request failed (${response.status})`)
        state.data = await response.json()
        state.lastFetchAt = Date.now()
        render()
    } catch (e) {
        console.error(e)
        toast('Could not load data. Check the server logs.', 'error')
    } finally {
        state.fetching = false
        document.body.classList.remove('is-loading')
    }
}

function render() {
    if (!state.data) return
    renderContext()
    renderCurrencyPicker()
    renderMonth()
    renderWeek()
    renderExpenses()
    syncControls()
}

function renderCurrencyPicker() {
    const currencies = state.data.currencies || []
    const options = state.currency && !currencies.includes(state.currency) ?
        [...currencies, state.currency].sort() : currencies
    els.currencySelect.hidden = options.length === 0
    els.currencySelect.textContent = ''
    const localOption = document.createElement('option')
    localOption.value = ''
    localOption.textContent = 'Local'
    els.currencySelect.appendChild(localOption)
    for (const currency of options) {
        const option = document.createElement('option')
        option.value = currency
        option.textContent = currency
        els.currencySelect.appendChild(option)
    }
    els.currencySelect.value = state.currency || ''
    els.currencyOptions.textContent = ''
    for (const currency of options) {
        const option = document.createElement('option')
        option.value = currency
        els.currencyOptions.appendChild(option)
    }
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

function renderMonth() {
    const data = state.data
    const budget = toNumber(data.monthlyBudget)
    const spent = toNumber(data.monthsSpend)
    const date = state.viewDate
    const daysInMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()
    const day = date.getDate()
    const daysLeft = Math.max(1, daysInMonth - day + 1)
    const remaining = budget - spent

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
    const currencyView = Boolean(state.currency)
    els.monthOf.hidden = currencyView
    els.monthBudget.hidden = currencyView
    els.monthProgress.hidden = currencyView
    els.monthRemaining.hidden = currencyView
    els.monthDaily.hidden = currencyView
    els.monthPace.hidden = currencyView
    els.monthCurrencyNote.hidden = !currencyView
    els.monthCurrencyNote.textContent = currencyView ? 'Budgets are tracked for local spending only.' : ''

    const expected = data.monthsExpectedSpend != null ? toNumber(data.monthsExpectedSpend) : budget * (day / daysInMonth)
    setPace(els.monthPace, budget, spent, budget > 0 ? expected / budget : 0)
    setProgress(els.monthProgress, els.monthProgressFill, spent, budget)
    setCardState(els.monthCard, spent, budget)
}

function renderWeek() {
    const data = state.data
    const budget = toNumber(data.weeklyBudget)
    const spent = toNumber(data.weeksSpend)
    const date = state.viewDate
    const periodStartDay = toNumber(data.weekPeriodStartDay) || date.getDate()
    const periodEndDay = toNumber(data.weekPeriodEndDay) || date.getDate()
    const periodStart = new Date(date.getFullYear(), date.getMonth(), periodStartDay)
    const periodEnd = new Date(date.getFullYear(), date.getMonth(), periodEndDay)
    const daysLeft = Math.max(0, periodEndDay - date.getDate())
    const remaining = budget - spent

    els.weekRange.textContent = `${shortDayFormat.format(periodStart)} – ${shortDayFormat.format(periodEnd)}`
    els.weekSpend.textContent = money(spent)
    els.weekBudget.textContent = budget > 0 ? money(budget) : 'no budget'
    if (budget <= 0) {
        els.weekRemaining.textContent = ''
    } else {
        els.weekRemaining.textContent = remaining >= 0 ? `${money(remaining)} left` : `${money(-remaining)} over`
    }
    els.weekDaysLeft.textContent = `${daysLeft} ${daysLeft === 1 ? 'day' : 'days'} to go`

    const currencyView = Boolean(state.currency)
    els.weekOf.hidden = currencyView
    els.weekBudget.hidden = currencyView
    els.weekProgress.hidden = currencyView
    els.weekRemaining.hidden = currencyView
    els.weekPace.hidden = currencyView

    const expected = data.weeksExpectedSpend != null ? toNumber(data.weeksExpectedSpend) : budget * ((date.getDay() + 1) / 7)
    setPace(els.weekPace, budget, spent, budget > 0 ? expected / budget : 0)
    setProgress(els.weekProgress, els.weekProgressFill, spent, budget)
    setCardState(els.weekCard, spent, budget)
}

function buildExpenseActions(transaction) {
    const actions = document.createElement('span')
    actions.className = 'expense__actions'

    const editButton = document.createElement('button')
    editButton.type = 'button'
    editButton.className = 'icon-button'
    editButton.title = 'Edit'
    editButton.setAttribute('aria-label', `Edit ${transaction.description || 'transaction'}`)
    editButton.innerHTML = ICONS.edit
    editButton.addEventListener('click', () => openEditTransactionDialog(transaction))

    const deleteButton = document.createElement('button')
    deleteButton.type = 'button'
    deleteButton.className = 'icon-button icon-button--danger'
    deleteButton.title = 'Delete'
    deleteButton.setAttribute('aria-label', `Delete ${transaction.description || 'transaction'}`)
    deleteButton.innerHTML = ICONS.delete
    deleteButton.addEventListener('click', () => openDeleteTransactionDialog(transaction))

    actions.append(editButton, deleteButton)
    return actions
}

function renderExpenses() {
    const transactions = state.data.transactions || []
    const totalCents = transactions.reduce((sum, transaction) => sum + Math.round(transaction.amount * 100), 0)
    const count = transactions.length
    const writable = state.data.writable !== false

    els.addTransactionButton.hidden = !writable
    els.expensesList.textContent = ''
    const currencyLabel = state.currency ? `${state.currency} · ` : ''
    els.expensesMeta.textContent = count ?
        `${currencyLabel}${count} ${count === 1 ? 'expense' : 'expenses'} · ${money(totalCents / 100)}` :
        ''
    els.expensesEmpty.hidden = count > 0

    for (const transaction of transactions.slice().reverse()) {
        const li = document.createElement('li')
        li.className = 'expense'
        const date = transaction.effectiveDate
        const sameMonth = date && date.month === state.viewDate.getMonth() + 1
        if (sameMonth && date.day === state.viewDate.getDate()) {
            li.classList.add('expense--today')
        } else if (sameMonth && date.day > state.viewDate.getDate()) {
            li.classList.add('expense--future')
            li.title = 'Dated after the viewed date'
        }
        const dateEl = document.createElement('span')
        dateEl.className = 'expense__date'
        dateEl.textContent = date ? `${date.month}/${date.day}` : ''
        const descEl = document.createElement('span')
        descEl.className = 'expense__desc'
        descEl.textContent = transaction.description || '—'
        const amountEl = document.createElement('span')
        amountEl.className = 'expense__amount'
        amountEl.textContent = money(transaction.amount)
        li.append(dateEl, descEl, amountEl)
        if (writable) {
            li.append(buildExpenseActions(transaction))
        }
        els.expensesList.appendChild(li)
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

function openAddTransactionDialog() {
    if (!state.data || state.data.writable === false) return
    state.editingTransaction = null
    els.transactionDialogTitle.textContent = 'Add transaction'
    els.transactionForm.reset()
    els.transactionCurrencyInput.value = state.currency || ''
    els.transactionDateInput.value = toDateInputValue(state.viewDate)
    els.transactionFormError.hidden = true
    els.transactionDialog.showModal()
    els.transactionAmountInput.focus()
}

function openEditTransactionDialog(transaction) {
    state.editingTransaction = transaction
    els.transactionDialogTitle.textContent = 'Edit transaction'
    els.transactionAmountInput.value = transaction.amount
    els.transactionDescriptionInput.value = transaction.description || ''
    els.transactionCurrencyInput.value = transaction.currency || ''
    const date = transaction.date || transaction.effectiveDate
    els.transactionDateInput.value = date ?
        toDateInputValue(new Date(state.viewDate.getFullYear(), date.month - 1, date.day)) :
        toDateInputValue(state.viewDate)
    els.transactionFormError.hidden = true
    els.transactionDialog.showModal()
    els.transactionAmountInput.focus()
}

async function submitTransaction(event) {
    event.preventDefault()
    const editing = state.editingTransaction
    const payload = {
        amount: Number.parseFloat(els.transactionAmountInput.value),
        description: els.transactionDescriptionInput.value,
        currency: els.transactionCurrencyInput.value.trim().toUpperCase(),
        date: els.transactionDateInput.value,
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
    els.deleteDialogText.textContent = `${money(transaction.amount)} · ${transaction.description || 'No description'}`
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
    els.editBudgetButton.disabled = !state.data
}

function viewToday() {
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

function openBudgetDialog() {
    if (!state.data) return
    els.monthlyBudgetInput.value = toNumber(state.data.monthlyBudget)
    els.firstDayBiasInput.value = toNumber(state.data.firstDayBias)
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
            body: JSON.stringify({ monthlyBudget, firstDayBias }),
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

els.editBudgetButton.addEventListener('click', openBudgetDialog)
els.budgetCancelButton.addEventListener('click', () => els.budgetDialog.close())
els.budgetForm.addEventListener('submit', submitBudget)
els.budgetForm.addEventListener('input', updateBudgetFormValidity)
els.budgetDialog.addEventListener('click', (event) => {
    if (event.target === els.budgetDialog) els.budgetDialog.close()
})

els.currencySelect.addEventListener('change', () => {
    state.currency = els.currencySelect.value || null
    fetchData({ silent: true })
})

els.addTransactionButton.addEventListener('click', openAddTransactionDialog)
els.transactionForm.addEventListener('submit', submitTransaction)
els.transactionCancelButton.addEventListener('click', () => els.transactionDialog.close())
els.transactionDialog.addEventListener('click', (event) => {
    if (event.target === els.transactionDialog) els.transactionDialog.close()
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

els.pretendDateInput.addEventListener('change', applyPretendDate)
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
