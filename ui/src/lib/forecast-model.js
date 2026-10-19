// View model for the Forecasts page: turns the pure forecast maths into the
// display strings and small structures the React components render.

import { formats, parseIso, startOfDay, toIso } from '@dscpln/ui-kit'
import { buildForecast } from './forecast-math.js'
import { currencyColor } from './money.js'

const monthLabel = (iso) => formats.monthYear.format(parseIso(iso))
const dateLabel = (iso) => `${formats.dayMonth.format(parseIso(iso))} ${formats.year.format(parseIso(iso))}`
const countLabel = (value, singular, plural = `${singular}s`) =>
  `${value} ${value === 1 ? singular : plural}`

const CADENCE_LABELS = {
  weekly: 'Weekly',
  biweekly: 'Every 2 weeks',
  semimonthly: 'Twice a month',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  annual: 'Annual',
}

const kpi = (label, valueText, { delta = '', className = 'muted', title = '', valueColor = null, labelTitle = '' } = {}) => ({
  label,
  labelTitle,
  valueText,
  valueColor,
  delta: { text: delta, className, title },
})

const signedMoney = (money, value, code) =>
  `${value > 0 ? '+' : ''}${money(value, code)}`

const percent = (value) => value == null ? null : `${Math.round(value * 100)}%`

export const buildKpis = (forecast, scenario, money) => {
  const code = scenario.currency
  const balanceUnknown = Boolean(forecast.balanceUnknown)
  const target = forecast.target
  const uncertaintyTarget = forecast.uncertainty?.target
  const targetText = !target.hasTarget ? '—'
    : target.already ? 'Already reached'
      : target.reached ? monthLabel(target.date)
        : 'Not reached'
  let targetDelta = 'no target set'
  let targetTitle = ''
  if (target.hasTarget) {
    if (uncertaintyTarget?.p10 && uncertaintyTarget?.p90) {
      targetDelta = `80% range ${monthLabel(uncertaintyTarget.p10)} – ${monthLabel(uncertaintyTarget.p90)}`
      targetTitle = uncertaintyTarget.probabilityByHorizon != null
        ? `${percent(uncertaintyTarget.probabilityByHorizon)} of Monte Carlo paths reach the target within the horizon`
        : ''
    } else if (forecast.userTarget) {
      targetDelta = forecast.userTarget.onTrack == null
        ? `target date ${dateLabel(forecast.userTarget.date)}`
        : forecast.userTarget.onTrack
          ? `on track for ${dateLabel(forecast.userTarget.date)}`
          : `short by ${money(Math.max(0, forecast.userTarget.gap), code)} at ${dateLabel(forecast.userTarget.date)}`
    } else if (target.already) {
      targetDelta = 'target already met'
    } else if (target.reached) {
      targetDelta = target.withinHorizon ? `target ${money(target.amount, code)}` : 'after the chart horizon'
    } else {
      targetDelta = `short by ${money(Math.max(0, target.shortfall), code)}`
    }
    if (uncertaintyTarget?.probabilityByDate != null) {
      targetTitle = `${percent(uncertaintyTarget.probabilityByDate)} of paths reach the target by the target date. ${targetTitle}`.trim()
    }
    if (balanceUnknown) {
      targetTitle = `Starting balance is unknown (assumed $0). ${targetTitle}`.trim()
    }
  }

  const runwayText = forecast.runway.depleted ? monthLabel(forecast.runway.date) : 'No depletion'
  const cashOutProbability = forecast.uncertainty?.cashOut?.probability
  const runwayDelta = forecast.runway.depleted
    ? forecast.runway.withinHorizon ? 'cash runs out within the horizon' : 'cash runs out after the horizon'
    : cashOutProbability != null && cashOutProbability > 0
      ? `${percent(cashOutProbability)} chance of cash-out within the horizon`
      : 'balance stays positive'
  const lastBand = forecast.uncertainty?.bands?.[forecast.uncertainty.bands.length - 1]
  const horizonDelta = lastBand?.p10 != null && lastBand?.p90 != null
    ? `80%: ${money(lastBand.p10, code)} – ${money(lastBand.p90, code)}`
    : `at ${monthLabel(forecast.horizonEnd)}`
  const savingsRate = forecast.savingsRate
  const lowText = forecast.lowestBalance < 0
    ? `projected low ${money(forecast.lowestBalance, code)} in ${monthLabel(forecast.lowestBalanceDate)}`
    : `projected low ${money(forecast.lowestBalance, code)}`
  const unknownRunway = kpi('Runway', 'Unknown start', {
    delta: lowText,
    className: 'muted',
    title: 'Starting balance is unknown. Add your real starting balance for an absolute runway.',
  })
  return [
    balanceUnknown
      ? kpi('Starting balance', 'Unknown', {
        delta: 'enter your real balance',
        className: 'muted',
        title: 'Starting balance is treated as unknown; projected balances are relative to $0.',
      })
      : kpi('Starting balance', money(forecast.startingBalance, code), {
        delta: countLabel((scenario.accounts || []).filter((account) => account.include !== false).length, 'account'),
        title: `As of ${dateLabel(scenario.asOf)}`,
      }),
    kpi('Avg monthly net', signedMoney(money, forecast.monthlyNet, code), {
      delta: `avg of ${forecast.horizonMonths} months · ${money(forecast.monthlyIncome, code)} in · ${money(forecast.monthlyExpenses, code)} out`,
      className: forecast.monthlyNet > 0 ? 'kpi__delta--good' : forecast.monthlyNet < 0 ? 'kpi__delta--bad' : 'muted',
      valueColor: forecast.monthlyNet > 0 ? 'var(--ok)' : forecast.monthlyNet < 0 ? 'var(--over)' : null,
    }),
    kpi('Target date', targetText, {
      delta: targetDelta,
      className: target.hasTarget && target.reached ? 'kpi__delta--good' : target.hasTarget ? 'kpi__delta--bad' : 'muted',
      title: targetTitle || (target.hasTarget && target.reached ? `Target ${money(target.amount, code)}` : ''),
    }),
    kpi(balanceUnknown ? `Net change in ${scenario.horizonMonths} months` : `Balance in ${scenario.horizonMonths} months`, money(forecast.horizonClosing, code), {
      delta: horizonDelta,
      valueColor: forecast.horizonClosing < 0 ? 'var(--over)' : null,
      title: balanceUnknown ? 'Assumes a $0 starting balance; add your real balance for an absolute figure.' : '',
    }),
    balanceUnknown ? unknownRunway : kpi('Runway', runwayText, {
      delta: runwayDelta,
      className: forecast.runway.depleted || (cashOutProbability || 0) > 0.1 ? 'kpi__delta--bad' : 'kpi__delta--good',
    }),
    kpi('Savings rate', savingsRate == null ? '—' : `${Math.round(savingsRate * 100)}%`, {
      delta: savingsRate == null ? 'no income baseline' : 'of average monthly income',
      className: savingsRate != null && savingsRate < 0 ? 'kpi__delta--bad' : 'muted',
    }),
  ]
}

