'use strict'

import test from 'node:test'
import assert from 'node:assert/strict'
import { startServer, jsonRequest } from './helpers.mjs'

test('serves workbook data with categories, currencies and income stats', async (t) => {
    const { server, baseUrl } = await startServer()
    t.after(() => new Promise((resolve) => server.close(resolve)))

    const response = await fetch(`${baseUrl}/data?date=2026-09-15`)
    assert.equal(response.status, 200)
    const data = await response.json()
    assert.deepEqual(data.currencies.map((entry) => entry.code), ['CAD', 'USD', 'XMR'])
    const cad = data.currencies.find((entry) => entry.code === 'CAD')
    assert.equal(cad.primary, true)
    assert.equal(cad.symbol, '$')
    assert.equal(data.currencies.find((entry) => entry.code === 'XMR').symbol, null)
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
    assert.deepEqual(data.conversionCategories, ['Conversion'])
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
    assert.match(await response.text(), /<title>D\$CPLN ⋅ Balance XLSX — Insights<\/title>/)
})

test('serves and saves forecast scenario sheets', async (t) => {
    const { server, baseUrl } = await startServer()
    t.after(() => new Promise((resolve) => server.close(resolve)))

    let response = await fetch(`${baseUrl}/forecast`)
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { scenario: null, errors: [] })

    const scenario = {
        name: 'Base plan',
        currency: 'CAD',
        asOf: '2026-09-15',
        horizonMonths: 24,
        baselineMonths: 6,
        notes: '',
        target: { label: 'Savings target', amount: 100000, date: null },
        accounts: [{ name: 'Chequing', balance: 12000, include: true }],
        events: [{ date: '2027-01-15', details: 'Plane tickets', kind: 'expense', amount: 2500, notes: '' }],
        overrides: { income: { Job: 5000 }, expense: {} },
        excludedCategories: [],
    }
    response = await jsonRequest(baseUrl, '/forecast', {
        scenario: { sheetName: null, revision: 0, ...scenario },
    }, 'PUT')
    assert.equal(response.status, 200)
    const saved = await response.json()
    assert.equal(saved.scenario.sheetName, 'Scenario - Base plan')
    assert.equal(saved.scenario.revision, 1)

    const stale = await jsonRequest(baseUrl, '/forecast', {
        scenario: { ...saved.scenario, revision: 0 },
    }, 'PUT')
    assert.equal(stale.status, 409)

    response = await fetch(`${baseUrl}/forecast`)
    assert.equal((await response.json()).scenario.sheetName, 'Scenario - Base plan')

    response = await fetch(`${baseUrl}/forecasts`)
    assert.equal(response.status, 200)
    assert.match(await response.text(), /<title>D\$CPLN ⋅ Balance XLSX — Forecasts<\/title>/)
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

test('serves and overrides the default excluded categories', async (t) => {
    const { server, baseUrl } = await startServer()
    t.after(() => new Promise((resolve) => server.close(resolve)))

    const spent = (data) => data.currencies.find((entry) => entry.code === 'CAD').monthsSpend
    const readData = async (query = '') => (await fetch(`${baseUrl}/data?date=2026-09-15${query}`)).json()

    // The workbook default (Investment Buy/Sell) is surfaced and applied.
    const defaults = await readData()
    assert.deepEqual(defaults.defaultExcludedCategories, ['Investment Buy', 'Investment Sell'])

    // Repeated ?exclude= params override it for the view.
    const explicit = await readData('&exclude=Rent')
    assert.ok(Math.abs((spent(defaults) - spent(explicit)) - 1275) < 1e-9)
    const all = await readData('&exclude=')
    assert.equal(spent(all), spent(defaults))

    // The write route persists a new default list (validated, sheet-ordered).
    let response = await jsonRequest(baseUrl, '/excluded-defaults', { categories: ['Snacks', 'Rent'] })
    assert.equal(response.status, 200)
    assert.deepEqual((await response.json()).defaultExcludedCategories, ['Rent', 'Snacks'])
    const updated = await readData()
    assert.deepEqual(updated.defaultExcludedCategories, ['Rent', 'Snacks'])
    assert.ok(Math.abs((spent(defaults) - spent(updated)) - 1275) < 1e-9)

    response = await jsonRequest(baseUrl, '/excluded-defaults', { categories: ['Nope'] })
    assert.equal(response.status, 400)
    assert.match(await response.text(), /Unknown category/)
    response = await jsonRequest(baseUrl, '/excluded-defaults', {})
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
