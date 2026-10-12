const weekday = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' })

const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()

export function dateLabel(date, today) {
  if (!today) return weekday.format(date)
  if (sameDay(date, today)) return 'Today'
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1)
  if (sameDay(date, yesterday)) return 'Yesterday'
  return weekday.format(date)
}

export const parseIso = (value) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? ''))
  if (!match) return null
  const [year, month, day] = match.slice(1).map(Number)
  const date = new Date(year, month - 1, day)
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date : null
}

export const sortNewestFirst = (transactions) => [...transactions].sort((a, b) =>
  a.date === b.date ? (b.row || 0) - (a.row || 0) : a.date < b.date ? 1 : -1)

export const formatCount = (count) => `${count} ${count === 1 ? 'transaction' : 'transactions'}`
