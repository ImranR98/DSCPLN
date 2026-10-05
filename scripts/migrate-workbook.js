'use strict'

// One-off workbook migrations for the Constants sheet:
//  1. Legacy "Budget / Monthly Budget / First Day Bias" section -> a per-currency
//     "Budgets" table (Currency | Monthly Budget | First Day Bias) in place.
//  2. Conversion categories (default "Conversion") -> a dedicated "Conversions"
//     group column, removing them from their current category groups. Categories
//     in the Conversions group are tracked separately from spend/income.
//
// Idempotent: re-running after a successful migration reports no changes.
//
// Usage:
//   node scripts/migrate-workbook.js [--dry-run] [--workbook path.xlsx] [--categories "Conversion,Other"]

const fs = require('fs')
const path = require('path')
const ExcelJS = require('exceljs')
const { loadConfig } = require('../config')
const { assertWorkbookRepo, commitFile } = require('../workbook-git')

const CONVERSION_GROUP = 'Conversions'
const BUDGETS_LABEL = 'Budgets'
const MONTHLY_LABEL = 'Monthly Budget'
const BIAS_LABEL = 'First Day Bias'
const CURRENCY_HEADER = 'Currency'
const CURRENCIES_HEADER = 'Currencies'
const FIRST_VALUE_ROW = 3

const trim = (value) => (value == null ? '' : String(value).trim())
const cloneStyle = (cell) => (cell.style ? JSON.parse(JSON.stringify(cell.style)) : null)

const readHeaderMap = (sheet) => {
    const headerMap = {}
    const order = []
    sheet.getRow(2).eachCell({ includeEmpty: false }, (cell, column) => {
        const header = trim(cell.value)
        if (header) {
            headerMap[header] = column
            order.push({ header, column })
        }
    })
    return { headerMap, order }
}

// Contiguous values in a column starting at row 3.
const readColumnValues = (sheet, column) => {
    const values = []
    for (let row = FIRST_VALUE_ROW; row <= 10000; row++) {
        const cell = sheet.getRow(row).getCell(column)
        const text = trim(cell.value)
        if (!text) {
            break
        }
        values.push({ text, style: cloneStyle(cell), numFmt: cell.numFmt })
    }
    return values
}

const writeColumnValues = (sheet, column, values) => {
    values.forEach((entry, index) => {
        const cell = sheet.getRow(FIRST_VALUE_ROW + index).getCell(column)
        cell.value = entry.text
        if (entry.style) {
            cell.style = entry.style
        }
        if (entry.numFmt) {
            cell.numFmt = entry.numFmt
        }
    })
    return FIRST_VALUE_ROW + values.length
}

const clearValuesFrom = (sheet, column, fromRow, removedCount) => {
    for (let row = fromRow; row < fromRow + removedCount; row++) {
        sheet.getRow(row).getCell(column).value = null
    }
}

const migrateBudgets = (sheet, changes) => {
    let budgetsRow = -1
    let monthlyRow = -1
    let biasRow = -1
    sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
        const label = trim(row.getCell(1).value)
        if (label === BUDGETS_LABEL && budgetsRow < 0) {
            budgetsRow = rowNumber
        }
        if (label === MONTHLY_LABEL) {
            monthlyRow = rowNumber
        }
        if (label === BIAS_LABEL) {
            biasRow = rowNumber
        }
    })
    if (budgetsRow > 0) {
        return // already migrated
    }
    if (monthlyRow < 0 || biasRow < 0) {
        return // no budget section to migrate
    }

    const monthlyBudget = Number.parseFloat(sheet.getRow(monthlyRow).getCell(2).value)
    const firstDayBias = Number.parseFloat(sheet.getRow(biasRow).getCell(2).value)
    if (!Number.isFinite(monthlyBudget) || !Number.isFinite(firstDayBias)) {
        return
    }

    // The legacy layout is "Budget" directly above "Monthly Budget" and
    // "First Day Bias" (rows 999-1001 in the live workbook).
    const anchorRow = trim(sheet.getRow(monthlyRow - 1).getCell(1).value) === 'Budget' ?
        monthlyRow - 1 : monthlyRow
    const labelCell = sheet.getRow(anchorRow).getCell(1)
    const labelStyle = cloneStyle(labelCell)
    const headerRow = sheet.getRow(anchorRow + 1)
    const headerRef = sheet.getRow(2).getCell(1)
    headerRow.getCell(1).value = CURRENCY_HEADER
    headerRow.getCell(2).value = MONTHLY_LABEL
    headerRow.getCell(3).value = BIAS_LABEL
    if (headerRef.style) {
        for (const column of [1, 2, 3]) {
            headerRow.getCell(column).style = JSON.parse(JSON.stringify(headerRef.style))
        }
        headerRow.font = { ...(headerRef.style.font || {}), bold: true }
    }
    labelCell.value = BUDGETS_LABEL
    if (labelStyle) {
        labelCell.style = labelStyle
    }

    // Primary currency = first value in the Currencies column.
    const { headerMap } = readHeaderMap(sheet)
    const currenciesColumn = headerMap[CURRENCIES_HEADER]
    const primaryCurrency = currenciesColumn ?
        readColumnValues(sheet, currenciesColumn).map((entry) => entry.text)[0] : null

    const valueRow = sheet.getRow(anchorRow + 2)
    valueRow.getCell(1).value = primaryCurrency || 'Currency'
    valueRow.getCell(2).value = monthlyBudget
    valueRow.getCell(3).value = firstDayBias
    valueRow.getCell(2).numFmt = '#,##0.00'
    valueRow.getCell(3).numFmt = '#,##0.00'

    // Clear any leftover legacy label rows beyond the new table.
    for (const rowNumber of [monthlyRow, biasRow]) {
        if (rowNumber > anchorRow + 2) {
            sheet.getRow(rowNumber).getCell(1).value = null
            sheet.getRow(rowNumber).getCell(2).value = null
        }
    }

    changes.push(`replaced the legacy budget section with a Budgets table (${primaryCurrency || 'first currency'}: ${monthlyBudget} / ${firstDayBias})`)
}

