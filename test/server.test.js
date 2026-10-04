'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync } = require('child_process')
const { loadConfig } = require('../config')
const { createApp } = require('../server')

const startServer = async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dscpln-server-'))
    fs.copyFileSync(path.join(__dirname, '..', 'mock-data.xlsx'), path.join(dir, 'mock.xlsx'))
    execFileSync('git', ['init', '-q'], { cwd: dir })
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({
        port: 3300,
        dataProvider: 'excelDataProvider',
        providers: {
            excelDataProvider: {
                workbookFile: './mock.xlsx',
            },
        },
    }))
    const config = loadConfig(path.join(dir, 'config.json'))
    const { app } = createApp(config)
    const server = app.listen(0)
    await new Promise((resolve) => server.once('listening', resolve))
    return {
        server,
        baseUrl: `http://127.0.0.1:${server.address().port}`,
    }
}

const jsonRequest = (baseUrl, url, body, method = 'POST') => fetch(`${baseUrl}${url}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
})

test('serves workbook data with categories, currencies and income stats', async (t) => {
    const { server, baseUrl } = await startServer()
    t.after(() => new Promise((resolve) => server.close(resolve)))

    const response = await fetch(`${baseUrl}/data?date=2026-09-15`)
    assert.equal(response.status, 200)
    const data = await response.json()
    assert.deepEqual(data.currencies.map((entry) => entry.code), ['CAD', 'USD', 'XMR'])
    const cad = data.currencies.find((entry) => entry.code === 'CAD')
    assert.equal(cad.primary, true)
    assert.equal(cad.monthlyBudget, 3000)
    assert.equal(cad.firstDayBias, 1500)
    assert.equal(cad.monthsIncome, 2645)
    assert.equal(cad.previousMonthsIncome, 2640)
    assert.equal(cad.trailingIncomeAverage, 2632.5)
    assert.equal(typeof cad.previousMonthsSpend, 'number')
    assert.equal(typeof cad.trailingSpendAverage, 'number')
    assert.equal('monthlyBudget' in data, false)
    assert.equal(data.history.length, 12)
    assert.deepEqual([data.history[11].year, data.history[11].month], [2026, 9])
    assert.equal(data.history[11].currencies.CAD.spend, 1472.23)
    assert.equal(data.transactions.length, 6)
    assert.equal(data.categories.find((entry) => entry.group === 'Money In').categories.includes('Job'), true)
})

test('supports transaction CRUD and category suggestions', async (t) => {
    const { server, baseUrl } = await startServer()
    t.after(() => new Promise((resolve) => server.close(resolve)))

    let response = await jsonRequest(baseUrl, '/transactions', {
        kind: 'expense',
        amount: 25,
        details: 'Unit lunch',
        date: '2026-09-15',
        category: 'Snacks',
        currency: 'CAD',
        notes: '',
    })
    assert.equal(response.status, 201)
    const created = await response.json()
    assert.equal(created.expenses, 25)

    let data = await (await fetch(`${baseUrl}/data?date=2026-09-15`)).json()
    assert.equal(data.transactions.length, 7)

    response = await jsonRequest(baseUrl, `/transactions/${created.id}`, {
        kind: 'income',
        amount: 30,
        details: 'Unit lunch',
        date: '2026-09-15',
        category: 'Interest',
        currency: 'CAD',
        notes: '',
    }, 'PUT')
    assert.equal(response.status, 200)
    const updated = await response.json()
    assert.equal(updated.kind, 'income')
    assert.equal(updated.moneyIn, 30)

    response = await jsonRequest(baseUrl, `/transactions/${created.id}`, {
        kind: 'income',
        amount: 31,
        details: 'Unit lunch',
        date: '2026-09-15',
        category: 'Interest',
        currency: 'CAD',
        notes: '',
    }, 'PUT')
    assert.equal(response.status, 409)

    response = await fetch(`${baseUrl}/transactions/${updated.id}`, { method: 'DELETE' })
    assert.equal(response.status, 204)

    response = await fetch(`${baseUrl}/category-suggestions?q=grocries&kind=expense`)
    assert.equal(response.status, 200)
    const suggestions = await response.json()
    assert.equal(suggestions.suggestions[0].category, 'Food Weekly')

    response = await fetch(`${baseUrl}/category-suggestions?q=grocries&kind=transfer`)
    assert.equal(response.status, 400)
})

test('suggests transaction details from history', async (t) => {
    const { server, baseUrl } = await startServer()
    t.after(() => new Promise((resolve) => server.close(resolve)))

    let response = await fetch(`${baseUrl}/details-suggestions?q=net`)
    assert.equal(response.status, 200)
    const body = await response.json()
    assert.equal(body.suggestions[0].details, 'Netflix')

    response = await fetch(`${baseUrl}/details-suggestions?q=net&kind=income`)
    assert.equal(response.status, 200)
    assert.deepEqual((await response.json()).suggestions, [])

    response = await fetch(`${baseUrl}/details-suggestions?q=x&kind=transfer`)
    assert.equal(response.status, 400)
})

test('serves transactions for a date range and the insights page', async (t) => {
    const { server, baseUrl } = await startServer()
    t.after(() => new Promise((resolve) => server.close(resolve)))

    let response = await fetch(`${baseUrl}/transactions?start=2026-09-01&end=2026-09-30`)
    assert.equal(response.status, 200)
    const body = await response.json()
    assert.equal(body.transactions.length, 6)
    assert.equal(body.transactions[0].date, '2026-09-01')

    response = await fetch(`${baseUrl}/transactions?start=2026-09-30&end=2026-09-01`)
    assert.equal(response.status, 400)

    response = await fetch(`${baseUrl}/transactions`)
    assert.equal(response.status, 400)

    response = await fetch(`${baseUrl}/insights`)
    assert.equal(response.status, 200)
    assert.match(await response.text(), /<title>D\$CPLN Insights<\/title>/)
})

test('imports transactions and rejects invalid batches atomically', async (t) => {
    const { server, baseUrl } = await startServer()
    t.after(() => new Promise((resolve) => server.close(resolve)))

    let response = await jsonRequest(baseUrl, '/transactions/import', {
        text: '2026-09-08\tCASH Dividend\t29.77\t\tCAD\tDividend\n2026-09-09\tNo amount\t\t\tCAD\tDividend',
    })
    assert.equal(response.status, 400)
    assert.match(await response.text(), /Line 2: Fill one of Money In or Expenses/)
    let data = await (await fetch(`${baseUrl}/data?date=2026-09-15`)).json()
    assert.equal(data.transactions.length, 6)

    response = await jsonRequest(baseUrl, '/transactions/import', {
        text: '2026-09-08\tCASH Dividend\t29.77\t\tCAD\tDividend\n2026-09-30\tXBAL Dividend reinvested\t\t52.21\tCAD\tInvestment Buy',
    })
    assert.equal(response.status, 201)
    const result = await response.json()
    assert.equal(result.imported, 2)
    data = await (await fetch(`${baseUrl}/data?date=2026-09-15`)).json()
    assert.equal(data.transactions.length, 8)
    assert.equal(data.transactions.some((transaction) => transaction.details === 'XBAL Dividend reinvested'), true)
    assert.deepEqual(data.transactionColumns, ['Date', 'Details', 'Money In', 'Expenses', 'Currency', 'Type', 'Notes'])
})

test('writes per-currency budget updates to the Constants sheet', async (t) => {
    const { server, baseUrl } = await startServer()
    t.after(() => new Promise((resolve) => server.close(resolve)))

    let response = await jsonRequest(baseUrl, '/budget', { monthlyBudget: 2800, firstDayBias: 1000, currency: 'USD' })
    assert.equal(response.status, 200)
    const data = await (await fetch(`${baseUrl}/data?date=2026-09-15`)).json()
    const usd = data.currencies.find((entry) => entry.code === 'USD')
    assert.equal(usd.monthlyBudget, 2800)
    assert.equal(usd.firstDayBias, 1000)
    const cad = data.currencies.find((entry) => entry.code === 'CAD')
    assert.equal(cad.monthlyBudget, 3000)
    assert.equal(cad.firstDayBias, 1500)

    response = await jsonRequest(baseUrl, '/budget', { monthlyBudget: 100, firstDayBias: 0 })
    assert.equal(response.status, 400)
})

test('rejects invalid input', async (t) => {
    const { server, baseUrl } = await startServer()
    t.after(() => new Promise((resolve) => server.close(resolve)))

    let response = await fetch(`${baseUrl}/data?date=nope`)
    assert.equal(response.status, 400)

    response = await jsonRequest(baseUrl, '/transactions', {
        kind: 'expense',
        amount: -5,
        details: 'bad',
        date: '2026-09-15',
        category: 'Snacks',
        currency: 'CAD',
    })
    assert.equal(response.status, 400)

    response = await jsonRequest(baseUrl, '/transactions', {
        kind: 'expense',
        amount: 5,
        details: 'bad',
        date: '2026-09-15',
        category: 'Not a category',
        currency: 'CAD',
    })
    assert.equal(response.status, 400)

    response = await fetch(`${baseUrl}/transactions/not-an-id`, { method: 'DELETE' })
    assert.equal(response.status, 400)

    response = await fetch(`${baseUrl}/transactions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{not json',
    })
    assert.equal(response.status, 400)
})
