// Transaction list helpers ported from the old balance UI: rows are always
// shown newest first, with friendly date labels.

import { formats, sameDay, addDays } from '@dscpln/ui-kit'

export const dateLabel = (date, today) => {
  if (sameDay(date, today)) return 'Today'
  if (sameDay(date, addDays(today, -1))) return 'Yesterday'
  return formats.weekday.format(date)
}

export const sortNewestFirst = (transactions) => [...transactions].sort((a, b) =>
  a.date === b.date ? (b.row || 0) - (a.row || 0) : a.date < b.date ? 1 : -1)

export const formatCount = (count) => `${count} ${count === 1 ? 'transaction' : 'transactions'}`
