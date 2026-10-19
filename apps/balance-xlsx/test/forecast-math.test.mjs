'use strict'

import test from 'node:test'
import assert from 'node:assert/strict'
import { buildForecast } from '../ui/src/lib/forecast-math.js'
import { buildVariableBaseline } from '../ui/src/lib/forecast-baseline.js'

const categories = [
    { group: 'Main Expenses', categories: ['Rent', 'Food Weekly'] },
    { group: 'Extra Expenses', categories: ['Snacks'] },
    { group: 'Money In', categories: ['Job'] },
    { group: 'Conversions', categories: ['Conversion'] },
]

const tx = (date, kind, amount, category, extra = {}) => ({
    date,
    kind,
    expenses: kind === 'expense' ? amount : null,
    moneyIn: kind === 'income' ? amount : null,
    currency: 'CAD',
    category,
    details: category,
    ...extra,
})

const scenario = (overrides = {}) => ({
    name: 'Base plan',
    currency: 'CAD',
    asOf: '2026-09-15',
    horizonMonths: 24,
    baselineMonths: 6,
    baselineMethod: 'simple',
    recurringDetection: false,
    uncertainty: false,
    accounts: [{ name: 'Main', balance: 0, include: true }],
    events: [],
    overrides: { income: {}, expense: {} },
    excludedCategories: [],
    recurringAdjustments: [],
    changes: [],
    target: { label: 'Savings target', amount: null, date: null },
    ...overrides,
})

const monthlyTransactions = ({ income = 0, expenses = 0, months = 3, asOf = '2026-09-15' } = {}) => {
    const end = new Date(`${asOf}T12:00:00`)
    const values = []
    for (let index = months; index >= 1; index -= 1) {
        const date = new Date(end.getFullYear(), end.getMonth() - index, 5)
        const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
        if (income) values.push(tx(iso, 'income', income, 'Job'))
        if (expenses) values.push(tx(iso, 'expense', expenses, 'Rent'))
    }
    return values
}

test('baseline uses complete months before the as-of month', () => {
    const transactions = [
        tx('2026-06-05', 'expense', 100, 'Rent'),
        tx('2026-07-05', 'expense', 200, 'Rent'),
        tx('2026-08-05', 'expense', 300, 'Rent'),
        tx('2026-09-05', 'expense', 999, 'Rent'),
        tx('2026-07-03', 'income', 1000, 'Job'),
        tx('2026-08-03', 'income', 1200, 'Job'),
        tx('2026-07-20', 'expense', 10, 'Snacks'),
    ]
    const baseline = buildVariableBaseline({
        scenario: scenario({ baselineMonths: 3 }),
        transactions,
        categories,
        method: 'simple',
    })
    assert.equal(baseline.monthCount, 3)
    assert.deepEqual(baseline.months.map((month) => `${month.year}-${month.month}`), [
        '2026-6', '2026-7', '2026-8',
    ])
    // Rent averages 100/200/300 over three months; September is excluded.
    const rent = baseline.rows.find((row) => row.kind === 'expense' && row.category === 'Rent')
    assert.equal(rent.auto, 200)
    assert.equal(rent.effective, 200)
    // Income only appears in two months; the zero month still counts.
    const job = baseline.rows.find((row) => row.kind === 'income' && row.category === 'Job')
    assert.ok(Math.abs(job.auto - 2200 / 3) < 1e-9)
    assert.ok(Math.abs(baseline.income - 2200 / 3) < 1e-9)
    assert.ok(Math.abs(baseline.expenses - (200 + 10 / 3)) < 1e-9)
    assert.deepEqual(baseline.actualMonthly.map((month) => month.income), [0, 1000, 1200])
})

test('overrides and exclusions replace the baseline', () => {
    const transactions = [
        tx('2026-06-05', 'expense', 100, 'Rent'),
        tx('2026-07-05', 'expense', 100, 'Rent'),
        tx('2026-08-05', 'expense', 100, 'Rent'),
        tx('2026-08-03', 'income', 1000, 'Job'),
    ]
    const baseline = buildVariableBaseline({
        scenario: scenario({
            baselineMonths: 3,
            overrides: { expense: { Rent: 1400 }, income: { Job: 5000 } },
            excludedCategories: ['Snacks'],
        }),
        transactions,
        categories,
        method: 'simple',
    })
    const rent = baseline.rows.find((row) => row.kind === 'expense' && row.category === 'Rent')
    assert.equal(rent.auto, 100)
    assert.equal(rent.override, 1400)
    assert.equal(rent.effective, 1400)
    const job = baseline.rows.find((row) => row.kind === 'income' && row.category === 'Job')
    assert.equal(job.effective, 5000)
    const snacks = baseline.rows.find((row) => row.kind === 'expense' && row.category === 'Snacks')
    assert.equal(snacks.include, false)
    assert.equal(snacks.effective, 0)
    assert.equal(baseline.income, 5000)
    assert.equal(baseline.expenses, 1400)
    assert.equal(baseline.net, 3600)
})

