'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const createProvider = require('../dataProviders/textFileDataProvider')
const { ValidationError, ConflictError } = require('../errors')

const createFixture = (lines = '', budget = '3000\n1470') => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dscpln-provider-'))
    const dataFile = path.join(dir, 'data.txt')
    fs.writeFileSync(dataFile, lines)
    fs.writeFileSync(path.join(dir, 'budget.txt'), budget)
    const provider = createProvider({ dataFile: './data.txt', budgetFile: './budget.txt' }, dir)
    return { dir, dataFile, provider }
}

test('parses transactions and inherited dates', async () => {
    const { provider } = createFixture('50 rent 10 2\n10 coffee\n20 lunch 10 4\n')
    const data = await provider.getData(new Date(2026, 9, 5))
    assert.deepEqual(data.transactions.map(t => t.date), [
        { month: 10, day: 2 },
        null,
        { month: 10, day: 4 },
    ])
    assert.deepEqual(data.transactions.map(t => t.effectiveDate), [
        { month: 10, day: 2 },
        { month: 10, day: 2 },
        { month: 10, day: 4 },
    ])
    assert.deepEqual(data.transactions.map(t => t.description), ['rent', 'coffee', 'lunch'])
})

test('only counts spending through the viewed day', async () => {
    const { provider } = createFixture('100 a 10 2\n50 b 10 9\n25 c 10 10\n')
    let data = await provider.getData(new Date(2026, 9, 9))
    assert.equal(data.monthsSpend, 150)
    assert.equal(data.weeksSpend, 150)
    assert.equal(data.transactions.length, 3)
    data = await provider.getData(new Date(2026, 9, 10))
    assert.equal(data.monthsSpend, 175)
    assert.equal(data.weeksSpend, 175)
})

test('computes first day bias aware expected spend', async () => {
    const { provider } = createFixture()
    const data = await provider.getData(new Date(2026, 9, 3))
    assert.equal(data.writable, true)
    assert.equal(data.weeklyBudget, 1852.5)
    assert.equal(data.weeksExpectedSpend, 1584.75)
    assert.equal(data.monthsExpectedSpend, 1584.75)
    assert.equal(data.weekPeriodStartDay, 1)
    assert.equal(data.weekPeriodEndDay, 10)
})

test('adds transactions with explicit dates and preserves CRLF', async () => {
    const { provider, dataFile } = createFixture('50 a 10 2\r\n10 b\r\n')
    const created = await provider.addTransaction({ amount: 12.5, description: 'new thing', date: '2026-10-15' })
    assert.equal(created.raw, '12.5 new thing 10 15')
    assert.equal(fs.readFileSync(dataFile, 'utf8'), '50 a 10 2\r\n10 b\r\n12.5 new thing 10 15\r\n')
    const data = await provider.getData(new Date(2026, 9, 15))
    assert.equal(data.monthsSpend, 72.5)
})

test('updates transactions and rejects stale ids', async () => {
    const { provider, dataFile } = createFixture('50 a 10 2\n10 b\n')
    const data = await provider.getData(new Date(2026, 9, 3))
    const target = data.transactions[0]
    const updated = await provider.updateTransaction(target.id, { amount: 60, description: 'a', date: '2026-10-02' })
    assert.equal(updated.raw, '60 a 10 2')
    assert.equal(fs.readFileSync(dataFile, 'utf8'), '60 a 10 2\n10 b\n')
    await assert.rejects(
        provider.updateTransaction(target.id, { amount: 1, description: 'x', date: '2026-10-02' }),
        ConflictError
    )
})

test('deletes transactions and heals inherited dates', async () => {
    const { provider, dataFile } = createFixture('50 rent 10 2\n10 coffee\n20 lunch\n')
    const data = await provider.getData(new Date(2026, 9, 3))
    await provider.deleteTransaction(data.transactions[0].id)
    assert.equal(fs.readFileSync(dataFile, 'utf8'), '10 coffee 10 2\n20 lunch\n')
    const after = await provider.getData(new Date(2026, 9, 3))
    assert.deepEqual(after.transactions.map(t => t.effectiveDate), [
        { month: 10, day: 2 },
        { month: 10, day: 2 },
    ])
})

