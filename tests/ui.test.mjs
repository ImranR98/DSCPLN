import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createApp, createState } from '../server.mjs'

// Browser tests for the import dialog. Playwright is a devDependency and
// Chromium may not be installed everywhere, so the file skips unless launch
// succeeds.

let chromium = null
try {
    ({ chromium } = await import('playwright-core'))
} catch {
    chromium = null
}

const CAN_LAUNCH = await (async () => {
    if (!chromium) return false
    try {
        const browser = await chromium.launch({ headless: true })
        await browser.close()
        return true
    } catch {
        return false
    }
})()

const TXT_EXPORT = [
    '2024-01-15, 9:00 a.m. - Alice: Hello from the browser',
    '2024-01-15, 9:01 a.m. - Bob: Imported and merged',
    ''
].join('\n')

// Starts the server and a browser page over a fresh data dir.
const withApp = async (fn) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whatsapptxt-ui-'))
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'whatsapptxt-ui-work-'))
    fs.writeFileSync(path.join(dir, '20240101 - Existing.json'), JSON.stringify([
        { date: new Date(2024, 0, 1, 10, 0).toISOString(), sender: 'Alice', type: 'text', body: 'hello' }
    ]) + '\n')
    const fixture = path.join(work, 'WhatsApp Chat with UI.txt')
    fs.writeFileSync(fixture, TXT_EXPORT)

    const state = createState(dir, { watch: false })
    const app = createApp(state)
    const server = await new Promise(resolve => {
        const s = app.listen(0, '127.0.0.1', () => resolve(s))
    })
    const browser = await chromium.launch({ headless: true })
    try {
        const page = await browser.newPage()
        await fn({ page, dir, fixture, base: `http://127.0.0.1:${server.address().port}` })
    } finally {
        await browser.close()
        server.close()
        fs.rmSync(dir, { recursive: true, force: true })
        fs.rmSync(work, { recursive: true, force: true })
    }
}

const uploadFixture = async (page, fixture) => {
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click('#import-browse')])
    await chooser.setFiles(fixture)
    await page.waitForSelector('.import-item--done')
}

const incomingDirs = (dir) => {
    const root = path.join(dir, '.watxt-incoming')
    return fs.existsSync(root) ? fs.readdirSync(root) : []
}

test('ui: import dialog uploads, previews, and merges an export', { skip: !CAN_LAUNCH }, async () => {
    await withApp(async ({ page, dir, fixture, base }) => {
        await page.goto(base)
        await page.click('#import')
        await page.waitForSelector('#import-dialog[open]')

        await uploadFixture(page, fixture)
        assert.match(await page.textContent('.import-item__meta'), /uploaded/)

        await page.click('#import-preview')
        await page.waitForSelector('#import-result:not([hidden])')
        const preview = await page.textContent('#import-result')
        assert.match(preview, /Preview: no files were renamed, deleted or written/)
        assert.match(preview, /20240115 - UI\.json/)
        assert.equal(fs.existsSync(path.join(dir, '20240115 - UI.json')), false, 'preview must not write')

        await page.click('#import-run')
        await page.waitForSelector('#import-done:not([hidden])')
        assert.equal(fs.existsSync(path.join(dir, '20240115 - UI.json')), true, 'import must write the merged conversation')
        assert.match(await page.textContent('#import-status'), /Import complete/)

        await page.waitForFunction(() =>
            [...document.querySelectorAll('#conversation-list li')].some(node => node.textContent.includes('UI')))
    })
})

test('ui: clicking outside the import dialog closes it and discards staged uploads', { skip: !CAN_LAUNCH }, async () => {
    await withApp(async ({ page, dir, fixture, base }) => {
        await page.goto(base)
        await page.click('#import')
        await page.waitForSelector('#import-dialog[open]')
        await uploadFixture(page, fixture)
        assert.equal(incomingDirs(dir).length, 1, 'the upload is staged while the dialog is open')

        // Click the backdrop well outside the centered dialog.
        await page.mouse.click(4, 4)
        await page.waitForFunction(() => !document.querySelector('#import-dialog').open)
        assert.match(await page.textContent('#banner-text'), /Import cancelled/)
        assert.deepEqual(incomingDirs(dir), [], 'dismissing must discard the staged batch')

        // Reopening starts clean.
        await page.click('#import')
        await page.waitForSelector('#import-dialog[open]')
        assert.equal(await page.locator('.import-item').count(), 0)
    })
})

test('ui: Escape dismisses the import dialog the same way', { skip: !CAN_LAUNCH }, async () => {
    await withApp(async ({ page, dir, fixture, base }) => {
        await page.goto(base)
        await page.click('#import')
        await page.waitForSelector('#import-dialog[open]')
        await uploadFixture(page, fixture)
        await page.keyboard.press('Escape')
        await page.waitForFunction(() => !document.querySelector('#import-dialog').open)
        assert.deepEqual(incomingDirs(dir), [])
    })
})

test('ui: dismissing is ignored while a merge is running', { skip: !CAN_LAUNCH }, async () => {
    await withApp(async ({ page, dir, fixture, base }) => {
        await page.goto(base)
        await page.click('#import')
        await page.waitForSelector('#import-dialog[open]')
        await uploadFixture(page, fixture)

        // Slow the merge down so the dismiss attempt lands mid-flight.
        await page.route('**/api/import/merge', async route => {
            await new Promise(resolve => setTimeout(resolve, 1500))
            await route.continue()
        })
        await page.click('#import-run')
        await page.mouse.click(4, 4)
        await new Promise(resolve => setTimeout(resolve, 300))
        assert.equal(await page.locator('#import-dialog[open]').count(), 1, 'the dialog must stay open while merging')

        await page.waitForSelector('#import-done:not([hidden])', { timeout: 15_000 })
        assert.equal(fs.existsSync(path.join(dir, '20240115 - UI.json')), true, 'the merge must still complete')
    })
})
