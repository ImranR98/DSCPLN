'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { loadConfig } = require('../config')
const { createApp } = require('../server')

const startServer = async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dscpln-server-'))
    fs.writeFileSync(path.join(dir, 'data.txt'), '')
    fs.writeFileSync(path.join(dir, 'budget.txt'), '3000\n1470')
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({
        port: 3300,
        dataProvider: 'textFileDataProvider',
        providers: {
            textFileDataProvider: {
                dataFile: './data.txt',
                budgetFile: './budget.txt',
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

const jsonPost = (baseUrl, url, body, method = 'POST') => fetch(`${baseUrl}${url}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
})

test('serves bias-aware data and supports transaction CRUD', async (t) => {
    const { server, baseUrl } = await startServer()
    t.after(() => new Promise((resolve) => server.close(resolve)))

    let response = await fetch(`${baseUrl}/data?date=2026-10-03`)
    assert.equal(response.status, 200)
    let data = await response.json()
    assert.equal(data.monthlyBudget, 3000)
    assert.equal(data.monthsExpectedSpend, 1584.75)
    assert.equal(data.transactions.length, 0)

    response = await jsonPost(baseUrl, '/transactions', { amount: 25, description: 'lunch', date: '2026-10-03' })
    assert.equal(response.status, 201)
    const created = await response.json()

    response = await fetch(`${baseUrl}/data?date=2026-10-03`)
    data = await response.json()
    assert.equal(data.monthsSpend, 25)
    assert.equal(data.transactions[0].id, created.id)

    response = await jsonPost(baseUrl, `/transactions/${created.id}`, { amount: 30, description: 'lunch', date: '2026-10-03' }, 'PUT')
    assert.equal(response.status, 200)
    const updated = await response.json()
    assert.equal(updated.raw, '30 lunch 10 3')

    response = await jsonPost(baseUrl, `/transactions/${created.id}`, { amount: 31, description: 'lunch', date: '2026-10-03' }, 'PUT')
    assert.equal(response.status, 409)

    response = await fetch(`${baseUrl}/transactions/${updated.id}`, { method: 'DELETE' })
    assert.equal(response.status, 204)

    response = await fetch(`${baseUrl}/data?date=2026-10-03`)
    data = await response.json()
    assert.equal(data.monthsSpend, 0)
})

test('filters calculations and transactions by currency', async (t) => {
    const { server, baseUrl } = await startServer()
    t.after(() => new Promise((resolve) => server.close(resolve)))

    let response = await jsonPost(baseUrl, '/transactions', { amount: 40, description: 'usd lunch', date: '2026-10-03', currency: 'usd' })
    assert.equal(response.status, 201)
    const created = await response.json()
    assert.equal(created.currency, 'USD')
    assert.equal(created.raw, 'USD 40 usd lunch 10 3')

    response = await jsonPost(baseUrl, '/transactions', { amount: 10, description: 'local lunch', date: '2026-10-03' })
    assert.equal(response.status, 201)

    let data = await (await fetch(`${baseUrl}/data?date=2026-10-03`)).json()
    assert.equal(data.monthsSpend, 10)
    assert.deepEqual(data.currencies, ['USD'])
    assert.equal(data.transactions.length, 1)

    data = await (await fetch(`${baseUrl}/data?date=2026-10-03&currency=USD`)).json()
    assert.equal(data.monthsSpend, 40)
    assert.equal(data.transactions.length, 1)
    assert.equal(data.transactions[0].id, created.id)

    response = await fetch(`${baseUrl}/data?date=2026-10-03&currency=US`)
    assert.equal(response.status, 400)
})

test('rejects invalid input', async (t) => {
    const { server, baseUrl } = await startServer()
    t.after(() => new Promise((resolve) => server.close(resolve)))

    let response = await fetch(`${baseUrl}/data?date=nope`)
    assert.equal(response.status, 400)

    response = await jsonPost(baseUrl, '/transactions', { amount: -5, description: 'bad', date: '2026-10-03' })
    assert.equal(response.status, 400)

    response = await jsonPost(baseUrl, '/transactions', { amount: 5, description: 'bad 10 2', date: '2026-10-03' })
    assert.equal(response.status, 400)

    response = await fetch(`${baseUrl}/transactions/not-an-id`, {
        method: 'DELETE',
    })
    assert.equal(response.status, 400)

    response = await fetch(`${baseUrl}/transactions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{not json',
    })
    assert.equal(response.status, 400)
})
