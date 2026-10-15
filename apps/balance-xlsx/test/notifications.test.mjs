'use strict'

import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { startNotifications } from '../notifications.mjs'

const waitFor = async (predicate) => {
    for (let i = 0; i < 100; i++) {
        if (predicate()) {
            return
        }
        await new Promise((resolve) => setTimeout(resolve, 10))
    }
    throw new Error('Timed out waiting for condition')
}

// Minimal portal relay stand-in: records notification payloads and can be
// flipped to fail so retry semantics stay testable.
const fakeRelay = async (t) => {
    const received = []
    let fail = true
    const server = http.createServer((req, res) => {
        let body = ''
        req.on('data', (chunk) => (body += chunk))
        req.on('end', () => {
            received.push(JSON.parse(body))
            res.statusCode = fail ? 500 : 200
            res.setHeader('Content-Type', 'application/json')
            res.end(fail ? '{"error":"boom"}' : '{"ok":true}')
        })
    })
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    t.after(() => new Promise((resolve) => server.close(resolve)))
    return {
        url: `http://127.0.0.1:${server.address().port}`,
        received,
        setFail: (value) => { fail = value },
        count: () => received.length,
    }
}

test('retries a failed budget notification while spend is unchanged', async (t) => {
    const relay = await fakeRelay(t)

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
                checkIntervalMinutes: 30,
                onlyWarnOnce: false,
            },
        }, provider, { relayUrl: relay.url })
    } finally {
        global.setInterval = realSetInterval
    }
    assert.equal(typeof tick, 'function')

    await waitFor(() => relay.count() === 1) // the startup check fails
    await tick()                             // same spend: the failure must retry
    assert.equal(relay.count(), 2)

    relay.setFail(false)
    await tick()
    assert.equal(relay.count(), 3)
    assert.equal(relay.received[2].title, 'D$CPLN - Balance XLSX: CAD over budget')
    assert.match(relay.received[2].message, /CAD 120\.00 of 100\.00/)
    assert.deepEqual(relay.received[2].tags, ['warning'])

    await tick() // settled at this spend level: no repeat
    assert.equal(relay.count(), 3)
})

test('notifications are a no-op without a portal relay', async () => {
    let called = 0
    const provider = {
        getData: async () => {
            called += 1
            return { currencies: [{ code: 'CAD', monthlyBudget: 100, monthsSpend: 120 }] }
        },
    }
    startNotifications({ notifications: { checkIntervalMinutes: 30, onlyWarnOnce: false } }, provider, { relayUrl: '' })
    assert.equal(called, 0)
})