const buildBaselineGroups = (forecast, reference, money) => {
  const rows = forecast.baseline.rows
  const code = forecast.baseline.currency
  return (reference?.categories || []).map((group) => ({
    group: group.group,
    rows: rows.filter((row) => row.group === group.group).map((row) => ({
      ...row,
      autoText: money(row.auto, code),
      recurringText: row.recurringMonthly > 0 ? money(row.recurringMonthly, code) : null,
      effectiveText: money(row.effective, code),
      confidenceClass: row.confidence === 'high' ? 'is-in' : row.confidence === 'low' ? 'is-out' : 'muted',
      outlierText: row.outliers.length
        ? row.outliers.map((outlier) => `${formats.monthShort.format(new Date(outlier.year, outlier.month - 1, 1))} ${money(outlier.amount, code)}`).join(', ')
        : '',
    })),
  })).filter((group) => group.rows.length > 0)
}

const buildProjectionRows = (forecast, money) => forecast.months.map((month) => ({
  key: `${month.year}-${month.month}`,
  label: month.partial ? `Rest of ${monthLabel(month.start)}` : monthLabel(month.start),
  partial: month.partial,
  openingText: money(month.opening, forecast.baseline.currency),
  incomeText: money(month.income, forecast.baseline.currency),
  expensesText: money(month.expenses, forecast.baseline.currency),
  oneTimeText: month.oneTime === 0 ? '—' : signedMoney(money, month.oneTime, forecast.baseline.currency),
  oneTimeClass: month.oneTime > 0 ? 'is-in' : month.oneTime < 0 ? 'is-out' : '',
  closingText: money(month.closing, forecast.baseline.currency),
  closingNegative: month.closing < 0,
  targetReached: Boolean(forecast.target.date && forecast.target.date >= month.start && forecast.target.date <= month.end),
}))

