// Backtest residuals and a seeded Monte Carlo band for the Forecasts page.
// Monthly variable income/expenses are perturbed by historical residuals;
// recurring items, scheduled changes and one-time events stay deterministic.

import { clean, parseIsoDate } from './insights-math.js'

const hashString = (value) => {
  let hash = 2166136261
  for (const char of String(value)) {
    hash ^= char.charCodeAt(0)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

const mulberry32 = (seed) => {
  let state = seed >>> 0
  return () => {
    state += 0x6D2B79F5
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

const percentile = (values, fraction) => {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * fraction)))
  return clean(sorted[index])
}

const datePercentile = (values, fraction) => {
  if (values.length === 0) return null
  const sorted = [...values].sort()
  const index = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * fraction)))
  return sorted[index]
}

const sample = (values, random) => values[Math.floor(random() * values.length)]

const endOfTargetMonth = (iso) => {
  const date = parseIsoDate(iso)
  if (!date) return null
  return new Date(date.getFullYear(), date.getMonth() + 1, 0)
}

const center = (values) => {
  const average = values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length)
  return values.map((value) => clean(value - average))
}

export const monteCarlo = ({ projection, backtest, scenario, paths = 500, seed = null }) => {
  const incomeResiduals = center(backtest?.residuals?.income || [])
  const expenseResiduals = center(backtest?.residuals?.expenses || [])
  if (!projection || projection.months.length === 0 || paths <= 0) return null
  if (incomeResiduals.length < 2 || expenseResiduals.length < 2) return null

  const seedValue = seed == null
    ? hashString(JSON.stringify({
      currency: scenario.currency,
      asOf: scenario.asOf,
      name: scenario.name,
      horizon: scenario.horizonMonths,
      target: scenario.target?.amount,
    }))
    : Number(seed)
  const random = mulberry32(seedValue)
  const targetDate = scenario.target?.date ? parseIsoDate(scenario.target.date) : null
  const targetMonthEnd = targetDate ? endOfTargetMonth(scenario.target.date)?.getTime() : null
  const targetAmount = Number(scenario.target?.amount) > 0 ? Number(scenario.target.amount) : null
  const pathMonths = projection.longRunMonths?.length ? projection.longRunMonths : projection.months
  const monthBalances = pathMonths.map(() => [])
  const targetDates = []
  const cashOutDates = []

  for (let path = 0; path < paths; path += 1) {
    let balance = projection.startingBalance
    let targetReached = null
    let cashOut = null
    pathMonths.forEach((month, index) => {
      const income = Math.max(0, clean(month.variableIncome + sample(incomeResiduals, random) + month.fixedIncome + month.recurringIncome))
      const expenses = Math.max(0, clean(month.variableExpenses + sample(expenseResiduals, random) + month.fixedExpenses + month.recurringExpenses))
      balance = clean(balance + income - expenses + month.oneTime)
      monthBalances[index].push(balance)
      if (targetAmount != null && targetReached == null && balance >= targetAmount) {
        targetReached = month.end
      }
      if (cashOut == null && balance < 0) {
        cashOut = month.end
      }
    })
    if (targetReached) targetDates.push(targetReached)
    if (cashOut) cashOutDates.push(cashOut)
  }

  const bands = projection.months.map((month, index) => {
    const values = monthBalances[index]
    return {
      date: month.end,
      p10: percentile(values, 0.1),
      p50: percentile(values, 0.5),
      p90: percentile(values, 0.9),
    }
  })

  const probability = (dates, endIso) => {
    if (!endIso) return null
    const end = parseIsoDate(endIso)
    if (!end) return null
    return dates.filter((date) => date <= endIso).length / paths
  }

  const targetDateIso = scenario.target?.date || null
  const simulationEnd = pathMonths[pathMonths.length - 1]?.end || projection.horizonEnd
  const targetWithinSimulation = Boolean(targetDateIso && simulationEnd && targetDateIso <= simulationEnd)
  return {
    paths,
    bands,
    target: targetAmount == null ? null : {
      probabilityByHorizon: projection.horizonEnd ? probability(targetDates, projection.horizonEnd) : null,
      probabilityByDate: targetWithinSimulation
        ? targetDates.filter((date) => {
          const value = parseIsoDate(date)
          return value && targetMonthEnd != null && value.getTime() <= targetMonthEnd
        }).length / paths
        : null,
      p10: datePercentile(targetDates, 0.1),
      p50: datePercentile(targetDates, 0.5),
      p90: datePercentile(targetDates, 0.9),
      reachedPaths: targetDates.length,
    },
    cashOut: {
      probability: projection.horizonEnd ? probability(cashOutDates, projection.horizonEnd) : null,
      p10: datePercentile(cashOutDates, 0.1),
      p50: datePercentile(cashOutDates, 0.5),
      p90: datePercentile(cashOutDates, 0.9),
      paths: cashOutDates.length,
    },
  }
}
