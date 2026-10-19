'use strict'

import test from 'node:test'
import assert from 'node:assert/strict'
import { monteCarlo } from '../ui/src/lib/forecast-uncertainty.js'

const projection = {
    startingBalance: 1000,
    horizonEnd: '2026-12-31',
    months: [
        { start: '2026-10-01', end: '2026-10-31', variableIncome: 100, variableExpenses: 50, fixedIncome: 0, fixedExpenses: 0, recurringIncome: 0, recurringExpenses: 0, oneTime: 0 },
        { start: '2026-11-01', end: '2026-11-30', variableIncome: 100, variableExpenses: 50, fixedIncome: 0, fixedExpenses: 0, recurringIncome: 0, recurringExpenses: 0, oneTime: 0 },
        { start: '2026-12-01', end: '2026-12-31', variableIncome: 100, variableExpenses: 50, fixedIncome: 0, fixedExpenses: 0, recurringIncome: 0, recurringExpenses: 0, oneTime: 0 },
    ],
}

const backtest = {
    residuals: {
        income: [-20, 0, 20, 10],
        expenses: [-10, 10, 0, 5],
    },
}

const scenario = {
    currency: 'CAD',
    asOf: '2026-09-15',
    name: 'Base',
    horizonMonths: 3,
    target: { amount: 1200, date: '2026-12-31' },
}

test('produces deterministic bands and target/cash-out probabilities', () => {
    const first = monteCarlo({ projection, backtest, scenario, paths: 200, seed: 42 })
    const second = monteCarlo({ projection, backtest, scenario, paths: 200, seed: 42 })
    assert.deepEqual(first.bands, second.bands)
    assert.equal(first.bands.length, 3)
    for (const band of first.bands) {
        assert.ok(band.p10 <= band.p50)
        assert.ok(band.p50 <= band.p90)
    }
    assert.equal(first.target.reachedPaths > 0, true)
    assert.ok(first.target.probabilityByHorizon >= 0 && first.target.probabilityByHorizon <= 1)
    assert.ok(first.target.probabilityByDate >= 0 && first.target.probabilityByDate <= 1)
    assert.match(first.target.p10, /^\d{4}-\d{2}-\d{2}$/)
    assert.match(first.target.p90, /^\d{4}-\d{2}-\d{2}$/)
    assert.ok(first.cashOut.probability >= 0 && first.cashOut.probability <= 1)
    assert.equal(first.paths, 200)
})

test('returns null without enough residuals', () => {
    assert.equal(monteCarlo({
        projection,
        backtest: { residuals: { income: [], expenses: [] } },
        scenario,
        paths: 10,
    }), null)
})

test('detects a high cash-out probability when expenses exceed income', () => {
    const spendy = {
        ...projection,
        startingBalance: 50,
        months: projection.months.map((month) => ({ ...month, variableIncome: 0, variableExpenses: 200 })),
    }
    const result = monteCarlo({
        projection: spendy,
        backtest,
        scenario: { ...scenario, target: { amount: null, date: null } },
        paths: 100,
        seed: 7,
    })
    assert.equal(result.target, null)
    assert.ok(result.cashOut.probability > 0.9)
})
