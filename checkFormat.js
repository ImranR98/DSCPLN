#!/usr/bin/env node
const fs = require('fs')
const path = require('path')
const app = require(path.join(__dirname, 'WhatsAppTXT.js'))

// Broad shapes that "look like" a timestamp. Used to catch lines the app silently treats as message text.
const DATE_LIKE_REGEXES = [
    /^\[?\(?\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}[, ]+\d{1,2}:\d{1,2}/,
    /^[0-9]{4}-[0-9]{2}-[0-9]{2}-[0-9]{1,6}/
]

const snippet = (line) => {
    const clean = line.replace(/\r$/, '')
    return clean.length > 80 ? clean.slice(0, 77) + '...' : clean
}

// Recursively collects .txt/.json files from a file or directory path (follows the root once, skips symlinked entries)
const collectChatFiles = (target) => {
    const stat = fs.statSync(target)
    if (stat.isFile()) return [target]
    const results = []
    for (const entry of fs.readdirSync(target).sort()) {
        if (entry.startsWith('.')) continue
        const full = path.join(target, entry)
        const entryStat = fs.lstatSync(full)
        if (entryStat.isSymbolicLink()) continue
        if (entryStat.isDirectory()) results.push(...collectChatFiles(full))
        else if (entry.toLowerCase().endsWith('.txt') || entry.toLowerCase().endsWith('.json')) results.push(full)
    }
    return results
}

// Groups files by directory + cleaned name; returns a Map of file path -> collision message
const findFilenameCollisions = (files) => {
    const groups = new Map()
    for (const file of files) {
        const match = app.matchFilenamePrefix(path.basename(file))
        const clean = match ? match.finalName : path.basename(file)
        const key = path.join(path.dirname(file), clean)
        if (!groups.has(key)) groups.set(key, [])
        groups.get(key).push(file)
    }
    const collisions = new Map()
    for (const [key, group] of groups) {
        if (group.length > 1) {
            const names = group.map(file => JSON.stringify(path.basename(file)))
            for (const file of group) {
                collisions.set(file, `filename collision: ${names.join(' and ')} all clean to ${JSON.stringify(path.basename(key))}`)
            }
            continue
        }
        const match = app.matchFilenamePrefix(path.basename(group[0]))
        if (match && match.finalName !== path.basename(group[0]) && fs.existsSync(path.join(path.dirname(group[0]), match.finalName))) {
            collisions.set(group[0], `filename collision: ${JSON.stringify(path.basename(group[0]))} would overwrite existing ${JSON.stringify(match.finalName)}`)
        }
    }
    return collisions
}

const labelForLevel = (level) => level === 'error' ? 'ERROR' : level === 'warning' ? 'WARN' : 'INFO'

// Classifies a filename, adding the same diagnostics for txt and json files
const analyzeFilename = (file, add) => {
    const match = app.matchFilenamePrefix(path.basename(file))
    let cleanName = path.basename(file)
    let style = 'generic'
    if (match) {
        style = match.style
        cleanName = match.finalName
        if (match.finalName === path.basename(file)) {
            add('error', null, `filename matches the "${style}" export prefix ${JSON.stringify(match.prefix)} but is too short for the app to strip; the app keeps the name unchanged`)
        } else if (style === 'backup') {
            const digits = match.prefix.slice(0, 8)
            const year = Number(digits.slice(0, 4))
            const month = Number(digits.slice(4, 6))
            const day = Number(digits.slice(6, 8))
            const probe = new Date(year, month - 1, day)
            if (probe.getFullYear() !== year || probe.getMonth() !== month - 1 || probe.getDate() !== day) {
                add('warning', null, `filename date prefix "${digits}" matches the app's regex but is not a real calendar date`)
            }
        }
    } else {
        add('warning', null, 'filename has no recognized export prefix; the app will process it but will not rename it')
    }
    return { match, cleanName, style }
}

// Validates a single WhatsApp .txt export against the app's expectations. Never modifies the file.
const checkFile = (file, options = {}) => {
    const content = fs.readFileSync(file, 'utf8')
    const empty = content.length === 0
    const bom = content.charCodeAt(0) === 0xFEFF
    const split = content.split('\n')
    const trailingNewline = split[split.length - 1] === ''
    const lines = trailingNewline ? split.slice(0, -1) : split

    const diagnostics = []
    const errors = []
    const warnings = []
    const add = (level, lineNumber, message) => {
        const diagnostic = {
            level,
            line: lineNumber,
            message,
            excerpt: lineNumber != null && lines[lineNumber - 1] != null ? snippet(lines[lineNumber - 1]) : null
        }
        diagnostics.push(diagnostic)
        if (level === 'error') errors.push(diagnostic)
        if (level === 'warning') warnings.push(diagnostic)
    }

    const header = app.matchExportHeader(lines)
    const headerEnd = header.count + (header.blankAfter ? 1 : 0)
    if (header.count > 0) {
        add('info', null, `recognized export header (${header.count}/${app.exportHeaderLabels.length} lines); the app strips it before merging`)
    }
    if (header.count > 0 && header.missing.length > 0) {
        add('warning', null, `incomplete export header; missing ${header.missing.map(label => JSON.stringify(label.trim())).join(', ')}`)
    }

    const context = app.buildDateContext(lines, { ...options, fileName: path.basename(file) })
    if (context.ambiguousCount > 0) {
        add('warning', null, `${context.ambiguousCount} ambiguous date line(s) resolved as ${context.order.toUpperCase()} (${context.orderSource}); override with --date-order`)
    }

    const { match, cleanName, style } = analyzeFilename(file, add)

    if (bom) add('error', null, 'file starts with a UTF-8 BOM; the app does not strip it, so the first date line will not be recognized')
    if (empty) add('error', null, 'file is empty; the app will throw (no date lines found)')

    const crlfCount = lines.filter(line => line.endsWith('\r')).length
    if (crlfCount > 0 && crlfCount === lines.length) add('warning', null, 'file uses CRLF line endings (the app tolerates them)')
    else if (crlfCount > 0) add('warning', null, `file mixes CRLF (${crlfCount}) and LF (${lines.length - crlfCount}) line endings`)
    if (!trailingNewline && !empty) add('warning', null, 'file has no trailing newline (the app tolerates this)')

    let sawDateLine = false
    let dateLineCount = 0
    let continuationCount = 0
    let previous = null
    const formatCounts = {}
    const typeCounts = {}
    const senders = new Set()

    lines.forEach((line, index) => {
        if (index < headerEnd) return
        const lineNumber = index + 1
        const classified = app.classifyDateLine(line, context)
        if (!classified) {
            if (line.trim() === '') {
                if (sawDateLine) continuationCount++
                return
            }
            if (!sawDateLine) add('error', lineNumber, 'continuation line appears before the first date line')
            else continuationCount++
            if (DATE_LIKE_REGEXES.some(regex => regex.test(app.normalizeLineForDate(line)))) {
                add('error', lineNumber, 'date-like line does not match any supported timestamp format; the app will treat it as message text')
            }
            return
        }

        sawDateLine = true
        dateLineCount++
        if (Number.isNaN(classified.timestamp)) {
            add('error', lineNumber, `line matches the "${classified.format}" timestamp format but the app parses it to NaN, so the app silently ignores it as a date line`)
            return
        }

        formatCounts[classified.format] = (formatCounts[classified.format] || 0) + 1
        if (previous !== null) {
            if (classified.timestamp < previous) add('warning', lineNumber, `timestamp goes backwards (previous was ${app.ts2display(previous)})`)
            else if (classified.timestamp === previous) add('warning', lineNumber, 'duplicate timestamp')
        }
        previous = classified.timestamp

        const body = app.normalizeLineForDate(line).slice(classified.match[0].length).replace(/^ ?[-:]? ?/, '')
        const senderMatch = /^([^:\n]{1,80}): ([\s\S]*)$/.exec(body)
        const sender = senderMatch ? senderMatch[1] : null
        const text = senderMatch ? senderMatch[2] : body
        const type = app.classifyMessageType(sender, text)
        typeCounts[type] = (typeCounts[type] || 0) + 1
        if (sender) senders.add(sender)
    })

    if (!empty && dateLineCount === 0) {
        add('error', null, 'no date lines found; the app throws "Date 1 and Date 2 both null!" for this file')
    }
    const formats = Object.keys(formatCounts)
    if (formats.length > 1) add('warning', null, `file mixes timestamp formats: ${formats.join(', ')}`)

    const dates = app.returnFirstLastDates(lines, { context })
    const first = dates ? dates[0] : null
    const last = dates ? dates[1] : null
    const outputName = last != null ? `${app.ts2ds(last)} - ${app.conversationKey(cleanName)}.json` : null

    return {
        file, json: false, style, match, cleanName, diagnostics, errors, warnings, empty, bom,
        dateLineCount, continuationCount, typeCounts, formatCounts, senders: [...senders],
        first, last, outputName
    }
}

// Validates an app-produced JSON conversation file. Never modifies the file.
const checkJsonFile = (file) => {
    const diagnostics = []
    const errors = []
    const warnings = []
    const add = (level, message, lineNumber = null) => {
        const diagnostic = { level, line: lineNumber, message, excerpt: null }
        diagnostics.push(diagnostic)
        if (level === 'error') errors.push(diagnostic)
        if (level === 'warning') warnings.push(diagnostic)
    }

    const { match, cleanName, style } = analyzeFilename(file, (level, lineNumber, message) => add(level, message, lineNumber))

    let messages = []
    let parseError = null
    try {
        messages = app.parseJsonChat(fs.readFileSync(file, 'utf8'))
    } catch (e) {
        parseError = e
        add('error', String(e))
    }

    const typeCounts = {}
    const senders = new Set()
    let previous = null
    if (!parseError) {
        if (messages.length === 0) add('error', 'JSON conversation contains no messages')
        messages.forEach((message, index) => {
            const timestamp = message.date.valueOf()
            if (previous !== null && timestamp < previous) add('warning', `message ${index + 1}: timestamp goes backwards`, index + 1)
            previous = timestamp
            typeCounts[message.type] = (typeCounts[message.type] || 0) + 1
            if (message.sender) senders.add(message.sender)
            if (/^(Chat exported on |Last chat on )/.test(message.body)) add('warning', `message ${index + 1}: body looks like an export header`, index + 1)
        })
    }

    const first = messages.length > 0 ? messages[0].date.getTime() : null
    const last = messages.length > 0 ? messages[messages.length - 1].date.getTime() : null
    const outputName = last != null ? `${app.ts2ds(last)} - ${app.conversationKey(cleanName)}.json` : null

    return {
        file, json: true, style, match, cleanName, diagnostics, errors, warnings, empty: false, bom: false,
        messageCount: messages.length, dateLineCount: messages.length, continuationCount: 0, mediaCount: 0,
        typeCounts, formatCounts: {}, senders: [...senders], first, last, outputName
    }
}

const report = (result, options = {}) => {
    const out = [result.file]
    const filename = result.match
        ? `${result.style} export prefix ${JSON.stringify(result.match.prefix)} -> ${JSON.stringify(result.cleanName)}`
        : 'generic filename (the app will not rename it)'
    out.push(`  filename: ${filename}`)
    if (result.json) {
        const types = Object.entries(result.typeCounts).map(([name, count]) => `${name} x${count}`).join(', ')
        out.push(`  messages: ${result.messageCount}${types ? ` (${types})` : ''}`)
    } else {
        const formats = Object.entries(result.formatCounts).map(([name, count]) => `${name} x${count}`).join(', ')
        const types = Object.entries(result.typeCounts).map(([name, count]) => `${name} x${count}`).join(', ')
        out.push(`  date lines: ${result.dateLineCount}${formats ? ` (${formats})` : ''}, continuation lines: ${result.continuationCount}${types ? `, messages: ${types}` : ''}`)
    }
    if (result.first != null) out.push(`  range: ${app.ts2display(result.first)} -> ${app.ts2display(result.last)}`)
    if (result.outputName) out.push(`  app output name: ${result.outputName}`)
    if (result.senders.length && !options.noContent) out.push(`  senders seen: ${result.senders.join(', ')}`)
    for (const diagnostic of result.diagnostics) {
        const label = labelForLevel(diagnostic.level)
        const location = diagnostic.line != null ? ` line ${diagnostic.line}` : ''
        const excerpt = diagnostic.excerpt && !options.noContent ? `\n    > ${diagnostic.excerpt}` : ''
        out.push(`  ${label}${location}: ${diagnostic.message}${excerpt}`)
    }
    out.push(`  => ${result.errors.length === 0 ? 'PASS' : 'FAIL'}`)
    return out.join('\n')
}

const summarize = (result) => {
    const out = [`${result.errors.length > 0 ? 'FAIL' : 'PASS'} ${result.file}`]
    for (const level of ['error', 'warning', 'info']) {
        const groups = new Map()
        for (const diagnostic of result.diagnostics) {
            if (diagnostic.level !== level) continue
            const group = groups.get(diagnostic.message) || { count: 0, first: null }
            group.count++
            if (group.first == null || (diagnostic.line != null && diagnostic.line < group.first)) group.first = diagnostic.line
            groups.set(diagnostic.message, group)
        }
        for (const [message, group] of groups) {
            const label = labelForLevel(level)
            const first = group.first != null ? ` (first at line ${group.first})` : ''
            out.push(`  ${label} x${group.count}: ${message}${first}`)
        }
    }
    return out.join('\n')
}

const usage = 'Usage: node checkFormat.js [--no-content] [--summary] [--date-order=auto|dmy|mdy|ymd] <file-or-directory> [...]\n' +
    '       node checkFormat.js --check-examples\n\n' +
    'Validates WhatsApp .txt exports and app-produced .json conversations against the\n' +
    'formats understood by WhatsAppTXT.js. Files are never modified.\n\n' +
    '--no-content omits chat excerpts and sender names from the report.\n' +
    '--summary collapses per-line diagnostics into per-file counts.\n' +
    '--date-order forces the component order for ambiguous slash/dot dates (default auto).'

const runParserChecks = (expect) => {
    const fullwidth = (str) => str.replace(/[0-9a-z.:]/g, char => String.fromCharCode(char.charCodeAt(0) + 0xFEE0))
    const cases = [
        ['2024-01-15, 9:00 a.m. - A: x', 'android', new Date(2024, 0, 15, 9, 0).valueOf()],
        ['2024-01-15, 12:00 a.m. - A: x', 'android', new Date(2024, 0, 15, 0, 0).valueOf()],
        ['2024-01-15, 3:04\u202fp.m. - A: x', 'android', new Date(2024, 0, 15, 15, 4).valueOf()],
        ['2016-03-18, 10:39:52 AM: A: x', 'androidSeconds', new Date(2016, 2, 18, 10, 39, 52).valueOf()],
        ['1/15/24, 3:04 PM - A: x', 'generic', new Date(2024, 0, 15, 15, 4).valueOf()],
        ['3/18/16, 10:39:52 AM: ', 'generic', new Date(2016, 2, 18, 10, 39, 52).valueOf()],
        ['15/1/2024, 3:04 pm - A: x', 'generic', new Date(2024, 0, 15, 15, 4).valueOf()],
        ['15/1/2024, 12:00 am - A: x', 'generic', new Date(2024, 0, 15, 0, 0).valueOf()],
        ['15/1/2024, 12:00 pm - A: x', 'generic', new Date(2024, 0, 15, 12, 0).valueOf()],
        ['18/1/2018, 9:01:18 am - A: x', 'generic', new Date(2018, 0, 18, 9, 1, 18).valueOf()],
        ['2024-01-15, 3:04 PM - A: x', 'generic', new Date(2024, 0, 15, 15, 4).valueOf()],
        ['15.01.2024, 15:04 - A: x', 'generic', new Date(2024, 0, 15, 15, 4).valueOf()],
        ['(16/01/2024, 3:04 PM) A: x', 'generic', new Date(2024, 0, 16, 15, 4).valueOf()],
        ['[2024-01-15, 3:04:05 AM] A: x', 'iphone', new Date(2024, 0, 15, 3, 4, 5).valueOf()],
        ['\u200e[2024-01-15, 3:04:05 AM] A: x', 'iphone', new Date(2024, 0, 15, 3, 4, 5).valueOf()],
        [fullwidth('2024-01-15, 9:00 a.m.') + ' - A: x', 'android', new Date(2024, 0, 15, 9, 0).valueOf()],
        ['2024-01-15-090418 - A: x', 'canonical', new Date(2024, 0, 15, 9, 4, 18).valueOf()]
    ]
    for (const [line, format, timestamp] of cases) {
        const classified = app.classifyDateLine(line)
        expect(classified != null, `parser: ${JSON.stringify(line)} was not classified`)
        if (!classified) continue
        expect(classified.format === format, `parser: ${JSON.stringify(line)} format ${classified.format}, expected ${format}`)
        expect(classified.timestamp === timestamp, `parser: ${JSON.stringify(line)} timestamp ${classified.timestamp}, expected ${timestamp}`)
    }
    for (const line of ['2024-13-45, 3:04 p.m. - A: x', '2024-01-15, 15:04 p.m. - A: x']) {
        const classified = app.classifyDateLine(line)
        expect(classified != null && Number.isNaN(classified.timestamp), `parser: ${JSON.stringify(line)} should classify with a NaN timestamp`)
    }
    for (const line of ['continuation line', '2024-01-15, 3:04 was fun', '32/13/2024, 3:04 PM - A: x', '2024-01-15-250000 - A: x', '']) {
        expect(app.classifyDateLine(line) === null, `parser: ${JSON.stringify(line)} should not be classified`)
    }
}

const runInferenceChecks = (expect) => {
    const dmy = app.buildDateContext(['15/1/2024, 3:04 pm - A: x', '1/2/2024, 4:04 pm - A: x'])
    expect(dmy.order === 'dmy' && dmy.orderSource === 'inferred', `inference: expected dmy/inferred, got ${JSON.stringify(dmy)}`)
    const mdy = app.buildDateContext(['1/15/2024, 3:04 pm - A: x'])
    expect(mdy.order === 'mdy' && mdy.orderSource === 'inferred', `inference: expected mdy/inferred, got ${JSON.stringify(mdy)}`)
    const ambiguous = app.buildDateContext(['01/02/2024, 09:00 - A: x'])
    expect(ambiguous.order === 'dmy' && ambiguous.orderSource === 'default' && ambiguous.ambiguousCount === 1, `inference: expected dmy/default with 1 ambiguous line, got ${JSON.stringify(ambiguous)}`)
    const override = app.buildDateContext(['01/02/2024, 09:00 - A: x'], { dateOrder: 'mdy' })
    expect(override.order === 'mdy' && override.orderSource === 'override', `inference: expected mdy/override, got ${JSON.stringify(override)}`)
    const tie = app.buildDateContext(['15/1/2024, 3:04 pm - A: x', '1/15/2024, 3:04 pm - A: x'])
    expect(tie.order === 'dmy' && tie.orderSource === 'default', `inference: tie should fall back to default, got ${JSON.stringify(tie)}`)

    const filenameMdy = app.buildDateContext(['10/8/22, 9:00 - A: x', '10/9/22, 9:00 - A: y'], { fileName: '20221009 - Alice.txt' })
    expect(filenameMdy.order === 'mdy' && filenameMdy.orderSource === 'filename', `inference: filename same-day should pick MDY, got ${JSON.stringify({ order: filenameMdy.order, source: filenameMdy.orderSource })}`)
    const filenameDmy = app.buildDateContext(['11/06/2026, 6:49 pm - A: x'], { fileName: '20260612 - Alice.txt' })
    expect(filenameDmy.order === 'dmy' && filenameDmy.orderSource === 'filename', `inference: filename future rejection should pick DMY, got ${JSON.stringify({ order: filenameDmy.order, source: filenameDmy.orderSource })}`)
    const neighbors = app.buildDateContext(['2022-10-01, 9:00 a.m. - A: a', '10/3/22, 2:26 PM - A: b', '2022-10-29, 9:00 a.m. - A: c'])
    expect(neighbors.order === 'mdy' && neighbors.orderSource === 'neighbors', `inference: neighbors should pick MDY, got ${JSON.stringify({ order: neighbors.order, source: neighbors.orderSource })}`)
    const monotonic = app.buildDateContext(['01/02/2024, 09:00 - A: a', '02/01/2024, 09:00 - A: b'])
    expect(monotonic.order === 'mdy' && monotonic.orderSource === 'monotonic', `inference: monotonic order should pick MDY, got ${JSON.stringify({ order: monotonic.order, source: monotonic.orderSource })}`)
    const hintsOverFilename = app.buildDateContext(['25/1/2024, 3:04 pm - A: x'], { fileName: '20260612 - Alice.txt' })
    expect(hintsOverFilename.order === 'dmy' && hintsOverFilename.orderSource === 'inferred', `inference: explicit hints should outrank filename, got ${JSON.stringify({ order: hintsOverFilename.order, source: hintsOverFilename.orderSource })}`)
    const filenameFromName = app.filenameDateFromName('20221009 - Alice.txt')
    const iphoneFromName = app.filenameDateFromName('2022-10-09-Alice.txt')
    expect(filenameFromName instanceof Date && filenameFromName.getFullYear() === 2022 && filenameFromName.getMonth() === 9 && filenameFromName.getDate() === 9, 'inference: backup filename date parse failed')
    expect(iphoneFromName instanceof Date && iphoneFromName.getDate() === 9, 'inference: iPhone filename date parse failed')
    expect(app.filenameDateFromName('WhatsApp Chat with Alice.txt') === null && app.filenameDateFromName('20221340 - Alice.txt') === null, 'inference: invalid filename dates should be null')
}

const runMessageChecks = (expect) => {
    const chat = [
        '2024-01-15, 9:00 a.m. - Alice: Hello',
        'continuation one',
        '',
        'continuation two',
        '2024-01-15, 9:01 a.m. - Bob: <Media omitted>',
        '2024-01-15, 9:02 a.m. - Alice added Carol',
        '2024-01-15, 9:03 a.m. - Bob: IMG-20240115-WA0001.jpg (file attached)',
        '2024-01-15, 9:04 a.m. - Alice: This message was deleted',
        '2024-01-15, 9:05 a.m. - Bob: '
    ].join('\n') + '\n'
    const { messages, warnings } = app.parseChat(chat)
    expect(warnings.length === 0, `messages: expected no warnings, got ${JSON.stringify(warnings)}`)
    expect(messages.length === 6, `messages: expected 6 messages, got ${messages.length}`)
    expect(messages[0].date.valueOf() === new Date(2024, 0, 15, 9, 0).valueOf(), `messages: date ${messages[0].date}`)
    expect(messages[0].sender === 'Alice' && messages[0].type === 'text', `messages: first message ${JSON.stringify(messages[0])}`)
    expect(messages[0].body === 'Hello\ncontinuation one\n\ncontinuation two', `messages: multiline body ${JSON.stringify(messages[0].body)}`)
    expect(messages[1].type === 'media', `messages: media type ${messages[1].type}`)
    expect(messages[2].sender === null && messages[2].type === 'system', `messages: system message ${JSON.stringify(messages[2])}`)
    expect(messages[3].type === 'attachment', `messages: attachment type ${messages[3].type}`)
    expect(messages[4].type === 'deleted', `messages: deleted type ${messages[4].type}`)
    expect(messages[5].sender === 'Bob' && messages[5].body === '', `messages: empty body ${JSON.stringify(messages[5])}`)

    const simple = app.parseChat('2024-01-15, 9:00 a.m. - A: x\n')
    expect(simple.messages.length === 1 && simple.messages[0].body === 'x', `messages: trailing newline artifact ${JSON.stringify(simple.messages[0].body)}`)

    const json = app.chatToJson(messages)
    const back = app.parseJsonChat(json)
    const shape = (list) => JSON.stringify(list.map(message => [message.date.getTime(), message.sender, message.type, message.body]))
    expect(shape(back) === shape(messages), 'messages: JSON round-trip mismatch')
    expect(JSON.parse(json)[0].date === messages[0].date.toISOString(), 'messages: dates must serialize as UTC ISO strings')

    const listA = app.parseChat('2024-01-01, 10:00 a.m. - A: x\n2024-01-01, 10:00 a.m. - A: x\n').messages
    const listB = app.parseChat('2024-01-01, 10:00 a.m. - A: x\n2024-01-02, 10:00 a.m. - B: y\n').messages
    const merged = app.mergeMessages([listA, listB])
    expect(merged.length === 3, `messages: merge expected 3 messages, got ${merged.length}`)
    expect(merged[0].date.getTime() <= merged[1].date.getTime() && merged[1].date.getTime() <= merged[2].date.getTime(), 'messages: merge not sorted')
    expect(merged.filter(message => message.body === 'x').length === 2, 'messages: merge must keep the max multiplicity')
}

const runRenameChecks = (expect) => {
    const makeChat = (name, extraBody) => {
        const times = [['09:00', 'hello'], ['09:01', 'how are you'], ['09:02', 'good'], ['09:03', 'bye'], ['09:04', 'later'], ['09:05', 'x']]
        const messages = times.map(([time, body]) => ({ date: new Date(`2024-01-01T${time}:00`), sender: name, type: 'text', body }))
        if (extraBody) messages.push({ date: new Date('2024-01-01T09:06:00'), sender: name, type: 'text', body: extraBody })
        return { key: name, name, messages, sources: [] }
    }
    const oldChat = makeChat('Old Name')
    const newChat = makeChat('New Name', 'new message')
    const unrelated = { key: 'Someone Else', name: 'Someone Else', sources: [], messages: [{ date: new Date('2024-01-01T09:00:00'), sender: 'Someone Else', type: 'text', body: 'different' }] }

    const detected = app.detectRenamedGroups([oldChat, newChat, unrelated], { minShared: 5, minCoverage: 0.6 })
    expect(detected.groups.length === 1 && detected.groups[0].length === 2, `renames: expected one group of two, got ${JSON.stringify(detected.groups)}`)
    const strict = app.detectRenamedGroups([oldChat, newChat], { minShared: 10, minCoverage: 0.6 })
    expect(strict.groups.length === 0, `renames: expected no group below the shared threshold, got ${JSON.stringify(strict.groups)}`)

    const merged = app.mergeConversationGroup([oldChat, newChat])
    expect(merged.name === 'New Name', `renames: expected newest name, got ${merged.name}`)
    expect(merged.messages.length === 8, `renames: expected 8 messages (7 unique + 1 marker), got ${merged.messages.length}`)
    const senders = new Set(merged.messages.filter(message => message.sender).map(message => message.sender))
    expect(senders.size === 1 && senders.has('New Name'), `renames: expected newest sender names, got ${JSON.stringify([...senders])}`)
    const marker = merged.messages.find(message => message.type === 'system')
    expect(marker != null && marker.sender === null, 'renames: missing rename marker')
    expect(marker.body === 'Conversation name changed from "Old Name" to "New Name"', `renames: unexpected marker body ${marker && marker.body}`)
    expect(marker.date.getTime() === oldChat.messages[oldChat.messages.length - 1].date.getTime(), 'renames: marker should sit at the older file last message')
    const markerIndex = merged.messages.indexOf(marker)
    expect(markerIndex > 0 && merged.messages[markerIndex - 1].date.getTime() <= marker.date.getTime(), 'renames: marker ordering wrong')

    const drifted = makeChat('Drifted')
    const fresh = makeChat('Fresh', 'extra')
    fresh.messages[0].date = new Date(fresh.messages[0].date.getTime() + 30000)
    const driftMerged = app.mergeConversationGroup([drifted, fresh])
    expect(driftMerged.messages.filter(message => message.type !== 'system').length === 7, `renames: expected minute-level dedupe, got ${driftMerged.messages.length}`)

    const equivalent = app.mergeConversationGroup([makeChat('Papa_s Contact'), makeChat("Papa's Contact", 'extra')])
    expect(equivalent.messages.every(message => message.type !== 'system'), 'renames: equivalent names should not produce a marker')

    const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'whatsapptxt-renames-'))
    const silent = (fn) => {
        const original = console.log
        console.log = () => {}
        try { fn() } finally { console.log = original }
    }
    try {
        fs.writeFileSync(path.join(tmp, '20240101 - Old Name.json'), JSON.stringify(oldChat.messages) + '\n')
        fs.writeFileSync(path.join(tmp, '20240101 - New Name.json'), JSON.stringify(newChat.messages) + '\n')
        silent(() => app.main([tmp]))
        const outputs = fs.readdirSync(tmp).sort()
        expect(outputs.length === 1 && outputs[0] === '20240101 - New Name.json', `renames: expected one merged output, got ${JSON.stringify(outputs)}`)
        if (outputs.length === 1) {
            const result = checkJsonFile(path.join(tmp, outputs[0]))
            expect(result.errors.length === 0, `renames: merged output failed validation:\n${report(result)}`)
            const messages = app.parseJsonChat(fs.readFileSync(path.join(tmp, outputs[0]), 'utf8'))
            expect(messages.some(message => message.type === 'system' && message.body.startsWith('Conversation name changed')), 'renames: merged output missing the rename marker')
        }
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true })
    }
}

