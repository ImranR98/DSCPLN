'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const math = require('../static/insightsMath')

const tx = (date, kind, amount, extra = {}) => ({
    date,
    kind,
    expenses: kind === 'expense' ? amount : null,
    moneyIn: kind === 'income' ? amount : null,
    category: extra.category || (kind === 'income' ? 'Job' : 'Rent'),
    currency: extra.currency || 'CAD',
    details: extra.details || '',
})

test('parses and formats ISO dates', () => {
    assert.equal(math.toIsoDate(math.parseIsoDate('2026-02-28')), '2026-02-28')
    assert.equal(math.parseIsoDate('2026-02-30'), null)
    assert.equal(math.parseIsoDate('nope'), null)
    assert.equal(math.toIsoDate(math.addDays(new Date(2026, 0, 31), 1)), '2026-02-01')
    assert.equal(math.toIsoDate(math.endOfMonth(new Date(2026, 1, 10))), '2026-02-28')
    assert.equal(math.daysInclusive(new Date(2026, 8, 1), new Date(2026, 8, 30)), 30)
})

test('computes the preceding range, snapping whole months', () => {
    // Whole months snap to whole months even when lengths differ.
    const month = math.previousRange(new Date(2026, 8, 1), new Date(2026, 8, 30))
    assert.equal(math.toIsoDate(month.start), '2026-08-01')
    assert.equal(math.toIsoDate(month.end), '2026-08-31')
    const quarter = math.previousRange(new Date(2026, 6, 1), new Date(2026, 8, 30))
    assert.equal(math.toIsoDate(quarter.start), '2026-04-01')
    assert.equal(math.toIsoDate(quarter.end), '2026-06-30')
    // Partial ranges stay equal-length.
    const partial = math.previousRange(new Date(2026, 8, 15), new Date(2026, 9, 4))
    assert.equal(math.toIsoDate(partial.start), '2026-08-26')
    assert.equal(math.toIsoDate(partial.end), '2026-09-14')
    const single = math.previousRange(new Date(2026, 9, 4), new Date(2026, 9, 4))
    assert.equal(math.toIsoDate(single.start), '2026-10-03')
    assert.equal(math.toIsoDate(single.end), '2026-10-03')
})

test('filters by range, currency and excluded categories', () => {
    const transactions = [
        tx('2026-08-31', 'expense', 10),
        tx('2026-09-01', 'expense', 20, { category: 'Rent' }),
        tx('2026-09-02', 'expense', 5, { category: 'Snacks', currency: 'USD' }),
        tx('2026-09-30', 'income', 100),
        tx('2026-10-01', 'expense', 7),
    ]
    const inRange = math.filterTransactions(transactions, {
        start: new Date(2026, 8, 1),
        end: new Date(2026, 8, 30),
    })
    assert.deepEqual(inRange.map((entry) => entry.date), ['2026-09-01', '2026-09-02', '2026-09-30'])
    const cad = math.filterTransactions(transactions, {
        start: new Date(2026, 8, 1),
        end: new Date(2026, 8, 30),
        currency: 'CAD',
    })
    assert.equal(cad.length, 2)
    const excluding = math.filterTransactions(transactions, {
        excludedCategories: new Set(['Rent']),
    })
    assert.equal(excluding.some((entry) => entry.category === 'Rent'), false)
})

test('totals, net and per-category aggregation', () => {
    const transactions = [
        tx('2026-09-01', 'expense', 20, { category: 'Rent' }),
        tx('2026-09-02', 'expense', 5.5, { category: 'Snacks' }),
        tx('2026-09-03', 'expense', 4.5, { category: 'Snacks' }),
        tx('2026-09-04', 'income', 100),
    ]
    const total = math.totals(transactions)
    assert.deepEqual(total, { spend: 30, income: 100, net: 70, count: 4 })
    assert.deepEqual(math.aggregateByCategory(transactions, 'expense'), [
        { category: 'Rent', amount: 20 },
        { category: 'Snacks', amount: 10 },
    ])
    assert.deepEqual(math.categoryTotalsMap(transactions, 'expense'), { Rent: 20, Snacks: 10 })
})

test('computes deltas with null percent when there is no previous amount', () => {
    assert.deepEqual(math.delta(150, 100), { amount: 50, pct: 50 })
    assert.deepEqual(math.delta(50, 100), { amount: -50, pct: -50 })
    assert.deepEqual(math.delta(10, 0), { amount: 10, pct: null })
})

