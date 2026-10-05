'use strict'

// Shared transaction list for the dashboard (editable) and insights (read-only).
// Rows are always rendered newest first.
;(function (global) {
    const { dates, formats, el, currencyColor, icons, setBreakableText } = DSCPLN

    const dateLabel = (date, today) => {
        if (dates.sameDay(date, today)) {
            return 'Today'
        }
        if (dates.sameDay(date, dates.addDays(today, -1))) {
            return 'Yesterday'
        }
        return formats.weekday.format(date)
    }

    const buildActions = (transaction, onEdit, onDelete) => el('span', { class: 'expense__actions' },
        el('button', {
            type: 'button',
            class: 'icon-button',
            title: 'Edit',
            'aria-label': `Edit ${transaction.details || 'transaction'}`,
            innerHTML: icons.edit,
            onclick: () => onEdit && onEdit(transaction),
        }),
        el('button', {
            type: 'button',
            class: 'icon-button icon-button--danger',
            title: 'Delete',
            'aria-label': `Delete ${transaction.details || 'transaction'}`,
            innerHTML: icons.delete,
            onclick: () => onDelete && onDelete(transaction),
        }))

    const buildRow = (transaction, options) => {
        const date = dates.parseIso(transaction.date)
        const isFuture = Boolean(date && options.markFuture && date > options.today)
        const isIncome = transaction.kind === 'income'
        const li = el('li', {
            class: `expense${isIncome ? ' expense--income' : ''}${isFuture ? ' expense--future' : ''}`,
            title: isFuture ? 'Dated in the future' : null,
            style: { '--currency': currencyColor(transaction.currency) },
        },
            el('span', { class: 'expense__main' },
                el('span', { class: 'expense__desc', text: transaction.details || '—' },
                    transaction.notes && el('span', { class: 'expense__notes', text: transaction.notes })),
                el('span', { class: 'expense__meta' },
                    date && options.today && el('span', { class: 'expense__date', text: dateLabel(date, options.today) }),
                    el('span', { class: 'expense__currency', text: transaction.currency || '', hidden: !transaction.currency }),
                    el('span', { class: 'expense__category', text: transaction.category || '' }))),
            options.writable && buildActions(transaction, options.onEdit, options.onDelete))

        if (options.money) {
            const amount = transaction.kind === 'income' ? transaction.moneyIn : transaction.expenses
            const amountEl = el('span', { class: `expense__amount${isIncome ? ' expense__amount--in' : ''}` })
            setBreakableText(amountEl, `${isIncome ? '+' : ''}${options.money(amount || 0, transaction.currency)}`)
            li.append(amountEl)
        }
        return li
    }

    const sortNewestFirst = (transactions) => [...transactions].sort((a, b) =>
        a.date === b.date ? (b.row || 0) - (a.row || 0) : (a.date < b.date ? 1 : -1))

    // Renders rows into `listEl` (toggling its hidden state) and returns the count.
    const renderList = (listEl, transactions, options = {}) => {
        const settings = { writable: false, today: new Date(), markFuture: false, ...options }
        const sorted = sortNewestFirst(transactions || [])
        listEl.textContent = ''
        listEl.hidden = sorted.length === 0
        for (const transaction of sorted) {
            listEl.appendChild(buildRow(transaction, settings))
        }
        return sorted.length
    }

    const formatCount = (count) => `${count} ${count === 1 ? 'transaction' : 'transactions'}`

    global.DSCPLN.transactions = { renderList, formatCount }
})(typeof window !== 'undefined' ? window : globalThis)
