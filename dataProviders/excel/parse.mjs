// Workbook cell parsing and validation.

import crypto from 'node:crypto';

import { ValidationError } from '../../errors.mjs';
import { MAX_IMPORT_ROWS, MAX_IMPORT_TEXT_LENGTH, TRANSACTION_HEADERS } from './model.mjs';




export const INCOME_GROUP = 'Money In'
export const CONVERSION_GROUP = 'Conversions'
export const CURRENCIES_HEADER = 'Currencies'
export const CURRENCY_SYMBOLS_HEADER = 'Symbols'
export const BUDGETS_LABEL = 'Budgets'
export const BUDGET_MONTHLY_LABEL = 'Monthly Budget'
export const BUDGET_BIAS_LABEL = 'First Day Bias'
export const BUDGET_CURRENCY_HEADER = 'Currency'

export const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30)
export const DATE_1904_OFFSET_DAYS = 1462
export const MS_PER_DAY = 24 * 60 * 60 * 1000

// The first day bias is fully available on day 1; the rest of the budget
// accrues evenly across the month.
export const cleanAmount = (value) => Number.parseFloat(Number(value).toPrecision(12))

export const hasSubCentPrecision = (value) => {
    const amount = Number(value)
    return Number.isFinite(amount) && Math.abs(amount * 100 - Math.round(amount * 100)) > 1e-6
}

export const normalizeHeader = (value) => String(value == null ? '' : value).trim()

export const cellString = (value) => {
    if (value == null) {
        return ''
    }
    if (typeof value === 'string') {
        return value
    }
    if (value instanceof Date) {
        return value.toISOString()
    }
    if (typeof value === 'object') {
        if (Array.isArray(value.richText)) {
            return value.richText.map((part) => part.text || '').join('')
        }
        if (typeof value.text === 'string') {
            return value.text
        }
        if (value.result != null) {
            return String(value.result)
        }
    }
    return String(value)
}

export const cellNumber = (value) => {
    if (value == null || value === '') {
        return null
    }
    if (typeof value === 'object' && value.result != null) {
        return cellNumber(value.result)
    }
    if (typeof value === 'number') {
        return Number.isFinite(value) ? value : null
    }
    const text = String(value).trim().replace(/,/g, '')
    if (text === '') {
        return null
    }
    const parsed = Number(text)
    return Number.isFinite(parsed) ? parsed : null
}

export const dateFromCell = (value, date1904) => {
    if (value instanceof Date && !isNaN(value)) {
        return { year: value.getUTCFullYear(), month: value.getUTCMonth() + 1, day: value.getUTCDate() }
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
        const ms = EXCEL_EPOCH_MS + (Math.trunc(value) + (date1904 ? DATE_1904_OFFSET_DAYS : 0)) * MS_PER_DAY
        const date = new Date(ms)
        return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() }
    }
    if (typeof value === 'string') {
        const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim())
        if (match) {
            return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) }
        }
    }
    return null
}

export const datePartsToIso = ({ year, month, day }) =>
    `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`

export const datePartsToUtcDate = ({ year, month, day }) => new Date(Date.UTC(year, month - 1, day))

export const transactionHash = (transaction) => crypto.createHash('sha256').update(JSON.stringify([
    transaction.dateIso,
    transaction.details,
    transaction.moneyIn,
    transaction.expenses,
    transaction.currency,
    transaction.category,
    transaction.notes,
])).digest('hex').slice(0, 12)

export const parseTransactionId = (id) => {
    const match = /^(\d+)-([0-9a-f]{12})$/.exec(String(id))
    if (!match) {
        throw new ValidationError('Invalid transaction id')
    }
    return { row: Number.parseInt(match[1], 10), hash: match[2] }
}

export const MAX_AMOUNT_DECIMALS = 12

