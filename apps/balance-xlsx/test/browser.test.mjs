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
    assert.equal(
        await page.locator('.card--hero').evaluate((el) => el.style.getPropertyValue('--currency')),
        '#dc2626',
    )
    assert.deepEqual(errors, [])

    // Add transaction starts on Amount, so the details suggestion menu cannot
    // cover the dialog actions before the user has typed anything.
    await page.locator('.expenses__actions button', { hasText: 'Add transaction' }).click()
    const transactionDialog = page.locator('dialog[open]')
    await transactionDialog.waitFor({ state: 'visible' })
    assert.equal(await transactionDialog.locator('.autocomplete__menu').count(), 0)
    await transactionDialog.locator('button', { hasText: 'Cancel' }).click()
    await transactionDialog.waitFor({ state: 'hidden' })
    assert.deepEqual(errors, [])

    // Category picker: the workbook defaults (Investment Buy/Sell) start
    // unchecked, and toggling one more category applies live to the page.
    await page.click('button[title="Counted categories"]')
    const dialog = page.locator('dialog.categories-dialog')
    await dialog.waitFor({ state: 'visible' })
    const sellRow = dialog.locator('.category-row', { hasText: 'Investment Sell' })
    assert.equal(await sellRow.locator('input[type="checkbox"]').isChecked(), false)
    await dialog.locator('.category-row', { hasText: /^Rent/ }).locator('input[type="checkbox"]').uncheck()
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

test('dashboard caps the transaction column to the main column on desktop', async (t) => {
    const browser = await launchBrowser()
    if (!browser) {
        t.skip('chromium not available (playwright browsers missing)')
        return
    }
    t.after(() => browser.close())

    const { server, baseUrl } = await startServer({ basePath: '/balance' })
    t.after(() => new Promise((resolve) => server.close(resolve)))

    const raw = await (await fetch(`${baseUrl}/balance/data?date=2026-09-15`)).json()
    const seed = raw.transactions?.[0] || {
        id: 'seed',
        kind: 'expense',
        date: '2026-09-15',
        details: 'Test transaction',
        category: 'Test',
        currency: 'CAD',
        expenses: 10,
    }
    const many = Array.from({ length: 45 }, (_, index) => ({
        ...seed,
        id: `layout-${index}`,
        date: '2026-09-15',
        details: `Layout row ${index + 1}`,
        expenses: 10,
    }))

    const page = await browser.newPage()
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.route('**/balance/data?*', (route) => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ...raw, transactions: many }),
    }))
    await page.goto(`${baseUrl}/balance/`)
    await page.waitForSelector('#expensesList .expense')
    await page.waitForFunction(() =>
        document.querySelector('.layout__side')?.style.getPropertyValue('--side-max-height'))

    const metrics = await page.evaluate(() => {
        const main = document.querySelector('.layout__main').getBoundingClientRect()
        const side = document.querySelector('.layout__side').getBoundingClientRect()
        const list = document.querySelector('#expensesList')
        return {
            mainHeight: main.height,
            sideHeight: side.height,
            scrollHeight: list.scrollHeight,
            clientHeight: list.clientHeight,
            overflowY: getComputedStyle(list).overflowY,
        }
    })

    assert.ok(metrics.sideHeight <= metrics.mainHeight + 1,
        `side column ${metrics.sideHeight}px should not exceed main column ${metrics.mainHeight}px`)
    assert.ok(metrics.scrollHeight > metrics.clientHeight,
        'transaction list should scroll when it exceeds the capped card height')
    assert.equal(metrics.overflowY, 'auto')
})

