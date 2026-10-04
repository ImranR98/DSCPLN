'use strict'

// Generates mock-data.xlsx: a representative schema with fake data.
// Run with: node scripts/create-mock-workbook.js

const path = require('path')
const ExcelJS = require('exceljs')

const OUTPUT = path.resolve(__dirname, '..', 'mock-data.xlsx')

const CATEGORY_GROUPS = [
    ['Main Expenses', ['Rent', 'Subscriptions', 'Haircut', 'Phone Bills', 'Food Weekly', 'Food General', 'Transport Public', 'Transport Private', 'Necessity', 'Medical']],
    ['Extra Expenses', ['Entertainment', 'Clothes', 'Snacks', 'Other Extra Expense', 'Electronics']],
    ['Special Expenses', ['School Fees', 'Other Special Expense', 'Parents Expenses', 'Loan Repayment', 'Conversion', 'Investment Buy']],
    ['Money In', ['Job', 'From Parents', 'Tax Returns', 'Other Earnings', 'Loan', 'Other Money in', 'Conversion', 'Investment Sell', 'Dividend', 'Interest']],
    ['Currencies', ['CAD', 'USD', 'XMR']],
]

const money = (value) => Math.round(value * 100) / 100

const buildTransactions = () => {
    const rows = []
    const push = (date, details, moneyIn, expenses, currency, category, notes) =>
        rows.push({ date, details, moneyIn, expenses, currency, category, notes: notes || '' })

    for (let year = 2025; year <= 2026; year++) {
        const lastMonth = year === 2026 ? 9 : 12
        for (let month = 1; month <= lastMonth; month++) {
            const monthName = new Date(Date.UTC(year, month - 1, 1)).toLocaleString('en-CA', { month: 'long', timeZone: 'UTC' })
            const day = (value) => new Date(Date.UTC(year, month - 1, value))
            push(day(1), `Rent ${monthName}`, null, money(1250 + (year - 2025) * 25), 'CAD', 'Rent', '')
            push(day(3), 'Job', money(2600 + month * 5), null, 'CAD', 'Job', 'Paycheque')
            push(day(6), 'Groceries', null, money(120 + (month % 5) * 8.5), 'CAD', 'Food Weekly', '')
            push(day(9), 'Netflix', null, 16.99, 'CAD', 'Subscriptions', '')
            push(day(12), 'Uber', null, money(12 + (month % 4) * 3.25), 'CAD', 'Transport Private', '')
            if (month % 3 === 0) {
                push(day(15), 'Spotify', null, 10.99, 'CAD', 'Subscriptions', '')
            }
            if (month % 4 === 0) {
                push(day(18), 'Coffee beans', null, 21.5, 'USD', 'Snacks', 'Bought while travelling')
            }
            if (month % 6 === 0) {
                push(day(21), 'Book sale', null, money(0.05), 'XMR', 'Entertainment', 'Test crypto entry')
            }
            if (month % 5 === 0) {
                push(day(24), 'Haircut', null, 35, 'CAD', 'Haircut', '')
            }
        }
    }
    return rows
}

const buildWorkbook = () => {
    const workbook = new ExcelJS.Workbook()
    workbook.creator = 'D$CPLN mock data'
    workbook.created = new Date(Date.UTC(2026, 0, 1))

    const transactions = workbook.addWorksheet('Transactions')
    transactions.columns = [
        { header: 'Date', key: 'date', width: 12 },
        { header: 'Details', key: 'details', width: 32 },
        { header: 'Money In', key: 'moneyIn', width: 12 },
        { header: 'Expenses', key: 'expenses', width: 12 },
        { header: 'Currency', key: 'currency', width: 10 },
        { header: 'Type', key: 'category', width: 22 },
        { header: 'Notes', key: 'notes', width: 40 },
    ]
    transactions.getRow(1).font = { bold: true }
    for (const row of buildTransactions()) {
        const added = transactions.addRow(row)
        added.getCell(1).numFmt = 'yyyy/mm/dd'
        added.getCell(3).numFmt = '#,##0.00'
        added.getCell(4).numFmt = '#,##0.00'
    }

    const constants = workbook.addWorksheet('Constants')
    constants.getCell('A1').value = 'Types:'
    constants.getCell('B1').value = 'This sheet is very Important, Values here are used by other sheets.'
    CATEGORY_GROUPS.forEach(([group, values], index) => {
        const column = index + 1
        constants.getRow(2).getCell(column).value = group
        constants.getRow(2).getCell(column).font = { bold: true }
        values.forEach((value, rowIndex) => {
            constants.getRow(3 + rowIndex).getCell(column).value = value
        })
    })
    constants.getCell('A15').value = 'Budgets'
    constants.getRow(16).getCell(1).value = 'Currency'
    constants.getRow(16).getCell(2).value = 'Monthly Budget'
    constants.getRow(16).getCell(3).value = 'First Day Bias'
    constants.getRow(16).font = { bold: true }
    constants.getCell('A17').value = 'CAD'
    constants.getCell('B17').value = 3000
    constants.getCell('C17').value = 1500
    constants.getCell('A18').value = 'USD'
    constants.getCell('B18').value = 500
    constants.getCell('C18').value = 100
    for (const ref of ['B17', 'C17', 'B18', 'C18']) {
        constants.getCell(ref).numFmt = '#,##0.00'
    }

    return workbook
}

buildWorkbook().xlsx.writeFile(OUTPUT).then(() => {
    console.log(`Wrote ${OUTPUT}`)
})
