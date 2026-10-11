// Excel workbook provider: load/parse the workbook, serve the dashboard
// and insights data, and write transactions/budgets back atomically.

import fs from 'node:fs';
import path from 'node:path';
import ExcelJS from 'exceljs';

import { ValidationError, ConflictError } from '../../errors.mjs';
import { suggestCategories as computeSuggestions, scoreCategories as computeCategoryScores } from '../../category-suggester.mjs';
import { assertWorkbookRepo, commitFile } from '../../workbook-git.mjs';
import { BUDGETS_LABEL, BUDGET_BIAS_LABEL, BUDGET_CURRENCY_HEADER, BUDGET_MONTHLY_LABEL, CONVERSION_GROUP, CURRENCIES_HEADER, CURRENCY_SYMBOLS_HEADER, INCOME_GROUP, categoriesForKind, conversionCategoriesFor, getMonthExpectedSpend, serializeTransaction } from './model.mjs';
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

        if (budgetsLabelRow > 0) {
            const columns = budgetColumns(sheet, budgetsLabelRow)
            eachBudgetRow(sheet, budgetsLabelRow, columns, (currency, row) => {
                budgets[currency] = {
                    monthlyBudget: cellNumber(row.getCell(columns.budgetColumn).value) || 0,
                    firstDayBias: cellNumber(row.getCell(columns.biasColumn).value) || 0,
                }
            })
        }
        return { categoryGroups, currencies, currencySymbols, budgets }
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
        const toDate = buildToDateTotals(transactions, day, conversionCategories)
        const firstMonths = buildFirstMonths(transactions)
        const currencies = buildCurrencyStats(constants, monthly, toDate, firstMonths, date, daysInMonth)
            .map((entry) => ({ ...entry, fractional: fractional.has(entry.code) }))
        const history = buildHistory(constants, monthly, toDate, date, daysInMonth)
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
        addTransaction,
        importTransactions,
        updateTransaction,
        deleteTransaction,
        suggestCategories,
        scoreCategories,
        suggestDetails,
    }
}
