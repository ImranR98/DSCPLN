'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync } = require('child_process')
const ExcelJS = require('exceljs')
const createProvider = require('../dataProviders/excelDataProvider')
const { ValidationError, ConflictError } = require('../errors')

const MOCK = path.join(__dirname, '..', 'mock-data.xlsx')

const git = (args, cwd) => execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: {
        ...process.env,
        GIT_AUTHOR_NAME: 'test',
        GIT_AUTHOR_EMAIL: 'test@test',
        GIT_COMMITTER_NAME: 'test',
        GIT_COMMITTER_EMAIL: 'test@test',
        GIT_CONFIG_COUNT: '1',
        GIT_CONFIG_KEY_0: 'commit.gpgsign',
        GIT_CONFIG_VALUE_0: 'false',
    },
})

const initGitRepo = (dir) => {
    git(['init', '-q'], dir)
}

const setup = () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dscpln-xlsx-'))
    const workbookFile = path.join(dir, 'mock.xlsx')
    fs.copyFileSync(MOCK, workbookFile)
    initGitRepo(dir)
    return { dir, workbookFile, provider: createProvider({ workbookFile }, dir) }
}

const createCustomWorkbook = async (file, rows) => {
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet('Transactions')
    sheet.addRow(['Date', 'Details', 'Money In', 'Expenses', 'Currency', 'Type', 'Notes'])
    for (const row of rows) {
        sheet.addRow([
            new Date(Date.UTC(row.year, row.month - 1, row.day)),
            row.details,
            row.moneyIn == null ? null : row.moneyIn,
            row.expenses == null ? null : row.expenses,
            row.currency || 'CAD',
            row.category,
            row.notes || '',
        ])
    }
    const constants = workbook.addWorksheet('Constants')
    constants.getCell('A2').value = 'Main Expenses'
    constants.getCell('A3').value = 'Rent'
    constants.getCell('B2').value = 'Money In'
    constants.getCell('B3').value = 'Job'
    constants.getCell('C2').value = 'Currencies'
    constants.getCell('C3').value = 'CAD'
    constants.getCell('A5').value = 'Budget'
    constants.getCell('A6').value = 'Monthly Budget'
    constants.getCell('B6').value = 1000
    constants.getCell('A7').value = 'First Day Bias'
    constants.getCell('B7').value = 500
    await workbook.xlsx.writeFile(file)
}

const currencyOf = (data, code) => data.currencies.find((entry) => entry.code === code)

test('reads constants, categories, currencies and budget', async () => {
    const { provider } = setup()
    const data = await provider.getData(new Date(2026, 8, 15))
    assert.deepEqual(data.currencies.map((entry) => entry.code), ['CAD', 'USD', 'XMR'])
    const cad = currencyOf(data, 'CAD')
    assert.equal(cad.primary, true)
    assert.equal(cad.monthlyBudget, 3000)
    assert.equal(cad.firstDayBias, 1500)
    const usd = currencyOf(data, 'USD')
    assert.equal(usd.primary, false)
    assert.equal(usd.monthlyBudget, 500)
    assert.equal(usd.firstDayBias, 100)
    assert.equal(currencyOf(data, 'XMR').monthlyBudget, 0)
    assert.deepEqual(data.categories.map((entry) => entry.group), ['Main Expenses', 'Extra Expenses', 'Special Expenses', 'Money In'])
    assert.equal(data.categories.find((entry) => entry.group === 'Money In').categories.includes('Job'), true)
})

test('parses transactions with full dates and counts expenses only', async () => {
    const { provider } = setup()
    const data = await provider.getData(new Date(2026, 8, 15))
    assert.equal(data.transactions.length, 6)
    const rent = data.transactions.find((transaction) => transaction.details === 'Rent September')
    assert.equal(rent.kind, 'expense')
    assert.equal(rent.expenses, 1275)
    assert.equal(rent.date, '2026-09-01')
    assert.equal(rent.category, 'Rent')
    const job = data.transactions.find((transaction) => transaction.category === 'Job')
    assert.equal(job.kind, 'income')
    assert.equal(job.moneyIn, 2645)
    const cad = currencyOf(data, 'CAD')
    assert.equal(cad.monthsSpend, 1472.23)
    assert.equal(cad.monthsIncome, 2645)
    assert.equal(cad.hasActivity, true)
    assert.equal(currencyOf(data, 'USD').hasActivity, false)
})

