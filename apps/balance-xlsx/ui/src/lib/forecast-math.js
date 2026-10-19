// Pure forecast maths shared by the Forecasts page and the Node tests. The
// scenario sheets contain only inputs; everything here is recomputed live from
// the transaction history.

import {
  addDays,
  clean,
  daysInclusive,
  endOfMonth,
  parseIsoDate,
  startOfMonth,
  toIsoDate,
} from './insights-math.js'
import { applyRecurringAdjustments, detectRecurring, recurringOccurrences } from './forecast-recurring.js'
import { backtestBaseline, buildVariableBaseline } from './forecast-baseline.js'
import { monteCarlo } from './forecast-uncertainty.js'

const addMonths = (date, months) => new Date(date.getFullYear(), date.getMonth() + months, 1)

const daysInMonth = (date) => new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()

const monthIndex = (date) => date.getFullYear() * 12 + date.getMonth()

const monthKeyFor = (date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`

const eventSignedAmount = (event) => (event.kind === 'income' ? 1 : -1) * Number(event.amount || 0)

const latestChange = (changes, kind, category, monthKey) => {
  let active = null
  for (const change of changes || []) {
    if (!change || change.kind !== kind || change.category !== category) continue
    if (typeof change.from !== 'string' || change.from > monthKey) continue
    if (!active || change.from >= active.from) active = change
  }
  return active
}

const addDateValue = (map, date, field, amount) => {
  if (!map.has(date)) map.set(date, { income: 0, expenses: 0 })
  map.get(date)[field] += amount
}

const buildMonthlyPlan = ({
  scenario,
  baseline,
  recurringItems,
  asOf,
  startMonth,
  simulationMonths,
  startingBalance,
}) => {
  const months = []
  const recurringByDate = new Map()
  const eventsByDate = new Map()
  const asOfIso = toIsoDate(asOf)
  let opening = startingBalance

  for (let index = 0; index < simulationMonths; index += 1) {
    const start = addMonths(startMonth, index)
    const end = endOfMonth(start)
    const startIso = toIsoDate(start)
    const endIso = toIsoDate(end)
    const monthKey = monthKeyFor(start)
    const suppressed = new Set()
    let variableIncome = 0
    let variableExpenses = 0
    let fixedIncome = 0
    let fixedExpenses = 0
    let recurringIncome = 0
    let recurringExpenses = 0
    let oneTime = 0

    for (const row of baseline.rows) {
      if (!row.include) continue
      const key = `${row.kind}|${row.category}`
      const change = latestChange(scenario.changes, row.kind, row.category, monthKey)
      if (change) {
        if (row.kind === 'income') fixedIncome += Number(change.amount)
        else fixedExpenses += Number(change.amount)
        suppressed.add(key)
        continue
      }
      if (row.override != null) {
        if (row.kind === 'income') fixedIncome += Number(row.override)
        else fixedExpenses += Number(row.override)
        suppressed.add(key)
        continue
      }
      if (row.kind === 'income') variableIncome += row.variableAuto
      else variableExpenses += row.variableAuto
    }

    for (const item of recurringItems || []) {
      if (item.include === false) continue
      const key = `${item.kind}|${item.category}`
      if (suppressed.has(key)) continue
      for (const occurrence of recurringOccurrences(item, startIso, endIso)) {
        if (occurrence < asOfIso) continue
        if (item.kind === 'income') {
          recurringIncome += Number(item.amount)
          addDateValue(recurringByDate, occurrence, 'income', Number(item.amount))
        } else {
          recurringExpenses += Number(item.amount)
          addDateValue(recurringByDate, occurrence, 'expenses', Number(item.amount))
        }
      }
    }

    for (const event of scenario.events || []) {
      const date = parseIsoDate(event.date)
      if (!date) continue
      if (date < asOf) continue
      if (date < start || date > end) continue
      const amount = eventSignedAmount(event)
      oneTime += amount
      eventsByDate.set(toIsoDate(date), (eventsByDate.get(toIsoDate(date)) || 0) + amount)
    }

    const fraction = index === 0 ? daysInclusive(asOf, end) / daysInMonth(start) : 1
    const row = {
      year: start.getFullYear(),
      month: start.getMonth() + 1,
      start: startIso,
      end: endIso,
      monthKey,
      partial: index === 0 && asOf.getDate() > 1,
      opening,
      variableIncome: clean(variableIncome * fraction),
      variableExpenses: clean(variableExpenses * fraction),
      fixedIncome: clean(fixedIncome * fraction),
      fixedExpenses: clean(fixedExpenses * fraction),
      recurringIncome: clean(recurringIncome),
      recurringExpenses: clean(recurringExpenses),
      oneTime: clean(oneTime),
    }
    row.income = clean(row.variableIncome + row.fixedIncome + row.recurringIncome)
    row.expenses = clean(row.variableExpenses + row.fixedExpenses + row.recurringExpenses)
    row.net = clean(row.income - row.expenses + row.oneTime)
    row.closing = clean(opening + row.net)
    opening = row.closing
    months.push(row)
  }

  return { months, recurringByDate, eventsByDate }
}

const simulatePlan = ({
  plan,
  startingBalance,
  asOf,
  horizonMonths,
  targetAmount,
  targetDateInput,
}) => {
  const horizonEnd = plan.months[Math.min(horizonMonths, plan.months.length) - 1]?.end || toIsoDate(asOf)
  const targetDateIso = targetDateInput ? toIsoDate(targetDateInput) : null
  const asOfIso = toIsoDate(asOf)
  let balance = startingBalance
  let targetDate = targetAmount != null && startingBalance >= targetAmount ? asOfIso : null
  let targetAlready = Boolean(targetDate)
  let runwayDate = startingBalance < 0 ? asOfIso : null
  let balanceAtHorizon = null
  let balanceAtSimulationEnd = startingBalance
  let balanceAtUserTarget = null
  let minimumBalance = startingBalance
  let minimumBalanceDate = asOfIso

  plan.months.forEach((month, index) => {
    const start = parseIsoDate(month.start)
    const end = parseIsoDate(month.end)
    const firstDay = index === 0 ? asOf : start
    const remainingDays = index === 0 ? daysInclusive(asOf, end) : daysInMonth(start)
    const variableIncomeDaily = month.variableIncome / remainingDays
    const variableExpensesDaily = month.variableExpenses / remainingDays
    const fixedIncomeDaily = index === 0 ? month.fixedIncome / remainingDays : 0
    const fixedExpensesDaily = index === 0 ? month.fixedExpenses / remainingDays : 0
    for (let day = firstDay; day <= end; day = addDays(day, 1)) {
      const iso = toIsoDate(day)
      let income = variableIncomeDaily
      let expenses = variableExpensesDaily
      if (index === 0) {
        income += fixedIncomeDaily
        expenses += fixedExpensesDaily
      } else if (day.getDate() === 1) {
        income += month.fixedIncome
        expenses += month.fixedExpenses
      }
      const recurring = plan.recurringByDate.get(iso)
      if (recurring) {
        income += recurring.income
        expenses += recurring.expenses
      }
      const event = plan.eventsByDate.get(iso) || 0
      balance = clean(balance + income - expenses + event)
      if (balance < minimumBalance) {
        minimumBalance = balance
        minimumBalanceDate = iso
      }
      if (targetAmount != null && targetDate == null && balance >= targetAmount) {
        targetDate = iso
      }
      if (runwayDate == null && balance < 0) {
        runwayDate = iso
      }
      if (targetDateIso && iso === targetDateIso) {
        balanceAtUserTarget = balance
      }
      if (iso === horizonEnd) {
        balanceAtHorizon = balance
      }
      balanceAtSimulationEnd = balance
    }
  })

  const horizonEndIso = horizonEnd
  const horizonRows = plan.months.slice(0, Math.min(horizonMonths, plan.months.length))
  const chartMonths = []
  let cumulativeEvents = 0
  for (const month of horizonRows) {
    cumulativeEvents = clean(cumulativeEvents + month.oneTime)
    chartMonths.push({
      date: month.end,
      closing: month.closing,
      closingWithoutEvents: clean(month.closing - cumulativeEvents),
      oneTime: month.oneTime,
    })
  }

  const monthlyIncome = clean(horizonRows.reduce((sum, month) => sum + month.income, 0) / Math.max(1, horizonRows.length))
  const monthlyExpenses = clean(horizonRows.reduce((sum, month) => sum + month.expenses, 0) / Math.max(1, horizonRows.length))
  const monthlyNet = clean(monthlyIncome - monthlyExpenses)
  const target = {
    hasTarget: targetAmount != null,
    amount: targetAmount,
    reached: Boolean(targetDate),
    already: targetAlready,
    date: targetDate,
    withinHorizon: Boolean(targetDate && targetDate <= horizonEndIso),
    shortfall: targetAmount != null && !targetDate ?
      clean(targetAmount - balanceAtSimulationEnd) : 0,
  }
  const runway = {
    depleted: Boolean(runwayDate),
    date: runwayDate,
    withinHorizon: Boolean(runwayDate && runwayDate <= horizonEndIso),
    unknown: startingBalance === 0,
  }
  const userTarget = targetDateIso ? {
    date: targetDateIso,
    balance: balanceAtUserTarget,
    gap: targetAmount != null && balanceAtUserTarget != null ?
      clean(targetAmount - balanceAtUserTarget) : null,
    onTrack: targetAmount != null && balanceAtUserTarget != null ? balanceAtUserTarget >= targetAmount : null,
  } : null

  return {
    startingBalance,
    balanceUnknown: startingBalance === 0,
    lowestBalance: clean(minimumBalance),
    lowestBalanceDate: minimumBalanceDate,
    months: horizonRows,
    chart: {
      start: { date: asOfIso, balance: startingBalance },
      months: chartMonths,
    },
    horizonMonths,
    horizonEnd: horizonEndIso,
    horizonClosing: balanceAtHorizon == null ? (horizonRows[horizonRows.length - 1]?.closing ?? startingBalance) : balanceAtHorizon,
    monthlyIncome,
    monthlyExpenses,
    monthlyNet,
    savingsRate: monthlyIncome > 0 ? clean(monthlyNet / monthlyIncome) : null,
    target,
    runway,
    userTarget,
  }
}

export const buildForecast = ({
  scenario,
  transactions,
  categories,
  firstMonth,
  paths = 500,
  seed = null,
  includeUncertainty = true,
}) => {
  const asOf = parseIsoDate(scenario.asOf)
  if (!asOf) throw new Error('Invalid as-of date')
  const horizonMonths = Math.min(120, Math.max(1, Number(scenario.horizonMonths) || 24))
  const targetAmount = Number(scenario.target?.amount) > 0 ? Number(scenario.target.amount) : null
  const targetDateInput = scenario.target?.date ? parseIsoDate(scenario.target.date) : null

  const recurringDetection = scenario.recurringDetection !== false
  const detected = recurringDetection
    ? detectRecurring({
      transactions,
      currency: scenario.currency,
      asOf: scenario.asOf,
      excludedCategories: scenario.excludedCategories || [],
      lookbackMonths: 24,
    })
    : []
  const { items: recurringItems, staleAdjustments } = recurringDetection
    ? applyRecurringAdjustments({
      items: detected,
      adjustments: scenario.recurringAdjustments || [],
      asOf: scenario.asOf,
    })
    : { items: [], staleAdjustments: [] }

  const backtest = backtestBaseline({
    transactions,
    scenario,
    categories,
    firstMonth,
    recurringItems,
  })
  const effectiveMethod = scenario.baselineMethod === 'simple' ? 'simple'
    : scenario.baselineMethod === 'robust' ? 'robust'
      : (backtest?.chosen || 'robust')
  const baseline = buildVariableBaseline({
    transactions,
    scenario,
    categories,
    firstMonth,
    recurringItems,
    method: effectiveMethod,
  })

  const startingBalance = clean((scenario.accounts || [])
    .filter((account) => account.include !== false)
    .reduce((sum, account) => sum + Number(account.balance || 0), 0))
  const simulationMonths = Math.min(600, Math.max(
    horizonMonths,
    120,
    targetDateInput ? monthIndex(targetDateInput) - monthIndex(asOf) + 2 : 0,
  ))
  const startMonth = startOfMonth(asOf)
  const plan = buildMonthlyPlan({
    scenario,
    baseline,
    recurringItems,
    asOf,
    startMonth,
    simulationMonths,
    startingBalance,
  })
  const projection = simulatePlan({
    plan,
    startingBalance,
    asOf,
    horizonMonths,
    targetAmount,
    targetDateInput,
  })
  const uncertaintyBacktest = backtest ? {
    ...backtest,
    residuals: effectiveMethod === backtest.chosen ? backtest.residuals : {
      income: backtest.targets.map((target) => clean(target.actualIncome - target[`${effectiveMethod}Income`])),
      expenses: backtest.targets.map((target) => clean(target.actualExpenses - target[`${effectiveMethod}Expenses`])),
    },
  } : null
  const projectionWithLongRun = { ...projection, longRunMonths: plan.months }
  const uncertainty = includeUncertainty && scenario.uncertainty !== false
    ? monteCarlo({ projection: projectionWithLongRun, backtest: uncertaintyBacktest, scenario, paths, seed })
    : null

  const pastEvents = (scenario.events || []).filter((event) => event.date < scenario.asOf).length
  const lowConfidenceCategories = baseline.rows.filter((row) =>
    row.include && row.override == null && row.confidence === 'low').length
  const lowConfidenceRecurring = recurringItems.filter((item) => item.include !== false && item.confidence < 0.7).length
  const warnings = []
  if (baseline.monthCount === 0) {
    warnings.push('No complete months of data are available for the baseline window.')
  } else if (baseline.income === 0 && baseline.expenses === 0) {
    warnings.push(`No ${scenario.currency} transactions were found in the baseline window.`)
  }
  if (startingBalance === 0) {
    warnings.push('Starting balance is 0, which is treated as unknown. Projected balances are relative to $0; add your real account balance to see absolute figures.')
  }
  if (projection.monthlyNet < 0) {
    warnings.push('Projected expenses are higher than projected income.')
  }
  if (targetAmount != null && !projection.target.reached) {
    warnings.push('The target is not reached within the long-run projection.')
  } else if (targetAmount != null && projection.target.reached && !projection.target.withinHorizon) {
    warnings.push('The target is reached after the chart horizon.')
  }
  if (pastEvents > 0) {
    warnings.push(`${pastEvents} event${pastEvents === 1 ? '' : 's'} before the as-of date ${pastEvents === 1 ? 'is' : 'are'} ignored.`)
  }
  if (lowConfidenceCategories > 0) {
    warnings.push(`${lowConfidenceCategories} categor${lowConfidenceCategories === 1 ? 'y has' : 'ies have'} a low-confidence auto estimate; consider an override.`)
  }
  if (lowConfidenceRecurring > 0) {
    warnings.push(`${lowConfidenceRecurring} recurring item${lowConfidenceRecurring === 1 ? ' has' : 's have'} low confidence; review them in the recurring card.`)
  }
  if (staleAdjustments.length > 0) {
    warnings.push(`${staleAdjustments.length} recurring adjustment${staleAdjustments.length === 1 ? '' : 's'} no longer match a detected item.`)
  }
  if (scenario.target?.date && scenario.target.date < scenario.asOf) {
    warnings.push('The target date is before the as-of date.')
  }
  if (scenario.uncertainty !== false && includeUncertainty && !uncertainty) {
    warnings.push('Not enough backtest history for uncertainty bands.')
  }

  return {
    ...projection,
    longRunMonths: plan.months,
    baseline,
    recurring: {
      detectionEnabled: recurringDetection,
      items: recurringItems,
      staleAdjustments,
    },
    backtest,
    uncertainty,
    effectiveMethod,
    simulationMonths,
    warnings,
  }
}
