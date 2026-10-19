'use strict'

import test from 'node:test'
import assert from 'node:assert/strict'
import {
    applyRecurringAdjustments,
    detectRecurring,
    monthlyEquivalent,
    normalizeRecurringDetails,
    recurringOccurrences,
} from '../ui/src/lib/forecast-recurring.js'

const tx = (date, kind, amount, category, details, currency = 'CAD') => ({
    date,
    kind,
    expenses: kind === 'expense' ? amount : null,
    moneyIn: kind === 'income' ? amount : null,
    currency,
    category,
    details,
})

const iso = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`

const monthlyDates = (startYear, startMonth, count, day = 1) => Array.from({ length: count }, (_, index) => {
    const date = new Date(startYear, startMonth - 1 + index, day)
    return iso(date)
})

test('normalizes recurring details and strips month/date noise', () => {
    assert.equal(normalizeRecurringDetails('Rent September 2026'), 'rent')
    assert.equal(normalizeRecurringDetails('NETFLIX.COM #12345'), 'netflix com')
    assert.equal(normalizeRecurringDetails('2026-09-01 Groceries'), 'groceries')
})

test('detects monthly rent and exposes its next date', () => {
    const transactions = monthlyDates(2025, 10, 12).map((date) => tx(date, 'expense', 1400, 'Rent', `Rent ${date.slice(0, 7)}`))
    const items = detectRecurring({ transactions, currency: 'CAD', asOf: '2026-09-15' })
    const rent = items.find((item) => item.category === 'Rent')
    assert.ok(rent)
    assert.equal(rent.cadence, 'monthly')
    assert.equal(rent.amount, 1400)
    assert.equal(rent.nextDate, '2026-10-01')
    assert.equal(rent.monthlyEquivalent, 1400)
    assert.ok(rent.confidence > 0.8)
})

test('detects biweekly paycheques and semi-monthly bills', () => {
    const jobDates = Array.from({ length: 12 }, (_, index) => {
        const date = new Date(2026, 5, 19 + index * 14)
        return iso(date)
    })
    const job = detectRecurring({
        transactions: jobDates.map((date) => tx(date, 'income', 2500, 'Job', 'Paycheque')),
        currency: 'CAD',
        asOf: jobDates[jobDates.length - 1],
    }).find((item) => item.category === 'Job')
    assert.ok(job)
    assert.equal(job.cadence, 'biweekly')

    const semiDates = []
    for (let month = 0; month < 8; month += 1) {
        semiDates.push(iso(new Date(2025, month, 1)))
        semiDates.push(iso(new Date(2025, month, 15)))
    }
    const loan = detectRecurring({
        transactions: semiDates.map((date) => tx(date, 'expense', 500, 'Loan Repayment', 'Loan')),
        currency: 'CAD',
        asOf: '2025-08-20',
    }).find((item) => item.category === 'Loan Repayment')
    assert.ok(loan)
    assert.equal(loan.cadence, 'semimonthly')
    assert.deepEqual(loan.anchorDays.sort((a, b) => a - b), [1, 15])
})

test('detects annual items and rejects variable weekly groceries', () => {
    const annual = detectRecurring({
        transactions: [
            tx('2024-03-01', 'expense', 1200, 'Insurance', 'Annual insurance'),
            tx('2025-03-01', 'expense', 1200, 'Insurance', 'Annual insurance'),
            tx('2026-03-01', 'expense', 1200, 'Insurance', 'Annual insurance'),
        ],
        currency: 'CAD',
        asOf: '2026-09-15',
    }).find((item) => item.category === 'Insurance')
    assert.ok(annual)
    assert.equal(annual.cadence, 'annual')
    assert.equal(annual.nextDate, '2027-03-01')

    const groceries = detectRecurring({
        transactions: [
            tx('2026-08-03', 'expense', 20, 'Food Weekly', 'Groceries'),
            tx('2026-08-10', 'expense', 200, 'Food Weekly', 'Groceries'),
            tx('2026-08-17', 'expense', 30, 'Food Weekly', 'Groceries'),
            tx('2026-08-24', 'expense', 180, 'Food Weekly', 'Groceries'),
            tx('2026-08-31', 'expense', 40, 'Food Weekly', 'Groceries'),
        ],
        currency: 'CAD',
        asOf: '2026-09-15',
    })
    assert.equal(groceries.some((item) => item.category === 'Food Weekly'), false)
})

test('ignores sparse and expired patterns', () => {
    const sparse = detectRecurring({
        transactions: [
            tx('2026-01-10', 'expense', 80, 'Medical', 'Clinic'),
            tx('2026-04-10', 'expense', 80, 'Medical', 'Clinic'),
        ],
        currency: 'CAD',
        asOf: '2026-09-15',
    })
    assert.equal(sparse.length, 0)

    const expired = detectRecurring({
        transactions: monthlyDates(2025, 10, 6).map((date) => tx(date, 'expense', 10, 'Subscriptions', 'Old service')),
        currency: 'CAD',
        asOf: '2026-09-15',
    })
    assert.equal(expired.length, 0)
})

test('applies includes, amounts, cadence and next-date adjustments', () => {
    const transactions = monthlyDates(2025, 10, 12).map((date) => tx(date, 'expense', 1400, 'Rent', 'Rent'))
    const items = detectRecurring({ transactions, currency: 'CAD', asOf: '2026-09-15' })
    const rent = items.find((item) => item.category === 'Rent')
    const adjusted = applyRecurringAdjustments({
        items,
        adjustments: [{
            kind: 'expense',
            category: 'Rent',
            details: rent.detailsKey,
            include: false,
            amount: 1500,
            cadence: 'monthly',
            nextDate: '2026-10-05',
        }],
    })
    const changed = adjusted.items.find((item) => item.category === 'Rent')
    assert.equal(changed.include, false)
    assert.equal(changed.amount, 1500)
    assert.equal(changed.nextDate, '2026-10-05')
    assert.equal(changed.detectedAmount, 1400)
    assert.deepEqual(adjusted.staleAdjustments, [])

    const stale = applyRecurringAdjustments({
        items,
        adjustments: [{ kind: 'expense', category: 'Rent', details: 'no-such-item' }],
    })
    assert.equal(stale.staleAdjustments.length, 1)
})

test('generates monthly, semimonthly and leap-year occurrences', () => {
    const monthly = {
        cadence: 'monthly',
        nextDate: '2026-01-31',
        anchorDays: [31],
        amount: 10,
    }
    assert.deepEqual(recurringOccurrences(monthly, '2026-01-01', '2026-04-30'), [
        '2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30',
    ])

    const semi = {
        cadence: 'semimonthly',
        nextDate: '2026-01-01',
        anchorDays: [1, 15],
        amount: 10,
    }
    assert.deepEqual(recurringOccurrences(semi, '2026-01-10', '2026-02-15'), [
        '2026-01-15', '2026-02-01', '2026-02-15',
    ])

    const leap = {
        cadence: 'annual',
        nextDate: '2024-02-29',
        anchorDays: [29],
        amount: 10,
    }
    assert.deepEqual(recurringOccurrences(leap, '2024-01-01', '2025-03-01'), ['2024-02-29', '2025-02-28'])
})

test('computes monthly equivalents', () => {
    assert.equal(monthlyEquivalent({ amount: 100, cadence: 'monthly' }), 100)
    assert.ok(Math.abs(monthlyEquivalent({ amount: 100, cadence: 'quarterly' }) - 100 / 3) < 1e-9)
    assert.equal(monthlyEquivalent({ amount: 120, cadence: 'annual' }), 10)
    assert.ok(Math.abs(monthlyEquivalent({ amount: 10, cadence: 'weekly' }) - 10 * 52 / 12) < 1e-9)
})
