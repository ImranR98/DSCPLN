import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { buildIndex, createApp, searchIndex } from '../server.mjs'

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

test('api: reload picks up new files and the data dir stays read-only', async () => {
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
