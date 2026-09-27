'use strict'

const $ = (id) => document.getElementById(id)

const els = {
    refreshButton: $('refreshButton'),
    themeButton: $('themeButton'),
    editBudgetButton: $('editBudgetButton'),
    contextLabel: $('contextLabel'),
    updatedLabel: $('updatedLabel'),
    pretendBanner: $('pretendBanner'),
    pretendBannerDate: $('pretendBannerDate'),
    bannerTodayButton: $('bannerTodayButton'),
    monthCard: $('monthCard'),
    monthName: $('monthName'),
    monthSpend: $('monthSpend'),
    monthBudget: $('monthBudget'),
    monthProgress: $('monthProgress'),
    monthProgressFill: $('monthProgressFill'),
    monthRemaining: $('monthRemaining'),
    monthDaily: $('monthDaily'),
    monthPace: $('monthPace'),
    weekCard: $('weekCard'),
    weekRange: $('weekRange'),
    weekBadge: $('weekBadge'),
    weekSpend: $('weekSpend'),
    weekBudget: $('weekBudget'),
    weekProgress: $('weekProgress'),
    weekProgressFill: $('weekProgressFill'),
    weekRemaining: $('weekRemaining'),
    weekDaysLeft: $('weekDaysLeft'),
    weekPace: $('weekPace'),
    expensesList: $('expensesList'),
    expensesMeta: $('expensesMeta'),
    expensesEmpty: $('expensesEmpty'),
    pretendDateInput: $('pretendDateInput'),
    pretendTodayButton: $('pretendTodayButton'),
    budgetDialog: $('budgetDialog'),
    budgetForm: $('budgetForm'),
    monthlyBudgetInput: $('monthlyBudgetInput'),
    firstWeekBiasInput: $('firstWeekBiasInput'),
    budgetFormError: $('budgetFormError'),
    budgetCancelButton: $('budgetCancelButton'),
    budgetSaveButton: $('budgetSaveButton'),
    toasts: $('toasts'),
}

const THEME_KEY = 'dscpln-theme'
const THEME_ORDER = ['auto', 'light', 'dark']
const REFRESH_STALE_MS = 60 * 1000

const ICONS = {
    auto: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 0 0 18z" fill="currentColor" stroke="none"/></svg>',
    light: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
    dark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>',
}