const migrateConversions = (sheet, changes, categories) => {
    const { headerMap, order } = readHeaderMap(sheet)
    const groupColumns = order
        .filter((entry) => entry.header !== CURRENCIES_HEADER)
        .map((entry) => ({ ...entry, values: readColumnValues(sheet, entry.column) }))

    const found = new Set()
    for (const entry of groupColumns) {
        for (const value of entry.values) {
            if (categories.includes(value.text)) {
                found.add(value.text)
            }
        }
    }
    if (found.size === 0) {
        return
    }

    let conversionsColumn = headerMap[CONVERSION_GROUP]
    if (!conversionsColumn) {
        conversionsColumn = sheet.columnCount + 1
        const headerCell = sheet.getRow(2).getCell(conversionsColumn)
        const reference = sheet.getRow(2).getCell(groupColumns[0].column)
        headerCell.value = CONVERSION_GROUP
        if (reference.style) {
            headerCell.style = JSON.parse(JSON.stringify(reference.style))
        }
        changes.push(`added a "${CONVERSION_GROUP}" group column`)
    }

    const conversionsValues = readColumnValues(sheet, conversionsColumn)
    for (const category of categories) {
        if (found.has(category) && !conversionsValues.some((entry) => entry.text === category)) {
            conversionsValues.push({ text: category, style: null, numFmt: null })
        }
    }
    writeColumnValues(sheet, conversionsColumn, conversionsValues)

    for (const entry of groupColumns) {
        if (entry.column === conversionsColumn) {
            continue
        }
        const kept = entry.values.filter((value) => !found.has(value.text))
        const removed = entry.values.length - kept.length
        if (removed > 0) {
            writeColumnValues(sheet, entry.column, kept)
            clearValuesFrom(sheet, entry.column, FIRST_VALUE_ROW + kept.length, removed)
            changes.push(`moved ${entry.values.filter((value) => found.has(value.text)).map((value) => `"${value.text}"`).join(', ')} out of "${entry.header}"`)
        }
    }
}

const migrate = async ({ workbookFile, categories = ['Conversion'], dryRun = false }) => {
    if (!workbookFile) {
        throw new Error('workbookFile is required')
    }
    assertWorkbookRepo(workbookFile)
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.readFile(workbookFile)
    const sheet = workbook.getWorksheet('Constants')
    if (!sheet) {
        throw new Error('Workbook has no "Constants" sheet')
    }
    const changes = []
    migrateBudgets(sheet, changes)
    migrateConversions(sheet, changes, categories)

    if (changes.length === 0) {
        return { workbookFile, changes, saved: false }
    }
    if (!dryRun) {
        const tempFile = `${workbookFile}.tmp`
        await workbook.xlsx.writeFile(tempFile)
        if (fs.existsSync(workbookFile)) {
            fs.copyFileSync(workbookFile, `${workbookFile}.bak`)
        }
        fs.renameSync(tempFile, workbookFile)
        commitFile(workbookFile, 'D$CPLN: migrate constants (Budgets table, Conversions group)')
    }
    return { workbookFile, changes, saved: !dryRun }
}

const parseArgs = (argv) => {
    const options = { dryRun: false, workbook: null, categories: ['Conversion'] }
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i]
        if (arg === '--dry-run') {
            options.dryRun = true
        } else if (arg === '--workbook') {
            options.workbook = argv[++i]
        } else if (arg === '--categories') {
            options.categories = String(argv[++i] || '').split(',').map((value) => value.trim()).filter(Boolean)
        } else {
            throw new Error(`Unknown argument: ${arg}`)
        }
    }
    return options
}

const resolveWorkbook = (options) => {
    if (options.workbook) {
        return path.resolve(options.workbook)
    }
    const config = loadConfig()
    const providerConfig = config.providers[config.dataProvider] || {}
    return path.resolve(config.configDir || process.cwd(), providerConfig.workbookFile || './mock-data.xlsx')
}

if (require.main === module) {
    (async () => {
        const options = parseArgs(process.argv.slice(2))
        const workbookFile = resolveWorkbook(options)
        const result = await migrate({ workbookFile, categories: options.categories, dryRun: options.dryRun })
        console.log(`${options.dryRun ? '[dry run] ' : ''}${workbookFile}`)
        if (result.changes.length === 0) {
            console.log('  no changes needed')
        }
        for (const change of result.changes) {
            console.log(`  - ${change}`)
        }
        console.log(result.saved ? '  saved and committed' : options.dryRun ? '  nothing written (dry run)' : '  nothing written')
    })().catch((e) => {
        console.error(`Migration failed: ${e.message}`)
        process.exit(1)
    })
}

module.exports = { migrate, parseArgs }
