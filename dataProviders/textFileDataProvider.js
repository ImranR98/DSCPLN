'use strict'

// Default provider
// All providers must implement getData and updateMonthlyBudget, and may implement
// addTransaction, updateTransaction, and deleteTransaction.

// Reads expenses from a text file where each line is of the form '<amount> <description> <optional 'M D' date (if none, take from previous line)>'
// Stores the monthly budget as a single number in a text file
// Stores a "first day bias" as a single number on the second line of the monthly budget file

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { ValidationError, NotFoundError, ConflictError } = require('../errors')

const AMOUNT_TOKEN_PATTERN = /^[0-9]+(?:\.[0-9]+)?$/
const CURRENCY_PREFIX_PATTERN = /^([A-Z]{3})\s/
const CURRENCY_CODE_PATTERN = /^[A-Z]{3}$/
const DATE_LIKE_SUFFIX_PATTERN = /(?:^|\s)[0-9]{1,2} [0-9]{1,2}$/

function countFullWeeksInMonth(inputDate) {
    if (!(inputDate instanceof Date) || isNaN(inputDate)) {
        throw new Error('Invalid date input')
    }

    const firstDayOfMonth = new Date(inputDate.getFullYear(), inputDate.getMonth(), 1)
    const startOfWeek = new Date(firstDayOfMonth)
    startOfWeek.setDate(firstDayOfMonth.getDate() + ((7 - firstDayOfMonth.getDay()) % 7))

    const lastDayOfMonth = new Date(inputDate.getFullYear(), inputDate.getMonth() + 1, 0)
    const endOfWeek = new Date(lastDayOfMonth)
    endOfWeek.setDate(lastDayOfMonth.getDate() - ((lastDayOfMonth.getDay() + 1) % 7))

    const millisecondsInDay = 24 * 60 * 60 * 1000
    return Math.floor(Math.round((endOfWeek - startOfWeek) / millisecondsInDay) / 7) + 1
}

// A "week" is a budget period, not necessarily a block of 7 days:
// - The first period runs from the 1st through the end of the first full Sun-Sat week, so a
//   partial week at the start of the month is lumped in with the following full week
// - Middle periods are full Sun-Sat weeks
// - The last period is the last full Sun-Sat week, extended through the end of the month to
//   absorb any trailing partial week
// The first period's budget includes the first day bias, which is available immediately.
const getMonthlyPeriods = (date, monthlyBudget, firstDayBias) => {
    const fullWeeks = countFullWeeksInMonth(date)
    const normalWeeklyBudget = fullWeeks > 0 ? Math.max(0, (monthlyBudget - firstDayBias) / fullWeeks) : 0
    const firstDayOfMonth = new Date(date.getFullYear(), date.getMonth(), 1)
    const firstFullWeekStartDay = 1 + ((7 - firstDayOfMonth.getDay()) % 7)
    const lastDayOfMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()
    const periods = []
    let startDay = 1
    for (let i = 0; i < fullWeeks; i++) {
        const isFirst = i === 0
        const isLast = i === fullWeeks - 1
        const endDay = isLast ? lastDayOfMonth : firstFullWeekStartDay + i * 7 + 6
        periods.push({
            startDay,
            endDay,
            budget: isFirst ? firstDayBias + normalWeeklyBudget : normalWeeklyBudget,
            normalBudget: normalWeeklyBudget,
        })
        startDay = endDay + 1
    }
    if (periods.length === 0) {
        periods.push({
            startDay: 1,
            endDay: lastDayOfMonth,
            budget: monthlyBudget,
            normalBudget: monthlyBudget,
        })
    }
    return periods
}

const getPeriodExpectedSpend = (period, day) => {
    const length = period.endDay - period.startDay + 1
    const elapsed = Math.min(Math.max(day - period.startDay + 1, 0), length)
    const bias = period.budget - period.normalBudget
    return Math.min(period.budget, bias + period.normalBudget * (elapsed / length))
}

