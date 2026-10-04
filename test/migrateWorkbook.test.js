'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync } = require('child_process')
const ExcelJS = require('exceljs')
const { migrate } = require('../scripts/migrate-workbook')

const buildLegacyWorkbook = async (file) => {
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet('Constants')
    sheet.addRow([])
    sheet.addRow(['Main Expenses', 'Special Expenses', 'Money In', 'Currencies'])
    sheet.addRow(['Rent', 'School Fees', 'Job', 'CAD'])
    sheet.addRow(['Food Weekly', 'Conversion', 'Conversion', 'USD'])
    sheet.addRow(['Medical', 'Investment Buy', 'Dividend'])
    sheet.addRow([])
    sheet.addRow(['Budget'])
    sheet.addRow(['Monthly Budget', 3000])
    sheet.addRow(['First Day Bias', 1470])
    const transactions = workbook.addWorksheet('Transactions')
    transactions.addRow(['Date', 'Details', 'Money In', 'Expenses', 'Currency', 'Type', 'Notes'])
    await workbook.xlsx.writeFile(file)
}

const readConstants = async (file) => {
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.readFile(file)
    return workbook.getWorksheet('Constants')
}

const columnValues = (sheet, column) => {
    const values = []
    for (let row = 3; row <= 20; row++) {
        const text = String(sheet.getRow(row).getCell(column).value == null ? '' : sheet.getRow(row).getCell(column).value).trim()
        if (!text) {
            break
        }
        values.push(text)
    }
    return values
}

test('migrates the legacy budget section and Conversion categories', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dscpln-migrate-'))
    execFileSync('git', ['init', '-q'], { cwd: dir })
    const workbookFile = path.join(dir, 'mock.xlsx')
    await buildLegacyWorkbook(workbookFile)

    const result = await migrate({ workbookFile })
    assert.equal(result.saved, true)
    assert.equal(result.changes.length, 4)

    const sheet = await readConstants(workbookFile)
    // Budget section replaced in place.
    assert.equal(sheet.getRow(7).getCell(1).value, 'Budgets')
    assert.equal(sheet.getRow(8).getCell(1).value, 'Currency')
    assert.equal(sheet.getRow(8).getCell(2).value, 'Monthly Budget')
    assert.equal(sheet.getRow(8).getCell(3).value, 'First Day Bias')
    assert.equal(sheet.getRow(9).getCell(1).value, 'CAD')
    assert.equal(sheet.getRow(9).getCell(2).value, 3000)
    assert.equal(sheet.getRow(9).getCell(3).value, 1470)

    // Conversion moved into its own group column; others shifted up.
    assert.deepEqual(columnValues(sheet, 2), ['School Fees', 'Investment Buy'])
    assert.deepEqual(columnValues(sheet, 3), ['Job', 'Dividend'])
    assert.equal(sheet.getRow(2).getCell(5).value, 'Conversions')
    assert.deepEqual(columnValues(sheet, 5), ['Conversion'])

    // Rewriting again reports no changes.
    const second = await migrate({ workbookFile })
    assert.deepEqual(second.changes, [])
    assert.equal(second.saved, false)
})

test('dry run reports changes without writing', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dscpln-migrate-dry-'))
    execFileSync('git', ['init', '-q'], { cwd: dir })
    const workbookFile = path.join(dir, 'mock.xlsx')
    await buildLegacyWorkbook(workbookFile)
    const before = fs.readFileSync(workbookFile)

    const result = await migrate({ workbookFile, dryRun: true })
    assert.equal(result.changes.length, 4)
    assert.equal(result.saved, false)
    assert.deepEqual(fs.readFileSync(workbookFile), before)
})
