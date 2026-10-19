'use strict'

import test from 'node:test'
import assert from 'node:assert/strict'
import { estimateTotals, buildVariableBaseline, backtestBaseline } from '../ui/src/lib/forecast-baseline.js'

const categories = [
    { group: 'Main Expenses', categories: ['Rent', 'Food Weekly'] },
    { group: 'Money In', categories: ['Job'] },
]

const tx = (date, kind, amount, category, details = category) => ({
    date,
    kind,
    expenses: kind === 'expense' ? amount : null,
    moneyIn: kind === 'income' ? amount : null,
    currency: 'CAD',
    category,
    details,
})

const monthlyDate = (year, month, day = 5) =>
    `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`

test('simple, robust, zero-inflated and outlier estimates', () => {
    const simple = estimateTotals([100, 200, 300], { method: 'simple' })
    assert.equal(simple.estimate, 200)
    assert.equal(simple.method, 'Simple average')

    const intermittent = estimateTotals([0, 0, 100, 0, 200, 0], { method: 'robust' })
    assert.match(intermittent.method, /^Zero-inflated/)
    assert.ok(intermittent.estimate > 0)

    const outlier = estimateTotals([100, 100, 100, 1000, 100, 100], { method: 'robust' })
    assert.ok(outlier.estimate < 200)
    assert.deepEqual(outlier.outliers, [3])

    const sparse = estimateTotals([0, 0, 0, 80, 0, 0], { method: 'robust' })
    assert.match(sparse.method, /sparse/i)
    assert.equal(sparse.confidence, 'low')
    assert.ok(sparse.estimate < 80)
})

test('builds variable rows, adds recurring equivalents and applies overrides', () => {
    const transactions = []
    for (let month = 4; month <= 9; month += 1) {
        transactions.push(tx(monthlyDate(2026, month, 1), 'expense', 1200, 'Rent', 'Rent'))
        transactions.push(tx(monthlyDate(2026, month, 6), 'expense', 100 + month, 'Food Weekly', 'Groceries'))
        transactions.push(tx(monthlyDate(2026, month, 3), 'income', 2600, 'Job', 'Job'))
    }
    const scenario = {
        currency: 'CAD',
        asOf: '2026-09-15',
        baselineMonths: 3,
        excludedCategories: [],
        overrides: { income: {}, expense: { Rent: 1500 } },
    }
    const recurringItems = [{
        key: 'expense|Rent|rent',
        kind: 'expense',
        category: 'Rent',
        amount: 1200,
        cadence: 'monthly',
        include: true,
        monthlyEquivalent: 1200,
        confidence: 0.9,
    }]
    const baseline = buildVariableBaseline({
        transactions,
        scenario,
        categories,
        recurringItems,
        method: 'robust',
    })
    const rent = baseline.rows.find((row) => row.category === 'Rent')
    assert.equal(rent.variableAuto, 0)
    assert.equal(rent.recurringMonthly, 1200)
    assert.equal(rent.override, 1500)
    assert.equal(rent.effective, 1500)
    assert.equal(rent.recurringSuppressed, true)
    assert.equal(rent.method, 'Recurring')

    const food = baseline.rows.find((row) => row.category === 'Food Weekly')
    assert.ok(food.variableAuto > 0)
    assert.equal(food.recurringMonthly, 0)

    const job = baseline.rows.find((row) => row.category === 'Job')
    assert.ok(job.variableAuto > 0)
    assert.equal(baseline.actualMonthly.length, 3)
    // Three complete months: Jun, Jul, Aug.
    assert.equal(baseline.actualMonthly[0].income, 2600)
    assert.equal(baseline.actualMonthly[0].expenses, 1200 + 106)
})

test('backtests simple and robust variable layers', () => {
    const transactions = []
    for (let month = 1; month <= 12; month += 1) {
        transactions.push(tx(monthlyDate(2025, month, 5), 'expense', 100 + (month % 3) * 20, 'Food Weekly', 'Groceries'))
        transactions.push(tx(monthlyDate(2025, month, 3), 'income', 2500, 'Job', 'Job'))
    }
    const scenario = {
        currency: 'CAD',
        asOf: '2026-01-15',
        baselineMonths: 4,
        excludedCategories: [],
        overrides: { income: {}, expense: {} },
    }
    const result = backtestBaseline({
        transactions,
        scenario,
        firstMonth: '2025-01-01',
        recurringItems: [],
    })
    assert.ok(result)
    assert.ok(result.months >= 3)
    assert.ok(['simple', 'robust'].includes(result.chosen))
    assert.equal(result.residuals.income.length, result.months)
    assert.equal(result.residuals.expenses.length, result.months)
})