const WEEK_MESSAGES = {
    partialStart: 'Includes next week (current week is partial)',
    partialEnd: 'Includes last week (current week is partial)',
    beforePartial: 'Includes next week (which is partial)',
    afterPartial: 'Includes last week (which was partial)',
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
        const response = await fetch(`/data?date=${toDateInputValue(state.viewDate)}`, {
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
    renderMonth()
    renderWeek()
    renderExpenses()
    syncControls()
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
    el.textContent = `${money(Math.abs(delta))} ${delta >= 0 ? 'under' : 'over'} pace`
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
        els.monthRemaining.textContent = 'Set a budget to track your pace.'
        els.monthDaily.textContent = ''
    } else if (remaining >= 0) {
        els.monthRemaining.textContent = `${money(remaining)} left`
        els.monthDaily.textContent = `${money(remaining / daysLeft)}/day · ${daysLeft} ${daysLeft === 1 ? 'day' : 'days'} left`
    } else {
        els.monthRemaining.textContent = `${money(-remaining)} over`
        els.monthDaily.textContent = ''
    }
    setPace(els.monthPace, budget, spent, day / daysInMonth)
    setProgress(els.monthProgress, els.monthProgressFill, spent, budget)
    setCardState(els.monthCard, spent, budget)
}

function renderWeek() {
    const data = state.data
    const budget = toNumber(data.weeklyBudget)
    const spent = toNumber(data.weeksSpend)
    const date = state.viewDate
    const weekStart = new Date(date)
    weekStart.setDate(date.getDate() - date.getDay())
    const weekEnd = new Date(weekStart)
    weekEnd.setDate(weekStart.getDate() + 6)
    const daysLeft = 6 - date.getDay()
    const remaining = budget - spent
    const code = data.weekSpecialCode

    els.weekRange.textContent = `${shortDayFormat.format(weekStart)} – ${shortDayFormat.format(weekEnd)}`
    els.weekSpend.textContent = money(spent)
    els.weekBudget.textContent = budget > 0 ? money(budget) : 'no budget'
    if (budget <= 0) {
        els.weekRemaining.textContent = ''
    } else {
        els.weekRemaining.textContent = remaining >= 0 ? `${money(remaining)} left` : `${money(-remaining)} over`
    }
    els.weekDaysLeft.textContent = `${daysLeft} ${daysLeft === 1 ? 'day' : 'days'} to go`

    if (code && WEEK_MESSAGES[code]) {
        els.weekBadge.textContent = WEEK_MESSAGES[code]
        els.weekBadge.hidden = false
    } else {
        els.weekBadge.hidden = true
    }

    if (code) {
        els.weekPace.textContent = ''
        els.weekPace.className = 'pace'
    } else {
        setPace(els.weekPace, budget, spent, (date.getDay() + 1) / 7)
    }
    setProgress(els.weekProgress, els.weekProgressFill, spent, budget)
    setCardState(els.weekCard, spent, budget)
}

function parseExpenseLines(lines) {
    let lastDate = null
    return lines.map((line) => {
        const tokens = line.split(/\s+/)
        const amount = Math.round(toNumber(tokens[0]) * 100) / 100
        let date = null
        if (tokens.length >= 3) {
            const monthToken = tokens[tokens.length - 2]
            const dayToken = tokens[tokens.length - 1]
            const month = Number.parseInt(monthToken, 10)
            const day = Number.parseInt(dayToken, 10)
            if (/^\d{1,2}$/.test(monthToken) && /^\d{1,2}$/.test(dayToken) &&
                month >= 1 && month <= 12 && day >= 1 && day <= 31) {
                date = { month, day }
                lastDate = date
                tokens.splice(-2)
            }
        }
        if (!date) date = lastDate
        return { amount, date, description: tokens.slice(1).join(' ').trim() }
    })
}

function renderExpenses() {
    const parsed = parseExpenseLines(state.data.extraData || [])
    const totalCents = parsed.reduce((sum, e) => sum + Math.round(e.amount * 100), 0)
    const count = parsed.length

    els.expensesList.textContent = ''
    els.expensesMeta.textContent = count ?
        `${count} ${count === 1 ? 'expense' : 'expenses'} · ${money(totalCents / 100)}` :
        ''
    els.expensesEmpty.hidden = count > 0

    for (const expense of parsed.slice().reverse()) {
        const li = document.createElement('li')
        li.className = 'expense'
        if (expense.date &&
            expense.date.month === state.viewDate.getMonth() + 1 &&
            expense.date.day === state.viewDate.getDate()) {
            li.classList.add('expense--today')
        }
        const dateEl = document.createElement('span')
        dateEl.className = 'expense__date'
        dateEl.textContent = expense.date ? `${expense.date.month}/${expense.date.day}` : ''
        const descEl = document.createElement('span')
        descEl.className = 'expense__desc'
        descEl.textContent = expense.description || '—'
        const amountEl = document.createElement('span')
        amountEl.className = 'expense__amount'
        amountEl.textContent = money(expense.amount)
        li.append(dateEl, descEl, amountEl)
        els.expensesList.appendChild(li)
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
    els.firstWeekBiasInput.value = toNumber(state.data.firstWeekBias)
    updateBudgetFormValidity()
    els.budgetDialog.showModal()
}

function getBudgetFormValues() {
    return {
        monthlyBudget: Number.parseFloat(els.monthlyBudgetInput.value),
        firstWeekBias: Number.parseFloat(els.firstWeekBiasInput.value),
    }
}

function updateBudgetFormValidity() {
    const { monthlyBudget, firstWeekBias } = getBudgetFormValues()
    let error = ''
    if (!Number.isFinite(monthlyBudget) || monthlyBudget <= 0) {
        error = 'Monthly budget must be greater than 0.'
    } else if (!Number.isFinite(firstWeekBias) || firstWeekBias < 0) {
        error = 'First week bias must be 0 or greater.'
    } else if (firstWeekBias > monthlyBudget) {
        error = 'First week bias cannot be greater than the monthly budget.'
    }
    els.budgetFormError.textContent = error
    els.budgetFormError.hidden = !error
    els.budgetSaveButton.disabled = Boolean(error)
    return !error
}

async function submitBudget(event) {
    event.preventDefault()
    if (!updateBudgetFormValidity()) return
    const { monthlyBudget, firstWeekBias } = getBudgetFormValues()
    els.budgetSaveButton.disabled = true
    try {
        const response = await fetch('/budget', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ monthlyBudget, firstWeekBias }),
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
