// Pure budget-progress helpers shared by the dashboard cards.

import { number } from './money.js'

// Progress reflects the expected spend for today, not an arbitrary share of
// the monthly budget. Under or at the pace line is green; over it is red.
export function progressState(spent, budget, expected) {
  if (budget <= 0) return 'card--none'
  return spent > expected ? 'card--over' : 'card--ok'
}

export function expectedSpend(currency, budget, today) {
  const supplied = number(currency?.monthsExpectedSpend)
  if (supplied > 0) return supplied
  if (budget <= 0 || !today) return 0
  const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate()
  return budget * (today.getDate() / daysInMonth)
}
