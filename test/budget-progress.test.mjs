import test from 'node:test'
import assert from 'node:assert/strict'
import { expectedSpend, progressState } from '../ui/src/lib/budget-progress.js'
import { currencyColor } from '../ui/src/lib/money.js'

test('progress is green at or under expected and red above it', () => {
  assert.equal(progressState(1200, 3000, 1500), 'card--ok')
  assert.equal(progressState(1500, 3000, 1500), 'card--ok')
  assert.equal(progressState(1500.01, 3000, 1500), 'card--over')
  assert.equal(progressState(2900, 3000, 2500), 'card--over')
})

test('no budget uses the neutral progress state', () => {
  assert.equal(progressState(10, 0, 0), 'card--none')
})

test('expected spend uses the workbook value first and prorates otherwise', () => {
  const today = new Date(2026, 8, 15)
  assert.equal(expectedSpend({ monthsExpectedSpend: 1500 }, 3000, today), 1500)
  // September 15: 900 * 15 / 30 = 450.
  assert.equal(expectedSpend({ monthsExpectedSpend: 0 }, 900, today), 450)
  assert.equal(expectedSpend({ monthsExpectedSpend: 0 }, 0, today), 0)
})

test('the primary currency accent is red for CAD', () => {
  assert.equal(currencyColor('CAD'), '#dc2626')
})
