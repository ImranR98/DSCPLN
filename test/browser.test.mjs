'use strict'

// Browser smoke test: the UI must work under a non-empty BASE_PATH (/balance),
// which is where path migrations regress. Skips cleanly when Chromium (from
// playwright-core) is not installed.

import test from 'node:test'
import { launchBrowser } from '@dscpln/test-kit'
import assert from 'node:assert/strict'
import { startServer } from './helpers.mjs'


test('dashboard loads under BASE_PATH with the shared kit', async (t) => {
    const browser = await launchBrowser()
    if (!browser) {
        t.skip('chromium not available (playwright browsers missing)')
        return
    }
    t.after(() => browser.close())

    const { server, baseUrl } = await startServer({ basePath: '/balance' })
    t.after(() => new Promise((resolve) => server.close(resolve)))

    const page = await browser.newPage()
    const errors = []
    page.on('pageerror', (err) => errors.push(err.message))
    page.on('console', (msg) => {
        if (msg.type() === 'error') errors.push(msg.text())
    })

    await page.goto(`${baseUrl}/balance/`)
    await page.waitForFunction(() => {
        const el = document.querySelector('#monthSpend')
        return el && el.textContent.trim() !== '—'
    })
    assert.equal(await page.title(), 'D$CPLN ⋅ Balance XLSX')
    assert.match(await page.textContent('h1'), /Balance XLSX/)
    assert.deepEqual(errors, [])

    await page.click('a[href="insights"]')
    await page.waitForFunction(() => document.querySelector('#insightsContent')?.children.length > 0)
    assert.match(await page.title(), /Insights/)
    assert.deepEqual(errors, [])
})
