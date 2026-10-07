'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { startServer, jsonRequest } = require('./helpers')

const token = async (baseUrl) => (await (await fetch(`${baseUrl}/token`)).json()).token

const api = (baseUrl, apiToken, url, options = {}) => fetch(`${baseUrl}${url}`, {
    ...options,
    headers: { Authorization: `Bearer ${apiToken}`, ...(options.headers || {}) },
})

const postJson = (baseUrl, apiToken, url, body) => api(baseUrl, apiToken, url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
})

const todayIso = () => {
    const date = new Date()
    const pad = (value) => String(value).padStart(2, '0')
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

test('serves the settings page and rotates the API token', async (t) => {
    const { server, baseUrl } = await startServer()
    t.after(() => new Promise((resolve) => server.close(resolve)))

    const page = await fetch(`${baseUrl}/settings`)
    assert.equal(page.status, 200)
    assert.match(await page.text(), /API token/)

    const first = await token(baseUrl)
    assert.ok(first.length > 20)
    const response = await jsonRequest(baseUrl, '/token/regenerate', {})
    assert.equal(response.status, 200)
    const second = (await response.json()).token
    assert.notEqual(second, first)
    assert.equal(await token(baseUrl), second)

    // The old token stops working immediately.
    const rejected = await api(baseUrl, first, '/api/categories')
    assert.equal(rejected.status, 401)
})

test('requires the API token on the external API', async (t) => {
    const { server, baseUrl } = await startServer()
    t.after(() => new Promise((resolve) => server.close(resolve)))

    const anonymous = await fetch(`${baseUrl}/api/categories`)
    assert.equal(anonymous.status, 401)
    assert.equal((await anonymous.json()).error, 'Invalid or missing API token')

    const wrong = await api(baseUrl, 'wrong-token', '/api/categories')
    assert.equal(wrong.status, 401)
    const wrongPost = await postJson(baseUrl, 'wrong-token', '/api/transactions', {
        amount: -1, details: 'x', currency: 'CAD', category: 'Snacks',
    })
    assert.equal(wrongPost.status, 401)
})

test('lists and scores categories', async (t) => {
    const { server, baseUrl } = await startServer()
    t.after(() => new Promise((resolve) => server.close(resolve)))
    const apiToken = await token(baseUrl)

    // No parameters: every group in sheet order, all scores zero.
    let response = await api(baseUrl, apiToken, '/api/categories')
    assert.equal(response.status, 200)
    let body = await response.json()
    assert.deepEqual(body.groups.map((entry) => entry.group),
        ['Main Expenses', 'Extra Expenses', 'Special Expenses', 'Money In', 'Conversions'])
    assert.equal(body.groups.every((entry) => entry.categories.every((category) => category.score === 0)), true)

    // Scoring covers every category of the kind, best match first.
    response = await api(baseUrl, apiToken, '/api/categories?details=grocries&kind=expense')
    assert.equal(response.status, 200)
    body = await response.json()
    assert.equal(body.groups.some((entry) => entry.group === 'Money In'), false)
    const categories = body.groups.flatMap((entry) => entry.categories)
    assert.ok(categories.find((entry) => entry.category === 'Food Weekly').score > 0.5)
    assert.equal(categories.some((entry) => entry.category === 'Medical' && entry.score === 0), true)

    // kind without details is a plain filtered list.
    response = await api(baseUrl, apiToken, '/api/categories?kind=income')
    body = await response.json()
    assert.deepEqual(body.groups.map((entry) => entry.group), ['Money In', 'Conversions'])
    assert.equal(body.groups.every((entry) => entry.categories.every((category) => category.score === 0)), true)

    // details without kind, and unknown kinds, are client errors.
    response = await api(baseUrl, apiToken, '/api/categories?details=coffee')
    assert.equal(response.status, 400)
    assert.match((await response.json()).error, /kind is required/)
    response = await api(baseUrl, apiToken, '/api/categories?details=coffee&kind=transfer')
    assert.equal(response.status, 400)
    assert.match((await response.json()).error, /Kind must be/)
})

test('adds transactions with a required category', async (t) => {
    const { server, baseUrl } = await startServer()
    t.after(() => new Promise((resolve) => server.close(resolve)))
    const apiToken = await token(baseUrl)

    // Positive amount = income; the date defaults to today.
    let response = await postJson(baseUrl, apiToken, '/api/transactions', {
        amount: 50,
        details: 'API refund',
        currency: 'CAD',
        category: 'Other Earnings',
    })
    assert.equal(response.status, 201)
    let body = await response.json()
    assert.equal(body.transaction.kind, 'income')
    assert.equal(body.transaction.moneyIn, 50)
    assert.equal(body.transaction.category, 'Other Earnings')
    assert.equal(body.transaction.date, todayIso())

    // Negative amount = expense.
    response = await postJson(baseUrl, apiToken, '/api/transactions', {
        amount: -12.34,
        details: 'Groceries',
        currency: 'CAD',
        category: 'Food Weekly',
        date: '2026-09-10',
    })
    assert.equal(response.status, 201)
    body = await response.json()
    assert.equal(body.transaction.kind, 'expense')
    assert.equal(body.transaction.expenses, 12.34)
    assert.equal(body.transaction.date, '2026-09-10')

    // The category is required, must exist, and must fit the kind.
    response = await postJson(baseUrl, apiToken, '/api/transactions', { amount: -5, details: 'No category', currency: 'CAD' })
    assert.equal(response.status, 400)
    assert.match((await response.json()).error, /Category is required/)

    response = await postJson(baseUrl, apiToken, '/api/transactions', { amount: -5, details: 'Bad', currency: 'CAD', category: 'Nope' })
    assert.equal(response.status, 400)
    assert.match((await response.json()).error, /Category must be one of/)

    response = await postJson(baseUrl, apiToken, '/api/transactions', { amount: -5, details: 'Mismatch', currency: 'CAD', category: 'Job' })
    assert.equal(response.status, 400)

    const zero = await postJson(baseUrl, apiToken, '/api/transactions', { amount: 0, details: 'Zero', currency: 'CAD', category: 'Snacks' })
    assert.equal(zero.status, 400)
    assert.match((await zero.json()).error, /non-zero/)

    const badJson = await fetch(`${baseUrl}/api/transactions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiToken}` },
        body: '{not json',
    })
    assert.equal(badJson.status, 400)
    assert.equal((await badJson.json()).error, 'Invalid JSON body')

    const unknown = await postJson(baseUrl, apiToken, '/api/nope', {})
    assert.equal(unknown.status, 404)
    assert.equal((await unknown.json()).error, 'Not found')
})
