'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const math = require('../static/insights-math')

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

test('computes the preceding range, calendar-aligned', () => {
    const range = (start, end) => math.previousRange(
        new Date(start[0], start[1] - 1, start[2]),
        new Date(end[0], end[1] - 1, end[2]))
    const iso = (value) => [math.toIsoDate(value.start), math.toIsoDate(value.end)]

    // Whole months snap to the same number of whole months even when lengths differ.
    assert.deepEqual(iso(range([2026, 9, 1], [2026, 9, 30])), ['2026-08-01', '2026-08-31'])
    assert.deepEqual(iso(range([2026, 7, 1], [2026, 9, 30])), ['2026-04-01', '2026-06-30'])
    assert.deepEqual(iso(range([2026, 1, 1], [2026, 2, 28])), ['2025-11-01', '2025-12-31'])

    // Partial months match the same calendar days of the previous month.
    assert.deepEqual(iso(range([2026, 10, 1], [2026, 10, 5])), ['2026-09-01', '2026-09-05'])
    assert.deepEqual(iso(range([2026, 10, 5], [2026, 10, 20])), ['2026-09-05', '2026-09-20'])
    assert.deepEqual(iso(range([2026, 12, 5], [2027, 1, 5])), ['2026-10-05', '2026-11-05'])

    // Month-end ranges keep the previous month-end and the same day count.
    assert.deepEqual(iso(range([2026, 10, 25], [2026, 10, 31])), ['2026-09-24', '2026-09-30'])
    assert.deepEqual(iso(range([2026, 10, 29], [2026, 10, 31])), ['2026-09-28', '2026-09-30'])

    // Single days and short months clamp cleanly.
    assert.deepEqual(iso(range([2026, 10, 5], [2026, 10, 5])), ['2026-09-05', '2026-09-05'])
    assert.deepEqual(iso(range([2026, 1, 31], [2026, 1, 31])), ['2025-12-31', '2025-12-31'])
    assert.deepEqual(iso(range([2026, 3, 31], [2026, 3, 31])), ['2026-02-28', '2026-02-28'])
    assert.deepEqual(iso(range([2026, 3, 29], [2026, 3, 30])), ['2026-02-27', '2026-02-28'])

    // Multi-month partials shift by the months they span.
    assert.deepEqual(iso(range([2026, 9, 1], [2026, 10, 5])), ['2026-07-01', '2026-08-04'])
    assert.deepEqual(iso(range([2026, 9, 15], [2026, 10, 4])), ['2026-07-16', '2026-08-04'])
})

test('caps ranges that extend past today for statistics', () => {
    const today = new Date(2026, 9, 5)
    const capped = math.elapsedRange(new Date(2026, 9, 1), new Date(2026, 9, 31), today)
    assert.equal(math.toIsoDate(capped.start), '2026-10-01')
    assert.equal(math.toIsoDate(capped.end), '2026-10-05')
    // Ranges ending today or earlier are untouched.
    const past = math.elapsedRange(new Date(2026, 8, 1), new Date(2026, 8, 30), today)
    assert.deepEqual([math.toIsoDate(past.start), math.toIsoDate(past.end)], ['2026-09-01', '2026-09-30'])
    const endingToday = math.elapsedRange(new Date(2026, 9, 1), new Date(2026, 9, 5), today)
    assert.equal(math.toIsoDate(endingToday.end), '2026-10-05')
    // Wholly future ranges are untouched.
    const future = math.elapsedRange(new Date(2026, 10, 1), new Date(2026, 10, 30), today)
    assert.deepEqual([math.toIsoDate(future.start), math.toIsoDate(future.end)], ['2026-11-01', '2026-11-30'])
})

