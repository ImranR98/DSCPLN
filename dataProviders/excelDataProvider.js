'use strict'

// Excel workbook provider.
// Providers must implement getData; the app optionally uses updateMonthlyBudget,
// getTransactions, addTransaction, importTransactions, updateTransaction,
// deleteTransaction, suggestCategories and suggestDetails.
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
const { suggestCategories: computeSuggestions } = require('../category-suggester')
const { assertWorkbookRepo, commitFile } = require('../workbook-git')

const INCOME_GROUP = 'Money In'
const CONVERSION_GROUP = 'Conversions'
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

const hasSubCentPrecision = (value) => {
    const amount = Number(value)
    return Number.isFinite(amount) && Math.abs(amount * 100 - Math.round(amount * 100)) > 1e-6
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

// Categories in the "Conversions" group are transfers between currencies: they
// are valid for both kinds and are tracked separately from spend/income.
const categoriesForKind = (constants, kind) => {
    const groups = kind === 'income' ?
        constants.categoryGroups.filter((entry) => entry.group === INCOME_GROUP || entry.group === CONVERSION_GROUP) :
        constants.categoryGroups.filter((entry) => entry.group !== INCOME_GROUP)
    return groups.flatMap((entry) => entry.categories)
}

const conversionCategoriesFor = (constants) => {
    const group = constants.categoryGroups.find((entry) => entry.group === CONVERSION_GROUP)
    return new Set(group ? group.categories : [])
}

const TRANSACTION_HEADERS = ['Date', 'Details', 'Money In', 'Expenses', 'Currency', 'Type', 'Notes']
const MAX_IMPORT_ROWS = 1000
const MAX_IMPORT_TEXT_LENGTH = 200 * 1024

const parseImportLines = (text) => {
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

const parseImportAmount = (value, label) => {
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
const parseImportLine = (line, orderedHeaders) => {
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
            return null
        }
        transaction.id = `${rowNumber}-${transactionHash(transaction)}`
        return transaction
    }

    const readTransactions = (sheet, map, date1904) => {
        const transactions = []
        sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
            if (rowNumber === 1) {
                return
            }
            const transaction = parseTransactionRow(row, map, rowNumber, date1904)
            if (transaction) {
                transactions.push(transaction)
            }
        })
        return transactions
    }

    // The Budgets table sits below the category lists: a label row, a header
    // row, then one currency per row until the first blank currency cell.
    const budgetColumns = (sheet, budgetsLabelRow) => {
        const columns = {}
        sheet.getRow(budgetsLabelRow + 1).eachCell({ includeEmpty: false }, (cell, column) => {
            const header = normalizeHeader(cellString(cell.value))
            if (header) {
                columns[header] = column
            }
        })
        const currencyColumn = columns[BUDGET_CURRENCY_HEADER] || 1
        return {
            currencyColumn,
            budgetColumn: columns[BUDGET_MONTHLY_LABEL] || currencyColumn + 1,
            biasColumn: columns[BUDGET_BIAS_LABEL] || currencyColumn + 2,
        }
    }

    const eachBudgetRow = (sheet, budgetsLabelRow, columns, callback) => {
        let scanning = true
        sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
            if (!scanning || rowNumber <= budgetsLabelRow + 1) {
                return
            }
            const currency = cellString(row.getCell(columns.currencyColumn).value).trim()
            if (!currency) {
                scanning = false
                return
            }
            callback(currency, row, rowNumber)
        })
    }

    const readConstants = (workbook) => {
        const sheet = getSheet(workbook, constantsSheetName, 'constants')
        const categoryGroups = []
        const currencies = []
        const budgets = {}
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
            if (normalizeHeader(cellString(row.getCell(1).value)) === BUDGETS_LABEL && budgetsLabelRow < 0) {
                budgetsLabelRow = rowNumber
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
            const columns = budgetColumns(sheet, budgetsLabelRow)
            eachBudgetRow(sheet, budgetsLabelRow, columns, (currency, row) => {
                budgets[currency] = {
                    monthlyBudget: cellNumber(row.getCell(columns.budgetColumn).value) || 0,
                    firstDayBias: cellNumber(row.getCell(columns.biasColumn).value) || 0,
                }
            })
        }
        return { categoryGroups, currencies, budgets }
    }

    const getBudgetForCurrency = (constants, currency) =>
        (currency && constants.budgets[currency]) || { monthlyBudget: 0, firstDayBias: 0 }

    const emptyTotals = () => ({ spend: 0, income: 0, convertedOut: 0, convertedIn: 0 })

    // Conversions are kept in their own buckets so they never count as
    // spend or income.
    const addTransactionToBuckets = (entry, transaction, isConversion) => {
        if (transaction.kind === 'income') {
            if (isConversion) {
                entry.convertedIn += transaction.moneyIn || 0
            } else {
                entry.income += transaction.moneyIn || 0
            }
        } else if (isConversion) {
            entry.convertedOut += transaction.expenses || 0
        } else {
            entry.spend += transaction.expenses || 0
        }
    }

    // Monthly totals keyed by `${currency}|${year}|${month}`.
    const buildMonthlyTotals = (transactions, conversionCategories) => {
        const monthly = new Map()
        for (const transaction of transactions) {
            const key = `${transaction.currency}|${transaction.date.year}|${transaction.date.month}`
            let entry = monthly.get(key)
            if (!entry) {
                entry = emptyTotals()
                monthly.set(key, entry)
            }
            addTransactionToBuckets(entry, transaction, conversionCategories.has(transaction.category))
        }
        return monthly
    }

    const buildTransactionRange = (transactions) => ({
        first: transactions.reduce((min, transaction) => (min == null || transaction.dateIso < min ? transaction.dateIso : min), null),
        last: transactions.reduce((max, transaction) => (max == null || transaction.dateIso > max ? transaction.dateIso : max), null),
    })

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
        const transactions = readTransactions(sheet, headerMap, date1904)
        const conversionCategories = conversionCategoriesFor(constants)
        return {
            date1904,
            headerMap,
            constants,
            transactions,
            monthly: buildMonthlyTotals(transactions, conversionCategories),
            conversionCategories,
            transactionRange: buildTransactionRange(transactions),
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
            throw new ValidationError(`Category must be one of the ${input.kind} categories in the "${constantsSheetName}" sheet`)
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
        if (!existing || existing.id !== id) {
            throw new ConflictError('This transaction changed on disk. Refresh and try again.')
        }
        return row
    }

    // Current-month totals per currency, ignoring days after the viewed date.
    const buildCurrentTotals = (monthTransactions, day, conversionCategories) => {
        const totals = new Map()
        for (const transaction of monthTransactions) {
            if (transaction.date.day > day) {
                continue
            }
            let entry = totals.get(transaction.currency)
            if (!entry) {
                entry = emptyTotals()
                totals.set(transaction.currency, entry)
            }
            addTransactionToBuckets(entry, transaction, conversionCategories.has(transaction.category))
        }
        return totals
    }

    // Per-currency current, previous-month and 12-month-trailing stats.
    const buildCurrencyStats = (constants, monthly, currentByCurrency, date, daysInMonth) => {
        const year = date.getFullYear()
        const month = date.getMonth() + 1
        const day = date.getDate()
        const previousMonthDate = new Date(year, month - 2, 1)
        const previousYear = previousMonthDate.getFullYear()
        const previousMonth = previousMonthDate.getMonth() + 1
        return constants.currencies.map((code, index) => {
            const budget = getBudgetForCurrency(constants, code)
            const current = currentByCurrency.get(code) || emptyTotals()
            const trailing = emptyTotals()
            for (let offset = 1; offset <= 12; offset++) {
                const target = new Date(year, month - 1 - offset, 1)
                const entry = monthly.get(`${code}|${target.getFullYear()}|${target.getMonth() + 1}`)
                if (entry) {
                    trailing.spend += entry.spend
                    trailing.income += entry.income
                    trailing.convertedOut += entry.convertedOut
                    trailing.convertedIn += entry.convertedIn
                }
            }
            const previous = monthly.get(`${code}|${previousYear}|${previousMonth}`) || emptyTotals()
            const monthsSpend = cleanAmount(current.spend)
            const monthsIncome = cleanAmount(current.income)
            const monthsConvertedOut = cleanAmount(current.convertedOut)
            const monthsConvertedIn = cleanAmount(current.convertedIn)
            return {
                code,
                primary: index === 0,
                hasActivity: monthsSpend > 0 || monthsIncome > 0 || monthsConvertedOut > 0 || monthsConvertedIn > 0,
                monthlyBudget: budget.monthlyBudget,
                firstDayBias: budget.firstDayBias,
                monthsSpend,
                previousMonthsSpend: cleanAmount(previous.spend),
                trailingSpendAverage: cleanAmount(trailing.spend / 12),
                monthsIncome,
                previousMonthsIncome: cleanAmount(previous.income),
                trailingIncomeAverage: cleanAmount(trailing.income / 12),
                monthsConvertedOut,
                previousMonthsConvertedOut: cleanAmount(previous.convertedOut),
                trailingConvertedOutAverage: cleanAmount(trailing.convertedOut / 12),
                monthsConvertedIn,
                previousMonthsConvertedIn: cleanAmount(previous.convertedIn),
                trailingConvertedInAverage: cleanAmount(trailing.convertedIn / 12),
                monthsExpectedSpend: getMonthExpectedSpend(budget.monthlyBudget, budget.firstDayBias, day, daysInMonth),
            }
        })
    }

    // The last 12 months of per-currency totals, oldest first. The viewed month
    // is capped at the viewed day (matching the month figures) and flagged as
    // partial when it is not over yet.
    const buildHistory = (constants, monthly, currentByCurrency, date, daysInMonth) => {
        const year = date.getFullYear()
        const month = date.getMonth() + 1
        const day = date.getDate()
        const history = []
        for (let offset = 11; offset >= 0; offset--) {
            const target = new Date(year, month - 1 - offset, 1)
            const targetYear = target.getFullYear()
            const targetMonth = target.getMonth() + 1
            const isCurrentMonth = offset === 0
            const currencyTotals = {}
            for (const code of constants.currencies) {
                const entry = isCurrentMonth ?
                    (currentByCurrency.get(code) || emptyTotals()) :
                    (monthly.get(`${code}|${targetYear}|${targetMonth}`) || emptyTotals())
                currencyTotals[code] = {
                    spend: cleanAmount(entry.spend),
                    income: cleanAmount(entry.income),
                    convertedOut: cleanAmount(entry.convertedOut),
                    convertedIn: cleanAmount(entry.convertedIn),
                }
            }
            history.push({
                year: targetYear,
                month: targetMonth,
                partial: isCurrentMonth && day < daysInMonth,
                currencies: currencyTotals,
            })
        }
        return history
    }

    const getData = async (date = new Date()) => {
        const parsed = await getParsed()
        const { constants, transactions, monthly, headerMap, conversionCategories, transactionRange } = parsed
        const year = date.getFullYear()
        const month = date.getMonth() + 1
        const day = date.getDate()
        const daysInMonth = new Date(year, month, 0).getDate()
        // Newest first for the transactions list: by date, then by workbook row.
        const monthTransactions = transactions
            .filter((transaction) => transaction.date.year === year && transaction.date.month === month)
            .sort((a, b) => (a.dateIso === b.dateIso ? b.row - a.row : a.dateIso < b.dateIso ? 1 : -1))

        const fractional = new Set()
        for (const transaction of transactions) {
            if (hasSubCentPrecision(transaction.moneyIn) || hasSubCentPrecision(transaction.expenses)) {
                fractional.add(transaction.currency)
            }
        }
        const currentByCurrency = buildCurrentTotals(monthTransactions, day, conversionCategories)
        const currencies = buildCurrencyStats(constants, monthly, currentByCurrency, date, daysInMonth)
            .map((entry) => ({ ...entry, fractional: fractional.has(entry.code) }))
        const history = buildHistory(constants, monthly, currentByCurrency, date, daysInMonth)
        return {
            currencies,
            categories: constants.categoryGroups,
            conversionCategories: [...conversionCategories],
            transactionRange,
            transactionColumns: Object.entries(headerMap)
                .sort((a, b) => a[1] - b[1])
                .map(([header]) => header),
            history,
            writable: true,
            transactions: monthTransactions.map(serializeTransaction),
        }
    }

    // Returns serialized transactions whose date falls within [start, end]
    // (inclusive), sorted by date then workbook row.
    const getTransactions = async (start, end) => {
        const startDate = parseDateInput(start)
        const endDate = parseDateInput(end)
        const startIso = datePartsToIso(startDate)
        const endIso = datePartsToIso(endDate)
        if (startIso > endIso) {
            throw new ValidationError('Start date must not be after the end date')
        }
        const parsed = await getParsed()
        return {
            start: startIso,
            end: endIso,
            transactions: parsed.transactions
                .filter((transaction) => transaction.dateIso >= startIso && transaction.dateIso <= endIso)
                .sort((a, b) => (a.dateIso === b.dateIso ? a.row - b.row : a.dateIso < b.dateIso ? -1 : 1))
                .map(serializeTransaction),
        }
    }

    const updateMonthlyBudget = async (monthlyBudget, firstDayBias, currency) => {
        const budget = Number.parseFloat(monthlyBudget)
        const bias = Number.parseFloat(firstDayBias)
        if (!Number.isFinite(budget) || budget < 0 || !Number.isFinite(bias) || bias < 0 || bias > budget) {
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

        let columns
        let targetRow
        if (budgetsLabelRow < 0) {
            budgetsLabelRow = lastUsedRow + 2
            columns = { currencyColumn: 1, budgetColumn: 2, biasColumn: 3 }
            sheet.getRow(budgetsLabelRow).getCell(1).value = BUDGETS_LABEL
            const headerRow = sheet.getRow(budgetsLabelRow + 1)
            headerRow.getCell(columns.currencyColumn).value = BUDGET_CURRENCY_HEADER
            headerRow.getCell(columns.budgetColumn).value = BUDGET_MONTHLY_LABEL
            headerRow.getCell(columns.biasColumn).value = BUDGET_BIAS_LABEL
            headerRow.font = { bold: true }
            targetRow = budgetsLabelRow + 2
        } else {
            columns = budgetColumns(sheet, budgetsLabelRow)
            targetRow = -1
            let lastBudgetRow = budgetsLabelRow + 1
            eachBudgetRow(sheet, budgetsLabelRow, columns, (value, row, rowNumber) => {
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
        row.getCell(columns.currencyColumn).value = currencyCode
        row.getCell(columns.budgetColumn).value = budget
        row.getCell(columns.budgetColumn).numFmt = '#,##0.00'
        row.getCell(columns.biasColumn).value = bias
        row.getCell(columns.biasColumn).numFmt = '#,##0.00'
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

    // Imports tab-separated rows positionally matched to the Transactions
    // sheet's header row. Every line is validated before anything is written,
    // so an invalid line rejects the whole batch.
    const importTransactions = async (text) => {
        const workbook = await loadWorkbook()
        const date1904 = Boolean(workbook.properties.date1904)
        const constants = readConstants(workbook)
        const sheet = getSheet(workbook, transactionsSheetName, 'transactions')
        const map = readHeaderMap(sheet)
        const orderedHeaders = Object.entries(map)
            .sort((a, b) => a[1] - b[1])
            .map(([header]) => header)
        const lines = parseImportLines(text)

        const transactions = []
        const errors = []
        for (const line of lines) {
            try {
                transactions.push(validateTransactionInput(constants, parseImportLine(line, orderedHeaders)))
            } catch (e) {
                if (e instanceof ValidationError) {
                    errors.push(`Line ${line.number}: ${e.message}`)
                    continue
                }
                throw e
            }
        }
        if (errors.length) {
            throw new ValidationError(`Import failed:\n${errors.join('\n')}`)
        }

        const lastRow = findLastDataRow(sheet, map)
        const template = findTemplateStyles(sheet, map)
        const stored = []
        transactions.forEach((transaction, index) => {
            const row = lastRow + 1 + index
            writeTransaction(sheet, map, { ...transaction, row }, template)
            stored.push(parseTransactionRow(sheet.getRow(row), map, row, date1904))
        })
        const count = stored.length
        await saveWorkbook(workbook, `D$CPLN: import ${count} transaction${count === 1 ? '' : 's'}`)
        return { imported: count, transactions: stored.map(serializeTransaction) }
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

    // Rewrites only the Type cell, for the narrow post-create category
    // correction the external API exposes.
    const reassignCategory = async (id, newCategory) => {
        const rowNumber = parseRowInput(id)
        const workbook = await loadWorkbook()
        const date1904 = Boolean(workbook.properties.date1904)
        const constants = readConstants(workbook)
        const sheet = getSheet(workbook, transactionsSheetName, 'transactions')
        const map = readHeaderMap(sheet)
        const row = findTransactionRow(sheet, map, rowNumber, date1904, id)
        const existing = parseTransactionRow(row, map, rowNumber, date1904)
        const category = typeof newCategory === 'string' ? newCategory.trim() : ''
        if (!category || !categoriesForKind(constants, existing.kind).includes(category)) {
            throw new ValidationError(`Category must be one of the ${existing.kind} categories in the "${constantsSheetName}" sheet`)
        }
        row.getCell(map['Type']).value = category
        await saveWorkbook(workbook, 'D$CPLN: correct transaction category')
        const stored = parseTransactionRow(sheet.getRow(rowNumber), map, rowNumber, date1904)
        return serializeTransaction(stored)
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

    // Autocomplete for the Details field: previously used description strings
    // seen more than three times, ranked by match quality, then use count and
    // recency.
    const suggestDetails = async (query, kind) => {
        if (kind != null && kind !== '' && kind !== 'expense' && kind !== 'income') {
            throw new ValidationError('Kind must be "expense" or "income"')
        }
        const text = typeof query === 'string' ? query.trim().toLowerCase() : ''
        const tokens = text.split(/\s+/).filter(Boolean)
        const parsed = await getParsed()

        const used = new Map()
        for (const transaction of parsed.transactions) {
            if (!transaction.details) {
                continue
            }
            if (kind && transaction.kind !== kind) {
                continue
            }
            let entry = used.get(transaction.details)
            if (!entry) {
                entry = {
                    details: transaction.details,
                    category: transaction.category,
                    kind: transaction.kind,
                    count: 0,
                    lastDate: '',
                }
                used.set(transaction.details, entry)
            }
            entry.count += 1
            if (transaction.dateIso && transaction.dateIso >= entry.lastDate) {
                entry.lastDate = transaction.dateIso
                entry.category = transaction.category
                entry.kind = transaction.kind
            }
        }

        const suggestions = []
        for (const entry of used.values()) {
            if (entry.count <= 3) {
                continue
            }
            const haystack = entry.details.toLowerCase()
            let score
            if (!text) {
                score = 0
            } else if (haystack === text) {
                score = 1000
            } else if (haystack.startsWith(text)) {
                score = 500
            } else if (tokens.every((token) => haystack.includes(token))) {
                score = 100
            } else {
                continue
            }
            suggestions.push({ ...entry, score: score + entry.count * 5 })
        }
        suggestions.sort((a, b) =>
            b.score - a.score ||
            (a.lastDate === b.lastDate ? 0 : a.lastDate < b.lastDate ? 1 : -1))
        return {
            suggestions: suggestions.slice(0, 8).map(({ score, ...entry }) => entry),
        }
    }

    return {
        getData,
        getTransactions,
        updateMonthlyBudget,
        addTransaction,
        importTransactions,
        updateTransaction,
        deleteTransaction,
        reassignCategory,
        suggestCategories,
        suggestDetails,
    }
}
