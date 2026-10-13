#!/usr/bin/env node
// WhatsApp TXT browser + import — Express server over a directory of JSON
// conversations. Browsing and search are read-only; the import API accepts
// chat exports, merges them with the existing conversations and writes the
// results back into the data directory.
//
//   node server.mjs --dir "/path/to/WhatsApp TXT" [--port 8787] [--host 127.0.0.1] [--no-watch]
//
// All conversations are indexed into memory at startup (~0.5s / ~300MB for
// 539k messages) and searched with a linear scan.

import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile as execFileCallback } from 'node:child_process'
import { parseArgs, promisify } from 'node:util'
import express from 'express'
import { asyncRoute, createApp as createKitApp } from '@dscpln/server-kit'

const STATIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'static')
const MESSAGE_TYPES = new Set(['text', 'media', 'attachment', 'deleted', 'system'])
const execFile = promisify(execFileCallback)
import { main as mergeExports } from './src/index.mjs'

const IMPORT_DIR = '.watxt-incoming'
const IMPORT_EXTENSIONS = new Set(['.zip', '.txt'])
const MAX_UPLOAD_BYTES = 200 * 1024 * 1024
const DATE_ORDERS = ['auto', 'dmy', 'mdy', 'ymd']

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

const safeBatchName = (value) => typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value)

const uploadFileName = (value) => {
    if (typeof value !== 'string' || value === '' || value !== path.basename(value) || value.startsWith('.')) return null
    if (!IMPORT_EXTENSIONS.has(path.extname(value).toLowerCase())) return null
    return value
}

// Reject archives that could escape extraction: absolute or `..` member
// names, or any symlink entry (unzip creates it and a later member written
// through it lands outside the staging dir — sanitizeStaging runs too late).
const assertSafeZip = async (file) => {
    const names = await execFile('unzip', ['-Z1', file])
    for (const name of names.stdout.split('\n')) {
        if (!name) continue
        if (name.startsWith('/') || /^[A-Za-z]:[\\/]/.test(name)) throw new Error('the archive contains an absolute path')
        if (name.split(/[\\/]/).includes('..')) throw new Error('the archive contains a parent path')
    }
    const listing = await execFile('unzip', ['-Z', file])
    for (const line of listing.stdout.split('\n')) {
        if (line.startsWith('l')) throw new Error('the archive contains a symlink')
    }
}

// Extracted archives must stay inside the staging dir: symlinks are removed
// (unzip can create them and a later read would follow them) and every real
// path is re-checked against the staging root (zip-slip defense in depth).
export const sanitizeStaging = async (staging) => {
    const root = await fsp.realpath(staging)
    const walk = async (dir) => {
        const entries = await fsp.readdir(dir, { withFileTypes: true })
        for (const entry of entries) {
            const full = path.join(dir, entry.name)
            if (entry.isSymbolicLink()) {
                await fsp.rm(full, { force: true })
                continue
            }
            if (entry.isDirectory()) {
                await walk(full)
                continue
            }
            const real = await fsp.realpath(full).catch(() => null)
            if (!real || (real !== root && !real.startsWith(root + path.sep))) {
                throw new Error('the archive contains an entry outside the staging directory')
            }
        }
    }
    await walk(root)
}

// Same-origin guard for mutations (the app sits behind a forward-auth proxy; this
// rejects cross-site POSTs from an authenticated browser).
const checkSameOrigin = (req, res, next) => {
    const origin = req.headers.origin || req.headers.referer
    if (origin) {
        try {
            if (new URL(origin).host !== req.headers.host) return res.status(403).json({ error: 'cross-origin request rejected' })
        } catch { /* malformed origin: ignore */ }
    }
    next()
}