test('forecasts preview live and save scenario sheets', async (t) => {
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
    let putCount = 0
    page.on('pageerror', (err) => errors.push(err.message))
    page.on('console', (msg) => {
        if (msg.type() === 'error') errors.push(msg.text())
    })
    page.on('request', (request) => {
        if (request.method() === 'PUT' && request.url().includes('/balance/forecast')) putCount += 1
    })
    page.on('dialog', (dialog) => dialog.accept())

    await page.goto(`${baseUrl}/balance/forecasts`)
    await page.waitForSelector('[data-testid="forecast-asof"]')
    assert.equal(await page.title(), 'D$CPLN ⋅ Balance XLSX — Forecasts')
    assert.match(await page.textContent('h1'), /Balance XLSX/)
    assert.equal(await page.locator('[data-testid="forecast-chart-card"] svg').count(), 1)

    // Opening a category-baseline group must not detach the details event.
    const firstGroup = page.locator('.forecast-baseline__group').first()
    await firstGroup.locator('summary').click()
    await page.waitForFunction(() => document.querySelectorAll('.forecast-baseline__row').length > 0)
    assert.ok(await page.locator('.forecast-baseline__row').count() > 0)

    // Editing is a live preview: the KPI changes without a workbook write.
    await page.fill('[data-testid="account-balance-0"]', '12000')
    await page.waitForFunction(() => {
        const tile = [...document.querySelectorAll('.kpi')].find((element) => element.textContent.includes('Starting balance'))
        return tile && tile.textContent.includes('12,000')
    })
    assert.equal(putCount, 0)

    await page.fill('[data-testid="forecast-target-amount"]', '50000')
    await page.waitForFunction(() => {
        const tile = [...document.querySelectorAll('.kpi')].find((element) => element.textContent.includes('Target date'))
        return tile && !tile.textContent.includes('—')
    })
    assert.equal(putCount, 0)

    const responsePromise = page.waitForResponse((result) => result.url().includes('/balance/forecast') && result.request().method() === 'PUT')
    await page.click('[data-testid="forecast-save"]')
    const confirm = page.locator('dialog[open]')
    await confirm.waitFor({ state: 'visible' })
    await confirm.getByRole('button', { name: 'Save', exact: true }).click()
    const response = await responsePromise
    assert.equal(response.status(), 200)
    await page.waitForFunction(() => document.querySelector('.app-header__meta-tools')?.textContent.includes('Saved'))
    assert.equal(putCount, 1)

    await page.reload()
    await page.waitForSelector('[data-testid="forecast-asof"]')
    assert.equal(await page.inputValue('[data-testid="account-balance-0"]'), '12000')
    assert.equal(await page.inputValue('[data-testid="forecast-target-amount"]'), '50000')
    assert.equal(await page.inputValue('[data-testid="forecast-asof"]'), '')

    const forecast = await (await fetch(`${baseUrl}/balance/forecast`)).json()
    assert.ok(forecast.scenario)
    assert.equal(forecast.scenario.sheetName, 'Scenario - Base plan')
    assert.equal(forecast.scenario.revision, 1)
    assert.equal(forecast.scenario.asOf, null)
    assert.deepEqual(errors, [])
})

test('forecast recurring adjustments and scheduled changes round-trip', async (t) => {
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
    page.on('dialog', (dialog) => dialog.accept())

    await page.goto(`${baseUrl}/balance/forecasts`)
    await page.waitForSelector('.forecast-recurring__item')
    const first = page.locator('.forecast-recurring__item').first()
    await first.locator('.forecast-recurring__adjust').click()
    await first.locator('[data-recurring-amount]').fill('1500')
    await page.locator('.forecast-recurring__item').nth(1).locator('.forecast-recurring__include input').uncheck()
    await page.click('button:has-text("Add change")')
    await page.fill('[data-testid="change-from"]', '2027-01')
    await page.selectOption('[data-testid="change-category"]', 'Rent')
    await page.fill('[data-testid="change-amount"]', '1500')
    await page.click('button[type="submit"][form="forecastChangeForm"]')
    await page.fill('[data-testid="account-balance-0"]', '10000')
    const responsePromise = page.waitForResponse((result) => result.url().includes('/balance/forecast') && result.request().method() === 'PUT')
    await page.click('[data-testid="forecast-save"]')
    const confirm = page.locator('dialog[open]')
    await confirm.waitFor({ state: 'visible' })
    await confirm.getByRole('button', { name: 'Save', exact: true }).click()
    const response = await responsePromise
    assert.equal(response.status(), 200)
    await page.waitForFunction(() => document.querySelector('.app-header__meta-tools')?.textContent.includes('Saved'))

    const forecast = await (await fetch(`${baseUrl}/balance/forecast`)).json()
    assert.ok(forecast.scenario)
    assert.equal(forecast.scenario.recurringAdjustments.length, 2)
    assert.equal(forecast.scenario.changes.length, 1)
    assert.equal(forecast.scenario.changes[0].from, '2027-01')
    assert.deepEqual(errors, [])

    await page.reload()
    await page.waitForSelector('[data-testid="forecast-asof"]')
    assert.equal(await page.locator('.forecast-change').count(), 1)
    assert.equal(await page.locator('.forecast-recurring__item').first().locator('[data-recurring-amount]').inputValue(), '1500')
    assert.deepEqual(errors, [])
})

