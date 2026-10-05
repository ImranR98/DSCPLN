'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const http = require('http')
const { startNotifications } = require('../notifications')

const waitFor = async (predicate) => {
    for (let i = 0; i < 100; i++) {
        if (predicate()) {
            return
        }
        await new Promise((resolve) => setTimeout(resolve, 10))
    }
    throw new Error('Timed out waiting for condition')
}

test('retries a failed budget notification while spend is unchanged', async (t) => {
    let requests = 0
    let fail = true
    const server = http.createServer((req, res) => {
        requests += 1
        res.statusCode = fail ? 500 : 200
        res.end()
    })
    await new Promise((resolve) => server.listen(0, resolve))
    t.after(() => new Promise((resolve) => server.close(resolve)))

    const provider = {
        getData: async () => ({ currencies: [{ code: 'CAD', monthlyBudget: 100, monthsSpend: 120 }] }),
    }
    const realSetInterval = global.setInterval
    let tick = null
    global.setInterval = (callback) => {
        tick = callback
        return { unref() { } }
    }
    try {
        startNotifications({
            notifications: {
                monthlyLimitUrl: `http://127.0.0.1:${server.address().port}/topic`,
                ntfyToken: null,
                checkIntervalMinutes: 30,
                onlyWarnOnce: false,
            },
        }, provider)
    } finally {
        global.setInterval = realSetInterval
    }
    assert.equal(typeof tick, 'function')

    await waitFor(() => requests === 1) // the startup check fails
    await tick()                        // same spend: the failure must retry
    assert.equal(requests, 2)

    fail = false
    await tick()
    assert.equal(requests, 3)

    await tick() // settled at this spend level: no repeat
    assert.equal(requests, 3)
})