export const createApp = (state, options = {}) => {
    // Served through the shared server kit: base-path mounting (BASE_PATH),
    // HTML injection, CSRF origin check, /ui kit assets and /api/health.
    const basePath = options.basePath ?? process.env.BASE_PATH ?? ''
    const app = createKitApp({
        title: 'WhatsApp TXT',
        pageTitle: null,
        basePath,
        staticDir: STATIC_DIR,
        jsonBody: false, // /api/import/upload streams raw bytes
        healthExtra: () => ({ conversations: state.index.conversations.length }),
        routes: (router) => {
            router.use('/api/import', express.json({ limit: '1mb' }))

            router.get('/api/state', (req, res) => {
        res.json(stateSummary(state.index, state.watching))
    })

            router.get('/api/conversations', (req, res) => {
        res.json(state.index.conversations.map(publicConversation))
    })

            router.get('/api/conversations/:id/messages', (req, res) => {
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

            router.get('/api/search', (req, res) => {
        const result = searchIndex(state.index, req.query)
        if (result === null) return res.status(404).json({ error: 'conversation not found' })
        res.json(result)
    })

            router.post('/api/reload', asyncRoute(async (req, res) => {
        try {
            await state.reload()
            res.json(stateSummary(state.index, state.watching))
        } catch (e) {
            res.status(500).json({ error: e.message })
        }
    }))

    // --- importing exports --------------------------------------------------

    // Streams one uploaded file (raw body) into the batch's incoming directory.
            router.post('/api/import/upload', checkSameOrigin, asyncRoute(async (req, res) => {
        const batch = req.query.batch
        const name = uploadFileName(req.query.name)
        if (!safeBatchName(batch)) return res.status(400).json({ error: 'batch must match [A-Za-z0-9_-]{1,64}' })
        if (!name) return res.status(400).json({ error: 'name must be a .zip or .txt file name without a path' })
        const batchDir = path.join(state.incomingRoot, batch)
        await fsp.mkdir(batchDir, { recursive: true })
        const target = path.join(batchDir, name)
        const part = `${target}.part`
        let size = 0
        let tooLarge = false
        const stream = fs.createWriteStream(part)
        req.on('data', (chunk) => {
            size += chunk.length
            if (size > MAX_UPLOAD_BYTES && !tooLarge) {
                tooLarge = true
                req.unpipe(stream)
                stream.destroy()
                req.resume()
            }
        })
        await new Promise((resolve, reject) => {
            stream.on('finish', resolve)
            stream.on('close', resolve)
            stream.on('error', reject)
            req.on('error', reject)
            req.pipe(stream)
        })
        if (tooLarge) {
            await fsp.rm(part, { force: true })
            return res.status(413).json({ error: `upload exceeds the ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB limit` })
        }
        if (size === 0) {
            await fsp.rm(part, { force: true })
            return res.status(400).json({ error: 'upload is empty' })
        }
        await fsp.rename(part, target)
        res.json({ ok: true, batch, name, size })
    }))

    // Merges a batch's uploads into the data directory. `dryRun` previews
    // without touching anything (and keeps the batch for a real merge).
            router.post('/api/import/merge', checkSameOrigin, asyncRoute(async (req, res) => {
        const { batch } = req.body ?? {}
        const dryRun = req.body?.dryRun === true
        const dateOrder = req.body?.dateOrder ?? 'auto'
        if (!safeBatchName(batch)) return res.status(400).json({ error: 'batch must match [A-Za-z0-9_-]{1,64}' })
        if (!DATE_ORDERS.includes(dateOrder)) return res.status(400).json({ error: `dateOrder must be one of ${DATE_ORDERS.join(', ')}` })
        if (state.mergeInFlight) return res.status(409).json({ error: 'a merge is already running' })
        const batchDir = path.join(state.incomingRoot, batch)
        const incoming = await fsp.readdir(batchDir).catch(() => null)
        if (!incoming) return res.status(404).json({ error: 'no uploads for this batch' })
        const inputs = incoming.filter((name) => name !== 'staging' && !name.startsWith('.'))
        if (inputs.length === 0) return res.status(400).json({ error: 'no uploads for this batch' })

        state.mergeInFlight = true
        const staging = path.join(batchDir, 'staging')
        try {
            await fsp.rm(staging, { recursive: true, force: true })
            await fsp.mkdir(staging, { recursive: true })
            for (const name of inputs) {
                const full = path.join(batchDir, name)
                const stat = await fsp.stat(full)
                if (!stat.isFile()) continue
                if (name.toLowerCase().endsWith('.zip')) {
                    await assertSafeZip(full)
                    await execFile('unzip', ['-oq', full, '-d', staging])
                } else {
                    await fsp.copyFile(full, path.join(staging, name))
                }
            }
            // Archives can contain another zip level.
            for (const name of await fsp.readdir(staging)) {
                if (!name.toLowerCase().endsWith('.zip')) continue
                const nested = path.join(staging, name)
                await assertSafeZip(nested)
                await execFile('unzip', ['-oq', nested, '-d', staging])
                await fsp.rm(nested, { force: true })
            }
            await sanitizeStaging(staging)
            for (const name of await fsp.readdir(staging)) {
                if (name.toLowerCase().endsWith('.vcf')) await fsp.rm(path.join(staging, name), { force: true })
            }

            let result
            try {
                result = mergeExports([state.dataDir, staging], { dryRun, dateOrder })
            } catch (e) {
                return res.status(400).json({ error: String(e?.message ?? e) })
            }
            await fsp.rm(staging, { recursive: true, force: true })
            if (!dryRun) {
                await fsp.rm(batchDir, { recursive: true, force: true })
                await state.reload()
            }
            state.lastImport = { at: new Date().toISOString(), dryRun, ...result }
            const topLevel = {
                ok: true,
                dryRun,
                at: state.lastImport.at,
                conversations: result.conversations.length,
                multiSource: result.conversations.filter((conversation) => conversation.sources > 1).length,
                renamedGroups: result.conversations.filter((conversation) => conversation.group).length,
                ambiguous: result.ambiguous,
                names: result.conversations.map((conversation) => conversation.outName),
                skipped: state.index.skipped
            }
            res.json(topLevel)
        } catch (e) {
            await fsp.rm(staging, { recursive: true, force: true }).catch(() => {})
            res.status(400).json({ error: String(e?.message ?? e) })
        } finally {
            state.mergeInFlight = false
        }
    }))

            router.post('/api/import/cancel', checkSameOrigin, asyncRoute(async (req, res) => {
        const { batch } = req.body ?? {}
        if (!safeBatchName(batch)) return res.status(400).json({ error: 'batch must match [A-Za-z0-9_-]{1,64}' })
        await fsp.rm(path.join(state.incomingRoot, batch), { recursive: true, force: true })
        res.json({ ok: true })
    }))

            router.get('/api/import/last', (req, res) => {
        res.json(state.lastImport ?? null)
    })
        },
    })
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
        close: null,
        incomingRoot: path.join(dataDir, IMPORT_DIR),
        mergeInFlight: false,
        lastImport: null
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