test('computes previous month and trailing 12 month averages', async () => {
    const { provider } = setup()
    const data = await provider.getData(new Date(2026, 8, 15))
    const cad = currencyOf(data, 'CAD')
    assert.equal(cad.previousMonthsIncome, 2640)
    assert.equal(cad.trailingIncomeAverage, 2632.5)

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dscpln-xlsx-'))
    const file = path.join(dir, 'custom.xlsx')
    await createCustomWorkbook(file, [
        { year: 2025, month: 12, day: 6, details: 'Rent', expenses: 100, category: 'Rent' },
        { year: 2025, month: 12, day: 20, details: 'Job', moneyIn: 100, category: 'Job' },
        { year: 2026, month: 1, day: 6, details: 'Rent', expenses: 200, category: 'Rent' },
        { year: 2026, month: 1, day: 20, details: 'Job', moneyIn: 200, category: 'Job' },
        { year: 2026, month: 2, day: 6, details: 'Rent', expenses: 300, category: 'Rent' },
        { year: 2026, month: 2, day: 20, details: 'Job', moneyIn: 300, category: 'Job' },
        { year: 2026, month: 3, day: 6, details: 'Rent', expenses: 400, category: 'Rent' },
        { year: 2026, month: 3, day: 20, details: 'Job', moneyIn: 400, category: 'Job' },
    ])
    initGitRepo(dir)
    const custom = createProvider({ workbookFile: file }, dir)
    const data2026 = currencyOf(await custom.getData(new Date(2026, 2, 15)), 'CAD')
    assert.equal(data2026.monthsIncome, 0)
    assert.equal(data2026.previousMonthsIncome, 300)
    assert.equal(data2026.trailingIncomeAverage, 50)
    assert.equal(data2026.monthsSpend, 400)
    assert.equal(data2026.previousMonthsSpend, 300)
    assert.equal(data2026.trailingSpendAverage, 50)
    // Legacy single-budget section is used for the first currency.
    assert.equal(data2026.monthlyBudget, 1000)
    assert.equal(data2026.firstDayBias, 500)
    assert.equal(Math.round(data2026.monthsExpectedSpend * 100) / 100, 741.94)
    const march = currencyOf(await custom.getData(new Date(2026, 2, 21)), 'CAD')
    assert.equal(march.monthsIncome, 400)
    assert.equal(march.previousMonthsIncome, 300)
    assert.equal(march.trailingIncomeAverage, 50)
    const dayOne = currencyOf(await custom.getData(new Date(2026, 2, 1)), 'CAD')
    assert.equal(Math.round(dayOne.monthsExpectedSpend * 100) / 100, 516.13)
    const lastDay = currencyOf(await custom.getData(new Date(2026, 2, 31)), 'CAD')
    assert.equal(lastDay.monthsExpectedSpend, 1000)
})

test('reports every currency with its own activity', async () => {
    const { provider } = setup()
    const august = await provider.getData(new Date(2026, 7, 20))
    assert.equal(currencyOf(august, 'CAD').hasActivity, true)
    assert.equal(currencyOf(august, 'USD').monthsSpend, 21.5)
    assert.equal(currencyOf(august, 'USD').hasActivity, true)
    assert.equal(currencyOf(august, 'XMR').hasActivity, false)
    // Transactions from all currencies are returned together.
    assert.equal(august.transactions.some((transaction) => transaction.currency === 'USD'), true)
    const june = await provider.getData(new Date(2026, 5, 22))
    assert.equal(currencyOf(june, 'XMR').monthsSpend, 0.05)
})

test('adds, edits and deletes transactions, preserving styles', async () => {
    const { provider, workbookFile } = setup()
    const created = await provider.addTransaction({
        kind: 'expense',
        amount: 9.5,
        details: 'Unit test expense',
        date: '2026-09-15',
        category: 'Snacks',
        currency: 'CAD',
        notes: 'temporary',
    })
    assert.equal(created.expenses, 9.5)
    const afterAdd = await provider.getData(new Date(2026, 8, 15))
    assert.equal(afterAdd.transactions.length, 7)

    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.readFile(workbookFile)
    const sheet = workbook.getWorksheet('Transactions')
    const appended = sheet.getRow(created.row)
    assert.equal(appended.getCell(1).numFmt, 'yyyy/mm/dd')
    assert.equal(appended.getCell(4).numFmt, '#,##0.00')

    const updated = await provider.updateTransaction(created.id, {
        kind: 'income',
        amount: 11,
        details: 'Unit test income',
        date: '2026-09-15',
        category: 'Interest',
        currency: 'CAD',
        notes: '',
    })
    assert.equal(updated.kind, 'income')
    assert.equal(updated.moneyIn, 11)
    await assert.rejects(provider.updateTransaction(created.id, {
        kind: 'income',
        amount: 11,
        details: 'Unit test income',
        date: '2026-09-15',
        category: 'Interest',
        currency: 'CAD',
        notes: '',
    }), ConflictError)

    await provider.deleteTransaction(updated.id)
    const afterDelete = await provider.getData(new Date(2026, 8, 15))
    assert.equal(afterDelete.transactions.length, 6)
    assert.equal(fs.existsSync(`${workbookFile}.bak`), true)
})

