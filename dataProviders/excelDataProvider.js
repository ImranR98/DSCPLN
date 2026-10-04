'use strict'

// Excel workbook provider.
// All providers must implement getData and updateMonthlyBudget, and may implement
// addTransaction, updateTransaction, deleteTransaction, and suggestCategories.
//
// Transactions sheet (headers in row 1, mapped by name):
//   Date | Details | Money In | Expenses | Currency | Type | Notes
// Constants sheet (headers in row 2, one category list per column) plus a
// Currencies column and a Budget section (labels in column A, values in column B).

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const ExcelJS = require('exceljs')
const { ValidationError, ConflictError } = require('../errors')
const { suggestCategories: computeSuggestions } = require('../categorySuggester')
const { assertWorkbookRepo, commitFile } = require('../workbookGit')

const INCOME_GROUP = 'Money In'
const BUDGETS_LABEL = 'Budgets'
const BUDGET_MONTHLY_LABEL = 'Monthly Budget'
const BUDGET_BIAS_LABEL = 'First Day Bias'
const BUDGET_CURRENCY_HEADER = 'Currency'

const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30)
const DATE_1904_OFFSET_DAYS = 1462
const MS_PER_DAY = 24 * 60 * 60 * 1000

// The first day bias is fully available on day 1; the rest of the budget
// accrues evenly across the month.
const getMonthExpectedSpend = (monthlyBudget, firstDayBias, day, daysInMonth) => {
    if (monthlyBudget <= 0) {
        return 0
    }
    const bias = Math.min(Math.max(firstDayBias, 0), monthlyBudget)
    const expected = bias + (monthlyBudget - bias) * (day / daysInMonth)
    return Math.min(monthlyBudget, Math.max(0, expected))
}

const normalizeHeader = (value) => String(value == null ? '' : value).trim()