const runEndToEndChecks = (expect) => {
    const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'whatsapptxt-test-'))
    const silent = (fn) => {
        const original = console.log
        console.log = () => {}
        try { fn() } finally { console.log = original }
    }
    try {
        const out = path.join(tmp, 'out')
        const srcA = path.join(tmp, 'src-a')
        const srcB = path.join(tmp, 'src-b')
        fs.mkdirSync(out); fs.mkdirSync(srcA); fs.mkdirSync(srcB)
        const header = 'Chat exported on Mon Apr 06 2020 03:37:54 GMT-0400 (Eastern Daylight Time).\nLast chat on Tue Jan 02 2024 10:00:00 GMT-0500 (Eastern Standard Time).\n\n'
        fs.writeFileSync(path.join(srcA, 'WhatsApp Chat with Alice.txt'), `${header}2024-01-01, 10:00 a.m. - Alice: Day one\n`)
        fs.writeFileSync(path.join(srcB, '20240102 - Alice.txt'), '2024-01-02, 10:00 a.m. - Bob: Day two\n')
        fs.writeFileSync(path.join(srcA, '.backup-state.json'), '{"state":true}\n')
        fs.writeFileSync(path.join(srcA, '.hidden.txt'), 'not a chat\n')
        silent(() => app.main([out, srcA, srcB]))
        expect(fs.existsSync(path.join(srcA, '.backup-state.json')) && fs.existsSync(path.join(srcA, '.hidden.txt')), 'e2e: hidden files were processed or renamed')
        const outputs = fs.readdirSync(out)
        expect(outputs.length === 1 && outputs[0] === '20240102 - Alice.json', `e2e: expected one JSON output, got ${JSON.stringify(outputs)}`)
        if (outputs.length === 1) {
            const json = fs.readFileSync(path.join(out, outputs[0]), 'utf8')
            const parsed = JSON.parse(json)
            expect(Array.isArray(parsed) && parsed.length === 2, `e2e: expected 2 messages, got ${JSON.stringify(parsed)}`)
            expect(Array.isArray(parsed) && parsed[0].date === new Date(2024, 0, 1, 10, 0).toISOString(), `e2e: first date ${JSON.stringify(parsed[0] && parsed[0].date)}`)
            expect(Array.isArray(parsed) && parsed[0].sender === 'Alice' && parsed[0].type === 'text' && parsed[0].body === 'Day one', `e2e: first message ${JSON.stringify(parsed[0])}`)
            expect(Array.isArray(parsed) && parsed[1].sender === 'Bob' && parsed[1].body === 'Day two', `e2e: second message ${JSON.stringify(parsed[1])}`)
            expect(json.endsWith('\n') && !json.endsWith('\n\n'), 'e2e: JSON output must end with exactly one newline')
            silent(() => app.main([out, srcA, srcB]))
            const rerun = fs.readFileSync(path.join(out, outputs[0]), 'utf8')
            expect(rerun === json, 'e2e: a second run changed the JSON output')
        }
        expect(fs.existsSync(path.join(srcA, 'Alice.txt')) && !fs.existsSync(path.join(srcA, 'WhatsApp Chat with Alice.txt')), 'e2e: source A was not renamed')
        expect(fs.existsSync(path.join(srcB, 'Alice.txt')), 'e2e: source B was not renamed')

        const collide = path.join(tmp, 'collide')
        fs.mkdirSync(collide)
        fs.writeFileSync(path.join(collide, 'WhatsApp Chat with Bob.txt'), '2024-01-01, 10:00 a.m. - A: x\n')
        fs.writeFileSync(path.join(collide, '20240101 - Bob.txt'), '2024-01-01, 10:00 a.m. - A: y\n')
        const collideOut = path.join(tmp, 'collide-out')
        fs.mkdirSync(collideOut)
        let threw = false
        silent(() => { try { app.main([collideOut, collide]) } catch (e) { threw = true } })
        expect(threw, 'e2e: filename collision did not abort')
        expect(fs.existsSync(path.join(collide, 'WhatsApp Chat with Bob.txt')) && fs.existsSync(path.join(collide, '20240101 - Bob.txt')), 'e2e: collision aborted after renaming')
        expect(fs.readdirSync(collideOut).length === 0, 'e2e: collision wrote output')

        const nonChat = path.join(tmp, 'non-chat')
        fs.mkdirSync(nonChat)
        fs.writeFileSync(path.join(nonChat, 'notes.txt'), 'just notes, no dates here\n')
        const nonChatOut = path.join(tmp, 'non-chat-out')
        fs.mkdirSync(nonChatOut)
        threw = false
        silent(() => { try { app.main([nonChatOut, nonChat]) } catch (e) { threw = true } })
        expect(threw, 'e2e: non-chat file did not abort')
        expect(fs.existsSync(path.join(nonChat, 'notes.txt')), 'e2e: non-chat file was renamed or deleted')

        const badJson = path.join(tmp, 'bad-json')
        fs.mkdirSync(badJson)
        fs.writeFileSync(path.join(badJson, 'WhatsApp Chat with Bad.txt').replace(/\.txt$/, '.json'), '{ "not": "an array" }\n')
        const badJsonOut = path.join(tmp, 'bad-json-out')
        fs.mkdirSync(badJsonOut)
        threw = false
        silent(() => { try { app.main([badJsonOut, badJson]) } catch (e) { threw = true } })
        expect(threw, 'e2e: malformed JSON conversation did not abort')

        const dry = path.join(tmp, 'dry')
        fs.mkdirSync(dry)
        fs.writeFileSync(path.join(dry, 'WhatsApp Chat with Carol.txt'), '2024-01-01, 10:00 a.m. - A: x\n')
        const dryOut = path.join(tmp, 'dry-out')
        fs.mkdirSync(dryOut)
        silent(() => app.main([dryOut, dry], { dryRun: true }))
        expect(fs.existsSync(path.join(dry, 'WhatsApp Chat with Carol.txt')), 'e2e: dry run renamed a source')
        expect(fs.readdirSync(dryOut).length === 0, 'e2e: dry run wrote an output')

        const ambiguousDir = path.join(tmp, 'ambiguous')
        fs.mkdirSync(ambiguousDir)
        fs.writeFileSync(path.join(ambiguousDir, 'WhatsApp Chat with Gina.txt'), '01/02/2024, 09:00 - Alice: Ambiguous\n')
        const ambiguousOut = path.join(tmp, 'ambiguous-out')
        fs.mkdirSync(ambiguousOut)
        silent(() => app.main([ambiguousOut, ambiguousDir]))
        const defaultOutputs = fs.readdirSync(ambiguousOut)
        expect(defaultOutputs.length === 1 && defaultOutputs[0] === '20240201 - Gina.json', `e2e: ambiguous dates should default to DMY, got ${JSON.stringify(defaultOutputs)}`)
        const ambiguousMdyOut = path.join(tmp, 'ambiguous-mdy-out')
        fs.mkdirSync(ambiguousMdyOut)
        silent(() => app.main([ambiguousMdyOut, ambiguousDir], { dateOrder: 'mdy' }))
        const mdyOutputs = fs.readdirSync(ambiguousMdyOut)
        expect(mdyOutputs.length === 1 && mdyOutputs[0] === '20240102 - Gina.json', `e2e: --date-order=mdy should give Jan 2, got ${JSON.stringify(mdyOutputs)}`)
        const ambiguousResult = checkFile(path.join(ambiguousDir, 'Gina.txt'))
        expect(ambiguousResult.warnings.some(warning => warning.message.includes('ambiguous')), 'e2e: checker did not warn about ambiguous dates')

        const filenameDir = path.join(tmp, 'filename-order')
        fs.mkdirSync(filenameDir)
        fs.writeFileSync(path.join(filenameDir, '20221009 - Hana.txt'), '10/8/22, 9:00 am - Alice: A\n10/9/22, 9:01 am - Alice: B\n')
        const filenameOut = path.join(tmp, 'filename-order-out')
        fs.mkdirSync(filenameOut)
        silent(() => app.main([filenameOut, filenameDir]))
        const filenameOutputs = fs.readdirSync(filenameOut)
        expect(filenameOutputs.length === 1 && filenameOutputs[0] === '20221009 - Hana.json', `e2e: filename inference output ${JSON.stringify(filenameOutputs)}`)
        if (filenameOutputs.length === 1) {
            const parsedFilename = JSON.parse(fs.readFileSync(path.join(filenameOut, filenameOutputs[0]), 'utf8'))
            expect(parsedFilename[0].date === new Date(2022, 9, 8, 9, 0).toISOString(), `e2e: filename inference should pick MDY, got ${parsedFilename[0].date}`)
        }

        const existing = [0, 1, 2, 3, 4].map(i => ({ date: new Date(2024, 0, 1, 9, i, 30).toISOString(), sender: 'Alice', type: 'text', body: `overlap ${i}` }))

        // New phone txt without seconds merges into the existing JSON (with seconds) plus a new message
        const mixed = path.join(tmp, 'mixed')
        fs.mkdirSync(mixed)
        fs.writeFileSync(path.join(mixed, '20240101 - Alice.json'), JSON.stringify(existing, null, 2) + '\n')
        const mixedLines = [0, 1, 2, 3, 4].map(i => `2024-01-01, 9:0${i} a.m. - Alice: overlap ${i}`).join('\n')
        fs.writeFileSync(path.join(mixed, 'WhatsApp Chat with Alice.txt'), `${mixedLines}\n2024-01-01, 9:05 a.m. - Alice: brand new\n`)
        silent(() => app.main([mixed]))
        const mixedOutputs = fs.readdirSync(mixed)
        expect(mixedOutputs.length === 1 && mixedOutputs[0] === '20240101 - Alice.json', `e2e: txt+json expected one output, got ${JSON.stringify(mixedOutputs)}`)
        if (mixedOutputs.length === 1) {
            const messages = app.parseJsonChat(fs.readFileSync(path.join(mixed, mixedOutputs[0]), 'utf8'))
            expect(messages.length === 6, `e2e: txt+json expected 6 messages without drift duplicates, got ${messages.length}`)
            expect(messages.filter(message => message.body.startsWith('overlap')).length === 5, 'e2e: txt+json overlap was duplicated')
            expect(messages.some(message => message.body === 'brand new'), 'e2e: txt+json new message missing')
        }

        // A new-name txt merges with the existing JSON and records the rename
        const renamedMix = path.join(tmp, 'renamed-mix')
        fs.mkdirSync(renamedMix)
        fs.writeFileSync(path.join(renamedMix, '20240101 - Alice.json'), JSON.stringify(existing, null, 2) + '\n')
        const renamedLines = [0, 1, 2, 3, 4].map(i => `2024-01-01, 9:0${i} a.m. - Alice Smith: overlap ${i}`).join('\n')
        fs.writeFileSync(path.join(renamedMix, 'WhatsApp Chat with Alice Smith.txt'), `${renamedLines}\n2024-01-01, 9:05 a.m. - Alice Smith: brand new\n`)
        silent(() => app.main([renamedMix]))
        const renamedOutputs = fs.readdirSync(renamedMix)
        expect(renamedOutputs.length === 1 && renamedOutputs[0] === '20240101 - Alice Smith.json', `e2e: renamed txt+json output ${JSON.stringify(renamedOutputs)}`)
        if (renamedOutputs.length === 1) {
            const messages = app.parseJsonChat(fs.readFileSync(path.join(renamedMix, renamedOutputs[0]), 'utf8'))
            expect(messages.some(message => message.type === 'system' && message.body === 'Conversation name changed from "Alice" to "Alice Smith"'), 'e2e: renamed txt+json missing marker')
        }

        // The removed text mode is ignored; output is still JSON
        const removedMode = path.join(tmp, 'removed-mode')
        fs.mkdirSync(removedMode)
        fs.writeFileSync(path.join(removedMode, 'WhatsApp Chat with Frank.txt'), '2024-01-01, 10:00 a.m. - Alice: Raw line\n')
        const removedModeOut = path.join(tmp, 'removed-mode-out')
        fs.mkdirSync(removedModeOut)
        silent(() => app.main([removedModeOut, removedMode], { normalize: false }))
        const removedModeOutputs = fs.readdirSync(removedModeOut)
        expect(removedModeOutputs.length === 1 && removedModeOutputs[0] === '20240101 - Frank.json', `e2e: removed text mode should still write JSON, got ${JSON.stringify(removedModeOutputs)}`)
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true })
    }
}

