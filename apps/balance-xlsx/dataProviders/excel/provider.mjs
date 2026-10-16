// Excel workbook provider: load/parse the workbook, serve the dashboard
// and insights data, and write transactions/budgets back atomically.

import fs from 'node:fs';
import path from 'node:path';
import ExcelJS from 'exceljs';

import { ValidationError, ConflictError } from '../../errors.mjs';
import { suggestCategories as computeSuggestions, scoreCategories as computeCategoryScores } from '../../category-suggester.mjs';
import { assertWorkbookRepo, commitFile } from '../../workbook-git.mjs';
import { BUDGETS_LABEL, BUDGET_BIAS_LABEL, BUDGET_CURRENCY_HEADER, BUDGET_MONTHLY_LABEL, CONVERSION_GROUP, CURRENCIES_HEADER, CURRENCY_SYMBOLS_HEADER, EXCLUDED_LABEL, INCOME_GROUP, categoriesForKind, conversionCategoriesFor, getMonthExpectedSpend, serializeTransaction } from './model.mjs';
import { cellNumber, cellString, cleanAmount, dateFromCell, datePartsToIso, datePartsToUtcDate, hasSubCentPrecision, normalizeHeader, parseDateInput, parseImportLine, parseImportLines, parseTransactionId, transactionHash, validateAmount, validateText } from './parse.mjs';

