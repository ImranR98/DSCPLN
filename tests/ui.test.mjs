import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createApp, createState } from '../server.mjs'

// Browser test for the import dialog. Playwright is a devDependency and
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

test('ui: import dialog uploads, previews, and merges an export', { skip: !CAN_LAUNCH }, async () => {
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
    const base = `http://127.0.0.1:${server.address().port}`
    const browser = await chromium.launch({ headless: true })
    try {
        const page = await browser.newPage()
        await page.goto(base)
        await page.click('#import')
        await page.waitForSelector('#import-dialog[open]')

        const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click('#import-browse')])
        await chooser.setFiles(fixture)
        await page.waitForSelector('.import-item--done')
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
    } finally {
        await browser.close()
        server.close()
        fs.rmSync(dir, { recursive: true, force: true })
        fs.rmSync(work, { recursive: true, force: true })
    }
})