const runSelfTest = () => {
    const root = path.join(__dirname, 'examples')
    const validRoot = path.join(root, 'valid')
    const invalidRoot = path.join(root, 'invalid')
    const mergeRoot = path.join(root, 'merge')
    if (!fs.existsSync(validRoot) || !fs.existsSync(invalidRoot) || !fs.existsSync(mergeRoot)) {
        console.error(`Missing ${root}; expected valid/, invalid/ and merge/ subdirectories`)
        return 2
    }
    let checks = 0
    let failures = 0
    const failureDetails = []
    const expect = (condition, detail) => {
        checks++
        if (!condition) {
            failures++
            failureDetails.push(detail)
        }
    }

    for (const file of collectChatFiles(validRoot)) {
        const result = file.toLowerCase().endsWith('.json') ? checkJsonFile(file) : checkFile(file)
        expect(result.errors.length === 0, `examples/${path.relative(root, file)} expected PASS but FAILED:\n${report(result)}`)
    }
    const sampleResult = checkFile(path.join(validRoot, 'matrix', 'android-filename', 'WhatsApp Chat with AndroidFormat.txt'))
    expect(sampleResult.outputName === '20240115 - AndroidFormat.json', `checker: expected output name 20240115 - AndroidFormat.json, got ${sampleResult.outputName}`)
    const defaultResult = checkFile(path.join(validRoot, 'edge', 'WhatsApp Chat with AmbiguousDmyDefault.txt'))
    expect(defaultResult.warnings.some(warning => warning.message.includes('(default)')), 'checker: AmbiguousDmyDefault fixture should resolve with the default order')
    for (const file of collectChatFiles(invalidRoot)) {
        const result = file.toLowerCase().endsWith('.json') ? checkJsonFile(file) : checkFile(file)
        expect(result.errors.length > 0, `examples/${path.relative(root, file)} expected FAIL but PASSED`)
    }
    const expectationsPath = path.join(root, 'expectations.json')
    if (fs.existsSync(expectationsPath)) {
        const expectations = JSON.parse(fs.readFileSync(expectationsPath, 'utf8'))
        const seen = new Set()
        for (const file of collectChatFiles(invalidRoot)) {
            const rel = path.relative(invalidRoot, file)
            const expected = expectations[rel]
            if (!expected) {
                expect(false, `invalid/${rel} has no entry in expectations.json`)
                continue
            }
            seen.add(rel)
            const result = checkFile(file)
            const messages = result.diagnostics.map(diagnostic => diagnostic.message)
            expect(messages.some(message => message.includes(expected.error)), `invalid/${rel} expected an error containing ${JSON.stringify(expected.error)}, got: ${messages.join(' | ')}`)
        }
        for (const rel of Object.keys(expectations)) {
            expect(seen.has(rel), `expectations.json lists ${rel} but no such fixture exists`)
        }
    }

    for (const scenario of fs.readdirSync(mergeRoot).filter(name => fs.statSync(path.join(mergeRoot, name)).isDirectory()).sort()) {
        const scenarioPath = path.join(mergeRoot, scenario)
        const sourceDirs = fs.readdirSync(scenarioPath)
            .map(name => path.join(scenarioPath, name))
            .filter(full => fs.statSync(full).isDirectory())
            .sort()
        try {
            const messageLists = sourceDirs.map(dir => {
                const files = collectChatFiles(dir)
                if (files.length !== 1) throw `expected exactly 1 chat file in ${path.relative(root, dir)}, found ${files.length}`
                const parsed = app.parseChat(app.stripExportHeader(fs.readFileSync(files[0], 'utf8')))
                if (parsed.warnings.length > 0) throw `unexpected leading line(s) in ${path.relative(root, dir)}`
                return parsed.messages
            })
            const merged = app.mergeMessages(messageLists)
            const expectedFirst = Math.min(...messageLists.map(list => Math.min(...list.map(message => message.date.getTime()))))
            const expectedLast = Math.max(...messageLists.map(list => Math.max(...list.map(message => message.date.getTime()))))
            const rangeMatches = merged.length > 0 && merged[0].date.getTime() === expectedFirst && merged[merged.length - 1].date.getTime() === expectedLast
            expect(rangeMatches, `merge/${scenario} expected merged range ${app.ts2display(expectedFirst)} -> ${app.ts2display(expectedLast)} but got ${merged.length ? `${app.ts2display(merged[0].date.getTime())} -> ${app.ts2display(merged[merged.length - 1].date.getTime())}` : 'no messages'}`)
            const maxCounts = new Map()
            for (const list of messageLists) {
                const counts = new Map()
                for (const message of list) {
                    const key = app.overlapKey(message)
                    counts.set(key, (counts.get(key) || 0) + 1)
                }
                for (const [key, count] of counts) maxCounts.set(key, Math.max(maxCounts.get(key) || 0, count))
            }
            const expectedLength = [...maxCounts.values()].reduce((total, count) => total + count, 0)
            expect(merged.length === expectedLength, `merge/${scenario} expected ${expectedLength} merged messages, got ${merged.length}`)
            const headerLeaked = merged.some(message => message.body.startsWith('Chat exported on ') || message.body.startsWith('Last chat on '))
            expect(!headerLeaked, `merge/${scenario} header leaked into a message body`)
        } catch (err) {
            expect(false, `merge/${scenario} threw: ${err}`)
        }
    }

    runParserChecks(expect)
    runInferenceChecks(expect)
    runMessageChecks(expect)
    runRenameChecks(expect)
    runEndToEndChecks(expect)

    if (failures > 0) {
        console.error(`SELF-TEST FAILED: ${failures} of ${checks} checks failed\n`)
        failureDetails.forEach(detail => console.error(detail + '\n'))
        return 1
    }
    console.log(`SELF-TEST PASSED: ${checks} checks (fixtures, parser, messages, merge, collisions and end-to-end)`)
    return 0
}

