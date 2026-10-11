import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { buildIndex, createApp, createState, searchIndex } from '../server.mjs'

const makeMessages = (count, startMs) => Array.from({ length: count }, (_, index) => ({
    date: new Date(startMs + index * 60000).toISOString(),
    sender: index % 2 ? 'Bob' : 'Alice',
    type: 'text',
    body: `message ${index} salam${index % 7 === 0 ? ' needle' : ''}${index % 11 === 0 ? ' then' : ''}${index % 13 === 0 ? ' the' : ''}`
}))

const makeDataDir = () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whatsapptxt-browse-'))
    fs.writeFileSync(path.join(dir, '20240101 - Chat One.json'), JSON.stringify(makeMessages(3, new Date(2024, 0, 1, 10, 0).valueOf()), null, 2) + '\n')
    fs.writeFileSync(path.join(dir, '20240102 - Big Chat.json'), JSON.stringify(makeMessages(3000, new Date(2024, 0, 2, 10, 0).valueOf()), null, 2) + '\n')
    fs.writeFileSync(path.join(dir, '.hidden.json'), JSON.stringify(makeMessages(1, new Date(2024, 0, 3, 10, 0).valueOf())))
    fs.writeFileSync(path.join(dir, 'broken.json'), '{ not json')
    fs.writeFileSync(path.join(dir, 'notes.txt'), 'ignored')
    return dir
}

const withServer = async (state, fn) => {
    const app = createApp(state)
    const server = await new Promise(resolve => {
        const s = app.listen(0, '127.0.0.1', () => resolve(s))
    })
    try {
        await fn(`http://127.0.0.1:${server.address().port}`)
    } finally {
        server.close()
    }
}

const getJson = async (base, route) => {
    const response = await fetch(base + route)
    return { status: response.status, body: await response.json() }
}

test('buildIndex: reads conversations, skips hidden/invalid/text files', () => {
    const dir = makeDataDir()
    const index = buildIndex(dir)
    assert.equal(index.conversations.length, 2)
    assert.equal(index.totalMessages, 3003)
    assert.deepEqual(index.conversations.map(c => c.id), ['20240102 - Big Chat.json', '20240101 - Chat One.json'])
    assert.equal(index.conversations[0].name, 'Big Chat')
    assert.deepEqual(index.skipped.map(item => item.file).sort(), ['broken.json'])
    assert.deepEqual(index.conversations[1].senders.sort(), ['Alice', 'Bob'])
})

test('api: state and conversations metadata', async () => {
    const dir = makeDataDir()
    const state = { index: buildIndex(dir), watching: false, reload: async () => {} }
    await withServer(state, async base => {
        const meta = await getJson(base, '/api/state')
        assert.equal(meta.status, 200)
        assert.equal(meta.body.conversations, 2)
        assert.equal(meta.body.messages, 3003)
        assert.equal(meta.body.watching, false)

        const list = await getJson(base, '/api/conversations')
        assert.equal(list.body.length, 2)
        assert.match(list.body[0].first, /^\d{4}-\d{2}-\d{2}T.*Z$/)
        assert.equal(list.body[0].messageCount, 3000)
        assert.equal(list.body[0].senders.length, 2)
    })
})

test('api: message pagination, around, and 404', async () => {
    const dir = makeDataDir()
    const state = { index: buildIndex(dir), watching: false, reload: async () => {} }
    const id = encodeURIComponent('20240102 - Big Chat.json')
    await withServer(state, async base => {
        const page = await getJson(base, `/api/conversations/${id}/messages?offset=2900&limit=200`)
        assert.equal(page.body.total, 3000)
        assert.equal(page.body.offset, 2900)
        assert.equal(page.body.messages.length, 100)
        assert.equal(page.body.messages[0].index, 2900)

        const around = await getJson(base, `/api/conversations/${id}/messages?around=1500&limit=100`)
        assert.equal(around.body.offset, 1450)
        assert.equal(around.body.messages[0].index, 1450)

        const tail = await getJson(base, `/api/conversations/${id}/messages?around=2999&limit=100`)
        assert.equal(tail.body.offset, 2949)
        assert.equal(tail.body.messages.length, 51)

        const missing = await getJson(base, `/api/conversations/nope.json/messages`)
        assert.equal(missing.status, 404)
    })
})

