'use strict'

// Pure aggregation and comparison math for the insights page. Attached to
// `DSCPLN.math` in the browser and exported for Node tests (core supplies the
// date helpers).
;(function (global) {
    const core = global.DSCPLN || require('./core')
    const { clean } = core
    const {
        parseIso: parseIsoDate,
        iso: toIsoDate,
        addDays,
        startOfMonth,
        endOfMonth,
        daysBetween: daysInclusive,
    } = core.dates

    function isWholeMonthsRange(start, end) {
        return toIsoDate(start) === toIsoDate(startOfMonth(start)) &&
            toIsoDate(end) === toIsoDate(endOfMonth(end))
    }

    // Range compared against for the previous period. Whole calendar months
    // snap to the same number of whole months before (September -> August);
    // partial months keep their anchor (the 1st, the month end, or the same
    // day-of-month) and their length, so the totals stay comparable (e.g.
    // Oct 1 - Oct 5 -> Sep 1 - Sep 5).
    function previousRange(start, end) {
        const months = (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth()) + 1
        if (isWholeMonthsRange(start, end)) {
            return { start: shiftMonths(start, -months), end: shiftMonths(end, -months) }
        }
        const length = daysInclusive(start, end)
        if (start.getDate() === 1) {
            const previousStart = shiftMonths(start, -months)
            return { start: previousStart, end: addDays(previousStart, length - 1) }
        }
        const previousEnd = shiftMonths(end, -months)
        return { start: addDays(previousEnd, -(length - 1)), end: previousEnd }
    }

    function amountOf(transaction) {
        const value = transaction.kind === 'income' ? transaction.moneyIn : transaction.expenses
        const amount = Number(value)
        return Number.isFinite(amount) ? amount : 0
    }

    function filterTransactions(transactions, options = {}) {
        const { start, end, currency, excludedCategories } = options
        const startIso = start ? toIsoDate(start) : null
        const endIso = end ? toIsoDate(end) : null
        return transactions.filter((transaction) => {
            if (currency && transaction.currency !== currency) {
                return false
            }
            if (startIso && transaction.date < startIso) {
                return false
            }
            if (endIso && transaction.date > endIso) {
                return false
            }
            if (excludedCategories && excludedCategories.has(transaction.category)) {
                return false
            }
            return true
        })
    }

    function totals(transactions) {
        let spend = 0
        let income = 0
        for (const transaction of transactions) {
            if (transaction.kind === 'income') {
                income += amountOf(transaction)
            } else {
                spend += amountOf(transaction)
            }
        }
        return { spend: clean(spend), income: clean(income), net: clean(income - spend), count: transactions.length }
    }

    function aggregateByCategory(transactions, kind) {
        const map = new Map()
        for (const transaction of transactions) {
            if (transaction.kind !== kind) {
                continue
            }
            const category = transaction.category || 'Uncategorized'
            map.set(category, (map.get(category) || 0) + amountOf(transaction))
        }
        return [...map.entries()]
            .map(([category, amount]) => ({ category, amount: clean(amount) }))
            .sort((a, b) => b.amount - a.amount)
    }

    function categoryTotalsMap(transactions, kind) {
        const result = {}
        for (const entry of aggregateByCategory(transactions, kind)) {
            result[entry.category] = entry.amount
        }
        return result
    }

    function delta(current, previous) {
        return {
            amount: clean(current - previous),
            pct: previous > 0 ? clean(((current - previous) / previous) * 100) : null,
        }
    }

    function dailySeries(transactions, start, end) {
        const days = []
        for (let date = new Date(start); date <= end; date = addDays(date, 1)) {
            days.push({ date: toIsoDate(date), spend: 0, income: 0 })
        }
        const index = new Map(days.map((day, position) => [day.date, position]))
        for (const transaction of transactions) {
            const position = index.get(transaction.date)
            if (position == null) {
                continue
            }
            if (transaction.kind === 'income') {
                days[position].income += amountOf(transaction)
            } else {
                days[position].spend += amountOf(transaction)
            }
        }
        for (const day of days) {
            day.spend = clean(day.spend)
            day.income = clean(day.income)
        }
        return days
    }

    // Projects the month total by scaling the amount so far to the full month.
    function projectMonthEnd({ spend, income, elapsedDays, daysInMonth }) {
        const factor = elapsedDays > 0 ? daysInMonth / elapsedDays : 0
        return { spend: clean(spend * factor), income: clean(income * factor) }
    }

    // The last `count` complete calendar months ending with the month before date.
    function lastCompleteMonths(count, date) {
        const end = new Date(date.getFullYear(), date.getMonth(), 0)
        const start = new Date(end.getFullYear(), end.getMonth() - (count - 1), 1)
        return { start, end }
    }

    // Shifts by whole months, preserving the day-of-month (clamped to the
    // target month's length, and mapping a month-end date to the target
    // month-end, so Sep 30 -> Aug 31).
    function shiftMonths(date, months) {
        const target = new Date(date.getFullYear(), date.getMonth() + months, 1)
        const lastDay = endOfMonth(target).getDate()
        const day = date.getDate() === endOfMonth(date).getDate() ?
            lastDay :
            Math.min(date.getDate(), lastDay)
        return new Date(target.getFullYear(), target.getMonth(), day)
    }

    function shiftYear(date) {
        const year = date.getFullYear() - 1
        const month = date.getMonth()
        const day = Math.min(date.getDate(), new Date(year, month + 1, 0).getDate())
        return new Date(year, month, day)
    }

    function spansMultipleMonths(start, end) {
        return start.getFullYear() !== end.getFullYear() || start.getMonth() !== end.getMonth()
    }

    // Months touched by [start, end], flagging months only partially covered.
    function monthPartials(start, end) {
        const months = []
        const cursor = startOfMonth(start)
        const last = startOfMonth(end)
        while (cursor <= last) {
            const monthStart = new Date(cursor)
            const monthEnd = endOfMonth(cursor)
            months.push({
                year: cursor.getFullYear(),
                month: cursor.getMonth() + 1,
                partial: start > monthStart || end < monthEnd,
            })
            cursor.setMonth(cursor.getMonth() + 1)
        }
        return months
    }

    // A multi-month range starting on Jan 1 (Year to date) compares against
    // the same window a year earlier.
    const isYtdRange = (start, end) => start.getMonth() === 0 && start.getDate() === 1 &&
        end.getFullYear() === start.getFullYear() && end.getMonth() > 0

    // Window compared against for a mode: 'prev', 'yoy', 'avg3', 'avg6', 'avg12'.
    function comparisonWindow(mode, range) {
        if (mode === 'yoy') {
            return { kind: 'range', mode, start: shiftYear(range.start), end: shiftYear(range.end) }
        }
        if (mode === 'avg3' || mode === 'avg6' || mode === 'avg12') {
            const count = Number(mode.slice(3))
            return { kind: 'average', mode, count, ...lastCompleteMonths(count, range.start) }
        }
        if (isYtdRange(range.start, range.end)) {
            return { kind: 'range', mode: 'prev', start: shiftYear(range.start), end: shiftYear(range.end) }
        }
        return { kind: 'range', mode: 'prev', ...previousRange(range.start, range.end) }
    }

    // Average-mode windows scale to the range length so per-day rates are
    // compared fairly; range-mode windows are compared as raw totals.
    function comparisonFactor(window, range) {
        if (window.kind !== 'average') {
            return 1
        }
        const rangeDays = daysInclusive(range.start, range.end)
        const windowDays = daysInclusive(window.start, window.end)
        return windowDays > 0 ? rangeDays / windowDays : 0
    }

    function categoryMovers(currentMap, previousMap, limit = 3) {
        const categories = new Set([...Object.keys(currentMap), ...Object.keys(previousMap)])
        const movers = []
        for (const category of categories) {
            const current = currentMap[category] || 0
            const previous = previousMap[category] || 0
            movers.push({ category, current, previous, delta: delta(current, previous) })
        }
        return {
            increases: movers.filter((entry) => entry.delta.amount > 0)
                .sort((a, b) => b.delta.amount - a.delta.amount)
                .slice(0, limit),
            decreases: movers.filter((entry) => entry.delta.amount < 0)
                .sort((a, b) => a.delta.amount - b.delta.amount)
                .slice(0, limit),
        }
    }

    const api = {
        parseIsoDate,
        toIsoDate,
        addDays,
        startOfMonth,
        endOfMonth,
        daysInclusive,
        previousRange,
        clean,
        filterTransactions,
        totals,
        aggregateByCategory,
        categoryTotalsMap,
        delta,
        dailySeries,
        projectMonthEnd,
        categoryMovers,
        lastCompleteMonths,
        shiftMonths,
        shiftYear,
        spansMultipleMonths,
        monthPartials,
        comparisonWindow,
        comparisonFactor,
        isWholeMonthsRange,
    }
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api
    }
    global.DSCPLN = Object.assign(global.DSCPLN || {}, { math: api })
})(typeof window !== 'undefined' ? window : globalThis)
