'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { startServer, jsonRequest } = require('./helpers')

const token = async (baseUrl) => (await (await fetch(`${baseUrl}/token`)).json()).token

const api = (baseUrl, apiToken, url, method, body) => fetch(`${baseUrl}${url}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiToken}` },
    body: body === undefined ? undefined : JSON.stringify(body),
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
    const rejected = await api(baseUrl, first, '/api/transactions', 'POST', { amount: -5, details: 'x', currency: 'CAD', category: 'Snacks' })
    assert.equal(rejected.status, 401)
})

test('requires the API token on the external API', async (t) => {
    const { server, baseUrl } = await startServer()
    t.after(() => new Promise((resolve) => server.close(resolve)))

    const anonymous = await fetch(`${baseUrl}/api/transactions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: -5, details: 'x', currency: 'CAD' }),
    })
    assert.equal(anonymous.status, 401)
    assert.equal((await anonymous.json()).error, 'Invalid or missing API token')

    const wrong = await api(baseUrl, 'wrong-token', '/api/transactions', 'POST', { amount: -5, details: 'x', currency: 'CAD' })
    assert.equal(wrong.status, 401)
})

test('adds transactions from a signed amount, auto-assigning and correcting the category', async (t) => {
    const { server, baseUrl } = await startServer()
    t.after(() => new Promise((resolve) => server.close(resolve)))
    const apiToken = await token(baseUrl)

    // Positive amount = income; an explicit category gives no edit token.
    let response = await api(baseUrl, apiToken, '/api/transactions', 'POST', {
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
    assert.equal(body.assignedCategory, undefined)
    assert.equal(body.editToken, undefined)

    // Negative amount = expense; a missing category is auto-assigned and the
    // response carries a one-transaction edit token. The date defaults to today.
    response = await api(baseUrl, apiToken, '/api/transactions', 'POST', {
        amount: -12.34,
        details: 'Groceries',
        currency: 'CAD',
    })
    assert.equal(response.status, 201)
    body = await response.json()
    assert.equal(body.transaction.kind, 'expense')
    assert.equal(body.transaction.expenses, 12.34)
    assert.equal(body.transaction.date, todayIso())
    assert.equal(body.transaction.category, 'Food Weekly')
    assert.equal(body.assignedCategory, 'Food Weekly')
    assert.ok(body.editToken)

    // The edit token can change only that transaction's category.
    response = await api(baseUrl, apiToken, `/api/transactions/${body.editToken}`, 'PATCH', { category: 'Rent' })
    assert.equal(response.status, 200)
    const updated = (await response.json()).transaction
    assert.equal(updated.category, 'Rent')
    assert.equal(updated.expenses, 12.34)
    assert.equal(updated.details, 'Groceries')
    assert.equal(updated.kind, 'expense')

    // A successful correction changes the transaction id, so the token is
    // single-use; retrying with it fails rather than editing the wrong row.
    response = await api(baseUrl, apiToken, `/api/transactions/${body.editToken}`, 'PATCH', { category: 'Snacks' })
    assert.equal(response.status, 409)
    assert.match((await response.json()).error, /changed since the edit token/)
})

test('rejects bad API requests as JSON', async (t) => {
    const { server, baseUrl } = await startServer()
    t.after(() => new Promise((resolve) => server.close(resolve)))
    const apiToken = await token(baseUrl)

    const zero = await api(baseUrl, apiToken, '/api/transactions', 'POST', {
        amount: 0, details: 'Zero', currency: 'CAD', category: 'Snacks',
    })
    assert.equal(zero.status, 400)
    assert.match((await zero.json()).error, /non-zero/)

    const unassignable = await api(baseUrl, apiToken, '/api/transactions', 'POST', {
        amount: -5, details: 'zzzqwertyuiop', currency: 'CAD',
    })
    assert.equal(unassignable.status, 422)
    const unassignableBody = await unassignable.json()
    assert.match(unassignableBody.error, /Could not assign a category/)
    assert.ok(Array.isArray(unassignableBody.suggestions))

    const missingDetails = await api(baseUrl, apiToken, '/api/transactions', 'POST', {
        amount: -5, currency: 'CAD',
    })
    assert.equal(missingDetails.status, 400)
    assert.match((await missingDetails.json()).error, /Details is required/)

    const badEditToken = await api(baseUrl, apiToken, '/api/transactions/not-a-token', 'PATCH', { category: 'Snacks' })
    assert.equal(badEditToken.status, 401)
    assert.match((await badEditToken.json()).error, /edit token/i)

    const badJson = await fetch(`${baseUrl}/api/transactions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiToken}` },
        body: '{not json',
    })
    assert.equal(badJson.status, 400)
    assert.equal((await badJson.json()).error, 'Invalid JSON body')

    const unknown = await api(baseUrl, apiToken, '/api/nope', 'POST', {})
    assert.equal(unknown.status, 404)
    assert.equal((await unknown.json()).error, 'Not found')
})
