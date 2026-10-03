#!/usr/bin/env node
// WhatsApp TXT browser — Express server over a directory of JSON conversations.
//
//   node server.mjs --dir "/path/to/WhatsApp TXT" [--port 8787] [--host 127.0.0.1] [--no-watch]
//
// The directory is only ever read. All conversations are indexed into memory at
// startup (~0.5s / ~300MB for 539k messages) and searched with a linear scan.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import express from 'express'

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public')
const MESSAGE_TYPES = new Set(['text', 'media', 'attachment', 'deleted', 'system'])

const displayName = (filename) => filename.replace(/\.json$/i, '').replace(/^\d{8} - /, '')

const clamp = (value, min, max) => Math.min(Math.max(value, min), max)

// Parses a YYYY-MM-DD (local) or ISO date parameter into epoch ms
const parseDateParam = (value) => {
    if (!value) return null
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        const [year, month, day] = value.split('-').map(Number)
        return new Date(year, month - 1, day).valueOf()
    }
    const parsed = Date.parse(value)
    return Number.isNaN(parsed) ? null : parsed
}

// Like parseDateParam, but a date-only value means the end of that local day
const parseEndDateParam = (value) => {
    if (!value) return null
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        const [year, month, day] = value.split('-').map(Number)
        return new Date(year, month - 1, day, 23, 59, 59, 999).valueOf()
    }
    return parseDateParam(value)
}

// Reads every conversation JSON in a directory into memory. Invalid files are skipped and reported.
export const buildIndex = (dataDir) => {
    const conversations = []
    const skipped = []
    for (const file of fs.readdirSync(dataDir).sort()) {
        if (file.startsWith('.') || !file.toLowerCase().endsWith('.json')) continue
        const full = path.join(dataDir, file)
        let stat
        let messages
        try {
            stat = fs.statSync(full)
            if (!stat.isFile()) continue
            const raw = JSON.parse(fs.readFileSync(full, 'utf8'))
            if (!Array.isArray(raw)) throw new Error('not an array of messages')
            messages = raw.map((message, index) => {
                if (!message || typeof message.body !== 'string') throw new Error(`message ${index} has no body`)
                const date = new Date(message.date).valueOf()
                if (Number.isNaN(date)) throw new Error(`message ${index} has an invalid date`)
                return {
                    index,
                    date,
                    sender: message.sender ?? null,
                    type: MESSAGE_TYPES.has(message.type) ? message.type : 'text',
                    body: message.body
                }
            })
        } catch (e) {
            skipped.push({ file, reason: e.message })
            continue
        }
        if (messages.length === 0) {
            skipped.push({ file, reason: 'contains no messages' })
            continue
        }
        conversations.push({
            id: file,
            name: displayName(file),
            bytes: stat.size,
            mtimeMs: stat.mtimeMs,
            messageCount: messages.length,
            first: messages[0].date,
            last: messages[messages.length - 1].date,
            senders: [...new Set(messages.map(message => message.sender).filter(Boolean))],
            messages
        })
    }
    conversations.sort((a, b) => b.last - a.last || a.name.localeCompare(b.name))
    const timeline = []
    for (const conversation of conversations) {
        for (const message of conversation.messages) timeline.push({ conversation, message })
    }
    timeline.sort((a, b) => a.message.date - b.message.date)
    return {
        dataDir,
        conversations,
        timeline,
        byId: new Map(conversations.map(conversation => [conversation.id, conversation])),
        skipped,
        indexedAt: Date.now(),
        totalMessages: conversations.reduce((total, conversation) => total + conversation.messageCount, 0),
        totalBytes: conversations.reduce((total, conversation) => total + conversation.bytes, 0)
    }
}

const publicConversation = (conversation) => ({
    id: conversation.id,
    name: conversation.name,
    messageCount: conversation.messageCount,
    first: new Date(conversation.first).toISOString(),
    last: new Date(conversation.last).toISOString(),
    senders: conversation.senders,
    bytes: conversation.bytes
})

