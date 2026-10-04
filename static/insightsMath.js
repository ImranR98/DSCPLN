'use strict'

// Pure date/aggregation math for the insights page. Loaded as a plain script
// (window.DSCPLNInsights) and exported for Node tests.
;(function (global) {
    const DAY_MS = 24 * 60 * 60 * 1000

    function parseIsoDate(value) {
        const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value == null ? '' : value))
        if (!match) {
            return null
        }
        const year = Number(match[1])
        const month = Number(match[2])
        const day = Number(match[3])
        const date = new Date(year, month - 1, day)
        if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
            return null
        }
        return date
    }

    function toIsoDate(date) {
        const pad = (value) => String(value).padStart(2, '0')
        return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
    }

    function addDays(date, days) {
        return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days)
    }

    function startOfMonth(date) {
        return new Date(date.getFullYear(), date.getMonth(), 1)
    }

    function endOfMonth(date) {
        return new Date(date.getFullYear(), date.getMonth() + 1, 0)
    }

    function daysInclusive(start, end) {
        return Math.round((end - start) / DAY_MS) + 1
    }

    // Equal-length range immediately before [start, end].
    function previousRange(start, end) {
        const length = daysInclusive(start, end)
        const previousEnd = addDays(start, -1)
        return { start: addDays(previousEnd, -(length - 1)), end: previousEnd }
    }

    function clean(value) {
        return Number.parseFloat(Number(value).toPrecision(12))
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

    function monthlySeries(transactions) {
        const map = new Map()
        for (const transaction of transactions) {
            const month = transaction.date.slice(0, 7)
            let entry = map.get(month)
            if (!entry) {
                entry = { month, spend: 0, income: 0 }
                map.set(month, entry)
            }
            if (transaction.kind === 'income') {
                entry.income += amountOf(transaction)
            } else {
                entry.spend += amountOf(transaction)
            }
        }
        return [...map.values()]
            .sort((a, b) => (a.month < b.month ? -1 : 1))
            .map((entry) => ({ ...entry, spend: clean(entry.spend), income: clean(entry.income) }))
    }

    // Same formula as the dashboard: first-day bias plus accrual to the day.
    function monthExpectedSpend(monthlyBudget, firstDayBias, day, daysInMonth) {
        if (monthlyBudget <= 0) {
            return 0
        }
        const bias = Math.min(Math.max(firstDayBias, 0), monthlyBudget)
        const expected = bias + (monthlyBudget - bias) * (day / daysInMonth)
        return Math.min(monthlyBudget, Math.max(0, expected))
    }

    function projectMonthEnd({ spend, income, elapsedDays, daysInMonth }) {
        const factor = elapsedDays > 0 ? daysInMonth / elapsedDays : 0
        return { spend: clean(spend * factor), income: clean(income * factor) }
    }

    // Average per complete calendar month over the `months` months before endDate's month.
    function trailingAverage(transactions, endDate, months) {
        let spend = 0
        let income = 0
        let counted = 0
        for (let offset = 1; offset <= months; offset++) {
            const monthStart = new Date(endDate.getFullYear(), endDate.getMonth() - offset, 1)
            const monthEnd = new Date(endDate.getFullYear(), endDate.getMonth() - offset + 1, 0)
            const startIso = toIsoDate(monthStart)
            const endIso = toIsoDate(monthEnd)
            for (const transaction of transactions) {
                if (transaction.date < startIso || transaction.date > endIso) {
                    continue
                }
                if (transaction.kind === 'income') {
                    income += amountOf(transaction)
                } else {
                    spend += amountOf(transaction)
                }
            }
            counted += 1
        }
        return counted ? { spend: clean(spend / counted), income: clean(income / counted) } : { spend: 0, income: 0 }
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
        amountOf,
        filterTransactions,
        totals,
        aggregateByCategory,
        categoryTotalsMap,
        delta,
        dailySeries,
        monthlySeries,
        monthExpectedSpend,
        projectMonthEnd,
        trailingAverage,
        categoryMovers,
    }
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api
    }
    global.DSCPLNInsights = api
})(typeof window !== 'undefined' ? window : globalThis)