const main = () => {
    const rawArgs = process.argv.slice(2)
    const noContent = rawArgs.includes('--no-content')
    const summary = rawArgs.includes('--summary')
    let dateOrder = 'auto'
    const dateOrderArg = rawArgs.find(arg => arg.startsWith('--date-order='))
    if (dateOrderArg) {
        dateOrder = dateOrderArg.slice('--date-order='.length)
        if (!['auto', 'dmy', 'mdy', 'ymd'].includes(dateOrder)) {
            console.error(`Invalid --date-order: ${dateOrder}`)
            process.exit(2)
        }
    }
    const args = rawArgs.filter(arg => arg !== '--no-content' && arg !== '--summary' && !arg.startsWith('--date-order='))
    if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
        console.log(usage)
        process.exit(args.length === 0 ? 2 : 0)
    }
    if (args.includes('--check-examples')) process.exit(runSelfTest())

    let files = []
    try {
        files = args.flatMap(collectChatFiles)
    } catch (err) {
        console.error(`Cannot read ${err.path || 'input'}: ${err.message}`)
        process.exit(2)
    }
    if (files.length === 0) {
        console.error('No .txt or .json files found in the given paths')
        process.exit(2)
    }

    let failed = 0
    const collisions = findFilenameCollisions(files)
    for (const file of files) {
        const result = file.toLowerCase().endsWith('.json') ? checkJsonFile(file) : checkFile(file, { dateOrder })
        const collision = collisions.get(file)
        if (collision) {
            const diagnostic = { level: 'error', line: null, message: collision, excerpt: null }
            result.diagnostics.push(diagnostic)
            result.errors.push(diagnostic)
        }
        console.log(summary ? summarize(result) : report(result, { noContent }))
        console.log('')
        if (result.errors.length > 0) failed++
    }
    console.log(`Checked ${files.length} file(s): ${files.length - failed} passed, ${failed} failed`)
    process.exit(failed > 0 ? 1 : 0)
}

main()