test('api: search by substring, filters, order, and snippets', async () => {
    const dir = makeDataDir()
    const state = { index: buildIndex(dir), watching: false, reload: async () => {} }
    await withServer(state, async base => {
        const all = await getJson(base, '/api/search?q=salam')
        assert.equal(all.body.total, 3003)
        assert.equal(all.body.results.length, 50)
        assert.equal(all.body.results[0].conversationId, '20240102 - Big Chat.json')

        const oldest = await getJson(base, '/api/search?q=salam&order=asc&limit=1')
        assert.equal(oldest.body.results[0].conversationId, '20240101 - Chat One.json')
        assert.equal(oldest.body.results[0].index, 0)

        const needles = await getJson(base, '/api/search?q=needle')
        assert.equal(needles.body.total, 430)
        const snippet = needles.body.results[0]
        assert.equal(snippet.snippet.slice(snippet.matchStart, snippet.matchStart + snippet.matchLength), 'needle')

        const byConversation = await getJson(base, `/api/search?q=salam&conversation=${encodeURIComponent('20240101 - Chat One.json')}`)
        assert.equal(byConversation.body.total, 3)

        const bySender = await getJson(base, '/api/search?sender=Bob')
        assert.equal(bySender.body.total, 1501)

        const byType = await getJson(base, '/api/search?q=salam&type=media')
        assert.equal(byType.body.total, 0)

        const byDate = await getJson(base, '/api/search?from=2024-01-02')
        assert.equal(byDate.body.total, 3000)
        const byDay = await getJson(base, '/api/search?from=2024-01-01&to=2024-01-01')
        assert.equal(byDay.body.total, 3)

        const unknown = await getJson(base, '/api/search?conversation=nope.json')
        assert.equal(unknown.status, 404)
    })
})

test('api: search results are globally chronological across conversations', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whatsapptxt-order-'))
    const series = (start, prefix) => [0, 1].map(offset => ({
        date: new Date(start + offset * 2 * 60000).toISOString(),
        sender: 'Alice',
        type: 'text',
        body: `salam ${prefix}${offset}`
    }))
    fs.writeFileSync(path.join(dir, '20240101 - A.json'), JSON.stringify(series(new Date(2024, 0, 1, 10, 0).valueOf(), 'a')) + '\n')
    fs.writeFileSync(path.join(dir, '20240101 - B.json'), JSON.stringify(series(new Date(2024, 0, 1, 10, 1).valueOf(), 'b')) + '\n')
    const state = { index: buildIndex(dir), watching: false, reload: async () => {} }
    await withServer(state, async base => {
        const desc = await getJson(base, '/api/search?q=salam')
        assert.deepEqual(desc.body.results.map(r => r.snippet), ['salam b1', 'salam a1', 'salam b0', 'salam a0'])
        const dates = desc.body.results.map(r => Date.parse(r.date))
        assert.deepEqual(dates, [...dates].sort((a, b) => b - a))
        const asc = await getJson(base, '/api/search?q=salam&order=asc')
        assert.deepEqual(asc.body.results.map(r => r.snippet), ['salam a0', 'salam b0', 'salam a1', 'salam b1'])
    })
})

test('api: whole-word search excludes substring matches', async () => {
    const dir = makeDataDir()
    const state = { index: buildIndex(dir), watching: false, reload: async () => {} }
    await withServer(state, async base => {
        const substring = await getJson(base, '/api/search?q=the&limit=1')
        assert.equal(substring.body.total, 484)
        assert.equal(substring.body.whole, false)

        const whole = await getJson(base, '/api/search?q=the&whole=1&limit=1')
        assert.equal(whole.body.total, 232)
        assert.equal(whole.body.whole, true)
        const snippet = whole.body.results[0]
        assert.equal(snippet.snippet.slice(snippet.matchStart, snippet.matchStart + snippet.matchLength), 'the')

        const thenWhole = await getJson(base, '/api/search?q=then&whole=1&limit=1')
        assert.equal(thenWhole.body.total, 274)

        const partial = await getJson(base, '/api/search?q=sala&whole=1&limit=1')
        assert.equal(partial.body.total, 0)
        const fullWord = await getJson(base, '/api/search?q=salam&whole=true&limit=1')
        assert.equal(fullWord.body.total, 3003)
    })
})

test('api: reload picks up new files without touching existing ones', async () => {
    const dir = makeDataDir()
    const watchFile = path.join(dir, '20240101 - Chat One.json')
    const before = fs.statSync(watchFile)
    const state = { index: buildIndex(dir), watching: false, reload: null }
    let index = state.index
    state.reload = async () => { index = buildIndex(dir); state.index = index }
    await withServer(state, async base => {
        await getJson(base, '/api/search?q=salam')
        fs.writeFileSync(path.join(dir, '20240103 - Chat Three.json'), JSON.stringify(makeMessages(2, new Date(2024, 0, 4, 10, 0).valueOf())) + '\n')
        const reloaded = await fetch(base + '/api/reload', { method: 'POST' })
        assert.equal(reloaded.status, 200)
        const body = await reloaded.json()
        assert.equal(body.conversations, 3)

        const after = fs.statSync(watchFile)
        assert.equal(after.size, before.size)
        assert.equal(after.mtimeMs, before.mtimeMs)
    })
})