export default (config = {}, configDir = process.cwd()) => {
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

    // Settings blocks (Budgets, Excluded from Budget by Default) can sit
    // anywhere on the sheet: the first cell matching the label anchors the
    // block, with its header row below and values below that. Reads accept any
    // position; the writers normalise both blocks to the canonical top-right
    // layout, so a legacy placement migrates on the next settings save.
    const findLabelCell = (sheet, label) => {
        let found = null
        sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
            if (found) {
                return
            }
            row.eachCell({ includeEmpty: false }, (cell, column) => {
                if (!found && normalizeHeader(cellString(cell.value)) === label) {
                    found = { row: rowNumber, column }
                }
            })
        })
        return found
    }

    const isSettingsLabel = (header) => header === BUDGETS_LABEL || header === EXCLUDED_LABEL

    const readBudgetBlock = (sheet, label) => {
        if (!label) {
            return { columns: null, entries: [] }
        }
        const headers = {}
        sheet.getRow(label.row + 1).eachCell({ includeEmpty: false }, (cell, column) => {
            if (column < label.column) {
                return
            }
            const header = normalizeHeader(cellString(cell.value))
            if (header) {
                headers[header] = column
            }
        })
        const currencyColumn = headers[BUDGET_CURRENCY_HEADER] || label.column
        const columns = {
            currencyColumn,
            budgetColumn: headers[BUDGET_MONTHLY_LABEL] || currencyColumn + 1,
            biasColumn: headers[BUDGET_BIAS_LABEL] || currencyColumn + 2,
        }
        const entries = []
        for (let rowNumber = label.row + 2; rowNumber <= sheet.rowCount; rowNumber++) {
            const currency = cellString(sheet.getRow(rowNumber).getCell(currencyColumn).value).trim()
            if (!currency) {
                break
            }
            entries.push({
                row: rowNumber,
                currency,
                monthlyBudget: cellNumber(sheet.getRow(rowNumber).getCell(columns.budgetColumn).value) || 0,
                firstDayBias: cellNumber(sheet.getRow(rowNumber).getCell(columns.biasColumn).value) || 0,
            })
        }
        return { columns, entries }
    }

    const readExcludedBlock = (sheet, label) => {
        if (!label) {
            return []
        }
        const names = []
        for (let rowNumber = label.row + 1; rowNumber <= sheet.rowCount; rowNumber++) {
            const value = cellString(sheet.getRow(rowNumber).getCell(label.column).value).trim()
            if (!value) {
                break
            }
            names.push(value)
        }
        return names
    }

    const readConstants = (workbook) => {
        const sheet = getSheet(workbook, constantsSheetName, 'constants')
        const categoryGroups = []
        const currencies = []
        const budgets = {}

        const columns = []
        sheet.getRow(2).eachCell({ includeEmpty: false }, (cell, column) => {
            const header = normalizeHeader(cellString(cell.value))
            if (header && !isSettingsLabel(header)) {
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
            previousRow = rowNumber
        })
        for (const entry of columns) {
            if (entry.header === CURRENCIES_HEADER) {
                currencies.push(...entry.values)
            } else if (entry.header !== CURRENCY_SYMBOLS_HEADER && entry.values.length) {
                categoryGroups.push({ group: entry.header, categories: entry.values })
            }
        }

        // Symbols pair with currencies by row, so gaps (currencies with no
        // symbol) are fine instead of stopping the column early.
        const currencySymbols = {}
        const symbolsColumn = columns.find((entry) => entry.header === CURRENCY_SYMBOLS_HEADER)
        if (symbolsColumn) {
            currencies.forEach((code, index) => {
                const symbol = cellString(sheet.getRow(3 + index).getCell(symbolsColumn.column).value).trim()
                if (symbol) {
                    currencySymbols[code] = symbol
                }
            })
        }

        const budgetBlock = readBudgetBlock(sheet, findLabelCell(sheet, BUDGETS_LABEL))
        for (const entry of budgetBlock.entries) {
            budgets[entry.currency] = { monthlyBudget: entry.monthlyBudget, firstDayBias: entry.firstDayBias }
        }

        // Names that no longer exist as categories are ignored, so renaming or
        // removing a category in the sheet can't leave a dangling default.
        const knownCategories = new Set(categoryGroups.flatMap((entry) => entry.categories))
        const defaultExcludedCategories = []
        for (const name of readExcludedBlock(sheet, findLabelCell(sheet, EXCLUDED_LABEL))) {
            if (knownCategories.has(name) && !defaultExcludedCategories.includes(name)) {
                defaultExcludedCategories.push(name)
            }
        }
        return { categoryGroups, currencies, currencySymbols, budgets, defaultExcludedCategories }
    }

    // Canonical layout: one blank column right of the category table, starting
    // at the top — the Budgets label (row 2), its header row (row 3) and
    // currency rows (row 4+), then the excluded-categories label below them.
    // Both blocks are cleared wherever they currently are and rewritten here.
    const clearSettingsBlocks = (sheet) => {
        const budgetLabel = findLabelCell(sheet, BUDGETS_LABEL)
        if (budgetLabel) {
            const { columns, entries } = readBudgetBlock(sheet, budgetLabel)
            sheet.getRow(budgetLabel.row).getCell(budgetLabel.column).value = null
            const columnsToClear = Object.values(columns)
            const headerRow = sheet.getRow(budgetLabel.row + 1)
            for (const column of columnsToClear) {
                headerRow.getCell(column).value = null
            }
            for (const entry of entries) {
                const row = sheet.getRow(entry.row)
                for (const column of columnsToClear) {
                    row.getCell(column).value = null
                }
            }
        }
        const excludedLabel = findLabelCell(sheet, EXCLUDED_LABEL)
        if (excludedLabel) {
            sheet.getRow(excludedLabel.row).getCell(excludedLabel.column).value = null
            for (let rowNumber = excludedLabel.row + 1; rowNumber <= sheet.rowCount; rowNumber++) {
                const cell = sheet.getRow(rowNumber).getCell(excludedLabel.column)
                if (!cellString(cell.value).trim()) {
                    break
                }
                cell.value = null
            }
        }
    }

    const writeSettingsBlocks = (sheet, { budgets, excluded }) => {
        clearSettingsBlocks(sheet)
        let tableRight = 0
        sheet.getRow(2).eachCell({ includeEmpty: false }, (cell, column) => {
            const header = normalizeHeader(cellString(cell.value))
            if (header && !isSettingsLabel(header)) {
                tableRight = Math.max(tableRight, column)
            }
        })
        const anchor = tableRight + 2
        if (budgets.length) {
            sheet.getRow(2).getCell(anchor).value = BUDGETS_LABEL
            const headerRow = sheet.getRow(3)
            headerRow.getCell(anchor).value = BUDGET_CURRENCY_HEADER
            headerRow.getCell(anchor + 1).value = BUDGET_MONTHLY_LABEL
            headerRow.getCell(anchor + 2).value = BUDGET_BIAS_LABEL
            headerRow.font = { bold: true }
            budgets.forEach((entry, index) => {
                const row = sheet.getRow(4 + index)
                row.getCell(anchor).value = entry.currency
                row.getCell(anchor + 1).value = entry.monthlyBudget
                row.getCell(anchor + 1).numFmt = '#,##0.00'
                row.getCell(anchor + 2).value = entry.firstDayBias
                row.getCell(anchor + 2).numFmt = '#,##0.00'
            })
        }
        if (excluded.length) {
            const excludedLabelRow = 4 + budgets.length + 1
            sheet.getRow(excludedLabelRow).getCell(anchor).value = EXCLUDED_LABEL
            excluded.forEach((name, index) => {
                sheet.getRow(excludedLabelRow + 1 + index).getCell(anchor).value = name
            })
        }
        return anchor
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
            throw new Error(`Workbook not found: ${workbookFile}`, { cause: e })
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
        if (!category) {
            throw new ValidationError('Category is required')
        }
        if (!allowedCategories.includes(category)) {
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

    // Per-currency monthly totals counting only days up to `day`, so months can
    // be compared month-to-date as well as at their end.
    const buildToDateTotals = (transactions, day, conversionCategories) => {
        const totals = new Map()
        for (const transaction of transactions) {
            if (transaction.date.day > day) {
                continue
            }
            const key = `${transaction.currency}|${transaction.date.year}|${transaction.date.month}`
            let entry = totals.get(key)
            if (!entry) {
                entry = emptyTotals()
                totals.set(key, entry)
            }
            addTransactionToBuckets(entry, transaction, conversionCategories.has(transaction.category))
        }
        return totals
    }

    // The earliest month in which each currency has a transaction.
    const buildFirstMonths = (transactions) => {
        const first = new Map()
        for (const transaction of transactions) {
            const current = first.get(transaction.currency)
            if (!current ||
                transaction.date.year < current.year ||
                (transaction.date.year === current.year && transaction.date.month < current.month)) {
                first.set(transaction.currency, { year: transaction.date.year, month: transaction.date.month })
            }
        }
        return first
    }

    // Per-currency current, previous-month and trailing 12-month stats. Past
    // months also carry month-to-date figures so they can be compared with a
    // partial current month, and trailing averages skip months before the
    // currency's first transaction.
    const buildCurrencyStats = (constants, monthly, toDate, firstMonths, date, daysInMonth) => {
        const year = date.getFullYear()
        const month = date.getMonth() + 1
        const day = date.getDate()
        const previousMonthDate = new Date(year, month - 2, 1)
        const previousYear = previousMonthDate.getFullYear()
        const previousMonth = previousMonthDate.getMonth() + 1
        const average = (total, count) => count > 0 ? cleanAmount(total / count) : 0
        return constants.currencies.map((code, index) => {
            const budget = getBudgetForCurrency(constants, code)
            const current = toDate.get(`${code}|${year}|${month}`) || emptyTotals()
            const firstMonth = firstMonths.get(code)
            const trailing = emptyTotals()
            const trailingToDate = emptyTotals()
            let trailingMonths = 0
            for (let offset = 1; offset <= 12; offset++) {
                const target = new Date(year, month - 1 - offset, 1)
                const targetYear = target.getFullYear()
                const targetMonth = target.getMonth() + 1
                if (firstMonth && (targetYear < firstMonth.year ||
                    (targetYear === firstMonth.year && targetMonth < firstMonth.month))) {
                    continue
                }
                trailingMonths += 1
                const entry = monthly.get(`${code}|${targetYear}|${targetMonth}`)
                if (entry) {
                    trailing.spend += entry.spend
                    trailing.income += entry.income
                    trailing.convertedOut += entry.convertedOut
                    trailing.convertedIn += entry.convertedIn
                }
                const toDateEntry = toDate.get(`${code}|${targetYear}|${targetMonth}`)
                if (toDateEntry) {
                    trailingToDate.spend += toDateEntry.spend
                    trailingToDate.income += toDateEntry.income
                    trailingToDate.convertedOut += toDateEntry.convertedOut
                    trailingToDate.convertedIn += toDateEntry.convertedIn
                }
            }
            const previous = monthly.get(`${code}|${previousYear}|${previousMonth}`) || emptyTotals()
            const previousToDate = toDate.get(`${code}|${previousYear}|${previousMonth}`) || emptyTotals()
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
                firstMonth: firstMonth ? datePartsToIso({ ...firstMonth, day: 1 }) : null,
                symbol: (constants.currencySymbols || {})[code] || null,
                trailingMonths,
                monthsSpend,
                previousMonthsSpend: cleanAmount(previous.spend),
                previousMonthsSpendToDate: cleanAmount(previousToDate.spend),
                trailingSpendAverage: average(trailing.spend, trailingMonths),
                trailingSpendAverageToDate: average(trailingToDate.spend, trailingMonths),
                monthsIncome,
                previousMonthsIncome: cleanAmount(previous.income),
                previousMonthsIncomeToDate: cleanAmount(previousToDate.income),
                trailingIncomeAverage: average(trailing.income, trailingMonths),
                trailingIncomeAverageToDate: average(trailingToDate.income, trailingMonths),
                monthsConvertedOut,
                previousMonthsConvertedOut: cleanAmount(previous.convertedOut),
                previousMonthsConvertedOutToDate: cleanAmount(previousToDate.convertedOut),
                trailingConvertedOutAverage: average(trailing.convertedOut, trailingMonths),
                trailingConvertedOutAverageToDate: average(trailingToDate.convertedOut, trailingMonths),
                monthsConvertedIn,
                previousMonthsConvertedIn: cleanAmount(previous.convertedIn),
                previousMonthsConvertedInToDate: cleanAmount(previousToDate.convertedIn),
                trailingConvertedInAverage: average(trailing.convertedIn, trailingMonths),
                trailingConvertedInAverageToDate: average(trailingToDate.convertedIn, trailingMonths),
                monthsExpectedSpend: getMonthExpectedSpend(budget.monthlyBudget, budget.firstDayBias, day, daysInMonth),
            }
        })
    }

    // The last 12 months of per-currency totals, oldest first. The viewed month
    // is capped at the viewed day (matching the month figures) and flagged as
    // partial when it is not over yet.
    const buildHistory = (constants, monthly, toDate, date, daysInMonth) => {
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
                    (toDate.get(`${code}|${targetYear}|${targetMonth}`) || emptyTotals()) :
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

    // `excludeCategories` unset means the workbook's "Excluded from Budget by
    // Default" list; an explicit list (even empty) overrides it for this view.
    // Excluded categories are left out of every aggregate (spend, income,
    // conversions, budgets, trailing averages, history) but the transaction
    // list, range and suggestions still see the whole workbook.
    const getData = async (date = new Date(), { excludeCategories } = {}) => {
        const parsed = await getParsed()
        const { constants, transactions, headerMap, conversionCategories, transactionRange } = parsed
        const excludedSet = new Set(excludeCategories === undefined ? constants.defaultExcludedCategories : excludeCategories)
        const counted = excludedSet.size ?
            transactions.filter((transaction) => !excludedSet.has(transaction.category)) :
            transactions
        const monthly = buildMonthlyTotals(counted, conversionCategories)
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
        const toDate = buildToDateTotals(counted, day, conversionCategories)
        const firstMonths = buildFirstMonths(counted)
        const currencies = buildCurrencyStats(constants, monthly, toDate, firstMonths, date, daysInMonth)
            .map((entry) => ({ ...entry, fractional: fractional.has(entry.code) }))
        const history = buildHistory(constants, monthly, toDate, date, daysInMonth)
        return {
            currencies,
            categories: constants.categoryGroups,
            conversionCategories: [...conversionCategories],
            defaultExcludedCategories: constants.defaultExcludedCategories,
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

    // Rewrites the Budgets block from the full entry list at the canonical
    // position, preserving the excluded list. Any legacy placement migrates.
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
        const excluded = readExcludedBlock(sheet, findLabelCell(sheet, EXCLUDED_LABEL))
        const budgets = readBudgetBlock(sheet, findLabelCell(sheet, BUDGETS_LABEL)).entries
            .map((entry) => ({ currency: entry.currency, monthlyBudget: entry.monthlyBudget, firstDayBias: entry.firstDayBias }))
        const entry = { currency: currencyCode, monthlyBudget: budget, firstDayBias: bias }
        const index = budgets.findIndex((existing) => existing.currency === currencyCode)
        if (index >= 0) {
            budgets[index] = entry
        } else {
            budgets.push(entry)
        }
        writeSettingsBlocks(sheet, { budgets, excluded })
        await saveWorkbook(workbook, `D$CPLN: update ${currencyCode} budget`)
    }

    // Writes the "Excluded from Budget by Default" list into the Constants
    // sheet (creating or repositioning the block) so toggles can be persisted
    // as the default without touching any other setting.
    const updateDefaultExcludedCategories = async (categories) => {
        if (!Array.isArray(categories)) {
            throw new ValidationError('Categories must be an array')
        }
        const workbook = await loadWorkbook()
        const constants = readConstants(workbook)
        const known = constants.categoryGroups.flatMap((entry) => entry.categories)
        const knownSet = new Set(known)
        const requested = []
        for (const value of categories) {
            const name = typeof value === 'string' ? value.trim() : ''
            if (!name || !knownSet.has(name)) {
                throw new ValidationError(`Unknown category: ${JSON.stringify(value) ?? String(value)}`)
            }
            if (!requested.includes(name)) {
                requested.push(name)
            }
        }
        // Write in the sheet's category order so the list stays tidy.
        const ordered = known.filter((name) => requested.includes(name))
        const sheet = getSheet(workbook, constantsSheetName, 'constants')
        const budgets = readBudgetBlock(sheet, findLabelCell(sheet, BUDGETS_LABEL)).entries
            .map((entry) => ({ currency: entry.currency, monthlyBudget: entry.monthlyBudget, firstDayBias: entry.firstDayBias }))
        writeSettingsBlocks(sheet, { budgets, excluded: ordered })
        await saveWorkbook(workbook, 'D$CPLN: update default excluded categories')
        return { defaultExcludedCategories: ordered }
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

    // Duplicate-detection identity: date + details + signed amount + currency.
    // Category and notes are deliberately excluded so a stored row that was
    // recategorized (or annotated) still matches a freshly scraped line, and
    // the multiset counting keeps two genuinely identical same-day
    // transactions importable.
    const looseKey = (dateIso, details, signedAmount, currency) =>
        JSON.stringify([dateIso, details, cleanAmount(signedAmount), currency])

    const keyCountsFor = (transactions) => {
        const counts = new Map()
        for (const transaction of transactions) {
            const signed = transaction.moneyIn != null ? transaction.moneyIn : -(transaction.expenses ?? 0)
            const key = looseKey(transaction.dateIso, transaction.details, signed, transaction.currency)
            counts.set(key, (counts.get(key) ?? 0) + 1)
        }
        return counts
    }

    // A parsed import line reduced to what duplicate matching needs: date,
    // details, amount and currency are required; category and notes are not.
    const candidateKey = (input) => {
        const date = parseDateInput(input.date)
        const details = validateText(input.details, 'Details', true)
        const amount = validateAmount(input.amount)
        const currency = typeof input.currency === 'string' ? input.currency.trim() : ''
        if (!currency) {
            throw new ValidationError('Currency is required')
        }
        return looseKey(datePartsToIso(date), details, input.kind === 'income' ? amount : -amount, currency)
    }

    // Read-only duplicate check for the external API: parses import text and
    // reports which lines already exist in the workbook. Matching is loose
    // (see looseKey) and count-aware, so checking two identical lines against
    // one stored row marks exactly one of them as a duplicate.
    const checkImportLines = async (text) => {
        const parsed = await getParsed()
        const orderedHeaders = Object.entries(parsed.headerMap)
            .sort((a, b) => a[1] - b[1])
            .map(([header]) => header)
        const lines = parseImportLines(text)
        const counts = keyCountsFor(parsed.transactions)
        const errors = []
        const results = []
        for (const line of lines) {
            try {
                const key = candidateKey(parseImportLine(line, orderedHeaders))
                const remaining = counts.get(key) ?? 0
                const duplicate = remaining > 0
                if (duplicate) {
                    counts.set(key, remaining - 1)
                }
                results.push({ line: line.number, duplicate })
            } catch (e) {
                if (e instanceof ValidationError) {
                    errors.push(`Line ${line.number}: ${e.message}`)
                    continue
                }
                throw e
            }
        }
        if (errors.length) {
            throw new ValidationError(`Check failed:\n${errors.join('\n')}`)
        }
        const duplicates = results.filter((entry) => entry.duplicate).length
        return { total: results.length, duplicates, new: results.length - duplicates, lines: results }
    }

    // Imports tab-separated rows positionally matched to the Transactions
    // sheet's header row. Every line is validated before anything is written,
    // so an invalid line rejects the whole batch. With skipDuplicates, lines
    // already present in the workbook (loose key) are reported as skipped and
    // never validated, so a since-renamed category on an old row cannot block
    // an otherwise clean import.
    const importTransactions = async (text, { skipDuplicates = false } = {}) => {
        const workbook = await loadWorkbook()
        const date1904 = Boolean(workbook.properties.date1904)
        const constants = readConstants(workbook)
        const sheet = getSheet(workbook, transactionsSheetName, 'transactions')
        const map = readHeaderMap(sheet)
        const orderedHeaders = Object.entries(map)
            .sort((a, b) => a[1] - b[1])
            .map(([header]) => header)
        const lines = parseImportLines(text)

        const counts = skipDuplicates ? keyCountsFor(parseWorkbook(workbook).transactions) : null
        const transactions = []
        let skipped = 0
        const errors = []
        for (const line of lines) {
            let input
            try {
                input = parseImportLine(line, orderedHeaders)
            } catch (e) {
                if (e instanceof ValidationError) {
                    errors.push(`Line ${line.number}: ${e.message}`)
                    continue
                }
                throw e
            }
            if (counts) {
                const key = candidateKey(input)
                const remaining = counts.get(key) ?? 0
                if (remaining > 0) {
                    counts.set(key, remaining - 1)
                    skipped += 1
                    continue
                }
            }
            try {
                transactions.push(validateTransactionInput(constants, input))
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
        return { imported: count, skipped, transactions: stored.map(serializeTransaction) }
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

    // Scores every category for the external API: grouped as in the Constants
    // sheet, best match first, with 0 for anything that doesn't match. Without
    // a kind it returns every group un-scored, doubling as a category list.
    const scoreCategories = async (description, kind) => {
        if (kind != null && kind !== '' && kind !== 'expense' && kind !== 'income') {
            throw new ValidationError('Kind must be "expense" or "income"')
        }
        const query = typeof description === 'string' ? description.trim() : ''
        if (query && !kind) {
            throw new ValidationError('kind is required when details is provided')
        }
        const parsed = await getParsed()
        const groups = parsed.constants.categoryGroups.filter((entry) =>
            !kind ||
            (kind === 'income' ?
                entry.group === INCOME_GROUP || entry.group === CONVERSION_GROUP :
                entry.group !== INCOME_GROUP))
        const samples = kind ? parsed.samplesByKind[kind] : []
        return groups.map((entry) => ({
            group: entry.group,
            categories: computeCategoryScores(query, samples, entry.categories).map((score) => ({
                category: score.category,
                score: Math.round(score.score * 1000) / 1000,
            })),
        }))
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
        updateDefaultExcludedCategories,
        addTransaction,
        checkImportLines,
        importTransactions,
        updateTransaction,
        deleteTransaction,
        suggestCategories,
        scoreCategories,
        suggestDetails,
    }
}
