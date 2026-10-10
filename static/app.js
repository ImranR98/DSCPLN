'use strict'

// Dashboard: the current-month overview, currency tiles, last-12-months chart,
// the transactions list and the add/edit/import dialogs.
const { dates, formats, number, clean, moneyFor, currencyColor, icons, setBreakableText, el, requestJson, initTheme, showToast } = DSCPLN

const $ = (id) => document.getElementById(id)

const els = {
    refreshButton: $('refreshButton'),
    themeButton: $('themeButton'),
    contextLabel: $('contextLabel'),
    updatedLabel: $('updatedLabel'),

    monthCard: $('monthCard'),
    monthHeading: $('monthHeading'),
    monthName: $('monthName'),
    monthSpend: $('monthSpend'),
    monthBudget: $('monthBudget'),
    monthProgress: $('monthProgress'),
    monthProgressFill: $('monthProgressFill'),
    monthRemaining: $('monthRemaining'),
    monthDaily: $('monthDaily'),
    monthDaysLeft: $('monthDaysLeft'),
    monthPace: $('monthPace'),
    monthPaceMarker: $('monthPaceMarker'),
    monthThisHeader: $('monthThisHeader'),
    monthPrevHeader: $('monthPrevHeader'),
    monthAvgHeader: $('monthAvgHeader'),
    monthSpentThis: $('monthSpentThis'),
    monthSpentPrev: $('monthSpentPrev'),
    monthSpentAvg: $('monthSpentAvg'),
    monthEarnThis: $('monthEarnThis'),
    monthEarnPrev: $('monthEarnPrev'),
    monthEarnAvg: $('monthEarnAvg'),
    monthConvLabel: $('monthConvLabel'),
    monthConvThis: $('monthConvThis'),
    monthConvPrev: $('monthConvPrev'),
    monthConvAvg: $('monthConvAvg'),
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
    importPastWarning: $('importPastWarning'),
    importFormError: $('importFormError'),
    importCancelButton: $('importCancelButton'),
    importSubmitButton: $('importSubmitButton'),
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

const REFRESH_STALE_MS = 60 * 1000
const INCOME_GROUP = 'Money In'
const CONVERSION_GROUP = 'Conversions'

const state = {
    today: dates.startOfDay(new Date()),
    data: null,
    lastFetchAt: 0,
    fractionalCurrencies: new Set(),
    symbols: new Map(),
    editingBudgetCurrency: null,
    editingTransaction: null,
    pendingDelete: null,
    categoryTouched: false,
}

let suggestionTimer = null
let categorySuggestionSequence = 0
let detailsSuggestionTimer = null
let detailsSuggestionSequence = 0
let detailsSuggestions = []
let detailsSuggestionIndex = -1
let fetchSequence = 0

// Currencies whose data needs more than cents (e.g. XMR) keep significant
// digits even for values of 1 or more; everything else uses plain 2 decimals.
// Currencies without a symbol render amounts with no prefix.
const money = moneyFor(
    (code) => Boolean(code) && state.fractionalCurrencies.has(code),
    (code) => state.symbols.get(code))

function applyCurrencyAccent(element, code) {
    const color = currencyColor(code)
    if (color) element.style.setProperty('--currency', color)
}

function getSelectedKind() {
    const selected = els.transactionKindInputs.find((input) => input.checked)
    return selected ? selected.value : 'expense'
}

function toast(message, type = 'success') {
    showToast(els.toasts, message, type)
}

async function fetchData({ silent = false } = {}) {
    const sequence = ++fetchSequence
    state.today = dates.startOfDay(new Date())
    if (!state.data && !silent) document.body.classList.add('is-loading')
    try {
        const params = new URLSearchParams({ date: dates.iso(state.today) })
        const data = await requestJson(`/data?${params}`)
        if (sequence !== fetchSequence) return
        state.data = data
        state.lastFetchAt = Date.now()
        state.fractionalCurrencies = new Set(
            (data.currencies || []).filter((entry) => entry.fractional).map((entry) => entry.code))
        state.symbols = new Map(
            (data.currencies || []).filter((entry) => entry.symbol).map((entry) => [entry.code, entry.symbol]))
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
    els.contextLabel.textContent = `Today · ${formats.weekday.format(state.today)}`
    els.updatedLabel.textContent = state.lastFetchAt ? `Updated ${formats.time.format(new Date(state.lastFetchAt))}` : ''
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

function setPace(element, budget, spent, fraction, code) {
    if (budget <= 0) {
        element.textContent = ''
        element.className = 'pace'
        return
    }
    const delta = budget * fraction - spent
    element.textContent = `${money(Math.abs(delta), code)} ${delta >= 0 ? 'less' : 'more'} than expected`
    element.className = `pace ${delta >= 0 ? 'pace--ok' : 'pace--over'}`
}

function renderMonth(currency) {
    const value = (key) => number(currency && currency[key])
    const budget = value('monthlyBudget')
    const spent = value('monthsSpend')
    const code = currency ? currency.code : null
    const date = state.today
    const daysInMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()
    const day = date.getDate()
    const daysLeft = Math.max(1, daysInMonth - day + 1)
    const remaining = budget - spent
    const expected = value('monthsExpectedSpend') || budget * (day / daysInMonth)

    els.monthHeading.textContent = currency ? currency.code : 'Main'
    applyCurrencyAccent(els.monthCard, code)
    els.monthName.textContent = formats.monthName.format(date)
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

    // Last month and the trailing average are shown through the same day of
    // month as today, so all three figure columns are directly comparable; the
    // full-month figures stay in each cell's tooltip.
    const months = Math.max(0, Math.round(value('trailingMonths')))
    const previousMonthDate = new Date(date.getFullYear(), date.getMonth() - 1, 1)
    const daysInPreviousMonth = new Date(previousMonthDate.getFullYear(), previousMonthDate.getMonth() + 1, 0).getDate()
    const previousThrough = Math.min(day, daysInPreviousMonth)
    const monthToDate = day < daysInMonth
    const pick = (full, toDate) => (monthToDate ? toDate : full)
    const throughLabel = (through) => `days 1–${through}`
    els.monthThisHeader.textContent = monthToDate ? `This month (${throughLabel(day)})` : 'This month'
    els.monthPrevHeader.textContent = monthToDate ? `Last month (${throughLabel(previousThrough)})` : 'Last month'
    els.monthAvgHeader.textContent = months > 0 ?
        (monthToDate ? `${months}-mo avg (${throughLabel(day)})` : `${months}-mo avg`) : '—'
    const previousName = formats.monthName.format(previousMonthDate)

    setBreakableText(els.monthSpentPrev,
        months > 0 ? money(pick(value('previousMonthsSpend'), value('previousMonthsSpendToDate')), code) : '—')
    els.monthSpentPrev.title = months > 0 ? `${previousName} full month: ${money(value('previousMonthsSpend'), code)}` : ''
    setBreakableText(els.monthSpentAvg,
        months > 0 ? money(pick(value('trailingSpendAverage'), value('trailingSpendAverageToDate')), code) : '—')
    els.monthSpentAvg.title = months > 0 ?
        `${months}-month average (full months): ${money(value('trailingSpendAverage'), code)}` : ''

    setBreakableText(els.monthEarnThis, `+${money(value('monthsIncome'), code)}`)
    setBreakableText(els.monthEarnPrev, months > 0 ?
        `+${money(pick(value('previousMonthsIncome'), value('previousMonthsIncomeToDate')), code)}` : '—')
    els.monthEarnPrev.title = months > 0 ? `${previousName} full month: +${money(value('previousMonthsIncome'), code)}` : ''
    setBreakableText(els.monthEarnAvg, months > 0 ?
        `+${money(pick(value('trailingIncomeAverage'), value('trailingIncomeAverageToDate')), code)}` : '—')
    els.monthEarnAvg.title = months > 0 ?
        `${months}-month average (full months): +${money(value('trailingIncomeAverage'), code)}` : ''

    const convertedThis = { out: value('monthsConvertedOut'), in: value('monthsConvertedIn') }
    const convertedPrev = {
        out: pick(value('previousMonthsConvertedOut'), value('previousMonthsConvertedOutToDate')),
        in: pick(value('previousMonthsConvertedIn'), value('previousMonthsConvertedInToDate')),
    }
    const convertedAvg = {
        out: pick(value('trailingConvertedOutAverage'), value('trailingConvertedOutAverageToDate')),
        in: pick(value('trailingConvertedInAverage'), value('trailingConvertedInAverageToDate')),
    }
    const convertedPrevFull = { out: value('previousMonthsConvertedOut'), in: value('previousMonthsConvertedIn') }
    const convertedAvgFull = { out: value('trailingConvertedOutAverage'), in: value('trailingConvertedInAverage') }
    const convertedText = (totals) => {
        const net = clean(totals.in - totals.out)
        return `${net > 0 ? '+' : net < 0 ? '−' : ''}${money(Math.abs(net), code)}`
    }
    const convertedTitle = (totals) => `out ${money(totals.out, code)} · in ${money(totals.in, code)}`
    const setConvertedCell = (element, totals, full, fullLabel, available = true) => {
        setBreakableText(element, available ? convertedText(totals) : '—')
        element.title = available ?
            [full && fullLabel ? `${fullLabel}: ${convertedTitle(full)}` : '', convertedTitle(totals)]
                .filter(Boolean).join('\n') : ''
    }
    setConvertedCell(els.monthConvThis, convertedThis)
    setConvertedCell(els.monthConvPrev, convertedPrev, convertedPrevFull, `${previousName} full month`, months > 0)
    setConvertedCell(els.monthConvAvg, convertedAvg, convertedAvgFull, `${months}-month average (full months)`, months > 0)
    const hasConversions = [convertedThis, convertedPrev, convertedAvg, convertedPrevFull, convertedAvgFull]
        .some((totals) => totals.out > 0 || totals.in > 0)
    for (const cell of [els.monthConvLabel, els.monthConvThis, els.monthConvPrev, els.monthConvAvg]) {
        cell.hidden = !hasConversions
    }

    setPace(els.monthPace, budget, spent, budget > 0 ? expected / budget : 0, code)
    setProgress(els.monthProgress, els.monthProgressFill, spent, budget)
    setCardState(els.monthCard, spent, budget)
    const paceFraction = budget > 0 ? Math.min(1, Math.max(0, expected / budget)) : 0
    els.monthPaceMarker.hidden = budget <= 0
    els.monthPaceMarker.style.left = `${(paceFraction * 100).toFixed(1)}%`
}

function buildCurrencyCard(currency) {
    const code = currency.code
    const budget = number(currency.monthlyBudget)
    const spent = number(currency.monthsSpend)
    const remaining = budget - spent
    const pct = budget > 0 ? Math.min((spent / budget) * 100, 100) : 0

    const card = el('section', {
        class: 'currency-card',
        'aria-label': `${code} budget`,
        style: { '--currency': currencyColor(code) },
    },
        el('div', { class: 'currency-card__header' },
            el('span', { class: 'currency-badge' }, code),
            el('button', {
                type: 'button',
                class: 'icon-button icon-button--small',
                title: `Edit ${code} budget`,
                'aria-label': `Edit ${code} budget`,
                innerHTML: icons.edit,
                onclick: () => openBudgetDialog(code),
            })),
        el('p', { class: 'currency-card__figure' },
            breakable('currency-card__spend', money(spent, code)),
            breakable('currency-card__budget', budget > 0 ? `of ${money(budget, code)}` : 'no budget')),
        el('div', {
            class: 'progress progress--sm',
            role: 'progressbar',
            'aria-valuemin': '0',
            'aria-valuemax': '100',
            'aria-valuenow': String(Math.round(pct)),
            'aria-valuetext': budget > 0 ? `${Math.round(pct)}% of budget used` : 'No budget set',
        }, el('div', { class: 'progress__fill', style: { width: `${pct.toFixed(1)}%` } })),
        el('div', { class: 'currency-card__meta' },
            budget > 0 && el('span', {
                class: remaining >= 0 ? '' : 'currency-card__over',
                text: remaining >= 0 ? `${money(remaining, code)} left` : `${money(-remaining, code)} over`,
            }),
            el('span', { class: 'currency-card__earned', text: `+${money(number(currency.monthsIncome), code)} in` })),
        convertedLine(currency, code))
    setCardState(card, spent, budget)
    return card
}

// A span whose money value may wrap at sensible points.
function breakable(className, text) {
    const span = el('span', { class: className })
    setBreakableText(span, text)
    return span
}

function convertedLine(currency, code) {
    const parts = []
    if (number(currency.monthsConvertedOut) > 0) {
        parts.push(`−${money(number(currency.monthsConvertedOut), code)}`)
    }
    if (number(currency.monthsConvertedIn) > 0) {
        parts.push(`+${money(number(currency.monthsConvertedIn), code)}`)
    }
    return parts.length ? el('div', { class: 'currency-card__converted', text: `${parts.join(' / ')} converted` }) : null
}

function renderOtherCurrencies() {
    const currencies = (state.data.currencies || []).filter((currency) => !currency.primary && currency.hasActivity)
    els.otherCurrencies.textContent = ''
    els.otherCurrencies.hidden = currencies.length === 0
    for (const currency of currencies) {
        els.otherCurrencies.appendChild(buildCurrencyCard(currency))
    }
}

function renderHistory() {
    const history = state.data.history || []
    const codes = (state.data.currencies || []).map((currency) => currency.code)
    const rendered = DSCPLN.chart.renderMonthly(els.historyChart, els.historyTooltip, {
        months: history,
        codes,
        money,
        symbolFor: (code) => state.symbols.get(code),
    })
    els.historyCard.hidden = !rendered
    if (!rendered) {
        els.historyRange.textContent = ''
        return
    }
    const first = history[0]
    const last = history[history.length - 1]
    els.historyRange.textContent =
        formats.monthYear.format(new Date(first.year, first.month - 1, 1)) + ' – ' +
        formats.monthYear.format(new Date(last.year, last.month - 1, 1))
}

function renderExpenses() {
    const transactions = state.data.transactions || []
    const count = transactions.length
    const writable = state.data.writable !== false

    els.addTransactionButton.hidden = !writable
    els.importButton.hidden = !writable
    els.expensesMeta.textContent = count ? DSCPLN.transactions.formatCount(count) : ''
    els.expensesEmpty.hidden = count > 0

    DSCPLN.transactions.renderList(els.expensesList, transactions, {
        writable,
        money,
        today: state.today,
        markFuture: true,
        onEdit: openEditTransactionDialog,
        onDelete: openDeleteTransactionDialog,
    })
}

function renderCategoryOptions(kind) {
    const groups = (state.data.categories || []).filter((entry) =>
        kind === 'income'
            ? entry.group === INCOME_GROUP || entry.group === CONVERSION_GROUP
            : entry.group !== INCOME_GROUP)
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
        const data = await requestJson(`/details-suggestions?${params}`)
        if (sequence !== detailsSuggestionSequence || !els.transactionDialog.open) {
            return
        }
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
        // mousedown is prevented to keep focus in the input; selection happens
        // on click, so a touch scroll gesture doesn't select a suggestion.
        els.detailsSuggestions.appendChild(el('li', {
            class: 'autocomplete__option',
            id: `detailsSuggestion-${index}`,
            role: 'option',
            'aria-selected': 'false',
            onmousedown: (event) => event.preventDefault(),
            onclick: () => selectDetailsSuggestion(index),
        },
            el('span', { class: 'autocomplete__option-details', text: suggestion.details }),
            el('span', { class: 'autocomplete__option-category', text: suggestion.category || '' })))
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
    const sequence = ++categorySuggestionSequence
    const details = els.transactionDetailsInput.value.trim()
    if (details.length < 3) {
        els.transactionCategoryHint.hidden = true
        return
    }
    try {
        const result = await requestJson(`/category-suggestions?q=${encodeURIComponent(details)}&kind=${getSelectedKind()}`)
        if (sequence !== categorySuggestionSequence) {
            return
        }
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
    els.transactionDialog.setAttribute('label', 'Add transaction')
    els.transactionForm.reset()
    renderCategoryOptions('expense')
    renderCurrencyOptions()
    const primary = primaryCurrency()
    els.transactionCurrencySelect.value = primary ? primary.code : ''
    els.transactionDateInput.value = dates.iso(state.today)
    els.transactionCategoryHint.hidden = true
    els.transactionFormError.hidden = true
    hideDetailsSuggestions()
    els.transactionDialog.show()
    els.transactionDetailsInput.focus()
}

function openEditTransactionDialog(transaction) {
    state.editingTransaction = transaction
    state.categoryTouched = true
    els.transactionDialog.setAttribute('label', 'Edit transaction')
    for (const input of els.transactionKindInputs) {
        input.checked = input.value === transaction.kind
    }
    renderCategoryOptions(transaction.kind)
    renderCurrencyOptions()
    els.transactionAmountInput.value = transaction.kind === 'income' ? transaction.moneyIn : transaction.expenses
    els.transactionDetailsInput.value = transaction.details || ''
    const date = dates.parseIso(transaction.date)
    els.transactionDateInput.value = date ? dates.iso(date) : dates.iso(state.today)
    els.transactionCategorySelect.value = transaction.category || ''
    els.transactionCurrencySelect.value = transaction.currency || ''
    els.transactionNotesInput.value = transaction.notes || ''
    els.transactionCategoryHint.hidden = true
    els.transactionFormError.hidden = true
    hideDetailsSuggestions()
    els.transactionDialog.show()
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
        await requestJson(editing ? `/transactions/${encodeURIComponent(editing.id)}` : '/transactions', {
            method: editing ? 'PUT' : 'POST',
            body: JSON.stringify(payload),
        })
        els.transactionDialog.hide()
        toast(editing ? 'Transaction updated' : 'Transaction added')
        await fetchData({ silent: true })
    } catch (e) {
        if (e.status === 409) {
            els.transactionDialog.hide()
            toast(e.message, 'error')
            await fetchData({ silent: true })
        } else {
            showFormError(e, els.transactionFormError, 'Could not save the transaction. Check the server logs.')
        }
    } finally {
        els.transactionSaveButton.disabled = false
    }
}

// HTTP errors carry the server's message; anything else is unexpected.
function showFormError(error, element, fallback) {
    const message = error.status ? error.message : fallback
    if (!error.status) {
        console.error(error)
    }
    element.textContent = message
    element.hidden = false
}

let importPastConfirmed = false

function resetImportConfirmation() {
    importPastConfirmed = false
    els.importPastWarning.hidden = true
    els.importSubmitButton.textContent = 'Import'
}

// Counts pasted lines whose Date column is before the current month, so the
// user can be warned before importing historical transactions.
function pastDatedImportLines(text) {
    const columns = state.data && state.data.transactionColumns
    const dateIndex = Math.max(0, (columns || ['Date']).indexOf('Date'))
    const monthStart = dates.iso(new Date(state.today.getFullYear(), state.today.getMonth(), 1))
    let count = 0
    let earliest = null
    for (const line of text.split(/\r?\n/)) {
        if (line.trim() === '') {
            continue
        }
        const value = (line.split('\t')[dateIndex] || '').trim()
        if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value >= monthStart) {
            continue
        }
        count += 1
        if (!earliest || value < earliest) {
            earliest = value
        }
    }
    return { count, earliest }
}

const IMPORTABLE_COLUMNS = ['Date', 'Details', 'Money In', 'Expenses', 'Currency', 'Type', 'Notes']

function openImportDialog() {
    if (!state.data || state.data.writable === false) return
    const columns = state.data.transactionColumns && state.data.transactionColumns.length ?
        state.data.transactionColumns :
        IMPORTABLE_COLUMNS
    const extra = columns.filter((column) => !IMPORTABLE_COLUMNS.includes(column))
    els.importHint.textContent = `One transaction per line, tab-separated, in this column order: ${columns.join(' · ')}. Fill either Money In or Expenses.` +
        (extra.length ? ` Leave ${extra.join(', ')} empty.` : '')
    els.importTextarea.value = ''
    els.importFormError.hidden = true
    resetImportConfirmation()
    els.importDialog.show()
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
    const past = pastDatedImportLines(text)
    if (past.count > 0 && !importPastConfirmed) {
        importPastConfirmed = true
        els.importPastWarning.textContent =
            `${past.count} ${past.count === 1 ? 'line is' : 'lines are'} dated before this month (earliest ${past.earliest}). ` +
            'Click "Import anyway" to confirm these are deliberate.'
        els.importPastWarning.hidden = false
        els.importSubmitButton.textContent = 'Import anyway'
        return
    }
    els.importSubmitButton.disabled = true
    try {
        const result = await requestJson('/transactions/import', {
            method: 'POST',
            body: JSON.stringify({ text }),
        })
        els.importDialog.hide()
        toast(`Imported ${result.imported} ${result.imported === 1 ? 'transaction' : 'transactions'}`)
        await fetchData({ silent: true })
    } catch (e) {
        showFormError(e, els.importFormError, 'Could not import transactions. Check the server logs.')
    } finally {
        els.importSubmitButton.disabled = false
    }
}

function openDeleteTransactionDialog(transaction) {
    state.pendingDelete = transaction
    const amount = transaction.kind === 'income' ? transaction.moneyIn : transaction.expenses
    els.deleteDialogText.textContent = `${money(amount || 0, transaction.currency)} · ${transaction.details || 'No details'}`
    els.deleteDialogError.hidden = true
    els.deleteDialog.show()
}

async function confirmDeleteTransaction() {
    const transaction = state.pendingDelete
    if (!transaction) return
    els.deleteConfirmButton.disabled = true
    try {
        await requestJson(`/transactions/${encodeURIComponent(transaction.id)}`, { method: 'DELETE' })
        els.deleteDialog.hide()
        state.pendingDelete = null
        toast('Transaction deleted')
        await fetchData({ silent: true })
    } catch (e) {
        if (e.status === 409) {
            els.deleteDialog.hide()
            state.pendingDelete = null
            toast(e.message, 'error')
            await fetchData({ silent: true })
        } else {
            showFormError(e, els.deleteDialogError, 'Could not delete the transaction. Check the server logs.')
        }
    } finally {
        els.deleteConfirmButton.disabled = false
    }
}

function syncControls() {
    els.primaryBudgetButton.disabled = !state.data
}

function openBudgetDialog(currencyCode) {
    if (!state.data) return
    const currency = (state.data.currencies || []).find((entry) => entry.code === currencyCode)
    state.editingBudgetCurrency = currencyCode
    els.monthlyBudgetInput.value = currency ? number(currency.monthlyBudget) : 0
    els.firstDayBiasInput.value = currency ? number(currency.firstDayBias) : 0
    els.budgetCurrencyNote.textContent = `Editing the ${currencyCode} budget.`
    updateBudgetFormValidity()
    els.budgetDialog.show()
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
    if (!Number.isFinite(monthlyBudget) || monthlyBudget < 0) {
        error = 'Monthly budget must be 0 or greater.'
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
        await requestJson('/budget', {
            method: 'POST',
            body: JSON.stringify({ monthlyBudget, firstDayBias, currency: state.editingBudgetCurrency }),
        })
        els.budgetDialog.hide()
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

els.primaryBudgetButton.addEventListener('click', () => {
    const primary = primaryCurrency()
    if (primary) {
        openBudgetDialog(primary.code)
    }
})
els.budgetCancelButton.addEventListener('click', () => els.budgetDialog.hide())
els.budgetForm.addEventListener('submit', submitBudget)
els.budgetForm.addEventListener('sl-input', updateBudgetFormValidity)

els.addTransactionButton.addEventListener('click', openAddTransactionDialog)
els.importButton.addEventListener('click', openImportDialog)
els.importForm.addEventListener('submit', submitImport)
els.importTextarea.addEventListener('sl-input', () => {
    if (importPastConfirmed) {
        resetImportConfirmation()
    }
})
els.importCancelButton.addEventListener('click', () => els.importDialog.hide())
els.transactionForm.addEventListener('submit', submitTransaction)
els.transactionCancelButton.addEventListener('click', () => els.transactionDialog.hide())

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
els.transactionDialog.addEventListener('sl-after-hide', hideDetailsSuggestions)

els.deleteConfirmButton.addEventListener('click', confirmDeleteTransaction)
els.deleteCancelButton.addEventListener('click', () => {
    state.pendingDelete = null
    els.deleteDialog.hide()
})

document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && Date.now() - state.lastFetchAt > REFRESH_STALE_MS) {
        fetchData({ silent: true })
    }
})

initTheme(els.themeButton)
syncControls()
fetchData()