const publicMessage = (message) => ({
    index: message.index,
    date: new Date(message.date).toISOString(),
    sender: message.sender,
    type: message.type,
    body: message.body
})

const stateSummary = (index, watching) => ({
    dataDir: index.dataDir,
    indexedAt: new Date(index.indexedAt).toISOString(),
    conversations: index.conversations.length,
    messages: index.totalMessages,
    bytes: index.totalBytes,
    skipped: index.skipped,
    watching
})

// Windowed snippet around the first query match
const snippetOf = (body, at, length) => {
    if (at == null || at < 0 || !length) return { snippet: body.slice(0, 160), matchStart: 0, matchLength: 0 }
    const start = Math.max(0, at - 60)
    const end = Math.min(body.length, at + length + 60)
    const prefix = start > 0 ? '…' : ''
    return {
        snippet: prefix + body.slice(start, end) + (end < body.length ? '…' : ''),
        matchStart: prefix.length + at - start,
        matchLength: length
    }
}

// Whole-word matcher: boundaries are Unicode letters/digits/underscore, so "the" does not match "then"
const wholeWordRegex = (query) => {
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return new RegExp(`(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`, 'iu')
}

// Case-insensitive substring search with filters, paginated in date order
export const searchIndex = (index, params) => {
    const query = String(params.q ?? '').trim().toLowerCase()
    const whole = params.whole === '1' || params.whole === 'true'
    const sender = params.sender ? String(params.sender) : null
    const type = params.type && MESSAGE_TYPES.has(params.type) ? params.type : null
    const from = parseDateParam(params.from)
    const to = parseEndDateParam(params.to)
    const limit = clamp(Number.parseInt(params.limit, 10) || 50, 1, 200)
    const offset = Math.max(0, Number.parseInt(params.offset, 10) || 0)
    const order = params.order === 'asc' ? 'asc' : 'desc'
    const matcher = query && whole ? wholeWordRegex(query) : null

    const scoped = params.conversation ? index.byId.get(String(params.conversation)) : null
    if (params.conversation && !scoped) return null

    let total = 0
    const results = []
    const visit = (conversation, message) => {
        if (from !== null && message.date < from) return
        if (to !== null && message.date > to) return
        if (sender && message.sender !== sender) return
        if (type && message.type !== type) return
        let at = -1
        if (query) {
            const lower = message.body.toLowerCase()
            if (!lower.includes(query)) return
            if (matcher) {
                const found = matcher.exec(message.body)
                if (!found) return
                at = found.index
            } else {
                at = lower.indexOf(query)
            }
        }
        if (total >= offset && results.length < limit) {
            results.push({
                conversationId: conversation.id,
                conversationName: conversation.name,
                index: message.index,
                date: new Date(message.date).toISOString(),
                sender: message.sender,
                type: message.type,
                ...snippetOf(message.body, at, query.length)
            })
        }
        total++
    }
    if (scoped) {
        const messages = scoped.messages
        if (order === 'asc') for (const message of messages) visit(scoped, message)
        else for (let i = messages.length - 1; i >= 0; i--) visit(scoped, messages[i])
    } else if (order === 'asc') {
        for (const entry of index.timeline) visit(entry.conversation, entry.message)
    } else {
        for (let i = index.timeline.length - 1; i >= 0; i--) {
            const entry = index.timeline[i]
            visit(entry.conversation, entry.message)
        }
    }
    return { total, offset, limit, order, whole, results }
}