test('searchIndex: returns null for unknown conversation filter', () => {
    const dir = makeDataDir()
    const index = buildIndex(dir)
    assert.equal(searchIndex(index, { conversation: 'missing.json' }), null)
})

// --- import --------------------------------------------------------------

const TXT_EXPORT = [
    '2024-01-15, 9:00 a.m. - Alice: Hello from the phone',
    '2024-01-15, 9:01 a.m. - Bob: It merges now',
    ''
].join('\n')

const makeImportState = () => {
    const dir = makeDataDir()
    // makeDataDir seeds non-export files for the browse tests (notes.txt,
    // broken.json); a merge would (correctly) try to parse them and abort, so
    // remove them for import tests.
    fs.rmSync(path.join(dir, 'notes.txt'), { force: true })
    fs.rmSync(path.join(dir, 'broken.json'), { force: true })
    return { dir, state: createState(dir, { watch: false }) }
}

const upload = (base, batch, name, body) =>
    fetch(`${base}/api/import/upload?batch=${encodeURIComponent(batch)}&name=${encodeURIComponent(name)}`, {
        method: 'POST',
        body
    })

const merge = (base, payload) =>
    fetch(`${base}/api/import/merge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    })

test('api: import upload and merge writes merged conversations and reloads the index', async () => {
    const { dir, state } = makeImportState()
    await withServer(state, async base => {
        const before = state.index.conversations.length
        const uploaded = await upload(base, 'batch1', 'WhatsApp Chat with Phone.txt', TXT_EXPORT)
        assert.equal(uploaded.status, 200)
        const uploadedBody = await uploaded.json()
        assert.equal(uploadedBody.ok, true)
        assert.equal(uploadedBody.size, Buffer.byteLength(TXT_EXPORT))
        assert.equal(fs.existsSync(path.join(dir, '.watxt-incoming', 'batch1', 'WhatsApp Chat with Phone.txt')), true)

        const merged = await merge(base, { batch: 'batch1' })
        assert.equal(merged.status, 200)
        const body = await merged.json()
        assert.equal(body.ok, true)
        assert.equal(body.dryRun, false)
        assert.equal(body.conversations, before + 1)
        assert.equal(body.names.includes('20240115 - Phone.json'), true, JSON.stringify(body.names))
        assert.equal(fs.existsSync(path.join(dir, '20240115 - Phone.json')), true)
        assert.equal(fs.existsSync(path.join(dir, '.watxt-incoming', 'batch1')), false, 'batch is consumed on success')
        assert.equal(state.index.conversations.length, before + 1)

        const list = await getJson(base, '/api/conversations')
        assert.equal(list.body.some(conversation => conversation.id === '20240115 - Phone.json'), true)
    })
})

test('api: import merge dry run previews without writing and keeps the batch', async () => {
    const { dir, state } = makeImportState()
    await withServer(state, async base => {
        await upload(base, 'preview1', 'WhatsApp Chat with Preview.txt', TXT_EXPORT)
        const preview = await merge(base, { batch: 'preview1', dryRun: true })
        assert.equal(preview.status, 200)
        const body = await preview.json()
        assert.equal(body.dryRun, true)
        assert.equal(body.names.includes('20240115 - Preview.json'), true)
        assert.equal(fs.existsSync(path.join(dir, '20240115 - Preview.json')), false, 'dry run must not write')
        assert.equal(fs.existsSync(path.join(dir, '.watxt-incoming', 'preview1')), true, 'dry run keeps the uploads')

        const real = await merge(base, { batch: 'preview1' })
        assert.equal(real.status, 200)
        assert.equal(fs.existsSync(path.join(dir, '20240115 - Preview.json')), true)
    })
})

test('api: import aborts safely on an unparseable export and cancel clears the batch', async () => {
    const { dir, state } = makeImportState()
    await withServer(state, async base => {
        await upload(base, 'bad1', 'notes.txt', 'this is not a whatsapp export\n')
        const merged = await merge(base, { batch: 'bad1' })
        assert.equal(merged.status, 400)
        const body = await merged.json()
        assert.match(body.error, /Aborting|no date lines/i)
        assert.equal(fs.existsSync(path.join(dir, 'notes.json')), false, 'nothing may be written on abort')
        assert.equal(fs.existsSync(path.join(dir, '.watxt-incoming', 'bad1')), true, 'uploads survive for retry or cancel')

        const cancelled = await fetch(base + '/api/import/cancel', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ batch: 'bad1' })
        })
        assert.equal(cancelled.status, 200)
        assert.equal(fs.existsSync(path.join(dir, '.watxt-incoming', 'bad1')), false)
    })
})

test('api: import validates batch names, upload names, and rejects cross-origin posts', async () => {
    const { state } = makeImportState()
    await withServer(state, async base => {
        assert.equal((await upload(base, '../evil', 'x.txt', TXT_EXPORT)).status, 400)
        assert.equal((await upload(base, 'ok', 'notes.md', TXT_EXPORT)).status, 400)
        assert.equal((await upload(base, 'ok', '../secret.txt', TXT_EXPORT)).status, 400)
        assert.equal((await upload(base, 'ok', '', TXT_EXPORT)).status, 400)
        assert.equal((await merge(base, { batch: 'nope' })).status, 404)
        assert.equal((await merge(base, { batch: 'ok', dateOrder: 'sideways' })).status, 400)

        const crossOrigin = await fetch(`${base}/api/import/upload?batch=ok&name=x.txt`, {
            method: 'POST',
            headers: { Origin: 'http://evil.example' },
            body: TXT_EXPORT
        })
        assert.equal(crossOrigin.status, 403)
    })
})

const haveZip = (() => {
    try {
        execFileSync('which', ['zip'], { stdio: 'ignore' })
        return true
    } catch {
        return false
    }
})()

test('api: import extracts zipped exports (including nested zips) and strips vcf files', { skip: !haveZip }, async () => {
    const { dir, state } = makeImportState()
    await withServer(state, async base => {
        const work = fs.mkdtempSync(path.join(os.tmpdir(), 'whatsapptxt-zip-'))
        const inner = path.join(work, 'inner')
        fs.mkdirSync(inner)
        fs.writeFileSync(path.join(inner, 'WhatsApp Chat with Zipped.txt'), TXT_EXPORT)
        fs.writeFileSync(path.join(inner, 'contacts.vcf'), 'BEGIN:VCARD\nEND:VCARD\n')
        execFileSync('zip', ['-q', path.join(work, 'inner.zip'), 'WhatsApp Chat with Zipped.txt', 'contacts.vcf'], { cwd: inner })
        execFileSync('zip', ['-q', path.join(work, 'outer.zip'), 'inner.zip'], { cwd: work })

        const uploaded = await upload(base, 'zip1', 'outer.zip', fs.readFileSync(path.join(work, 'outer.zip')))
        assert.equal(uploaded.status, 200)
        const merged = await merge(base, { batch: 'zip1' })
        assert.equal(merged.status, 200)
        const body = await merged.json()
        assert.equal(body.names.includes('20240115 - Zipped.json'), true)
        assert.equal(fs.existsSync(path.join(dir, '20240115 - Zipped.json')), true)
    })
})

test('base path: the app mounts under BASE_PATH with the shared kit', async () => {
    const dir = makeDataDir()
    const state = { index: buildIndex(dir), watching: false, reload: async () => {} }
    const app = createApp(state, { basePath: '/watxt' })
    const server = await new Promise(resolve => {
        const s = app.listen(0, '127.0.0.1', () => resolve(s))
    })
    try {
        const base = `http://127.0.0.1:${server.address().port}`
        const page = await fetch(`${base}/watxt`)
        assert.equal(page.status, 200)
        const html = await page.text()
        assert.match(html, /<base href="\/watxt\/">/)
        assert.match(html, /<title>D\$CPLN ⋅ WhatsApp TXT<\/title>/)

        const meta = await getJson(base, '/watxt/api/state')
        assert.equal(meta.status, 200)
        assert.equal(meta.body.conversations, 2)

        const asset = /src="\.\/(assets\/[^"]+\.js)"/.exec(html)?.[1]
        assert.ok(asset, 'the built UI bundle must be referenced')
        assert.equal((await fetch(`${base}/watxt/${asset}`)).status, 200)

        // The kit's standard health route must not be shadowed by an app-level
        // /api catch-all: the portal and k8s probe rely on it.
        const health = await (await fetch(`${base}/watxt/api/health`)).json()
        assert.equal(health.ok, true)
        assert.equal(health.basePath, '/watxt')

        const unknown = await fetch(`${base}/watxt/api/nope`)
        assert.equal(unknown.status, 404)

        const crossOrigin = await fetch(`${base}/watxt/api/reload`, {
            method: 'POST',
            headers: { Origin: 'http://evil.example' }
        })
        assert.equal(crossOrigin.status, 403)
    } finally {
        server.close()
    }
})

test('sanitizeStaging removes symlinks and keeps real files', async () => {
    const { sanitizeStaging } = await import('../server.mjs')
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'watxt-stage-'))
    fs.writeFileSync(path.join(dir, 'chat.txt'), 'hello')
    fs.symlinkSync('/etc/passwd', path.join(dir, 'escape.txt'))
    await sanitizeStaging(dir)
    assert.deepEqual(fs.readdirSync(dir).sort(), ['chat.txt'])
    fs.rmSync(dir, { recursive: true, force: true })
})
