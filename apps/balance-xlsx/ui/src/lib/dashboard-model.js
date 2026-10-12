// Pure computation for the dashboard hero and currency tiles (no React).

import { formats } from '@dscpln/ui-kit'
import { number, clean, currencyColor } from './money.js'

function cardState(spent, budget) {
  if (budget <= 0) return 'card--none'
  if (spent >= budget) return 'card--over'
  if (spent / budget >= 0.8) return 'card--warn'
  return 'card--ok'
}

export function buildHero(data, today, money) {
  const currency = (data?.currencies || []).find((entry) => entry.primary) || (data?.currencies || [])[0] || null
  const value = (key) => number(currency && currency[key])
  const budget = value('monthlyBudget')
  const spent = value('monthsSpend')
  const code = currency ? currency.code : null
  const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate()
  const day = today.getDate()
  const daysLeft = Math.max(1, daysInMonth - day + 1)
  const remaining = budget - spent
  const expected = value('monthsExpectedSpend') || budget * (day / daysInMonth)

  const pct = budget > 0 ? Math.min((spent / budget) * 100, 100) : 0
  const paceFraction = budget > 0 ? Math.min(1, Math.max(0, expected / budget)) : 0
  const paceDelta = expected - spent

  // Last month and the trailing average are shown through the same day of
  // month as today, so all three figure columns are directly comparable; the
  // full-month figures stay in each cell's tooltip.
  const months = Math.max(0, Math.round(value('trailingMonths')))
  const previousMonthDate = new Date(today.getFullYear(), today.getMonth() - 1, 1)
  const daysInPreviousMonth = new Date(previousMonthDate.getFullYear(), previousMonthDate.getMonth() + 1, 0).getDate()
  const previousThrough = Math.min(day, daysInPreviousMonth)
  const monthToDate = day < daysInMonth
  const pick = (full, toDate) => (monthToDate ? toDate : full)
  const throughLabel = (through) => `days 1–${through}`
  const previousName = formats.monthName.format(previousMonthDate)

  const convertedThis = { out: value('monthsConvertedOut'), in: value('monthsConvertedIn') }
  const convertedPrev = {
    out: pick(value('previousMonthsConvertedOut'), value('previousMonthsConvertedOutToDate')),
    in: pick(value('previousMonthsConvertedIn'), value('previousMonthsConvertedInToDate')),
  }
  const convertedAvg = {
    out: pick(value('trailingConvertedOutAverage'), value('trailingConvertedOutAverageToDate')),
    in: pick(value('trailingConvertedInAverage'), value('trailingConvertedInAverageToDate')),
  }
  const convertedPrevFull = { out: value('previousMonthsConvertedOut'), in: value('previousMonthsConvertedIn') }
  const convertedAvgFull = { out: value('trailingConvertedOutAverage'), in: value('trailingConvertedInAverage') }
  const convertedText = (totals) => {
    const net = clean(totals.in - totals.out)
    return `${net > 0 ? '+' : net < 0 ? '−' : ''}${money(Math.abs(net), code)}`
  }
  const convertedTitle = (totals) => `out ${money(totals.out, code)} · in ${money(totals.in, code)}`
  const convertedCell = (totals, full, fullLabel, available = true) => ({
    text: available ? convertedText(totals) : '—',
    title: available
      ? [full && fullLabel ? `${fullLabel}: ${convertedTitle(full)}` : '', convertedTitle(totals)].filter(Boolean).join('\n')
      : '',
  })
  const convThis = convertedCell(convertedThis)
  const convPrev = convertedCell(convertedPrev, convertedPrevFull, `${previousName} full month`, months > 0)
  const convAvg = convertedCell(convertedAvg, convertedAvgFull, `${months}-month average (full months)`, months > 0)
  const hasConversions = [convertedThis, convertedPrev, convertedAvg, convertedPrevFull, convertedAvgFull]
    .some((totals) => totals.out > 0 || totals.in > 0)

  return {
    code,
    heading: currency ? currency.code : 'Main',
    accent: currencyColor(code),
    monthName: formats.monthName.format(today),
    spendText: money(spent, code),
    budgetText: budget > 0 ? money(budget, code) : 'no budget',
    remainingText: budget <= 0 ? '—' : money(remaining, code),
    dailyText: budget <= 0 ? '—' : money(remaining >= 0 ? remaining / daysLeft : 0, code),
    remainingOver: budget > 0 && remaining < 0,
    daysLeft,
    spentThis: money(spent, code),
    thisHeader: monthToDate ? `This month (${throughLabel(day)})` : 'This month',
    prevHeader: monthToDate ? `Last month (${throughLabel(previousThrough)})` : 'Last month',
    avgHeader: months > 0 ? (monthToDate ? `${months}-mo avg (${throughLabel(day)})` : `${months}-mo avg`) : '—',
    spentPrev: months > 0 ? money(pick(value('previousMonthsSpend'), value('previousMonthsSpendToDate')), code) : '—',
    spentPrevTitle: months > 0 ? `${previousName} full month: ${money(value('previousMonthsSpend'), code)}` : '',
    spentAvg: months > 0 ? money(pick(value('trailingSpendAverage'), value('trailingSpendAverageToDate')), code) : '—',
    spentAvgTitle: months > 0 ? `${months}-month average (full months): ${money(value('trailingSpendAverage'), code)}` : '',
    earnThis: `+${money(value('monthsIncome'), code)}`,
    earnPrev: months > 0 ? `+${money(pick(value('previousMonthsIncome'), value('previousMonthsIncomeToDate')), code)}` : '—',
    earnPrevTitle: months > 0 ? `${previousName} full month: +${money(value('previousMonthsIncome'), code)}` : '',
    earnAvg: months > 0 ? `+${money(pick(value('trailingIncomeAverage'), value('trailingIncomeAverageToDate')), code)}` : '—',
    earnAvgTitle: months > 0 ? `${months}-month average (full months): +${money(value('trailingIncomeAverage'), code)}` : '',
    convThis,
    convPrev,
    convAvg,
    hasConversions,
    paceText: budget <= 0
      ? ''
      : `${money(Math.abs(paceDelta), code)} ${paceDelta >= 0 ? 'less' : 'more'} than expected`,
    paceClass: paceDelta >= 0 ? 'pace--ok' : 'pace--over',
    progressPct: pct,
    progressAriaText: budget > 0 ? `${Math.round(pct)}% of budget used` : 'No budget set',
    paceMarkerHidden: budget <= 0,
    paceMarkerLeft: `${(paceFraction * 100).toFixed(1)}%`,
    cardClass: cardState(spent, budget),
  }
}