test('forecast reset restores defaults and keeps one Base plan sheet', async (t) => {
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
    page.on('dialog', (dialog) => dialog.accept())

    await page.goto(`${baseUrl}/balance/forecasts`)
    await page.waitForSelector('[data-testid="forecast-asof"]')
    assert.equal(await page.inputValue('[data-testid="forecast-asof"]'), '')
    assert.match(await page.textContent('.app-header__meta-tools'), /Today/)
    assert.equal(await page.locator('[data-testid="forecast-save"]').isDisabled(), true)

    // Blank means today; an explicit date can be cleared again without an error.
    await page.fill('[data-testid="forecast-asof"]', '2026-09-15')
    await page.waitForSelector('.forecast-chart__svg')
    assert.doesNotMatch(await page.textContent('.app-header__meta-tools'), /Today/)
    assert.match(await page.textContent('.app-header__meta-tools'), /2026/)
    await page.fill('[data-testid="forecast-asof"]', '')
    await page.waitForSelector('.forecast-chart__svg')
    assert.match(await page.textContent('.app-header__meta-tools'), /Today/)
    assert.equal(errors.length, 0)

    await page.fill('[data-testid="account-balance-0"]', '12000')
    await page.fill('[data-testid="forecast-target-amount"]', '50000')
    await page.click('[data-testid="forecast-reset"]')
    const confirm = page.locator('dialog[open]')
    await confirm.waitFor({ state: 'visible' })
    await confirm.getByRole('button', { name: 'Reset', exact: true }).click()
    await page.waitForTimeout(150)

    assert.equal(await page.inputValue('[data-testid="forecast-asof"]'), '')
    assert.equal(await page.inputValue('[data-testid="account-name-0"]'), 'Main account')
    assert.equal(await page.inputValue('[data-testid="account-balance-0"]'), '0')
    assert.equal(await page.inputValue('[data-testid="forecast-target-amount"]'), '')
    assert.equal(await page.locator('[data-testid="forecast-save"]').isEnabled(), true)

    const responsePromise = page.waitForResponse((result) => result.url().includes('/balance/forecast') && result.request().method() === 'PUT')
    await page.click('[data-testid="forecast-save"]')
    const saveConfirm = page.locator('dialog[open]')
    await saveConfirm.waitFor({ state: 'visible' })
    await saveConfirm.getByRole('button', { name: 'Save', exact: true }).click()
    const response = await responsePromise
    assert.equal(response.status(), 200)
    await page.waitForFunction(() => document.querySelector('.app-header__meta-tools')?.textContent.includes('Saved'))

    const forecast = await (await fetch(`${baseUrl}/balance/forecast`)).json()
    assert.ok(forecast.scenario)
    assert.equal(forecast.scenario.sheetName, 'Scenario - Base plan')
    assert.equal(forecast.scenario.name, 'Base plan')
    assert.equal(forecast.scenario.asOf, null)
    assert.equal(forecast.scenario.revision, 1)
    assert.equal(forecast.scenario.accounts[0].name, 'Main account')
    assert.equal(forecast.scenario.accounts[0].balance, 0)
    assert.equal(forecast.scenario.target.amount, null)

    // Resetting an existing sheet must update it in place, not create a duplicate.
    await page.fill('[data-testid="account-balance-0"]', '2500')
    await page.click('[data-testid="forecast-reset"]')
    const resetAgain = page.locator('dialog[open]')
    await resetAgain.waitFor({ state: 'visible' })
    await resetAgain.getByRole('button', { name: 'Reset', exact: true }).click()
    assert.equal(await page.inputValue('[data-testid="account-balance-0"]'), '0')

    const secondResponsePromise = page.waitForResponse((result) => result.url().includes('/balance/forecast') && result.request().method() === 'PUT')
    await page.click('[data-testid="forecast-save"]')
    const secondSaveConfirm = page.locator('dialog[open]')
    await secondSaveConfirm.waitFor({ state: 'visible' })
    await secondSaveConfirm.getByRole('button', { name: 'Save', exact: true }).click()
    const secondResponse = await secondResponsePromise
    assert.equal(secondResponse.status(), 200)
    await page.waitForFunction(() => document.querySelector('.app-header__meta-tools')?.textContent.includes('Saved'))

    const afterSecondSave = await (await fetch(`${baseUrl}/balance/forecast`)).json()
    assert.ok(afterSecondSave.scenario)
    assert.equal(afterSecondSave.scenario.sheetName, 'Scenario - Base plan')
    assert.equal(afterSecondSave.scenario.revision, 2)
    assert.equal(afterSecondSave.scenario.accounts[0].balance, 0)
    assert.deepEqual(errors, [])
})

test('recovers an unsaved local draft after reload', async (t) => {
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
    page.on('dialog', (dialog) => dialog.accept())

    await page.goto(`${baseUrl}/balance/forecasts`)
    await page.waitForSelector('[data-testid="forecast-asof"]')
    await page.fill('[data-testid="account-balance-0"]', '12345')
    await page.waitForFunction(() => document.querySelector('.forecast-save-status')?.textContent.includes('Unsaved'))
    await page.waitForFunction(() => localStorage.getItem('dscpln-balance-forecast-draft-v1'))

    await page.reload()
    await page.waitForSelector('.forecast-recovered')
    assert.match(await page.textContent('.forecast-recovered'), /Unsaved draft found/)
    await page.getByRole('button', { name: 'Restore draft' }).click()
    assert.equal(await page.inputValue('[data-testid="account-balance-0"]'), '12345')
    assert.equal(await page.locator('[data-testid="forecast-save"]').isEnabled(), true)
    assert.deepEqual(errors, [])
})