const getMonthExpectedSpend = (periods, day, monthlyBudget) => {
    let expected = 0
    for (const period of periods) {
        if (day > period.endDay) {
            expected += period.budget
        } else if (day >= period.startDay) {
            expected += getPeriodExpectedSpend(period, day)
            break
        } else {
            break
        }
    }
    return Math.min(expected, monthlyBudget)
}

const getTransactionId = (line, raw) =>
    `${line}-${crypto.createHash('sha256').update(raw).digest('hex').slice(0, 12)}`

const parseTransactionId = (id) => {
    const match = /^(\d+)-[0-9a-f]{12}$/.exec(String(id))
    if (!match) {
        throw new ValidationError('Invalid transaction id')
    }
    return Number.parseInt(match[1], 10)
}

const parseTransactionLine = (raw, line, previousDate) => {
    const tokens = raw.split(/\s+/)
    const currencyMatch = CURRENCY_PREFIX_PATTERN.exec(raw)
    const currency = currencyMatch ? currencyMatch[1] : null
    const amountIndex = currencyMatch ? 1 : 0
    const amountToken = tokens[amountIndex]
    if (!AMOUNT_TOKEN_PATTERN.test(amountToken || '') || tokens.length <= amountIndex + 1) {
        return null
    }
    const amount = Math.round(Number.parseFloat(amountToken) * 100) / 100
    const descriptionTokens = tokens.slice(amountIndex + 1)
    let date = null
    if (descriptionTokens.length >= 2) {
        const monthToken = descriptionTokens[descriptionTokens.length - 2]
        const dayToken = descriptionTokens[descriptionTokens.length - 1]
        if (/^\d{1,2}$/.test(monthToken) && /^\d{1,2}$/.test(dayToken)) {
            const month = Number.parseInt(monthToken, 10)
            const day = Number.parseInt(dayToken, 10)
            if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
                date = { month, day }
                descriptionTokens.splice(-2)
            }
        }
    }
    return {
        id: getTransactionId(line, raw),
        line,
        raw,
        currency,
        amount,
        description: descriptionTokens.join(' '),
        date,
        effectiveDate: date || previousDate,
    }
}

const parseDateInput = (value) => {
    if (typeof value !== 'string') {
        throw new ValidationError('Date must be a YYYY-MM-DD string')
    }
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
    if (!match) {
        throw new ValidationError('Date must be a YYYY-MM-DD string')
    }
    const year = Number(match[1])
    const month = Number(match[2])
    const day = Number(match[3])
    const date = new Date(year, month - 1, day)
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
        throw new ValidationError('Date is not a valid calendar date')
    }
    return { month, day }
}

const parseCurrency = (value) => {
    if (value == null || value === '') {
        return null
    }
    if (typeof value !== 'string') {
        throw new ValidationError('Currency must be a 3-letter code (for example "USD")')
    }
    const currency = value.trim().toUpperCase()
    if (currency === '') {
        return null
    }
    if (!CURRENCY_CODE_PATTERN.test(currency)) {
        throw new ValidationError('Currency must be a 3-letter code (for example "USD")')
    }
    return currency
}

const validateTransactionInput = (input = {}) => {
    const amount = Number.parseFloat(input.amount)
    if (!Number.isFinite(amount) || amount <= 0) {
        throw new ValidationError('Amount must be greater than 0')
    }
    if (Math.abs(amount * 100 - Math.round(amount * 100)) > 1e-6) {
        throw new ValidationError('Amount can have at most 2 decimal places')
    }
    const description = typeof input.description === 'string' ? input.description.trim() : ''
    if (!description) {
        throw new ValidationError('Description is required')
    }
    if (/[\r\n]/.test(description)) {
        throw new ValidationError('Description must be a single line')
    }
    if (DATE_LIKE_SUFFIX_PATTERN.test(description)) {
        throw new ValidationError('Description cannot end with a date (for example "10 2") because it would be read as a date')
    }
    return {
        currency: parseCurrency(input.currency),
        amount: Math.round(amount * 100) / 100,
        description,
        date: parseDateInput(input.date),
    }
}