test('builds daily and monthly series', () => {
    const transactions = [
        tx('2026-09-01', 'expense', 10, { category: 'Rent' }),
        tx('2026-09-03', 'income', 100),
        tx('2026-09-03', 'expense', 2.5, { category: 'Snacks' }),
        tx('2026-10-02', 'expense', 4, { category: 'Rent' }),
    ]
    const daily = math.dailySeries(transactions, new Date(2026, 8, 1), new Date(2026, 8, 4))
    assert.equal(daily.length, 4)
    assert.deepEqual(daily[0], { date: '2026-09-01', spend: 10, income: 0 })
    assert.deepEqual(daily[2], { date: '2026-09-03', spend: 2.5, income: 100 })
    assert.deepEqual(daily[1], { date: '2026-09-02', spend: 0, income: 0 })
    assert.deepEqual(math.monthlySeries(transactions), [
        { month: '2026-09', spend: 12.5, income: 100 },
        { month: '2026-10', spend: 4, income: 0 },
    ])
})

test('projects month-end spending and averages', () => {
    assert.deepEqual(math.projectMonthEnd({ spend: 300, income: 1000, elapsedDays: 10, daysInMonth: 30 }), {
        spend: 900,
        income: 3000,
    })
    assert.deepEqual(math.projectMonthEnd({ spend: 300, income: 1000, elapsedDays: 0, daysInMonth: 30 }), {
        spend: 0,
        income: 0,
    })
    const transactions = [
        tx('2026-07-10', 'expense', 100, { category: 'Rent' }),
        tx('2026-07-20', 'income', 1000),
        tx('2026-08-10', 'expense', 200, { category: 'Rent' }),
        tx('2026-08-20', 'income', 1200),
        tx('2026-09-05', 'expense', 999, { category: 'Rent' }),
    ]
    assert.deepEqual(math.trailingAverage(transactions, new Date(2026, 8, 15), 2), {
        spend: 150,
        income: 1100,
    })
})

test('applies the first-day-bias pace formula', () => {
    const expected = math.monthExpectedSpend(3000, 1500, 4, 31)
    assert.equal(Number(expected.toFixed(2)), 1693.55)
    assert.equal(math.monthExpectedSpend(0, 0, 4, 31), 0)
    assert.equal(math.monthExpectedSpend(1000, 5000, 15, 30), 1000)
})

test('builds complete-month presets and comparison windows', () => {
    const preset = math.lastCompleteMonths(3, new Date(2026, 9, 15))
    assert.equal(math.toIsoDate(preset.start), '2026-07-01')
    assert.equal(math.toIsoDate(preset.end), '2026-09-30')

    const prev = math.comparisonWindow('prev', { start: new Date(2026, 8, 1), end: new Date(2026, 8, 30) })
    assert.equal(prev.kind, 'range')
    assert.equal(math.toIsoDate(prev.start), '2026-08-01')
    assert.equal(math.toIsoDate(prev.end), '2026-08-31')

    const yoy = math.comparisonWindow('yoy', { start: new Date(2026, 8, 15), end: new Date(2026, 9, 4) })
    assert.equal(math.toIsoDate(yoy.start), '2025-09-15')
    assert.equal(math.toIsoDate(yoy.end), '2025-10-04')
    assert.equal(math.toIsoDate(math.shiftYear(new Date(2024, 1, 29))), '2023-02-28')

    const range = { start: new Date(2026, 8, 15), end: new Date(2026, 9, 4) }
    const avg = math.comparisonWindow('avg3', range)
    assert.equal(avg.kind, 'average')
    assert.equal(avg.count, 3)
    assert.equal(math.toIsoDate(avg.start), '2026-06-01')
    assert.equal(math.toIsoDate(avg.end), '2026-08-31')
    assert.equal(Number(math.comparisonFactor(avg, range).toFixed(6)), Number((20 / 92).toFixed(6)))
    assert.equal(math.comparisonFactor(prev, range), 1)
})

test('flags partial and multi-month ranges', () => {
    assert.equal(math.spansMultipleMonths(new Date(2026, 8, 15), new Date(2026, 9, 4)), true)
    assert.equal(math.spansMultipleMonths(new Date(2026, 8, 1), new Date(2026, 8, 30)), false)
    assert.deepEqual(math.monthPartials(new Date(2026, 8, 15), new Date(2026, 9, 4)), [
        { year: 2026, month: 9, partial: true },
        { year: 2026, month: 10, partial: true },
    ])
    assert.deepEqual(math.monthPartials(new Date(2026, 8, 1), new Date(2026, 8, 30)), [
        { year: 2026, month: 9, partial: false },
    ])
})

test('finds the biggest category movers', () => {
    const movers = math.categoryMovers(
        { Rent: 1000, Snacks: 40, Transport: 10 },
        { Rent: 800, Snacks: 100, Transport: 10 }
    )
    assert.equal(movers.increases[0].category, 'Rent')
    assert.deepEqual(movers.increases[0].delta, { amount: 200, pct: 25 })
    assert.equal(movers.decreases[0].category, 'Snacks')
    assert.deepEqual(movers.decreases[0].delta, { amount: -60, pct: -60 })
    assert.equal(movers.increases.some((entry) => entry.category === 'Transport'), false)
})
