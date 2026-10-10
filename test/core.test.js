'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const http = require('http')
const { requestJson, moneyFor } = require('../static/core')

test('moneyFor uses stored symbols and leaves symbol-less currencies bare', () => {
    const symbols = { CAD: '$', GBP: '£', TZS: 'TSh' }
    const money = moneyFor(() => false, (code) => symbols[code])
    assert.equal(money(12.5, 'CAD'), '$12.50')
    assert.equal(money(-12.5, 'GBP'), '−£12.50')
    assert.equal(money(0.05, 'TZS'), 'TSh0.05')
    // No symbol means no prefix (the currency code is shown elsewhere).
    assert.equal(money(12.5, 'XMR'), '12.50')
})

test('requestJson parses JSON and tolerates empty success bodies', async (t) => {
    const server = http.createServer((req, res) => {
        if (req.url === '/json') {
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ ok: true }))
        } else if (req.url === '/empty') {
            res.end()
        } else if (req.url === '/none') {
            res.statusCode = 204
            res.end()
        } else {
            res.statusCode = 400
            res.end('bad request')
        }
    })
    await new Promise((resolve) => server.listen(0, resolve))
    t.after(() => new Promise((resolve) => server.close(resolve)))
    const baseUrl = `http://127.0.0.1:${server.address().port}`

    assert.deepEqual(await requestJson(`${baseUrl}/json`), { ok: true })
    assert.equal(await requestJson(`${baseUrl}/empty`), null)
    assert.equal(await requestJson(`${baseUrl}/none`), null)
    await assert.rejects(requestJson(`${baseUrl}/bad`), (e) => e.status === 400 && e.message === 'bad request')
})