test('projection prorates the as-of month and applies events by date', () => {
    const transactions = monthlyTransactions({ income: 300, expenses: 150 })
    const forecast = buildForecast({
        scenario: scenario({
            asOf: '2026-09-16',
            horizonMonths: 2,
            baselineMonths: 3,
            accounts: [{ name: 'Main', balance: 1000, include: true }],
            events: [{ date: '2026-09-20', details: 'Trip', kind: 'expense', amount: 100, notes: '' }],
            target: { label: 'Target', amount: 1300, date: null },
        }),
        transactions,
        categories,
        paths: 0,
    })
    assert.equal(forecast.startingBalance, 1000)
    assert.equal(forecast.months.length, 2)
    // Sep 16-30 is 15 of 30 days, so half the monthly baseline applies.
    assert.equal(forecast.months[0].income, 150)
    assert.equal(forecast.months[0].expenses, 75)
    assert.equal(forecast.months[0].oneTime, -100)
    assert.equal(forecast.months[0].closing, 975)
    // October is a full month.
    assert.equal(forecast.months[1].income, 300)
    assert.equal(forecast.months[1].expenses, 150)
    assert.ok(Math.abs(forecast.months[1].closing - 1125) < 1e-6)
    assert.ok(Math.abs(forecast.horizonClosing - 1125) < 1e-6)
    assert.equal(forecast.months[0].partial, true)
    assert.equal(forecast.months[1].partial, false)
})

test('finds the target date and reports runway', () => {
    const transactions = monthlyTransactions({ income: 300, expenses: 200 })
    const forecast = buildForecast({
        scenario: scenario({
            asOf: '2026-09-30',
            horizonMonths: 6,
            baselineMonths: 3,
            accounts: [{ name: 'Main', balance: 1000, include: true }],
            target: { label: 'Target', amount: 1300, date: null },
        }),
        transactions,
        categories,
        paths: 0,
    })
    // Sep 30 applies one day of net, then full months on the 1st.
    assert.equal(forecast.target.reached, true)
    assert.equal(forecast.target.date, '2026-12-30')
    assert.equal(forecast.target.withinHorizon, true)
    assert.equal(forecast.runway.depleted, false)
})

test('reports already-met targets and no target', () => {
    const already = buildForecast({
        scenario: scenario({
            accounts: [{ name: 'Main', balance: 5000, include: true }],
            target: { amount: 1000, date: null },
        }),
        transactions: [],
        categories,
        paths: 0,
    })
    assert.equal(already.target.reached, true)
    assert.equal(already.target.already, true)
    assert.equal(already.target.date, '2026-09-15')
    const none = buildForecast({
        scenario: scenario({
            accounts: [{ name: 'Main', balance: 5000, include: true }],
            target: { amount: null, date: null },
        }),
        transactions: [],
        categories,
        paths: 0,
    })
    assert.equal(none.target.hasTarget, false)
    assert.equal(none.target.reached, false)
})

test('ignores events before the as-of date and warns', () => {
    const forecast = buildForecast({
        scenario: scenario({
            asOf: '2026-09-15',
            horizonMonths: 2,
            accounts: [{ name: 'Main', balance: 1000, include: true }],
            events: [
                { date: '2026-09-01', details: 'Past', kind: 'expense', amount: 100, notes: '' },
                { date: '2026-10-01', details: 'Future', kind: 'income', amount: 50, notes: '' },
            ],
        }),
        transactions: [],
        categories,
        paths: 0,
    })
    assert.equal(forecast.months[1].oneTime, 50)
    assert.ok(forecast.warnings.some((warning) => warning.includes('before the as-of date')))
})