export const createApp = (state) => {
    const app = express()
    app.disable('x-powered-by')
    app.use(express.static(PUBLIC_DIR))

    app.get('/api/state', (req, res) => {
        res.json(stateSummary(state.index, state.watching))
    })

    app.get('/api/conversations', (req, res) => {
        res.json(state.index.conversations.map(publicConversation))
    })

    app.get('/api/conversations/:id/messages', (req, res) => {
        const conversation = state.index.byId.get(req.params.id)
        if (!conversation) return res.status(404).json({ error: 'conversation not found' })
        const limit = clamp(Number.parseInt(req.query.limit, 10) || 200, 1, 500)
        let offset
        if (req.query.around != null) {
            const around = clamp(Number.parseInt(req.query.around, 10) || 0, 0, conversation.messageCount - 1)
            offset = clamp(around - Math.floor(limit / 2), 0, Math.max(0, conversation.messageCount - 1))
        } else {
            offset = clamp(Number.parseInt(req.query.offset, 10) || 0, 0, Math.max(0, conversation.messageCount - 1))
        }
        res.json({
            id: conversation.id,
            name: conversation.name,
            total: conversation.messageCount,
            offset,
            limit,
            messages: conversation.messages.slice(offset, offset + limit).map(publicMessage)
        })
    })

    app.get('/api/search', (req, res) => {
        const result = searchIndex(state.index, req.query)
        if (result === null) return res.status(404).json({ error: 'conversation not found' })
        res.json(result)
    })

    app.post('/api/reload', async (req, res) => {
        try {
            await state.reload()
            res.json(stateSummary(state.index, state.watching))
        } catch (e) {
            res.status(500).json({ error: e.message })
        }
    })

    app.use('/api', (req, res) => res.status(404).json({ error: 'not found' }))
    app.get('*', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')))
    return app
}

// Debounced directory watcher; rebuilds the whole index (cheap at current scale)
export const createWatcher = (dataDir, rebuild, { debounceMs = 500 } = {}) => {
    let timer = null
    const watcher = fs.watch(dataDir, () => {
        clearTimeout(timer)
        timer = setTimeout(() => rebuild(), debounceMs)
    })
    return { close: () => { clearTimeout(timer); watcher.close() } }
}

export const createState = (dataDir, { watch = true } = {}) => {
    const state = {
        dataDir,
        index: buildIndex(dataDir),
        watching: false,
        reload: null,
        close: null
    }
    let pending = Promise.resolve()
    state.reload = () => {
        pending = pending.then(() => { state.index = buildIndex(dataDir) })
        return pending
    }
    if (watch) {
        state.close = createWatcher(dataDir, () => { state.reload().catch(() => {}) }).close
        state.watching = true
    }
    return state
}

const USAGE = `Usage: node server.mjs --dir <json-directory> [options]

Serves a local web UI for browsing and searching WhatsApp TXT JSON conversations.

Options:
  --dir <path>     Directory of conversation .json files (required)
  --port <number>  Port to listen on (default 8787)
  --host <name>    Host to bind (default 127.0.0.1)
  --no-watch       Do not watch the directory for changes
  --help           Show this help`

const main = async () => {
    let values
    try {
        values = parseArgs({
            allowNegative: true,
            options: {
                dir: { type: 'string' },
                port: { type: 'string', default: '8787' },
                host: { type: 'string', default: '127.0.0.1' },
                watch: { type: 'boolean', default: true },
                help: { type: 'boolean', default: false }
            }
        }).values
    } catch (e) {
        console.error(e.message)
        console.error(USAGE)
        process.exit(2)
    }
    if (values.help) {
        console.log(USAGE)
        process.exit(0)
    }
    if (!values.dir) {
        console.error('error: --dir is required')
        console.error(USAGE)
        process.exit(2)
    }
    const dataDir = path.resolve(values.dir)
    if (!fs.existsSync(dataDir) || !fs.statSync(dataDir).isDirectory()) {
        console.error(`error: not a directory: ${dataDir}`)
        process.exit(2)
    }
    const state = createState(dataDir, { watch: values.watch })
    const app = createApp(state)
    const port = Number(values.port)
    const server = app.listen(port, values.host, () => {
        const { conversations, totalMessages, skipped } = state.index
        console.log(`whatsapptxt browser: http://${values.host}:${port}`)
        console.log(`indexed ${conversations.length} conversations, ${totalMessages.toLocaleString()} messages${skipped.length ? ` (${skipped.length} file(s) skipped)` : ''}`)
    })
    const shutdown = () => {
        state.close?.()
        server.close(() => process.exit(0))
    }
    process.on('SIGINT', shutdown)
    process.on('SIGTERM', shutdown)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    main().catch(err => {
        console.error(err)
        process.exit(1)
    })
}