const buildChart = (forecast, scenario, currency) => ({
  start: forecast.chart.start,
  months: forecast.chart.months,
  uncertainty: forecast.uncertainty?.bands || null,
  target: forecast.target.hasTarget ? forecast.target.amount : null,
  targetDate: forecast.target.hasTarget ? forecast.target.date : null,
  events: (scenario.events || [])
    .filter((event) => event.date >= scenario.asOf && event.date <= forecast.horizonEnd)
    .map((event) => ({ ...event })),
  currency: scenario.currency,
  symbol: currency?.symbol || '',
  color: currencyColor(scenario.currency) || 'var(--accent)',
  horizonEnd: forecast.horizonEnd,
})

const buildRecurringItems = (forecast, scenario, money) => {
  const currentMonth = scenario.asOf.slice(0, 7)
  return forecast.recurring.items.map((item) => {
    const categoryChanges = (scenario.changes || [])
      .filter((change) => change.kind === item.kind && change.category === item.category)
      .sort((a, b) => (a.from === b.from ? 0 : a.from < b.from ? -1 : 1))
    const activeChange = [...categoryChanges].reverse().find((change) => change.from <= currentMonth) || null
    const nextChange = categoryChanges.find((change) => change.from > currentMonth) || null
    return {
      ...item,
      cadenceLabel: CADENCE_LABELS[item.cadence] || item.cadence,
      amountText: money(item.amount, scenario.currency),
      monthlyEquivalentText: money(item.monthlyEquivalent, scenario.currency),
      confidenceClass: item.confidence >= 0.8 ? 'is-in' : item.confidence >= 0.65 ? 'muted' : 'is-out',
      suppressedByOverride: scenario.overrides?.[item.kind]?.[item.category] != null,
      suppressedByChange: Boolean(activeChange),
      activeChange,
      nextChange,
    }
  })
}

const buildModelQuality = (forecast, money) => {
  const backtest = forecast.backtest
  if (!backtest) return null
  return {
    chosen: forecast.effectiveMethod || backtest.chosen,
    months: backtest.months,
    simpleMaeText: money(backtest.simple.mae, forecast.baseline.currency),
    robustMaeText: money(backtest.robust.mae, forecast.baseline.currency),
    simpleBiasText: signedMoney(money, backtest.simple.bias, forecast.baseline.currency),
    robustBiasText: signedMoney(money, backtest.robust.bias, forecast.baseline.currency),
    rows: backtest.targets.map((target) => ({
      key: `${target.year}-${target.month}`,
      label: formats.monthYear.format(new Date(target.year, target.month - 1, 1)),
      actualIncomeText: money(target.actualIncome, forecast.baseline.currency),
      actualExpensesText: money(target.actualExpenses, forecast.baseline.currency),
      chosenIncomeText: money(target[`${forecast.effectiveMethod}Income`], forecast.baseline.currency),
      chosenExpensesText: money(target[`${forecast.effectiveMethod}Expenses`], forecast.baseline.currency),
    })),
  }
}