const buildLine = ({ amount, description, date, currency }) =>
    `${currency ? `${currency} ` : ''}${amount} ${description} ${date.month} ${date.day}`

module.exports = (config = {}, configDir = process.cwd()) => {
    const resolvePath = (value, fallback) =>
        path.resolve(configDir, typeof value === 'string' && value.trim() !== '' ? value : fallback)
    const dataFile = resolvePath(config.dataFile, './data.txt')
    const budgetFile = resolvePath(config.budgetFile, './budget.txt')
    const monthlyBudgetInit = Number.isFinite(Number(config.monthlyBudgetInit)) ? Number(config.monthlyBudgetInit) : 2400
    const firstDayBiasInit = Number.isFinite(Number(config.firstDayBiasInit)) ? Number(config.firstDayBiasInit) : 1400

    fs.mkdirSync(path.dirname(dataFile), { recursive: true })
    fs.mkdirSync(path.dirname(budgetFile), { recursive: true })
    if (!fs.existsSync(dataFile)) {
        fs.writeFileSync(dataFile, '')
    }
    if (!fs.existsSync(budgetFile)) {
        fs.writeFileSync(budgetFile, `${monthlyBudgetInit}\n${firstDayBiasInit}`)
    }

    const readFileState = () => {
        const contents = fs.readFileSync(dataFile, 'utf8')
        if (contents === '') {
            return { lines: [], eol: '\n', trailingNewline: false }
        }
        const eol = contents.includes('\r\n') ? '\r\n' : '\n'
        const trailingNewline = contents.endsWith('\n')
        const lines = contents.split(/\r\n|\n/)
        if (trailingNewline) {
            lines.pop()
        }
        return { lines, eol, trailingNewline }
    }

    const writeLines = ({ lines, eol, trailingNewline }) => {
        let contents = lines.join(eol)
        if (trailingNewline && lines.length > 0) {
            contents += eol
        }
        const tempFile = `${dataFile}.tmp`
        fs.writeFileSync(tempFile, contents)
        fs.renameSync(tempFile, dataFile)
    }

    const readTransactions = (state = readFileState()) => {
        const transactions = []
        let previousDate = null
        state.lines.forEach((raw, line) => {
            const transaction = parseTransactionLine(raw, line, previousDate)
            if (!transaction) {
                return
            }
            transactions.push(transaction)
            if (transaction.date) {
                previousDate = transaction.date
            }
        })
        return transactions
    }

    const readBudget = () => {
        const budgetData = fs.readFileSync(budgetFile, 'utf8').trim().split('\n').map(l => Number.parseFloat(l || 0))
        return {
            monthlyBudget: budgetData[0] || 0,
            firstDayBias: budgetData[1] || 0,
        }
    }

    const sumTransactions = (transactions) =>
        Math.round(transactions.reduce((total, transaction) => total + Math.round(transaction.amount * 100), 0)) / 100

    const getData = async (date = new Date(), currency = null) => {
        const selectedCurrency = parseCurrency(currency)
        const { monthlyBudget, firstDayBias } = readBudget()
        const transactions = readTransactions()
        const monthNum = date.getMonth() + 1
        const dayOfMonth = date.getDate()
        const periods = getMonthlyPeriods(date, monthlyBudget, firstDayBias)
        const currentPeriod = periods.find(period => dayOfMonth >= period.startDay && dayOfMonth <= period.endDay)
        const matchesCurrency = (transaction) =>
            selectedCurrency ? transaction.currency === selectedCurrency : transaction.currency === null
        const monthTransactions = transactions.filter(transaction =>
            matchesCurrency(transaction) &&
            transaction.effectiveDate && transaction.effectiveDate.month === monthNum)
        const spentBefore = (transaction) => transaction.effectiveDate.day <= dayOfMonth
        const inCurrentPeriod = (transaction) =>
            transaction.effectiveDate.day >= currentPeriod.startDay &&
            transaction.effectiveDate.day <= Math.min(dayOfMonth, currentPeriod.endDay)
        return {
            monthlyBudget,
            firstDayBias,
            weeklyBudget: currentPeriod.budget,
            weekPeriodStartDay: currentPeriod.startDay,
            weekPeriodEndDay: currentPeriod.endDay,
            monthsSpend: sumTransactions(monthTransactions.filter(spentBefore)),
            weeksSpend: sumTransactions(monthTransactions.filter(inCurrentPeriod)),
            weeksExpectedSpend: getPeriodExpectedSpend(currentPeriod, dayOfMonth),
            monthsExpectedSpend: getMonthExpectedSpend(periods, dayOfMonth, monthlyBudget),
            currencies: [...new Set(transactions.map(transaction => transaction.currency).filter(Boolean))].sort(),
            writable: true,
            transactions: monthTransactions,
        }
    }

    const updateMonthlyBudget = async (monthlyBudget, firstDayBias) => {
        const budget = Number.parseFloat(monthlyBudget)
        const bias = Number.parseFloat(firstDayBias)
        if (!Number.isFinite(budget) || budget <= 0 || !Number.isFinite(bias) || bias < 0 || bias > budget) {
            throw new ValidationError('Invalid budget values')
        }
        const tempBudgetFile = `${budgetFile}.tmp`
        fs.writeFileSync(tempBudgetFile, `${budget.toString()}\n${bias.toString()}`)
        fs.renameSync(tempBudgetFile, budgetFile)
    }

    const addTransaction = async (input) => {
        const { currency, amount, description, date } = validateTransactionInput(input)
        const state = readFileState()
        const raw = buildLine({ currency, amount, description, date })
        state.lines.push(raw)
        state.trailingNewline = true
        writeLines(state)
        const line = state.lines.length - 1
        return {
            id: getTransactionId(line, raw),
            line,
            raw,
            currency,
            amount,
            description,
            date,
            effectiveDate: date,
        }
    }

    const updateTransaction = async (id, input) => {
        const line = parseTransactionId(id)
        const { currency, amount, description, date } = validateTransactionInput(input)
        const state = readFileState()
        if (line < 0 || line >= state.lines.length || getTransactionId(line, state.lines[line]) !== id) {
            throw new ConflictError('This transaction changed on disk. Refresh and try again.')
        }
        const raw = buildLine({ currency, amount, description, date })
        state.lines[line] = raw
        writeLines(state)
        return {
            id: getTransactionId(line, raw),
            line,
            raw,
            currency,
            amount,
            description,
            date,
            effectiveDate: date,
        }
    }

    const deleteTransaction = async (id) => {
        const line = parseTransactionId(id)
        const state = readFileState()
        if (line < 0 || line >= state.lines.length || getTransactionId(line, state.lines[line]) !== id) {
            throw new ConflictError('This transaction changed on disk. Refresh and try again.')
        }
        const target = readTransactions(state).find(transaction => transaction.line === line)
        if (!target) {
            throw new NotFoundError('Transaction not found')
        }
        state.lines.splice(line, 1)
        if (target.date) {
            for (let i = line; i < state.lines.length; i++) {
                const next = parseTransactionLine(state.lines[i], i, null)
                if (!next) {
                    continue
                }
                if (!next.date) {
                    state.lines[i] = buildLine({
                        currency: next.currency,
                        amount: next.amount,
                        description: next.description,
                        date: target.date,
                    })
                }
                break
            }
        }
        writeLines(state)
    }

    return { getData, updateMonthlyBudget, addTransaction, updateTransaction, deleteTransaction }
}