test('shiftMonths preserves the day and month-end anchoring', () => {
    assert.equal(math.toIsoDate(math.shiftMonths(new Date(2026, 8, 30), -1)), '2026-08-31')
    assert.equal(math.toIsoDate(math.shiftMonths(new Date(2026, 0, 31), 1)), '2026-02-28')
    assert.equal(math.toIsoDate(math.shiftMonths(new Date(2024, 1, 29), -12)), '2023-02-28')
    assert.equal(math.toIsoDate(math.shiftMonths(new Date(2026, 9, 5), -1)), '2026-09-05')
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

test('builds a daily series', () => {
    const transactions = [
        tx('2026-09-01', 'expense', 10, { category: 'Rent' }),
        tx('2026-09-03', 'income', 100),
        tx('2026-09-03', 'expense', 2.5, { category: 'Snacks' }),
    ]
    const daily = math.dailySeries(transactions, new Date(2026, 8, 1), new Date(2026, 8, 4))
    assert.equal(daily.length, 4)
    assert.deepEqual(daily[0], { date: '2026-09-01', spend: 10, income: 0 })
    assert.deepEqual(daily[1], { date: '2026-09-02', spend: 0, income: 0 })
    assert.deepEqual(daily[2], { date: '2026-09-03', spend: 2.5, income: 100 })
})

test('averages the trailing months into a shaped cumulative baseline', () => {
    const transactions = [
        tx('2026-07-10', 'expense', 100, { category: 'Rent' }),
        tx('2026-08-05', 'expense', 50, { category: 'Rent' }),
        tx('2026-09-20', 'expense', 30, { category: 'Rent' }),
    ]
    const months = math.monthPartials(new Date(2026, 6, 1), new Date(2026, 8, 30))
    assert.equal(months.length, 3)
    const average = math.averageCumulative(transactions, months, 30)
    assert.equal(average.spend.length, 30)
    // Ends at the mean of the months' totals, starting at zero.
    assert.equal(average.spend[0], 0)
    assert.equal(average.spend[29], 60)
    // The increments differ (the spends land on different days), so the curve
    // is not a straight line.
    const increments = average.spend.slice(1).map((value, index) => Number((value - average.spend[index]).toFixed(6)))
    assert.ok(new Set(increments).size > 1)
})

test('averages a zero-data month into the baseline', () => {
    const transactions = [
        tx('2026-07-01', 'expense', 100, { category: 'Rent' }),
        tx('2026-09-30', 'expense', 60, { category: 'Rent' }),
    ]
    const months = math.monthPartials(new Date(2026, 6, 1), new Date(2026, 8, 30))
    const average = math.averageCumulative(transactions, months, 30)
    assert.equal(Number(average.spend[29].toFixed(6)), Number((160 / 3).toFixed(6)))
})

test('resamples a series to a target length', () => {
    assert.deepEqual(math.resampleSeries([0, 10, 20, 30], 4), [0, 10, 20, 30])
    assert.deepEqual(math.resampleSeries([0, 10, 20, 30], 2), [10, 30])
    assert.deepEqual(math.resampleSeries([5], 3), [5, 5, 5])
    assert.deepEqual(math.resampleSeries([], 3), [])
})

test('projects month-end spending', () => {
    assert.deepEqual(math.projectMonthEnd({ spend: 300, income: 1000, elapsedDays: 10, daysInMonth: 30 }), {
        spend: 900,
        income: 3000,
    })
    assert.deepEqual(math.projectMonthEnd({ spend: 300, income: 1000, elapsedDays: 0, daysInMonth: 30 }), {
        spend: 0,
        income: 0,
    })
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

test('compares year-to-date against the same period last year', () => {
    const ytd = math.comparisonWindow('prev', { start: new Date(2026, 0, 1), end: new Date(2026, 9, 5) })
    assert.equal(math.toIsoDate(ytd.start), '2025-01-01')
    assert.equal(math.toIsoDate(ytd.end), '2025-10-05')
    // January month-to-date still compares with the previous month.
    const january = math.comparisonWindow('prev', { start: new Date(2026, 0, 1), end: new Date(2026, 0, 5) })
    assert.equal(math.toIsoDate(january.start), '2025-12-01')
    assert.equal(math.toIsoDate(january.end), '2025-12-05')
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