test('validates transaction input', async () => {
    const { provider } = setup()
    const base = { kind: 'expense', amount: 5, details: 'x', date: '2026-09-15', category: 'Snacks', currency: 'CAD', notes: '' }
    await assert.rejects(provider.addTransaction({ ...base, kind: 'transfer' }), ValidationError)
    await assert.rejects(provider.addTransaction({ ...base, category: 'Nope' }), ValidationError)
    await assert.rejects(provider.addTransaction({ ...base, currency: 'EUR' }), ValidationError)
    await assert.rejects(provider.addTransaction({ ...base, amount: 0 }), ValidationError)
    await assert.rejects(provider.addTransaction({ ...base, amount: 1.234 }), ValidationError)
    await assert.rejects(provider.addTransaction({ ...base, details: '' }), ValidationError)
    await assert.rejects(provider.addTransaction({ ...base, date: '2026-02-30' }), ValidationError)
    await assert.rejects(provider.addTransaction({ ...base, kind: 'income', category: 'Snacks' }), ValidationError)
})

test('writes per-currency budgets into the Constants sheet', async () => {
    const { provider, workbookFile } = setup()
    await provider.updateMonthlyBudget(2500, 900, 'CAD')
    await provider.updateMonthlyBudget(700, 50, 'USD')
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.readFile(workbookFile)
    const constants = workbook.getWorksheet('Constants')
    assert.equal(constants.getCell('A17').value, 'CAD')
    assert.equal(constants.getCell('B17').value, 2500)
    assert.equal(constants.getCell('C17').value, 900)
    assert.equal(constants.getCell('A18').value, 'USD')
    assert.equal(constants.getCell('B18').value, 700)
    assert.equal(constants.getCell('C18').value, 50)
    const data = await provider.getData(new Date(2026, 8, 15))
    assert.equal(currencyOf(data, 'CAD').monthlyBudget, 2500)
    assert.equal(currencyOf(data, 'CAD').firstDayBias, 900)
    assert.equal(currencyOf(data, 'USD').monthlyBudget, 700)
    assert.equal(currencyOf(data, 'USD').firstDayBias, 50)
    await assert.rejects(provider.updateMonthlyBudget(100, 0, 'EUR'), ValidationError)
    await assert.rejects(provider.updateMonthlyBudget(100, 0), ValidationError)
})

test('requires the workbook directory to be a git repository', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dscpln-nogit-'))
    fs.writeFileSync(path.join(dir, 'mock.xlsx'), '')
    assert.throws(
        () => createProvider({ workbookFile: path.join(dir, 'mock.xlsx') }, dir),
        /git repository/
    )
})

test('commits changes with the app identity, ignoring existing signing config', async () => {
    const { provider, dir } = setup()
    git(['config', 'commit.gpgsign', 'true'], dir)
    git(['config', 'user.signingkey', 'DEADBEEF'], dir)
    git(['config', 'user.name', 'Someone Else'], dir)
    git(['config', 'user.email', 'someone@example.com'], dir)

    await provider.addTransaction({
        kind: 'expense',
        amount: 1.25,
        details: 'Commit test',
        date: '2026-09-20',
        category: 'Snacks',
        currency: 'CAD',
        notes: '',
    })

    const log = git(['log', '-1', '--format=%an|%ae|%cn|%ce|%G?'], dir).trim()
    assert.equal(log, 'D$CPLN|dscpln@localhost|D$CPLN|dscpln@localhost|N')
    assert.equal(git(['status', '--porcelain', '--', 'mock.xlsx'], dir).trim(), '')
    // The repository's own config (including the hostile signing settings) is left untouched.
    assert.equal(git(['config', '--local', 'commit.gpgsign'], dir).trim(), 'true')
    assert.equal(git(['config', '--local', 'user.name'], dir).trim(), 'Someone Else')
})

test('suggests categories from history per kind', async () => {
    const { provider } = setup()
    const expense = await provider.suggestCategories('grocries', 'expense')
    assert.equal(expense.suggestions[0].category, 'Food Weekly')
    const income = await provider.suggestCategories('Jb', 'income')
    assert.equal(income.suggestions[0].category, 'Job')
    await assert.rejects(provider.suggestCategories('x', 'transfer'), ValidationError)
})
