// Workbook domain shaping: budgets, categories, transactions.




export const INCOME_GROUP = 'Money In'
export const CONVERSION_GROUP = 'Conversions'
export const CURRENCIES_HEADER = 'Currencies'
export const CURRENCY_SYMBOLS_HEADER = 'Symbols'
export const BUDGETS_LABEL = 'Budgets'
export const BUDGET_MONTHLY_LABEL = 'Monthly Budget'
export const BUDGET_BIAS_LABEL = 'First Day Bias'
export const BUDGET_CURRENCY_HEADER = 'Currency'
// Categories listed under this Constants label start out unchecked (left out
// of the totals) on the dashboard and insights pages.
export const EXCLUDED_LABEL = 'Excluded from Budget by Default'

export const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30)
export const DATE_1904_OFFSET_DAYS = 1462
export const MS_PER_DAY = 24 * 60 * 60 * 1000

// The first day bias is fully available on day 1; the rest of the budget
// accrues evenly across the month.
export const getMonthExpectedSpend = (monthlyBudget, firstDayBias, day, daysInMonth) => {
    if (monthlyBudget <= 0) {
        return 0
    }
    const bias = Math.min(Math.max(firstDayBias, 0), monthlyBudget)
    const expected = bias + (monthlyBudget - bias) * (day / daysInMonth)
    return Math.min(monthlyBudget, Math.max(0, expected))
}

// Trims floating point noise without forcing a fixed number of decimals, so
// tiny amounts (e.g. fractional XMR) keep their precision.
export const categoriesForKind = (constants, kind) => {
    const groups = kind === 'income' ?
        constants.categoryGroups.filter((entry) => entry.group === INCOME_GROUP || entry.group === CONVERSION_GROUP) :
        constants.categoryGroups.filter((entry) => entry.group !== INCOME_GROUP)
    return groups.flatMap((entry) => entry.categories)
}

export const conversionCategoriesFor = (constants) => {
    const group = constants.categoryGroups.find((entry) => entry.group === CONVERSION_GROUP)
    return new Set(group ? group.categories : [])
}

export const TRANSACTION_HEADERS = ['Date', 'Details', 'Money In', 'Expenses', 'Currency', 'Type', 'Notes']
export const MAX_IMPORT_ROWS = 1000
export const MAX_IMPORT_TEXT_LENGTH = 200 * 1024

export const serializeTransaction = (transaction) => ({
    id: transaction.id,
    row: transaction.row,
    date: transaction.dateIso,
    details: transaction.details,
    moneyIn: transaction.moneyIn,
    expenses: transaction.expenses,
    currency: transaction.currency,
    category: transaction.category,
    notes: transaction.notes,
    kind: transaction.kind,
})