export const validateAmount = (value) => {
    const amount = Number.parseFloat(value)
    if (!Number.isFinite(amount) || amount <= 0) {
        throw new ValidationError('Amount must be greater than 0')
    }
    // The tolerance is relative to the scaled value so binary floating point
    // noise (e.g. 16.99 storing as 16.989999…) doesn't look like over-precision,
    // while a genuine extra decimal place is still rejected.
    const scaled = amount * (10 ** MAX_AMOUNT_DECIMALS)
    const tolerance = Math.max(1e-6, Math.abs(scaled) * Number.EPSILON * 4)
    if (Math.abs(scaled - Math.round(scaled)) > tolerance) {
        throw new ValidationError(`Amount can have at most ${MAX_AMOUNT_DECIMALS} decimal places`)
    }
    return Number.parseFloat(amount.toFixed(MAX_AMOUNT_DECIMALS))
}

export const validateText = (value, label, required) => {
    const text = typeof value === 'string' ? value.trim() : ''
    if (!text && required) {
        throw new ValidationError(`${label} is required`)
    }
    if (/[\r\n]/.test(text)) {
        throw new ValidationError(`${label} must be a single line`)
    }
    return text
}

export const parseDateInput = (value) => {
    if (typeof value !== 'string') {
        throw new ValidationError('Date must be a YYYY-MM-DD string')
    }
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim())
    if (!match) {
        throw new ValidationError('Date must be a YYYY-MM-DD string')
    }
    const year = Number(match[1])
    const month = Number(match[2])
    const day = Number(match[3])
    const date = new Date(Date.UTC(year, month - 1, day))
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
        throw new ValidationError('Date is not a valid calendar date')
    }
    return { year, month, day }
}

// Categories in the "Conversions" group are transfers between currencies: they
// are valid for both kinds and are tracked separately from spend/income.
export const parseImportLines = (text) => {
    if (typeof text !== 'string' || text.trim() === '') {
        throw new ValidationError('Paste at least one transaction line')
    }
    if (text.length > MAX_IMPORT_TEXT_LENGTH) {
        throw new ValidationError('Import is too large. Split it into smaller batches.')
    }
    const lines = []
    text.split(/\r?\n/).forEach((raw, index) => {
        if (raw.trim() === '') {
            return
        }
        lines.push({ number: index + 1, fields: raw.split('\t').map((field) => field.trim()) })
    })
    if (lines.length === 0) {
        throw new ValidationError('Paste at least one transaction line')
    }
    if (lines.length > MAX_IMPORT_ROWS) {
        throw new ValidationError(`Import is limited to ${MAX_IMPORT_ROWS} transactions at a time`)
    }
    return lines
}

export const parseImportAmount = (value, label) => {
    if (value == null || value === '') {
        return null
    }
    const parsed = Number(String(value).replace(/[,\s]/g, ''))
    if (!Number.isFinite(parsed)) {
        throw new ValidationError(`${label} must be a number`)
    }
    return parsed
}

// Fields are matched positionally to the sheet's header row, so pasted rows
// are exactly the columns as they appear in the workbook.
export const parseImportLine = (line, orderedHeaders) => {
    const fields = {}
    const unknown = []
    line.fields.forEach((value, index) => {
        const header = orderedHeaders[index]
        if (!header) {
            if (value !== '') {
                unknown.push(`column ${index + 1}`)
            }
            return
        }
        if (value !== '' && !TRANSACTION_HEADERS.includes(header)) {
            unknown.push(`"${header}"`)
        }
        fields[header] = value
    })
    if (unknown.length) {
        throw new ValidationError(`Unexpected value in ${unknown.join(', ')}`)
    }
    const moneyIn = parseImportAmount(fields['Money In'], 'Money In')
    const expenses = parseImportAmount(fields['Expenses'], 'Expenses')
    if (moneyIn != null && expenses != null) {
        throw new ValidationError('Fill only one of Money In or Expenses')
    }
    if (moneyIn == null && expenses == null) {
        throw new ValidationError('Fill one of Money In or Expenses')
    }
    return {
        kind: moneyIn != null ? 'income' : 'expense',
        amount: moneyIn != null ? moneyIn : expenses,
        date: fields['Date'],
        details: fields['Details'],
        currency: fields['Currency'],
        category: fields['Type'],
        notes: fields['Notes'],
    }
}

