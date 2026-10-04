'use strict'

// Excel workbook provider.
// All providers must implement getData and updateMonthlyBudget, and may implement
// addTransaction, updateTransaction, deleteTransaction, and suggestCategories.
//
// Transactions sheet (headers in row 1, mapped by name):
//   Date | Details | Money In | Expenses | Currency | Type | Notes
// Constants sheet (headers in row 2, one category list per column) plus a
// Currencies column and a Budgets section (labels in column A, values to the right).
//
// Parsed data is cached per provider keyed by the workbook's mtime+size, and
// concurrent loads share a single in-flight parse. Rows are always iterated with
// worksheet.eachRow so files with an inflated dimension (e.g. LibreOffice writing
// A1:AMK1048576) don't cause million-row loops.

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

// Trims floating point noise without forcing a fixed number of decimals, so
// tiny amounts (e.g. fractional XMR) keep their precision.
const cleanAmount = (value) => Number.parseFloat(Number(value).toPrecision(12))

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
        return Number.isFinite(value) ? value : null
    }
    const text = String(value).trim().replace(/,/g, '')
    if (text === '') {
        return null
    }
    const parsed = Number(text)
    return Number.isFinite(parsed) ? parsed : null
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

const MAX_AMOUNT_DECIMALS = 12

const validateAmount = (value) => {
    const amount = Number.parseFloat(value)
    if (!Number.isFinite(amount) || amount <= 0) {
        throw new ValidationError('Amount must be greater than 0')
    }
    const scaled = amount * (10 ** MAX_AMOUNT_DECIMALS)
    if (Math.abs(scaled - Math.round(scaled)) > 1e-6) {
        throw new ValidationError(`Amount can have at most ${MAX_AMOUNT_DECIMALS} decimal places`)
    }
    return Number.parseFloat(amount.toFixed(MAX_AMOUNT_DECIMALS))
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

    let parsedCache = null
    let parseInFlight = null

    const loadWorkbook = async () => {
        if (!fs.existsSync(workbookFile)) {
            throw new Error(`Workbook not found: ${workbookFile}`)
        }
        const workbook = new ExcelJS.Workbook()
        await workbook.xlsx.readFile(workbookFile)
        return workbook
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

    const parseTransactionRow = (row, map, rowNumber, date1904) => {
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
        sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
            if (rowNumber === 1) {
                return
            }
            const transaction = parseTransactionRow(row, map, rowNumber, date1904)
            if (!transaction) {
                return
            }
            if (transaction.invalidDate) {
                warnings.push(`Row ${rowNumber}: missing or invalid date, skipped`)
                return
            }
            transactions.push(transaction)
        })
        return { transactions, warnings }
    }

    const readConstants = (workbook) => {
        const sheet = getSheet(workbook, constantsSheetName, 'constants')
        const categoryGroups = []
        const currencies = []
        const budgets = {}
        let legacyBudget = null
        let budgetsLabelRow = -1

        const columns = []
        sheet.getRow(2).eachCell({ includeEmpty: false }, (cell, column) => {
            const header = normalizeHeader(cellString(cell.value))
            if (header) {
                columns.push({ header, column, values: [], stopped: false })
            }
        })
        let previousRow = 0
        sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
            if (rowNumber > 2) {
                if (previousRow >= 2 && rowNumber > previousRow + 1) {
                    for (const entry of columns) {
                        entry.stopped = true
                    }
                }
                for (const entry of columns) {
                    if (entry.stopped) {
                        continue
                    }
                    const value = cellString(row.getCell(entry.column).value).trim()
                    if (!value) {
                        entry.stopped = true
                        continue
                    }
                    entry.values.push(value)
                }
            }
            const label = normalizeHeader(cellString(row.getCell(1).value))
            if (label === BUDGETS_LABEL && budgetsLabelRow < 0) {
                budgetsLabelRow = rowNumber
            }
            if (label === BUDGET_MONTHLY_LABEL || label === BUDGET_BIAS_LABEL) {
                legacyBudget = legacyBudget || { monthlyBudget: 0, firstDayBias: 0 }
                const value = cellNumber(row.getCell(2).value) || 0
                if (label === BUDGET_MONTHLY_LABEL) {
                    legacyBudget.monthlyBudget = value
                } else {
                    legacyBudget.firstDayBias = value
                }
            }
            previousRow = rowNumber
        })
        for (const entry of columns) {
            if (entry.header === 'Currencies') {
                currencies.push(...entry.values)
            } else if (entry.values.length) {
                categoryGroups.push({ group: entry.header, categories: entry.values })
            }
        }

        if (budgetsLabelRow > 0) {
            const columnsByHeader = {}
            sheet.getRow(budgetsLabelRow + 1).eachCell({ includeEmpty: false }, (cell, column) => {
                const header = normalizeHeader(cellString(cell.value))
                if (header) {
                    columnsByHeader[header] = column
                }
            })
            const currencyColumn = columnsByHeader[BUDGET_CURRENCY_HEADER] || 1
            const budgetColumn = columnsByHeader[BUDGET_MONTHLY_LABEL] || currencyColumn + 1
            const biasColumn = columnsByHeader[BUDGET_BIAS_LABEL] || currencyColumn + 2
            let scanning = true
            sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
                if (!scanning || rowNumber <= budgetsLabelRow + 1) {
                    return
                }
                const currency = cellString(row.getCell(currencyColumn).value).trim()
                if (!currency) {
                    scanning = false
                    return
                }
                budgets[currency] = {
                    monthlyBudget: cellNumber(row.getCell(budgetColumn).value) || 0,
                    firstDayBias: cellNumber(row.getCell(biasColumn).value) || 0,
                }
            })
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

    // Monthly totals in cents keyed by `${currency}|${year}|${month}`.
    const buildMonthlyTotals = (transactions) => {
        const monthly = new Map()
        for (const transaction of transactions) {
            const key = `${transaction.currency}|${transaction.date.year}|${transaction.date.month}`
            let entry = monthly.get(key)
            if (!entry) {
                entry = { spend: 0, income: 0 }
                monthly.set(key, entry)
            }
            if (transaction.kind === 'income') {
                entry.income += transaction.moneyIn || 0
            } else {
                entry.spend += transaction.expenses || 0
            }
        }
        return monthly
    }

    const buildSamples = (transactions, constants, kind) => {
        const allowed = new Set(categoriesForKind(constants, kind))
        return transactions
            .filter((transaction) => transaction.category && allowed.has(transaction.category))
            .map((transaction) => ({
                details: transaction.details,
                category: transaction.category,
                date: datePartsToUtcDate(transaction.date),
            }))
    }

    const parseWorkbook = (workbook) => {
        const date1904 = Boolean(workbook.properties.date1904)
        const constants = readConstants(workbook)
        const sheet = getSheet(workbook, transactionsSheetName, 'transactions')
        const headerMap = readHeaderMap(sheet)
        const { transactions, warnings } = readTransactions(sheet, headerMap, date1904)
        return {
            date1904,
            headerMap,
            constants,
            transactions,
            warnings,
            monthly: buildMonthlyTotals(transactions),
            samplesByKind: {
                expense: buildSamples(transactions, constants, 'expense'),
                income: buildSamples(transactions, constants, 'income'),
            },
        }
    }

    const getParsed = async () => {
        let stat
        try {
            stat = fs.statSync(workbookFile)
        } catch (e) {
            throw new Error(`Workbook not found: ${workbookFile}`)
        }
        if (parsedCache && parsedCache.mtimeMs === stat.mtimeMs && parsedCache.size === stat.size) {
            return parsedCache
        }
        if (parseInFlight) {
            return parseInFlight
        }
        parseInFlight = (async () => {
            try {
                const workbook = await loadWorkbook()
                const parsed = parseWorkbook(workbook)
                const freshStat = fs.statSync(workbookFile)
                parsedCache = { ...parsed, mtimeMs: freshStat.mtimeMs, size: freshStat.size }
                return parsedCache
            } finally {
                parseInFlight = null
            }
        })()
        return parseInFlight
    }

    const cacheFromWorkbook = (workbook) => {
        try {
            const parsed = parseWorkbook(workbook)
            const stat = fs.statSync(workbookFile)
            parsedCache = { ...parsed, mtimeMs: stat.mtimeMs, size: stat.size }
        } catch (e) {
            parsedCache = null
        }
    }

    const saveWorkbook = async (workbook, commitMessage) => {
        const tempFile = `${workbookFile}.tmp`
        await workbook.xlsx.writeFile(tempFile)
        if (fs.existsSync(workbookFile)) {
            fs.copyFileSync(workbookFile, `${workbookFile}.bak`)
        }
        fs.renameSync(tempFile, workbookFile)
        cacheFromWorkbook(workbook)
        try {
            commitFile(workbookFile, commitMessage)
        } catch (e) {
            console.error(`Failed to commit workbook changes: ${e.message}`)
        }
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

    const rowHasTransactionContent = (row, map) => ['Date', 'Details', 'Money In', 'Expenses']
        .some((header) => {
            const value = row.getCell(map[header]).value
            return value != null && value !== ''
        })

    const findLastDataRow = (sheet, map) => {
        let lastRow = 1
        sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
            if (rowNumber > 1 && rowNumber > lastRow && rowHasTransactionContent(row, map)) {
                lastRow = rowNumber
            }
        })
        return lastRow
    }

    const findTemplateStyles = (sheet, map) => {
        const cells = {}
        let height = null
        sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
            if (rowNumber === 1) {
                return
            }
            let hasContent = false
            for (const [header, column] of Object.entries(map)) {
                const cell = row.getCell(column)
                if (cell.value != null && cell.value !== '') {
                    cells[header] = cell
                    hasContent = true
                }
            }
            if (hasContent) {
                height = row.height || height
            }
        })
        const styles = {}
        for (const [header, column] of Object.entries(map)) {
            styles[header] = cells[header] ?
                JSON.parse(JSON.stringify(cells[header].style || {})) :
                JSON.parse(JSON.stringify(sheet.getColumn(column).style || {}))
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

    const findTransactionRow = (sheet, map, rowNumber, date1904, id) => {
        const row = sheet.findRow(rowNumber)
        if (!row) {
            throw new ConflictError('This transaction changed on disk. Refresh and try again.')
        }
        const existing = parseTransactionRow(row, map, rowNumber, date1904)
        if (!existing || existing.invalidDate || existing.id !== id) {
            throw new ConflictError('This transaction changed on disk. Refresh and try again.')
        }
        return row
    }

    const getData = async (date = new Date()) => {
        const parsed = await getParsed()
        const { constants, transactions, monthly, warnings } = parsed
        const year = date.getFullYear()
        const month = date.getMonth() + 1
        const day = date.getDate()
        const daysInMonth = new Date(year, month, 0).getDate()
        const previousMonthDate = new Date(year, month - 2, 1)
        const previousYear = previousMonthDate.getFullYear()
        const previousMonth = previousMonthDate.getMonth() + 1
        const monthTransactions = transactions.filter((transaction) =>
            transaction.date.year === year && transaction.date.month === month)

        const currentByCurrency = new Map()
        for (const transaction of monthTransactions) {
            if (transaction.date.day > day) {
                continue
            }
            let entry = currentByCurrency.get(transaction.currency)
            if (!entry) {
                entry = { spend: 0, income: 0 }
                currentByCurrency.set(transaction.currency, entry)
            }
            if (transaction.kind === 'income') {
                entry.income += transaction.moneyIn || 0
            } else {
                entry.spend += transaction.expenses || 0
            }
        }

        const currencies = constants.currencies.map((code, index) => {
            const budget = getBudgetForCurrency(constants, code)
            const current = currentByCurrency.get(code) || { spend: 0, income: 0 }
            let trailingSpendCents = 0
            let trailingIncomeCents = 0
            for (let offset = 1; offset <= 12; offset++) {
                const target = new Date(year, month - 1 - offset, 1)
                const entry = monthly.get(`${code}|${target.getFullYear()}|${target.getMonth() + 1}`)
                if (entry) {
                    trailingSpendCents += entry.spend
                    trailingIncomeCents += entry.income
                }
            }
            const previous = monthly.get(`${code}|${previousYear}|${previousMonth}`) || { spend: 0, income: 0 }
            const monthsSpend = cleanAmount(current.spend)
            const monthsIncome = cleanAmount(current.income)
            return {
                code,
                primary: index === 0,
                hasActivity: monthsSpend > 0 || monthsIncome > 0,
                monthlyBudget: budget.monthlyBudget,
                firstDayBias: budget.firstDayBias,
                monthsSpend,
                previousMonthsSpend: cleanAmount(previous.spend),
                trailingSpendAverage: cleanAmount(trailingSpendCents / 12),
                monthsIncome,
                previousMonthsIncome: cleanAmount(previous.income),
                trailingIncomeAverage: cleanAmount(trailingIncomeCents / 12),
                monthsExpectedSpend: getMonthExpectedSpend(budget.monthlyBudget, budget.firstDayBias, day, daysInMonth),
            }
        })

        const history = []
        for (let offset = 11; offset >= 0; offset--) {
            const target = new Date(year, month - 1 - offset, 1)
            const targetYear = target.getFullYear()
            const targetMonth = target.getMonth() + 1
            const currencyTotals = {}
            for (const code of constants.currencies) {
                const entry = monthly.get(`${code}|${targetYear}|${targetMonth}`) || { spend: 0, income: 0 }
                currencyTotals[code] = {
                    spend: cleanAmount(entry.spend),
                    income: cleanAmount(entry.income),
                }
            }
            history.push({ year: targetYear, month: targetMonth, currencies: currencyTotals })
        }

        return {
            currencies,
            categories: constants.categoryGroups,
            history,
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

        let budgetsLabelRow = -1
        let lastUsedRow = 1
        sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
            lastUsedRow = Math.max(lastUsedRow, rowNumber)
            if (normalizeHeader(cellString(row.getCell(1).value)) === BUDGETS_LABEL && budgetsLabelRow < 0) {
                budgetsLabelRow = rowNumber
            }
        })

        let currencyColumn = 1
        let budgetColumn = 2
        let biasColumn = 3
        let targetRow
        if (budgetsLabelRow < 0) {
            budgetsLabelRow = lastUsedRow + 2
            sheet.getRow(budgetsLabelRow).getCell(1).value = BUDGETS_LABEL
            const headerRow = sheet.getRow(budgetsLabelRow + 1)
            headerRow.getCell(1).value = BUDGET_CURRENCY_HEADER
            headerRow.getCell(2).value = BUDGET_MONTHLY_LABEL
            headerRow.getCell(3).value = BUDGET_BIAS_LABEL
            headerRow.font = { bold: true }
            targetRow = budgetsLabelRow + 2
        } else {
            const columns = {}
            sheet.getRow(budgetsLabelRow + 1).eachCell({ includeEmpty: false }, (cell, column) => {
                const header = normalizeHeader(cellString(cell.value))
                if (header) {
                    columns[header] = column
                }
            })
            currencyColumn = columns[BUDGET_CURRENCY_HEADER] || 1
            budgetColumn = columns[BUDGET_MONTHLY_LABEL] || currencyColumn + 1
            biasColumn = columns[BUDGET_BIAS_LABEL] || currencyColumn + 2
            targetRow = -1
            let lastBudgetRow = budgetsLabelRow + 1
            let scanning = true
            sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
                if (!scanning || rowNumber <= budgetsLabelRow + 1) {
                    return
                }
                const value = cellString(row.getCell(currencyColumn).value).trim()
                if (!value) {
                    scanning = false
                    return
                }
                lastBudgetRow = rowNumber
                if (value === currencyCode && targetRow < 0) {
                    targetRow = rowNumber
                }
            })
            if (targetRow < 0) {
                targetRow = lastBudgetRow + 1
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
        const template = findTemplateStyles(sheet, map)
        const row = lastRow + 1
        writeTransaction(sheet, map, { ...transaction, row }, template)
        await saveWorkbook(workbook, 'D$CPLN: add transaction')
        const stored = parseTransactionRow(sheet.getRow(row), map, row, date1904)
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
        findTransactionRow(sheet, map, rowNumber, date1904, id)
        writeTransaction(sheet, map, { ...transaction, row: rowNumber }, null)
        await saveWorkbook(workbook, 'D$CPLN: update transaction')
        const stored = parseTransactionRow(sheet.getRow(rowNumber), map, rowNumber, date1904)
        return serializeTransaction(stored)
    }

    const deleteTransaction = async (id) => {
        const rowNumber = parseRowInput(id)
        const workbook = await loadWorkbook()
        const date1904 = Boolean(workbook.properties.date1904)
        const sheet = getSheet(workbook, transactionsSheetName, 'transactions')
        const map = readHeaderMap(sheet)
        findTransactionRow(sheet, map, rowNumber, date1904, id)
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
        const parsed = await getParsed()
        return computeSuggestions(query, parsed.samplesByKind[kind])
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