test('leaves later explicit dates alone when deleting', async () => {
    const { provider, dataFile } = createFixture('50 rent 10 2\n10 coffee 10 5\n')
    const data = await provider.getData(new Date(2026, 9, 6))
    await provider.deleteTransaction(data.transactions[0].id)
    assert.equal(fs.readFileSync(dataFile, 'utf8'), '10 coffee 10 5\n')
})

test('parses currency lines and excludes them by default', async () => {
    const { provider } = createFixture('USD 50 lunch 10 2\n20 local\nEUR 5 coffee 10 3\n')
    const data = await provider.getData(new Date(2026, 9, 5))
    assert.deepEqual(data.currencies, ['EUR', 'USD'])
    assert.equal(data.transactions.length, 1)
    assert.equal(data.transactions[0].description, 'local')
    assert.equal(data.transactions[0].currency, null)
    assert.equal(data.monthsSpend, 20)
    assert.equal(data.weeksSpend, 20)
})

test('includes the selected currency in calculations', async () => {
    const { provider } = createFixture('USD 50 lunch 10 2\n20 local\nUSD 10 coffee\n')
    const data = await provider.getData(new Date(2026, 9, 5), 'usd')
    assert.equal(data.monthsSpend, 60)
    assert.equal(data.weeksSpend, 60)
    assert.equal(data.transactions.length, 2)
    assert.deepEqual(data.transactions.map(t => t.currency), ['USD', 'USD'])
    assert.deepEqual(data.transactions.map(t => t.effectiveDate), [
        { month: 10, day: 2 },
        { month: 10, day: 2 },
    ])
})

test('rejects invalid currency filters', async () => {
    const { provider } = createFixture('')
    await assert.rejects(provider.getData(new Date(2026, 9, 5), 'US'), ValidationError)
    await assert.rejects(provider.getData(new Date(2026, 9, 5), 'US1'), ValidationError)
})

test('adds, updates, and clears currency prefixes', async () => {
    const { provider, dataFile } = createFixture('')
    const created = await provider.addTransaction({ amount: 10, description: 'x', date: '2026-10-02', currency: 'usd' })
    assert.equal(created.raw, 'USD 10 x 10 2')
    assert.equal(created.currency, 'USD')
    const updated = await provider.updateTransaction(created.id, { amount: 11, description: 'x', date: '2026-10-02', currency: '' })
    assert.equal(updated.raw, '11 x 10 2')
    assert.equal(updated.currency, null)
    assert.equal(fs.readFileSync(dataFile, 'utf8'), '11 x 10 2\n')
})

test('rejects invalid currency input', async () => {
    const { provider } = createFixture('')
    await assert.rejects(provider.addTransaction({ amount: 5, description: 'x', date: '2026-10-02', currency: 'US' }), ValidationError)
    await assert.rejects(provider.addTransaction({ amount: 5, description: 'x', date: '2026-10-02', currency: 'US1' }), ValidationError)
    await assert.rejects(provider.addTransaction({ amount: 5, description: 'x', date: '2026-10-02', currency: 'us dollar' }), ValidationError)
})

test('preserves currency when healing dates on delete', async () => {
    const { provider, dataFile } = createFixture('50 rent 10 2\nUSD 10 coffee\n')
    const data = await provider.getData(new Date(2026, 9, 3))
    await provider.deleteTransaction(data.transactions[0].id)
    assert.equal(fs.readFileSync(dataFile, 'utf8'), 'USD 10 coffee 10 2\n')
    const usd = await provider.getData(new Date(2026, 9, 3), 'USD')
    assert.deepEqual(usd.transactions[0].effectiveDate, { month: 10, day: 2 })
})

test('validates transaction input', async () => {
    const { provider } = createFixture()
    await assert.rejects(provider.addTransaction({ amount: 0, description: 'x', date: '2026-10-02' }), ValidationError)
    await assert.rejects(provider.addTransaction({ amount: 5, description: '   ', date: '2026-10-02' }), ValidationError)
    await assert.rejects(provider.addTransaction({ amount: 5, description: 'rent 10 2', date: '2026-10-02' }), ValidationError)
    await assert.rejects(provider.addTransaction({ amount: 5, description: 'x', date: '2026-02-30' }), ValidationError)
    await assert.rejects(provider.addTransaction({ amount: 5, description: 'x', date: 'tomorrow' }), ValidationError)
    await assert.rejects(provider.addTransaction({ amount: 1.234, description: 'x', date: '2026-10-02' }), ValidationError)
})