export const buildForecastModel = ({ scenario, reference, transactions, money, paths = 500, now = new Date() }) => {
  const currency = (reference?.currencies || []).find((entry) => entry.code === scenario.currency) || null
  const effectiveScenario = { ...scenario, asOf: resolveScenarioAsOf(scenario, now) }
  const forecast = buildForecast({
    scenario: effectiveScenario,
    transactions,
    categories: reference?.categories || [],
    firstMonth: currency?.firstMonth || null,
    paths,
  })
  return {
    scenario,
    effectiveScenario,
    currency,
    forecast,
    kpis: buildKpis(forecast, effectiveScenario, money),
    baselineGroups: buildBaselineGroups(forecast, reference, money),
    baselineMonthly: forecast.baseline.actualMonthly.map((month) => ({
      key: `${month.year}-${month.month}`,
      label: formats.monthYear.format(new Date(month.year, month.month - 1, 1)),
      incomeText: money(month.income, effectiveScenario.currency),
      expensesText: money(month.expenses, effectiveScenario.currency),
      netText: signedMoney(money, month.net, effectiveScenario.currency),
      netClass: month.net > 0 ? 'is-in' : month.net < 0 ? 'is-out' : '',
    })),
    projectionRows: buildProjectionRows(forecast, money),
    chart: buildChart(forecast, effectiveScenario, currency),
    recurring: {
      detectionEnabled: forecast.recurring.detectionEnabled,
      items: buildRecurringItems(forecast, effectiveScenario, money),
      staleAdjustments: forecast.recurring.staleAdjustments,
    },
    modelQuality: buildModelQuality(forecast, money),
    warnings: [
      ...forecast.warnings,
      ...(forecast.userTarget && forecast.userTarget.onTrack === false
        ? [`At the target date (${dateLabel(forecast.userTarget.date)}), the balance is projected to be ${money(Math.max(0, forecast.userTarget.gap), effectiveScenario.currency)} short.`]
        : []),
    ],
  }
}

export const resolveScenarioAsOf = (scenario, now = new Date()) => (
  scenario.asOf || toIso(startOfDay(now))
)

export const attachScenarioDefaults = (scenario) => ({
  ...scenario,
  name: scenario.name || 'Base plan',
  baselineMethod: scenario.baselineMethod || 'auto',
  recurringDetection: scenario.recurringDetection !== false,
  uncertainty: scenario.uncertainty !== false,
  recurringAdjustments: scenario.recurringAdjustments || [],
  changes: scenario.changes || [],
  dirty: false,
})

export const createScenario = ({ currency, name = 'Base plan' }) => ({
  sheetName: null,
  revision: 0,
  updatedAt: null,
  dirty: false,
  name,
  currency,
  asOf: '',
  horizonMonths: 24,
  baselineMonths: 6,
  baselineMethod: 'auto',
  recurringDetection: true,
  uncertainty: true,
  notes: '',
  target: { label: 'Savings target', amount: null, date: null },
  accounts: [{ name: 'Main account', balance: 0, include: true }],
  events: [],
  overrides: { income: {}, expense: {} },
  excludedCategories: [],
  recurringAdjustments: [],
  changes: [],
})

// The server payload: client-only dirty/UI fields are not part of the sheet.
export const scenarioPayload = (scenario) => ({
  sheetName: scenario.sheetName || null,
  revision: Number.isInteger(scenario.revision) ? scenario.revision : 0,
  name: scenario.name,
  currency: scenario.currency,
  asOf: scenario.asOf || null,
  horizonMonths: scenario.horizonMonths,
  baselineMonths: scenario.baselineMonths,
  baselineMethod: scenario.baselineMethod || 'auto',
  recurringDetection: scenario.recurringDetection !== false,
  uncertainty: scenario.uncertainty !== false,
  notes: scenario.notes || '',
  target: {
    label: scenario.target?.label || 'Savings target',
    amount: scenario.target?.amount ?? null,
    date: scenario.target?.date || null,
  },
  accounts: (scenario.accounts || []).map((account) => ({
    name: account.name,
    balance: account.balance,
    include: account.include !== false,
  })),
  events: (scenario.events || []).map((event) => ({
    date: event.date,
    details: event.details,
    kind: event.kind,
    amount: event.amount,
    notes: event.notes || '',
  })),
  overrides: {
    income: { ...(scenario.overrides?.income || {}) },
    expense: { ...(scenario.overrides?.expense || {}) },
  },
  excludedCategories: [...(scenario.excludedCategories || [])],
  recurringAdjustments: (scenario.recurringAdjustments || []).map((adjustment) => ({
    kind: adjustment.kind,
    category: adjustment.category,
    details: adjustment.details,
    label: adjustment.label || '',
    include: adjustment.include !== false,
    amount: adjustment.amount ?? null,
    cadence: adjustment.cadence || null,
    nextDate: adjustment.nextDate || null,
  })),
  changes: (scenario.changes || []).map((change) => ({
    from: change.from,
    kind: change.kind,
    category: change.category,
    amount: change.amount,
  })),
})
