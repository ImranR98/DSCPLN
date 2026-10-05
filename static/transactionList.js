'use strict'

// Shared transaction list used by the dashboard (editable) and the insights
// page (read-only). Rows are always rendered newest first.
;(function (global) {
    const { money, currencyColor, setBreakableText } = DSCPLNFormat

    const dayFormat = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' })

    const ICONS = {
        edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
        delete: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M6 6l1 14h10l1-14"/></svg>',
    }

    const parseIsoDate = (value) => {
        const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value || '')
        return match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : null
    }

    const isSameDay = (a, b) =>
        a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()

    const dateLabel = (date, today) => {
        const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1)
        if (isSameDay(date, today)) return 'Today'
        if (isSameDay(date, yesterday)) return 'Yesterday'
        return dayFormat.format(date)
    }

    const buildActions = (transaction, onEdit, onDelete) => {
        const actions = document.createElement('span')
        actions.className = 'expense__actions'

        const editButton = document.createElement('button')
        editButton.type = 'button'
        editButton.className = 'icon-button'
        editButton.title = 'Edit'
        editButton.setAttribute('aria-label', `Edit ${transaction.details || 'transaction'}`)
        editButton.innerHTML = ICONS.edit
        editButton.addEventListener('click', () => onEdit && onEdit(transaction))

        const deleteButton = document.createElement('button')
        deleteButton.type = 'button'
        deleteButton.className = 'icon-button icon-button--danger'
        deleteButton.title = 'Delete'
        deleteButton.setAttribute('aria-label', `Delete ${transaction.details || 'transaction'}`)
        deleteButton.innerHTML = ICONS.delete
        deleteButton.addEventListener('click', () => onDelete && onDelete(transaction))

        actions.append(editButton, deleteButton)
        return actions
    }

    const buildRow = (transaction, options) => {
        const li = document.createElement('li')
        li.className = 'expense'
        if (transaction.kind === 'income') {
            li.classList.add('expense--income')
        }
        const color = currencyColor(transaction.currency)
        if (color) {
            li.style.setProperty('--currency', color)
        }
        const date = parseIsoDate(transaction.date)
        if (date && options.markFuture && options.today && date > options.today) {
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
        if (date && options.today) {
            const dateEl = document.createElement('span')
            dateEl.className = 'expense__date'
            dateEl.textContent = dateLabel(date, options.today)
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
        if (options.writable) {
            li.append(buildActions(transaction, options.onEdit, options.onDelete))
        }
        li.append(amountEl)
        return li
    }

    const sortNewestFirst = (transactions) => [...transactions].sort((a, b) => {
        if (a.date !== b.date) {
            return a.date < b.date ? 1 : -1
        }
        return (b.row || 0) - (a.row || 0)
    })

    // Renders the rows into `listEl` (toggling its hidden state) and returns the
    // transaction count.
    const renderList = (listEl, transactions, options = {}) => {
        const settings = {
            writable: false,
            today: new Date(),
            markFuture: false,
            onEdit: null,
            onDelete: null,
            ...options,
        }
        const sorted = sortNewestFirst(transactions || [])
        listEl.textContent = ''
        listEl.hidden = sorted.length === 0
        for (const transaction of sorted) {
            listEl.appendChild(buildRow(transaction, settings))
        }
        return sorted.length
    }

    const formatCount = (count) => `${count} ${count === 1 ? 'transaction' : 'transactions'}`

    const api = { renderList, formatCount, sortNewestFirst }
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api
    }
    global.DSCPLNTransactions = api
})(typeof window !== 'undefined' ? window : globalThis)