const cellString = (value) => {
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

const cellNumber = (value) => {
    if (value == null || value === '') {
        return null
    }
    if (typeof value === 'object' && value.result != null) {
        return cellNumber(value.result)
    }
    if (typeof value === 'number') {
        return Number.isFinite(value) ? Math.round(value * 100) / 100 : null
    }
    const text = String(value).trim().replace(/,/g, '')
    if (text === '') {
        return null
    }
    const parsed = Number(text)
    return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : null
}

const dateFromCell = (value, date1904) => {
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

const datePartsToIso = ({ year, month, day }) =>
    `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`

const datePartsToUtcDate = ({ year, month, day }) => new Date(Date.UTC(year, month - 1, day))

const transactionHash = (transaction) => crypto.createHash('sha256').update(JSON.stringify([
    transaction.dateIso,
    transaction.details,
    transaction.moneyIn,
    transaction.expenses,
    transaction.currency,
    transaction.category,
    transaction.notes,
])).digest('hex').slice(0, 12)

const parseTransactionId = (id) => {
    const match = /^(\d+)-([0-9a-f]{12})$/.exec(String(id))
    if (!match) {
        throw new ValidationError('Invalid transaction id')
    }
    return { row: Number.parseInt(match[1], 10), hash: match[2] }
}

const validateAmount = (value) => {
    const amount = Number.parseFloat(value)
    if (!Number.isFinite(amount) || amount <= 0) {
        throw new ValidationError('Amount must be greater than 0')
    }
    const rounded = Math.round(amount * 100) / 100
    if (Math.abs(amount - rounded) > 1e-6) {
        throw new ValidationError('Amount can have at most 2 decimal places')
    }
    return rounded
}

const validateText = (value, label, required) => {
    const text = typeof value === 'string' ? value.trim() : ''
    if (!text && required) {
        throw new ValidationError(`${label} is required`)
    }
    if (/[\r\n]/.test(text)) {
        throw new ValidationError(`${label} must be a single line`)
    }
    return text
}

const parseDateInput = (value) => {
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

const categoriesForKind = (constants, kind) => {
    const groups = kind === 'income' ?
        constants.categoryGroups.filter((entry) => entry.group === INCOME_GROUP) :
        constants.categoryGroups.filter((entry) => entry.group !== INCOME_GROUP)
    return groups.flatMap((entry) => entry.categories)
}

const serializeTransaction = (transaction) => ({
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

module.exports = (config = {}, configDir = process.cwd()) => {
    const resolvePath = (value, fallback) =>
        path.resolve(configDir, typeof value === 'string' && value.trim() !== '' ? value : fallback)
    const workbookFile = resolvePath(config.workbookFile, './mock-data.xlsx')
    const transactionsSheetName = config.transactionsSheet || 'Transactions'
    const constantsSheetName = config.constantsSheet || 'Constants'

    const workbookDirectory = path.dirname(workbookFile)
    if (!fs.existsSync(workbookDirectory)) {
        throw new Error(`Workbook directory not found: ${workbookDirectory}`)
    }
    assertWorkbookRepo(workbookFile)

    const loadWorkbook = async () => {
        if (!fs.existsSync(workbookFile)) {
            throw new Error(`Workbook not found: ${workbookFile}`)
        }
        const workbook = new ExcelJS.Workbook()
        await workbook.xlsx.readFile(workbookFile)
        return workbook
    }

    const saveWorkbook = async (workbook, commitMessage) => {
        const tempFile = `${workbookFile}.tmp`
        await workbook.xlsx.writeFile(tempFile)
        if (fs.existsSync(workbookFile)) {
            fs.copyFileSync(workbookFile, `${workbookFile}.bak`)
        }
        fs.renameSync(tempFile, workbookFile)
        try {
            commitFile(workbookFile, commitMessage)
        } catch (e) {
            console.error(`Failed to commit workbook changes: ${e.message}`)
        }
    }

    const getSheet = (workbook, name, label) => {
        const sheet = workbook.getWorksheet(name)
        if (!sheet) {
            throw new Error(`Workbook is missing the "${name}" ${label} sheet`)
        }
        return sheet
    }

    const readHeaderMap = (sheet) => {
        const map = {}
        sheet.getRow(1).eachCell({ includeEmpty: false }, (cell, column) => {
            const header = normalizeHeader(cellString(cell.value))
            if (header) {
                map[header] = column
            }
        })
        for (const required of ['Date', 'Details', 'Money In', 'Expenses', 'Currency', 'Type']) {
            if (!map[required]) {
                throw new Error(`Transactions sheet is missing the "${required}" column`)
            }
        }
        return map
    }

    const parseTransactionRow = (sheet, map, rowNumber, date1904) => {
        const row = sheet.getRow(rowNumber)
        const details = cellString(row.getCell(map['Details']).value).trim()
        const moneyIn = cellNumber(row.getCell(map['Money In']).value)
        const expenses = cellNumber(row.getCell(map['Expenses']).value)
        if (!details && moneyIn == null && expenses == null) {
            return null
        }
        const date = dateFromCell(row.getCell(map['Date']).value, date1904)
        const transaction = {
            row: rowNumber,
            date,
            dateIso: date ? datePartsToIso(date) : null,
            details,
            moneyIn,
            expenses,
            currency: cellString(row.getCell(map['Currency']).value).trim(),
            category: cellString(row.getCell(map['Type']).value).trim(),
            notes: map['Notes'] ? cellString(row.getCell(map['Notes']).value).trim() : '',
            kind: expenses == null && moneyIn != null ? 'income' : 'expense',
        }
        if (!date) {
            return { ...transaction, invalidDate: true }
        }
        transaction.id = `${rowNumber}-${transactionHash(transaction)}`
        return transaction
    }

    const readTransactions = (sheet, map, date1904) => {
        const transactions = []
        const warnings = []
        for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber++) {
            const transaction = parseTransactionRow(sheet, map, rowNumber, date1904)
            if (!transaction) {
                continue
            }
            if (transaction.invalidDate) {
                warnings.push(`Row ${rowNumber}: missing or invalid date, skipped`)
                continue
            }
            transactions.push(transaction)
        }
        return { transactions, warnings }
    }

    const readConstants = (workbook) => {
        const sheet = getSheet(workbook, constantsSheetName, 'constants')
        const categoryGroups = []
        const currencies = []
        const budgets = {}
        let legacyBudget = null
        sheet.getRow(2).eachCell({ includeEmpty: false }, (cell, column) => {
            const header = normalizeHeader(cellString(cell.value))
            if (!header) {
                return
            }
            if (header === 'Currencies') {
                for (let rowNumber = 3; rowNumber <= sheet.rowCount; rowNumber++) {
                    const value = cellString(sheet.getRow(rowNumber).getCell(column).value).trim()
                    if (!value) {
                        break
                    }
                    currencies.push(value)
                }
                return
            }
            const categories = []
            for (let rowNumber = 3; rowNumber <= sheet.rowCount; rowNumber++) {
                const value = cellString(sheet.getRow(rowNumber).getCell(column).value).trim()
                if (!value) {
                    break
                }
                categories.push(value)
            }
            if (categories.length) {
                categoryGroups.push({ group: header, categories })
            }
        })
        let budgetsLabelRow = -1
        for (let rowNumber = 1; rowNumber <= sheet.rowCount; rowNumber++) {
            const label = normalizeHeader(cellString(sheet.getRow(rowNumber).getCell(1).value))
            if (label === BUDGETS_LABEL && budgetsLabelRow < 0) {
                budgetsLabelRow = rowNumber
            }
        }
        if (budgetsLabelRow > 0) {
            const columns = {}
            sheet.getRow(budgetsLabelRow + 1).eachCell({ includeEmpty: false }, (cell, column) => {
                const header = normalizeHeader(cellString(cell.value))
                if (header) {
                    columns[header] = column
                }
            })
            const currencyColumn = columns[BUDGET_CURRENCY_HEADER] || 1
            const budgetColumn = columns[BUDGET_MONTHLY_LABEL] || currencyColumn + 1
            const biasColumn = columns[BUDGET_BIAS_LABEL] || currencyColumn + 2
            for (let rowNumber = budgetsLabelRow + 2; rowNumber <= sheet.rowCount; rowNumber++) {
                const currency = cellString(sheet.getRow(rowNumber).getCell(currencyColumn).value).trim()
                if (!currency) {
                    break
                }
                budgets[currency] = {
                    monthlyBudget: cellNumber(sheet.getRow(rowNumber).getCell(budgetColumn).value) || 0,
                    firstDayBias: cellNumber(sheet.getRow(rowNumber).getCell(biasColumn).value) || 0,
                }
            }
        }
        for (let rowNumber = 1; rowNumber <= sheet.rowCount; rowNumber++) {
            const label = normalizeHeader(cellString(sheet.getRow(rowNumber).getCell(1).value))
            if (label === BUDGET_MONTHLY_LABEL || label === BUDGET_BIAS_LABEL) {
                legacyBudget = legacyBudget || { monthlyBudget: 0, firstDayBias: 0 }
                const value = cellNumber(sheet.getRow(rowNumber).getCell(2).value) || 0
                if (label === BUDGET_MONTHLY_LABEL) {
                    legacyBudget.monthlyBudget = value
                } else {
                    legacyBudget.firstDayBias = value
                }
            }
        }
        return { categoryGroups, currencies, budgets, legacyBudget }
    }

    const getBudgetForCurrency = (constants, currency) => {
        if (currency && constants.budgets[currency]) {
            return constants.budgets[currency]
        }
        if (currency && currency === constants.currencies[0] && constants.legacyBudget) {
            return constants.legacyBudget
        }
        return { monthlyBudget: 0, firstDayBias: 0 }
    }

    const validateTransactionInput = (constants, input = {}) => {
        if (input.kind !== 'expense' && input.kind !== 'income') {
            throw new ValidationError('Kind must be "expense" or "income"')
        }
        const allowedCategories = categoriesForKind(constants, input.kind)
        const category = typeof input.category === 'string' ? input.category.trim() : ''
        if (!category || !allowedCategories.includes(category)) {
            throw new ValidationError(`Category must be one of the ${input.kind === 'income' ? INCOME_GROUP : 'expense'} categories in the "${constantsSheetName}" sheet`)
        }
        const currency = typeof input.currency === 'string' ? input.currency.trim() : ''
        if (!currency) {
            throw new ValidationError('Currency is required')
        }
        if (constants.currencies.length && !constants.currencies.includes(currency)) {
            throw new ValidationError(`Currency must be one of: ${constants.currencies.join(', ')}`)
        }
        return {
            kind: input.kind,
            amount: validateAmount(input.amount),
            details: validateText(input.details, 'Details', true),
            date: parseDateInput(input.date),
            currency,
            category,
            notes: validateText(input.notes, 'Notes', false),
        }
    }

    const findLastDataRow = (sheet, map) => {
        const hasContent = (row) => ['Date', 'Details', 'Money In', 'Expenses']
            .some((header) => {
                const value = row.getCell(map[header]).value
                return value != null && value !== ''
            })
        let lastRow = Math.max(sheet.rowCount, 1)
        while (lastRow > 1 && !hasContent(sheet.getRow(lastRow))) {
            lastRow--
        }
        return lastRow
    }

    const findTemplateStyles = (sheet, map, fromRow) => {
        const styles = {}
        let height = null
        for (const [header, column] of Object.entries(map)) {
            let style = null
            for (let rowNumber = fromRow; rowNumber >= 2; rowNumber--) {
                const value = sheet.getRow(rowNumber).getCell(column).value
                if (value != null && value !== '') {
                    style = JSON.parse(JSON.stringify(sheet.getRow(rowNumber).getCell(column).style || {}))
                    if (height == null) {
                        height = sheet.getRow(rowNumber).height || null
                    }
                    break
                }
            }
            styles[header] = style || JSON.parse(JSON.stringify(sheet.getColumn(column).style || {}))
        }
        return { styles, height }
    }

    const writeTransaction = (sheet, map, transaction, template) => {
        const row = sheet.getRow(transaction.row)
        const setCell = (header, value) => {
            if (!map[header]) {
                return
            }
            const cell = row.getCell(map[header])
            if (template && template.styles[header]) {
                cell.style = template.styles[header]
            }
            cell.value = value
        }
        setCell('Date', datePartsToUtcDate(transaction.date))
        setCell('Details', transaction.details)
        setCell('Money In', transaction.kind === 'income' ? transaction.amount : null)
        setCell('Expenses', transaction.kind === 'expense' ? transaction.amount : null)
        setCell('Currency', transaction.currency)
        setCell('Type', transaction.category)
        setCell('Notes', transaction.notes || null)
        if (template && template.height) {
            row.height = template.height
        }
    }

    const parseRowInput = (id) => {
        const { row } = parseTransactionId(id)
        return row
    }

    const getData = async (date = new Date()) => {
        const workbook = await loadWorkbook()
        const date1904 = Boolean(workbook.properties.date1904)
        const constants = readConstants(workbook)
        const sheet = getSheet(workbook, transactionsSheetName, 'transactions')
        const map = readHeaderMap(sheet)
        const { transactions, warnings } = readTransactions(sheet, map, date1904)
        const year = date.getFullYear()
        const month = date.getMonth() + 1
        const day = date.getDate()
        const daysInMonth = new Date(year, month, 0).getDate()
        const sameMonth = (transaction, targetYear, targetMonth) =>
            transaction.date.year === targetYear && transaction.date.month === targetMonth
        const sum = (list, key) => Math.round(list.reduce((total, item) => total + Math.round((item[key] || 0) * 100), 0)) / 100
        const previousMonthDate = new Date(year, month - 2, 1)
        const monthTransactions = transactions.filter((transaction) => sameMonth(transaction, year, month))

        const currencies = constants.currencies.map((code, index) => {
            const budget = getBudgetForCurrency(constants, code)
            const inCurrency = (transaction) => transaction.currency === code
            const expenseTransactions = monthTransactions.filter((transaction) =>
                inCurrency(transaction) && transaction.kind === 'expense')
            const incomeTransactions = monthTransactions.filter((transaction) =>
                inCurrency(transaction) && transaction.kind === 'income')
            const monthsSpend = sum(expenseTransactions.filter((transaction) => transaction.date.day <= day), 'expenses')
            const monthsIncome = sum(incomeTransactions.filter((transaction) => transaction.date.day <= day), 'moneyIn')
            let trailingIncomeTotal = 0
            let trailingSpendTotal = 0
            for (let offset = 1; offset <= 12; offset++) {
                const target = new Date(year, month - 1 - offset, 1)
                const targetYear = target.getFullYear()
                const targetMonth = target.getMonth() + 1
                trailingIncomeTotal += sum(transactions.filter((transaction) =>
                    transaction.kind === 'income' &&
                    inCurrency(transaction) &&
                    sameMonth(transaction, targetYear, targetMonth)), 'moneyIn')
                trailingSpendTotal += sum(transactions.filter((transaction) =>
                    transaction.kind === 'expense' &&
                    inCurrency(transaction) &&
                    sameMonth(transaction, targetYear, targetMonth)), 'expenses')
            }
            return {
                code,
                primary: index === 0,
                hasActivity: monthsSpend > 0 || monthsIncome > 0,
                monthlyBudget: budget.monthlyBudget,
                firstDayBias: budget.firstDayBias,
                monthsSpend,
                previousMonthsSpend: sum(transactions.filter((transaction) =>
                    transaction.kind === 'expense' &&
                    inCurrency(transaction) &&
                    sameMonth(transaction, previousMonthDate.getFullYear(), previousMonthDate.getMonth() + 1)), 'expenses'),
                trailingSpendAverage: Math.round((trailingSpendTotal / 12) * 100) / 100,
                monthsIncome,
                previousMonthsIncome: sum(transactions.filter((transaction) =>
                    transaction.kind === 'income' &&
                    inCurrency(transaction) &&
                    sameMonth(transaction, previousMonthDate.getFullYear(), previousMonthDate.getMonth() + 1)), 'moneyIn'),
                trailingIncomeAverage: Math.round((trailingIncomeTotal / 12) * 100) / 100,
                monthsExpectedSpend: getMonthExpectedSpend(budget.monthlyBudget, budget.firstDayBias, day, daysInMonth),
            }
        })

        return {
            currencies,
            categories: constants.categoryGroups,
            warnings,
            writable: true,
            transactions: monthTransactions.map(serializeTransaction),
        }
    }

    const updateMonthlyBudget = async (monthlyBudget, firstDayBias, currency) => {
        const budget = Number.parseFloat(monthlyBudget)
        const bias = Number.parseFloat(firstDayBias)
        if (!Number.isFinite(budget) || budget <= 0 || !Number.isFinite(bias) || bias < 0 || bias > budget) {
            throw new ValidationError('Invalid budget values')
        }
        const currencyCode = typeof currency === 'string' ? currency.trim() : ''
        if (!currencyCode) {
            throw new ValidationError('Currency is required')
        }
        const workbook = await loadWorkbook()
        const constants = readConstants(workbook)
        if (constants.currencies.length && !constants.currencies.includes(currencyCode)) {
            throw new ValidationError('Unknown currency')
        }
        const sheet = getSheet(workbook, constantsSheetName, 'constants')
        const findLabelRow = (label) => {
            for (let rowNumber = 1; rowNumber <= sheet.rowCount; rowNumber++) {
                if (normalizeHeader(cellString(sheet.getRow(rowNumber).getCell(1).value)) === label) {
                    return rowNumber
                }
            }
            return -1
        }
        let labelRow = findLabelRow(BUDGETS_LABEL)
        let currencyColumn = 1
        let budgetColumn = 2
        let biasColumn = 3
        let targetRow
        if (labelRow < 0) {
            labelRow = sheet.rowCount + 2
            sheet.getRow(labelRow).getCell(1).value = BUDGETS_LABEL
            const headerRow = sheet.getRow(labelRow + 1)
            headerRow.getCell(1).value = BUDGET_CURRENCY_HEADER
            headerRow.getCell(2).value = BUDGET_MONTHLY_LABEL
            headerRow.getCell(3).value = BUDGET_BIAS_LABEL
            headerRow.font = { bold: true }
            targetRow = labelRow + 2
        } else {
            const columns = {}
            sheet.getRow(labelRow + 1).eachCell({ includeEmpty: false }, (cell, column) => {
                const header = normalizeHeader(cellString(cell.value))
                if (header) {
                    columns[header] = column
                }
            })
            currencyColumn = columns[BUDGET_CURRENCY_HEADER] || 1
            budgetColumn = columns[BUDGET_MONTHLY_LABEL] || currencyColumn + 1
            biasColumn = columns[BUDGET_BIAS_LABEL] || currencyColumn + 2
            targetRow = -1
            for (let rowNumber = labelRow + 2; rowNumber <= sheet.rowCount; rowNumber++) {
                const value = cellString(sheet.getRow(rowNumber).getCell(currencyColumn).value).trim()
                if (value === currencyCode || !value) {
                    targetRow = rowNumber
                    break
                }
            }
            if (targetRow < 0) {
                targetRow = sheet.rowCount + 1
            }
        }
        const row = sheet.getRow(targetRow)
        row.getCell(currencyColumn).value = currencyCode
        row.getCell(budgetColumn).value = budget
        row.getCell(budgetColumn).numFmt = '#,##0.00'
        row.getCell(biasColumn).value = bias
        row.getCell(biasColumn).numFmt = '#,##0.00'
        await saveWorkbook(workbook, `D$CPLN: update ${currencyCode} budget`)
    }

    const addTransaction = async (input) => {
        const workbook = await loadWorkbook()
        const date1904 = Boolean(workbook.properties.date1904)
        const constants = readConstants(workbook)
        const transaction = validateTransactionInput(constants, input)
        const sheet = getSheet(workbook, transactionsSheetName, 'transactions')
        const map = readHeaderMap(sheet)
        const lastRow = findLastDataRow(sheet, map)
        const template = findTemplateStyles(sheet, map, lastRow)
        const row = lastRow + 1
        writeTransaction(sheet, map, { ...transaction, row }, template)
        await saveWorkbook(workbook, 'D$CPLN: add transaction')
        const stored = parseTransactionRow(sheet, map, row, date1904)
        return serializeTransaction(stored)
    }

    const updateTransaction = async (id, input) => {
        const rowNumber = parseRowInput(id)
        const workbook = await loadWorkbook()
        const date1904 = Boolean(workbook.properties.date1904)
        const constants = readConstants(workbook)
        const transaction = validateTransactionInput(constants, input)
        const sheet = getSheet(workbook, transactionsSheetName, 'transactions')
        const map = readHeaderMap(sheet)
        if (rowNumber < 2 || rowNumber > sheet.rowCount) {
            throw new ConflictError('This transaction changed on disk. Refresh and try again.')
        }
        const existing = parseTransactionRow(sheet, map, rowNumber, date1904)
        if (!existing || existing.invalidDate || existing.id !== id) {
            throw new ConflictError('This transaction changed on disk. Refresh and try again.')
        }
        writeTransaction(sheet, map, { ...transaction, row: rowNumber }, null)
        await saveWorkbook(workbook, 'D$CPLN: update transaction')
        const stored = parseTransactionRow(sheet, map, rowNumber, date1904)
        return serializeTransaction(stored)
    }

    const deleteTransaction = async (id) => {
        const rowNumber = parseRowInput(id)
        const workbook = await loadWorkbook()
        const date1904 = Boolean(workbook.properties.date1904)
        const sheet = getSheet(workbook, transactionsSheetName, 'transactions')
        const map = readHeaderMap(sheet)
        if (rowNumber < 2 || rowNumber > sheet.rowCount) {
            throw new ConflictError('This transaction changed on disk. Refresh and try again.')
        }
        const existing = parseTransactionRow(sheet, map, rowNumber, date1904)
        if (!existing || existing.invalidDate || existing.id !== id) {
            throw new ConflictError('This transaction changed on disk. Refresh and try again.')
        }
        sheet.spliceRows(rowNumber, 1)
        await saveWorkbook(workbook, 'D$CPLN: delete transaction')
    }

    const suggestCategories = async (description, kind) => {
        const query = typeof description === 'string' ? description.trim() : ''
        if (!query) {
            return { confident: false, suggestions: [] }
        }
        if (kind !== 'expense' && kind !== 'income') {
            throw new ValidationError('Kind must be "expense" or "income"')
        }
        const workbook = await loadWorkbook()
        const date1904 = Boolean(workbook.properties.date1904)
        const constants = readConstants(workbook)
        const sheet = getSheet(workbook, transactionsSheetName, 'transactions')
        const map = readHeaderMap(sheet)
        const { transactions } = readTransactions(sheet, map, date1904)
        const allowed = new Set(categoriesForKind(constants, kind))
        const samples = transactions
            .filter((transaction) => transaction.category && allowed.has(transaction.category))
            .map((transaction) => ({
                details: transaction.details,
                category: transaction.category,
                date: datePartsToUtcDate(transaction.date),
            }))
        return computeSuggestions(query, samples)
    }

    return {
        getData,
        updateMonthlyBudget,
        addTransaction,
        updateTransaction,
        deleteTransaction,
        suggestCategories,
    }
}