export function buildCurrencyCards(data, money) {
  return (data?.currencies || [])
    .filter((currency) => !currency.primary && currency.hasActivity)
    .map((currency) => {
      const code = currency.code
      const budget = number(currency.monthlyBudget)
      const spent = number(currency.monthsSpend)
      const remaining = budget - spent
      const pct = budget > 0 ? Math.min((spent / budget) * 100, 100) : 0
      const convertedParts = []
      if (number(currency.monthsConvertedOut) > 0) {
        convertedParts.push(`−${money(number(currency.monthsConvertedOut), code)}`)
      }
      if (number(currency.monthsConvertedIn) > 0) {
        convertedParts.push(`+${money(number(currency.monthsConvertedIn), code)}`)
      }
      return {
        code,
        color: currencyColor(code),
        spendText: money(spent, code),
        budgetText: budget > 0 ? `of ${money(budget, code)}` : 'no budget',
        pct,
        ariaNow: Math.round(pct),
        ariaText: budget > 0 ? `${Math.round(pct)}% of budget used` : 'No budget set',
        remainingText: budget > 0 ? (remaining >= 0 ? `${money(remaining, code)} left` : `${money(-remaining, code)} over`) : null,
        remainingOver: budget > 0 && remaining < 0,
        earnedText: `+${money(number(currency.monthsIncome), code)} in`,
        convertedText: convertedParts.length ? `${convertedParts.join(' / ')} converted` : null,
        cardClass: cardState(spent, budget),
      }
    })
}