test('category overrides and scheduled changes replace recurring items', () => {
    const iso = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
    const transactions = Array.from({ length: 12 }, (_, index) => {
        const date = iso(new Date(2025, 9 + index, 1))
        return {
            date,
            kind: 'expense',
            expenses: 1000,
            moneyIn: null,
            currency: 'CAD',
            category: 'Rent',
            details: 'Rent',
        }
    })
    const categories = [{ group: 'Main Expenses', categories: ['Rent'] }]
    const base = scenario({
        name: 'Base',
        asOf: '2026-09-15',
        horizonMonths: 7,
        baselineMonths: 6,
        baselineMethod: 'simple',
        recurringDetection: true,
        uncertainty: false,
        accounts: [{ name: 'Main', balance: 0, include: true }],
        events: [],
        target: { label: 'Savings', amount: null, date: null },
        excludedCategories: [],
        recurringAdjustments: [],
        changes: [],
        overrides: { income: {}, expense: {} },
    })
    const overridden = buildForecast({
        scenario: { ...base, overrides: { income: {}, expense: { Rent: 1500 } } },
        transactions,
        categories,
        firstMonth: '2025-10-01',
        paths: 0,
    })
    const october = overridden.months[1]
    assert.equal(october.fixedExpenses, 1500)
    assert.equal(october.recurringExpenses, 0)

    const changed = buildForecast({
        scenario: { ...base, changes: [{ from: '2027-01', kind: 'expense', category: 'Rent', amount: 1600 }] },
        transactions,
        categories,
        firstMonth: '2025-10-01',
        paths: 0,
    })
    assert.equal(changed.months[1].recurringExpenses, 1000)
    assert.equal(changed.months[1].fixedExpenses, 0)
    const january = changed.months.find((month) => month.year === 2027 && month.month === 1)
    assert.equal(january.fixedExpenses, 1600)
    assert.equal(january.recurringExpenses, 0)
})

test('treats a zero starting balance as unknown and reports the projected low', () => {
    const forecast = buildForecast({
        scenario: scenario({
            asOf: '2026-09-15',
            horizonMonths: 3,
            baselineMonths: 3,
            accounts: [{ name: 'Main account', balance: 0, include: true }],
            events: [{ date: '2026-09-20', details: 'Fee', kind: 'expense', amount: 100, notes: '' }],
            target: { label: 'Savings', amount: null, date: null },
        }),
        transactions: [],
        categories: [],
        firstMonth: null,
        paths: 0,
    })
    assert.equal(forecast.balanceUnknown, true)
    assert.equal(forecast.runway.unknown, true)
    assert.equal(forecast.lowestBalance, -100)
    assert.equal(forecast.lowestBalanceDate, '2026-09-20')
    assert.ok(forecast.warnings.some((warning) => warning.includes('treated as unknown')))
})

test('reports a cash-out date when expenses exceed income', () => {
    const transactions = monthlyTransactions({ expenses: 100 })
    const forecast = buildForecast({
        scenario: scenario({
            asOf: '2026-09-30',
            horizonMonths: 6,
            baselineMonths: 3,
            accounts: [{ name: 'Main', balance: 50, include: true }],
            target: { amount: null, date: null },
        }),
        transactions,
        categories,
        paths: 0,
    })
    assert.equal(forecast.runway.depleted, true)
    assert.equal(forecast.runway.date, '2026-10-15')
    assert.equal(forecast.runway.withinHorizon, true)
})

test('unchecking a recurring item removes it from the forecast', () => {
    const transactions = Array.from({ length: 6 }, (_, index) => {
        const date = new Date(2026, 3 + index, 5)
        return tx(
            `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-05`,
            'expense',
            70,
            'Food Weekly',
            { details: 'Groceries' },
        )
    })
    const base = scenario({
        asOf: '2026-09-15',
        horizonMonths: 2,
        baselineMonths: 3,
        baselineMethod: 'simple',
        recurringDetection: true,
        uncertainty: false,
        categories,
        accounts: [{ name: 'Main', balance: 1000, include: true }],
        target: { amount: null, date: null },
    })
    const included = buildForecast({ scenario: base, transactions, categories, paths: 0 })
    const item = included.recurring.items.find((entry) => entry.category === 'Food Weekly')
    assert.ok(item)
    const excluded = buildForecast({
        scenario: {
            ...base,
            recurringAdjustments: [{
                kind: item.kind,
                category: item.category,
                details: item.detailsKey,
                include: false,
            }],
        },
        transactions,
        categories,
        paths: 0,
    })
    assert.equal(excluded.months[0].recurringExpenses, 0)
    assert.equal(excluded.baseline.expenses, 0)
})
