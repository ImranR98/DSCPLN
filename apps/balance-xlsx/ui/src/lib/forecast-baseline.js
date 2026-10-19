// Robust variable baseline for the Forecasts page: monthly category totals,
// zero-inflated estimates, recency weighting, outlier exclusion, sparse
// shrinkage, and a small Simple-vs-Robust backtest.

import { clean, parseIsoDate, trailingMonths } from './insights-math.js'
import { monthlyEquivalent, recurringKey } from './forecast-recurring.js'

const HALF_LIFE_MONTHS = 3
const BACKTEST_MONTHS = 6

const median = (values) => {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

const mean = (values) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0

const stddev = (values) => {
  if (values.length < 2) return 0
  const average = mean(values)
  return Math.sqrt(values.reduce((sum, value) => sum + (value - average) ** 2, 0) / values.length)
}

const coefficientOfVariation = (values) => {
  const average = mean(values)
  return average > 0 ? stddev(values) / average : 0
}

const monthWindows = ({ asOf, baselineMonths, firstMonth }) => {
  const end = parseIsoDate(asOf)
  if (!end) return []
  const first = firstMonth ? parseIsoDate(firstMonth) : null
  return trailingMonths(baselineMonths, end, first).map(({ year, month }) => ({
    year,
    month,
    start: new Date(year, month - 1, 1),
    end: new Date(year, month, 0),
  }))
}

const weightsFor = (length) => Array.from({ length }, (_, index) =>
  0.5 ** ((length - 1 - index) / HALF_LIFE_MONTHS))

const weightedMean = (values, weights, indices) => {
  let total = 0
  let weight = 0
  for (const index of indices) {
    total += values[index] * weights[index]
    weight += weights[index]
  }
  return weight > 0 ? total / weight : 0
}

const weightedMedian = (values, weights, indices) => {
  const pairs = indices.map((index) => ({ value: values[index], weight: weights[index] }))
    .sort((a, b) => a.value - b.value)
  const total = pairs.reduce((sum, pair) => sum + pair.weight, 0)
  if (total <= 0) return 0
  let cumulative = 0
  for (const pair of pairs) {
    cumulative += pair.weight
    if (cumulative >= total / 2) return pair.value
  }
  return pairs[pairs.length - 1]?.value || 0
}

const detectOutliers = (totals) => {
  const active = totals.filter((value) => value > 0)
  if (active.length < 4) return []
  const center = median(totals)
  const deviation = median(totals.map((value) => Math.abs(value - center)))
  const threshold = center + Math.max(3 * deviation, center * 1.5, 0.01)
  const indices = []
  totals.forEach((value, index) => {
    if (value > threshold) indices.push(index)
  })
  return indices
}

export const estimateTotals = (totals = [], { method = 'robust' } = {}) => {
  const length = totals.length
  const outlierIndices = detectOutliers(totals)
  const outlierSet = new Set(outlierIndices)
  const usable = Array.from({ length }, (_, index) => index)
    .filter((index) => !outlierSet.has(index))
  const allIndices = Array.from({ length }, (_, index) => index)
  const indices = method === 'simple'
    ? allIndices
    : (usable.length >= 2 ? usable : allIndices)
  const values = indices.map((index) => totals[index])
  const activeMonths = values.filter((value) => value > 0).length
  const weights = weightsFor(length)
  const average = mean(values)
  const cv = coefficientOfVariation(values)
  const monthCount = length

  if (length === 0 || activeMonths === 0) {
    return {
      estimate: 0,
      method: 'No data',
      confidence: 'none',
      activeMonths: 0,
      monthCount,
      cv: 0,
      frequency: 0,
      severity: 0,
      outliers: [],
    }
  }

  let estimate = average
  let label = 'Simple average'
  if (method !== 'simple' && length >= 3) {
    const weightedFrequency = values.reduce((sum, value, index) => {
      const original = indices[index]
      return sum + (value > 0 ? weights[original] : 0)
    }, 0) / indices.reduce((sum, index) => sum + weights[index], 0)
    const positive = indices.filter((index) => totals[index] > 0)
    const severity = positive.length ? weightedMedian(totals, weights, positive) : 0
    if (activeMonths <= 2 || activeMonths / values.length < 0.6) {
      estimate = weightedFrequency * severity
      label = 'Zero-inflated'
    } else if (cv > 0.6) {
      estimate = weightedMedian(totals, weights, indices)
      label = 'Recency-weighted median'
    } else {
      estimate = weightedMean(totals, weights, indices)
      label = 'Recency-weighted mean'
    }
    if (activeMonths < 3) {
      estimate *= activeMonths / (activeMonths + 2)
      label = label === 'Zero-inflated' ? 'Zero-inflated (sparse)' : 'Sparse (shrunk)'
    }
  }

  const confidence = activeMonths >= 4 && length >= 6 && cv <= 0.6 && outlierIndices.length <= 1 ? 'high'
    : activeMonths >= 2 && length >= 4 ? 'medium' : 'low'

  return {
    estimate: clean(estimate),
    method: label,
    confidence,
    activeMonths,
    monthCount,
    cv: clean(cv),
    frequency: clean(activeMonths / Math.max(1, values.length)),
    severity: clean(activeMonths > 0 ? estimate / Math.max(0.000001, activeMonths / Math.max(1, values.length)) : 0),
    outliers: outlierIndices.map((index) => index),
  }
}

const emptyMonthTotals = (length) => Array.from({ length }, () => 0)

const monthIndexMap = (months) => new Map(months.map((month, index) => [`${month.year}|${month.month}`, index]))

const totalByKind = (transactions, { currency, months, excluded, recurringKeys, skipRecurring = true }) => {
  const indexFor = monthIndexMap(months)
  const income = emptyMonthTotals(months.length)
  const expenses = emptyMonthTotals(months.length)
  for (const transaction of transactions) {
    if (transaction.currency !== currency || excluded.has(transaction.category)) continue
    const date = parseIsoDate(transaction.date)
    if (!date) continue
    const index = indexFor.get(`${date.getFullYear()}|${date.getMonth() + 1}`)
    if (index == null) continue
    if (skipRecurring && recurringKeys.has(recurringKey(transaction))) continue
    const amount = Number(transaction.kind === 'income' ? transaction.moneyIn : transaction.expenses)
    if (!Number.isFinite(amount) || amount <= 0) continue
    if (transaction.kind === 'income') income[index] += amount
    else expenses[index] += amount
  }
  return { income, expenses }
}

export const buildVariableBaseline = ({
  transactions = [],
  scenario,
  categories = [],
  firstMonth = null,
  recurringItems = [],
  method: estimateMethod = 'robust',
}) => {
  const months = monthWindows({
    asOf: scenario.asOf,
    baselineMonths: scenario.baselineMonths,
    firstMonth,
  })
  const monthCount = months.length
  const excluded = new Set(scenario.excludedCategories || [])
  // Recurring items are excluded from the variable-layer history whether they
  // are currently scheduled or not. An unchecked item therefore leaves the
  // forecast entirely instead of silently reappearing as an average.
  const recurringKeys = new Set((recurringItems || []).map((item) => item.key))
  const indexFor = monthIndexMap(months)
  const categoryTotals = new Map()
  const actualIncome = emptyMonthTotals(monthCount)
  const actualExpenses = emptyMonthTotals(monthCount)

  for (const transaction of transactions) {
    if (transaction.currency !== scenario.currency || excluded.has(transaction.category)) continue
    const date = parseIsoDate(transaction.date)
    if (!date) continue
    const index = indexFor.get(`${date.getFullYear()}|${date.getMonth() + 1}`)
    if (index == null) continue
    const amount = Number(transaction.kind === 'income' ? transaction.moneyIn : transaction.expenses)
    if (!Number.isFinite(amount) || amount <= 0) continue
    if (transaction.kind === 'income') actualIncome[index] += amount
    else actualExpenses[index] += amount
    if (recurringKeys.has(recurringKey(transaction))) continue
    const key = `${transaction.kind}|${transaction.category}`
    if (!categoryTotals.has(key)) categoryTotals.set(key, emptyMonthTotals(monthCount))
    categoryTotals.get(key)[index] += amount
  }

  const rows = []
  for (const group of categories) {
    const kinds = group.group === 'Money In' ? ['income'] :
      group.group === 'Conversions' ? ['income', 'expense'] : ['expense']
    for (const category of group.categories) {
      for (const kind of kinds) {
        const totals = categoryTotals.get(`${kind}|${category}`) || emptyMonthTotals(monthCount)
        const estimate = estimateTotals(totals, { method: estimateMethod })
        const recurringRows = (recurringItems || []).filter((item) =>
          item.include !== false && item.kind === kind && item.category === category)
        const recurringMonthly = clean(recurringRows.reduce((sum, item) => sum + monthlyEquivalent(item), 0))
        const override = scenario.overrides?.[kind]?.[category]
        const include = !excluded.has(category)
        const variableAuto = estimate.estimate
        const auto = clean(variableAuto + recurringMonthly)
        const effective = include ? clean(override == null ? auto : Number(override)) : 0
        const recurringConfidence = recurringRows.length
          ? recurringRows.reduce((value, item) => Math.min(value, item.confidence || 0), 1)
          : 0
        const method = recurringMonthly > 0
          ? (variableAuto === 0 || estimate.method === 'No data' ? 'Recurring' : `${estimate.method} + recurring`)
          : estimate.method
        const confidence = recurringMonthly > 0 && variableAuto === 0
          ? (recurringConfidence >= 0.8 ? 'high' : recurringConfidence >= 0.65 ? 'medium' : 'low')
          : estimate.confidence
        rows.push({
          group: group.group,
          kind,
          category,
          auto,
          variableAuto,
          recurringMonthly,
          override: override == null ? null : clean(override),
          include,
          effective,
          method,
          confidence,
          activeMonths: estimate.activeMonths,
          monthCount: estimate.monthCount,
          frequency: estimate.frequency,
          severity: estimate.severity,
          outliers: estimate.outliers.map((index) => ({
            year: months[index]?.year,
            month: months[index]?.month,
            amount: clean(totals[index]),
          })),
          recurringSuppressed: override != null,
          recurringCount: recurringRows.length,
        })
      }
    }
  }

  const income = clean(rows.filter((row) => row.kind === 'income').reduce((sum, row) => sum + row.effective, 0))
  const expenses = clean(rows.filter((row) => row.kind === 'expense').reduce((sum, row) => sum + row.effective, 0))
  return {
    currency: scenario.currency,
    monthCount,
    months,
    rows,
    income,
    expenses,
    net: clean(income - expenses),
    actualMonthly: months.map((month, index) => ({
      year: month.year,
      month: month.month,
      income: clean(actualIncome[index]),
      expenses: clean(actualExpenses[index]),
      net: clean(actualIncome[index] - actualExpenses[index]),
    })),
  }
}

const aggregateTotals = ({ transactions, scenario, months, recurringItems }) => {
  const excluded = new Set(scenario.excludedCategories || [])
  // Recurring items are excluded from the variable-layer history whether they
  // are currently scheduled or not. An unchecked item therefore leaves the
  // forecast entirely instead of silently reappearing as an average.
  const recurringKeys = new Set((recurringItems || []).map((item) => item.key))
  const totals = totalByKind(transactions, {
    currency: scenario.currency,
    months,
    excluded,
    recurringKeys,
    skipRecurring: true,
  })
  return totals
}

export const backtestBaseline = ({
  transactions = [],
  scenario,
  firstMonth = null,
  recurringItems = [],
}) => {
  const end = parseIsoDate(scenario.asOf)
  if (!end) return null
  const first = firstMonth ? parseIsoDate(firstMonth) : null
  // Use enough history for the training window plus the backtest targets.
  const allMonths = trailingMonths(Math.max(12, Math.min(24, scenario.baselineMonths + BACKTEST_MONTHS)), end, first)
  const targetMonths = allMonths.slice(-BACKTEST_MONTHS)
  if (targetMonths.length < 3) return null
  const targets = []
  for (const target of targetMonths) {
    const targetIndex = allMonths.findIndex((month) => month.year === target.year && month.month === target.month)
    const training = allMonths.slice(Math.max(0, targetIndex - Math.max(2, scenario.baselineMonths)), targetIndex)
    if (training.length < 2) continue
    const trainingTotals = aggregateTotals({
      transactions,
      scenario,
      months: training,
      firstMonth,
      recurringItems,
    })
    const simpleIncome = estimateTotals(trainingTotals.income, { method: 'simple' })
    const simpleExpenses = estimateTotals(trainingTotals.expenses, { method: 'simple' })
    const robustIncome = estimateTotals(trainingTotals.income, { method: 'robust' })
    const robustExpenses = estimateTotals(trainingTotals.expenses, { method: 'robust' })
    const actual = aggregateTotals({
      transactions,
      scenario,
      months: [target],
      firstMonth,
      recurringItems,
    })
    targets.push({
      year: target.year,
      month: target.month,
      actualIncome: clean(actual.income[0]),
      actualExpenses: clean(actual.expenses[0]),
      simpleIncome: simpleIncome.estimate,
      simpleExpenses: simpleExpenses.estimate,
      robustIncome: robustIncome.estimate,
      robustExpenses: robustExpenses.estimate,
    })
  }
  if (targets.length < 3) return null
  const error = (key) => targets.reduce((sum, target) => sum
    + Math.abs(target[`${key}Income`] - target.actualIncome)
    + Math.abs(target[`${key}Expenses`] - target.actualExpenses), 0) / (targets.length * 2)
  const bias = (key) => targets.reduce((sum, target) => sum
    + (target[`${key}Income`] - target.actualIncome)
    + (target[`${key}Expenses`] - target.actualExpenses), 0) / (targets.length * 2)
  const simpleMae = clean(error('simple'))
  const robustMae = clean(error('robust'))
  const chosen = robustMae < simpleMae * 0.9 ? 'robust' : 'simple'
  const residuals = {
    income: targets.map((target) => clean(target.actualIncome - target[`${chosen}Income`])),
    expenses: targets.map((target) => clean(target.actualExpenses - target[`${chosen}Expenses`])),
  }
  return {
    months: targets.length,
    simple: { mae: simpleMae, bias: clean(bias('simple')) },
    robust: { mae: robustMae, bias: clean(bias('robust')) },
    chosen,
    targets: targets.map((target) => ({
      ...target,
      chosenIncome: target[`${chosen}Income`],
      chosenExpenses: target[`${chosen}Expenses`],
    })),
    residuals,
  }
}
