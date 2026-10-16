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

    // Category picker: the workbook defaults (Investment Buy/Sell) start
    // unchecked, and toggling one more category applies live to the page.
    await page.click('button[title="Counted categories"]')
    const dialog = page.locator('dialog.categories-dialog')
    await dialog.waitFor({ state: 'visible' })
    const sellRow = dialog.locator('.category-row', { hasText: 'Investment Sell' })
    assert.equal(await sellRow.locator('input[type="checkbox"]').isChecked(), false)
    await dialog.locator('.category-row', { hasText: 'Rent' }).locator('input[type="checkbox"]').uncheck()
    await dialog.locator('.dialog-actions button', { hasText: 'Close' }).click()
    await page.waitForFunction(() =>
        document.querySelector('.app-header__meta-tools')?.textContent.includes('3 not counted'))
    assert.deepEqual(errors, [])

    await page.click('a[href="insights"]')
    await page.waitForFunction(() => document.querySelector('#insightsContent')?.children.length > 0)
    assert.match(await page.title(), /Insights/)
    assert.deepEqual(errors, [])

    // Amounts must render in the insights transactions list. The mock workbook
    // ends in September 2026, so pin the range instead of using the current month.
    await page.goto(`${baseUrl}/balance/insights?start=2026-09-01&end=2026-09-30`)
    await page.waitForFunction(() =>
        document.querySelectorAll('#transactionsList .expense__amount').length > 0)
    const amount = await page.textContent('#transactionsList .expense__amount')
    assert.match(amount, /\$/)
    assert.deepEqual(errors, [])
})
