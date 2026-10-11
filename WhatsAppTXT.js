const fs = require('fs')

// Lists chat files in a dir (.txt exports and .json outputs; dotfiles such as backup state files are ignored)
const getChatFiles = (dir, includeJson = true) => fs.readdirSync(dir).filter(fil => {
    if (fil.startsWith('.')) return false
    const lower = fil.toLowerCase()
    if (!lower.endsWith('.txt') && !(includeJson && lower.endsWith('.json'))) return false
    return !fs.statSync(`${dir}/${fil}`).isDirectory()
})

// Conversation identity: clean name without extension (.txt and .json are the same conversation)
const conversationKey = (finalName) => finalName.replace(/\.(txt|json)$/i, '')

// Given a file name, returns { style, prefix, finalName } if it has a known export prefix, else null
const matchFilenamePrefix = (txt) => {
    const regexRes1 = /^WhatsApp Chat with /.exec(txt) // Android Export
    const regexRes2 = /^[0-9]{4}(0[1-9]|1[0-2])(0[1-9]|[1-2][0-9]|3[0-1]) - /.exec(txt) // Previous Backup
    const regexRes3 = /^[0-9]{4}-[0-9]{1,2}-[0-9]{1,2}-/.exec(txt) // iPhone Export
    const res = regexRes1 || regexRes2 || regexRes3
    if (!res) return null
    const style = regexRes1 ? 'android' : regexRes2 ? 'backup' : 'iphone'
    return { style, prefix: res[0], finalName: txt.length > res[0].length + 4 ? txt.slice(res[0].length) : txt }
}

// Given a list of files in a dir, returns [{ original, final }] and throws before any rename if two
// files would end up with the same name or a target already exists
const planFileRenames = (dir, txts) => {
    const plan = txts.map(txt => {
        const match = matchFilenamePrefix(txt)
        return { original: txt, final: match ? match.finalName : txt }
    })
    const grouped = new Map()
    for (const item of plan) {
        if (item.final === item.original) continue
        if (!grouped.has(item.final)) grouped.set(item.final, [])
        grouped.get(item.final).push(item.original)
    }
    const problems = []
    for (const [final, originals] of grouped) {
        if (originals.length > 1) {
            problems.push(`  ${originals.map(name => JSON.stringify(name)).join(' and ')} both map to ${JSON.stringify(final)}`)
        }
        if (fs.existsSync(`${dir}/${final}`)) {
            problems.push(`  ${JSON.stringify(originals[0])} maps to ${JSON.stringify(final)}, which already exists`)
        }
    }
    if (problems.length > 0) {
        throw `Refusing to rename files in ${dir} because of name collisions:\n${problems.join('\n')}`
    }
    return plan
}

// Header lines prepended by some external backup tools
const exportHeaderLabels = ['Chat exported on ', 'Last chat on ']

// NFKD-normalizes a line and strips leading direction marks (iOS adds U+200E to some lines)
const normalizeLineForDate = (line) => line.normalize('NFKD').replace(/^[\u200e\u200f]+/, '')

// Returns { count, blankAfter, missing } for the recognized header lines at the start of a file
const matchExportHeader = (lines) => {
    const found = []
    let index = 0
    while (index < exportHeaderLabels.length && index < lines.length) {
        const line = normalizeLineForDate(lines[index].replace(/\r$/, ''))
        const label = exportHeaderLabels.find(item => !found.includes(item) && line.startsWith(item) && line.endsWith('.'))
        if (!label) break
        found.push(label)
        index++
    }
    const blankAfter = index < lines.length && lines[index].replace(/\r$/, '') === ''
    return { count: found.length, blankAfter, missing: exportHeaderLabels.filter(label => !found.includes(label)) }
}

// Removes the recognized export header (and one following blank line) from the start of the content
const stripExportHeader = (content) => {
    const lines = content.split('\n')
    const { count, blankAfter } = matchExportHeader(lines)
    if (count === 0) return content
    return lines.slice(count + (blankAfter ? 1 : 0)).join('\n')
}

// Explicit date formats whose component order is unambiguous (year first or bracketed year first)
const dateFormats = [
    {
        name: 'android',
        regex: /^[0-9]{4}-[0-9]{2}-[0-9]{2}, [0-9]{1,2}:[0-9]{1,2} (?:a\.m\.|p\.m\.) /,
        parse: (match) => new Date(match[0].slice(0, -1).replace(/\./g, '')).valueOf()
    },
    {
        name: 'iphone',
        regex: /^\[[0-9]{4}-[0-9]{2}-[0-9]{2}, [0-9]{1,2}:[0-9]{1,2}:[0-9]{1,2} (?:AM|PM)\] /,
        parse: (match) => new Date(match[0].slice(1, -2)).valueOf()
    },
    {
        name: 'androidSeconds',
        regex: /^[0-9]{4}-[0-9]{2}-[0-9]{2}, [0-9]{1,2}:[0-9]{2}:[0-9]{2} (?:AM|PM)/,
        parse: (match) => new Date(match[0]).valueOf()
    },
    {
        name: 'canonical',
        regex: /^([0-9]{4})-([0-9]{2})-([0-9]{2})-([01][0-9]|2[0-3])([0-5][0-9])([0-5][0-9])/,
        parse: (match) => new Date(parseInt(match[1], 10), parseInt(match[2], 10) - 1, parseInt(match[3], 10), parseInt(match[4], 10), parseInt(match[5], 10), parseInt(match[6], 10)).valueOf()
    }
]

// Loose date shape used to infer the component order
const dateShapeRegex = /^[\[(]?(\d{1,4})([-/.])(\d{1,2})\2(\d{1,4})/

// Generic matcher: optional bracket, three date components with a consistent separator,
// time H:MM[:SS], optional meridiem, optional closing bracket
const genericDateRegex = /^([\[(])?(\d{1,4})([-/.])(\d{1,2})\3(\d{1,4})(?:,\s*|\s+)(\d{1,2}):(\d{1,2})(?::(\d{1,2})(?:\.\d{1,3})?)?(?:\s*([ap])\.?\s*m\.?)?(\s*[\])])?/i

// Normalizes a two-digit year to 2000+
const normalizeYear = (value) => {
    if (value.length === 4) return Number(value)
    if (value.length <= 2) return 2000 + Number(value)
    return null
}

// Resolves the date components for the given order. Returns { year, month, day } or null
const resolveDateComponents = (c1, c2, c3, order) => {
    let year, month, day
    if (c1.length === 4) {
        year = Number(c1); month = Number(c2); day = Number(c3)
    } else if (order === 'mdy') {
        month = Number(c1); day = Number(c2); year = normalizeYear(c3)
    } else if (order === 'ymd') {
        year = normalizeYear(c1); month = Number(c2); day = Number(c3)
    } else {
        day = Number(c1); month = Number(c2); year = normalizeYear(c3)
    }
    if (year == null || month < 1 || month > 12 || day < 1 || day > 31) return null
    const probe = new Date(year, month - 1, day)
    if (probe.getFullYear() !== year || probe.getMonth() !== month - 1 || probe.getDate() !== day) return null
    return { year, month, day }
}

// Parses a line with the generic matcher. Returns null when the shape or the values are not valid
const classifyGenericLine = (line, context) => {
    const match = genericDateRegex.exec(line)
    if (!match) return null
    const open = match[1]
    const close = match[10]
    if (open && (!close || close.trim() !== (open === '[' ? ']' : ')'))) return null
    if (!open && close) return null
    const rest = line.slice(match[0].length)
    if (open) {
        if (rest !== '' && rest[0] !== ' ') return null
    } else if (rest !== '' && !/^( - |: )/.test(rest) && rest.trim() !== '') {
        return null
    }
    let order
    if (match[2].length === 4) {
        order = 'ymd'
    } else {
        const first = Number(match[2])
        const second = Number(match[4])
        if (first > 12 && second <= 12) order = 'dmy'
        else if (second > 12 && first <= 12) order = 'mdy'
        else order = (context && context.order) || 'dmy'
    }
    const date = resolveDateComponents(match[2], match[4], match[5], order)
    if (!date) return null
    let hours = Number(match[6])
    const meridiem = match[9]
    if (meridiem) {
        if (hours < 1 || hours > 12) return null
        hours %= 12
        if (meridiem.toLowerCase() === 'p') hours += 12
    } else if (hours > 23) {
        return null
    }
    const minutes = Number(match[7])
    const seconds = match[8] == null ? 0 : Number(match[8])
    if (minutes > 59 || seconds > 59) return null
    const timestamp = new Date(date.year, date.month - 1, date.day, hours, minutes, seconds).valueOf()
    return {
        format: 'generic',
        match,
        timestamp,
        variant: {
            order,
            meridiem: Boolean(meridiem),
            seconds: match[8] != null,
            bracket: open === '[' ? 'square' : open === '(' ? 'paren' : 'none',
            ambiguous: match[2].length !== 4 && Number(match[2]) <= 12 && Number(match[4]) <= 12
        }
    }
}

// Returns the local date encoded in an export filename (YYYYMMDD - or YYYY-M-D-), or null
const filenameDateFromName = (name) => {
    const backup = /^(\d{4})(\d{2})(\d{2}) - /.exec(name)
    const iphone = /^(\d{4})-(\d{1,2})-(\d{1,2})-/.exec(name)
    const parts = backup ? [backup[1], backup[2], backup[3]] : iphone ? [iphone[1], iphone[2], iphone[3]] : null
    if (!parts) return null
    const year = Number(parts[0])
    const month = Number(parts[1])
    const day = Number(parts[2])
    const probe = new Date(year, month - 1, day)
    if (probe.getFullYear() !== year || probe.getMonth() !== month - 1 || probe.getDate() !== day) return null
    return probe
}

// Classifies all lines under one candidate order and returns timeline evidence
const analyzeOrder = (lines, order) => {
    const sequence = []
    for (const line of lines) {
        const classified = classifyDateLine(line, { order })
        if (!classified || Number.isNaN(classified.timestamp)) continue
        sequence.push({ ts: classified.timestamp, ambiguous: Boolean(classified.variant && classified.variant.ambiguous) })
    }
    let backwardsCount = 0
    let backwardsDays = 0
    for (let i = 1; i < sequence.length; i++) {
        const delta = sequence[i - 1].ts - sequence[i].ts
        if (delta > 0) {
            backwardsCount++
            backwardsDays += delta / 86400000
        }
    }
    let neighborFits = 0
    let neighborTotal = 0
    let neighborOutDays = 0
    for (let i = 0; i < sequence.length; i++) {
        if (!sequence[i].ambiguous) continue
        let prev = null
        let next = null
        for (let j = i - 1; j >= 0 && !prev; j--) if (!sequence[j].ambiguous) prev = sequence[j]
        for (let j = i + 1; j < sequence.length && !next; j++) if (!sequence[j].ambiguous) next = sequence[j]
        if (!prev && !next) continue
        neighborTotal++
        const low = prev ? prev.ts : -Infinity
        const high = next ? next.ts : Infinity
        if (sequence[i].ts >= low && sequence[i].ts <= high) neighborFits++
        else neighborOutDays += (sequence[i].ts < low ? low - sequence[i].ts : sequence[i].ts - high) / 86400000
    }
    let maxTs = null
    for (const entry of sequence) if (maxTs === null || entry.ts > maxTs) maxTs = entry.ts
    return { backwardsCount, backwardsDays, neighborFits, neighborTotal, neighborOutDays, maxTs }
}

// Chooses between DMY and MDY when component hints are absent/tied
const chooseOrder = (lines, filenameDate, defaultOrder) => {
    const dmy = analyzeOrder(lines, 'dmy')
    const mdy = analyzeOrder(lines, 'mdy')
    if (filenameDate) {
        const score = (stats) => {
            if (stats.maxTs == null) return null
            const max = new Date(stats.maxTs)
            const maxUtc = Date.UTC(max.getFullYear(), max.getMonth(), max.getDate())
            const fileUtc = Date.UTC(filenameDate.getFullYear(), filenameDate.getMonth(), filenameDate.getDate())
            const days = Math.round((maxUtc - fileUtc) / 86400000)
            return { sameDay: days === 0, future: days > 1, distance: Math.abs(days) }
        }
        const scoreDmy = score(dmy)
        const scoreMdy = score(mdy)
        if (scoreDmy && scoreMdy) {
            if (scoreDmy.sameDay !== scoreMdy.sameDay) return { order: scoreDmy.sameDay ? 'dmy' : 'mdy', orderSource: 'filename', dmy, mdy }
            if (scoreDmy.future !== scoreMdy.future) return { order: scoreDmy.future ? 'mdy' : 'dmy', orderSource: 'filename', dmy, mdy }
            if (scoreDmy.distance !== scoreMdy.distance) return { order: scoreDmy.distance < scoreMdy.distance ? 'dmy' : 'mdy', orderSource: 'filename', dmy, mdy }
        }
    }
    if (dmy.neighborTotal > 0 && mdy.neighborTotal > 0) {
        const ratioDmy = dmy.neighborFits / dmy.neighborTotal
        const ratioMdy = mdy.neighborFits / mdy.neighborTotal
        if (ratioDmy !== ratioMdy) return { order: ratioDmy > ratioMdy ? 'dmy' : 'mdy', orderSource: 'neighbors', dmy, mdy }
        if (dmy.neighborOutDays !== mdy.neighborOutDays) return { order: dmy.neighborOutDays < mdy.neighborOutDays ? 'dmy' : 'mdy', orderSource: 'neighbors', dmy, mdy }
    }
    if (dmy.backwardsCount !== mdy.backwardsCount) return { order: dmy.backwardsCount < mdy.backwardsCount ? 'dmy' : 'mdy', orderSource: 'monotonic', dmy, mdy }
    if (dmy.backwardsDays !== mdy.backwardsDays) return { order: dmy.backwardsDays < mdy.backwardsDays ? 'dmy' : 'mdy', orderSource: 'monotonic', dmy, mdy }
    return { order: defaultOrder, orderSource: 'default', dmy, mdy }
}

// Returns { order, orderSource, ambiguousCount, evidence } for the lines of a file
const buildDateContext = (lines, options = {}) => {
    if (options.context) return options.context
    let dmyHints = 0
    let mdyHints = 0
    for (const line of lines) {
        const shape = dateShapeRegex.exec(normalizeLineForDate(line))
        if (!shape || shape[1].length === 4) continue
        const first = Number(shape[1])
        const second = Number(shape[3])
        if (first > 12 && second <= 12) dmyHints++
        else if (second > 12 && first <= 12) mdyHints++
    }
    let order, orderSource
    let evidence = null
    if (options.dateOrder && options.dateOrder !== 'auto') {
        order = options.dateOrder
        orderSource = 'override'
    } else if (dmyHints > mdyHints) {
        order = 'dmy'
        orderSource = 'inferred'
    } else if (mdyHints > dmyHints) {
        order = 'mdy'
        orderSource = 'inferred'
    } else {
        const filenameDate = options.fileName ? filenameDateFromName(options.fileName) : null
        const chosen = chooseOrder(lines, filenameDate, options.defaultOrder || 'dmy')
        order = chosen.order
        orderSource = chosen.orderSource
        evidence = { filenameDate, dmy: chosen.dmy, mdy: chosen.mdy }
    }
    let ambiguousCount = 0
    for (const line of lines) {
        const classified = classifyDateLine(line, { order })
        if (classified && classified.variant && classified.variant.ambiguous) ambiguousCount++
    }
    return { order, orderSource, ambiguousCount, evidence }
}

// Returns { format, match, timestamp, variant? } if the line looks like a date line, else null (timestamp may be NaN)
const classifyDateLine = (line, context) => {
    const normalized = normalizeLineForDate(line) // Some versions use weird nbsp
    for (const format of dateFormats) {
        const match = format.regex.exec(normalized)
        if (!match) continue
        const timestamp = format.parse(match)
        if (!Number.isNaN(timestamp)) return { format: format.name, match, timestamp }
        return classifyGenericLine(normalized, context) || { format: format.name, match, timestamp }
    }
    return classifyGenericLine(normalized, context)
}

// Returns a numerical value for the given line if it is a "date line", else return null
const returnDateLineIfValid = (line, context) => {
    const classified = classifyDateLine(line, context)
    return classified ? classified.timestamp : null
}

// Returns a 2-item array with the values of the first and last date lines for the given lines array (returns null if no values found)
const returnFirstLastDates = (lines, options = {}) => {
    const context = options.context || buildDateContext(lines, options)
    const result = []
    lines.forEach(line => {
        const temp = returnDateLineIfValid(line, context)
        if (temp) {
            if (result.length === 0) {
                result.push(temp)
                result.push(temp)
            } else {
                if (temp < result[0]) result[0] = temp
                if (temp > result[1]) result[1] = temp
            }
        }
    })
    return result.length === 2 ? result : null
}

const twoDigits = (num) => (num <= 9 ? '0' : '') + num.toString()

// Gets a YYYYMMDD string from a timestamp
const ts2ds = (ts) => {
    const dat = new Date(ts)
    return `${dat.getFullYear()}${twoDigits(dat.getMonth() + 1)}${twoDigits(dat.getDate())}`
}

// Formats a timestamp for display
const ts2display = (ts) => {
    const d = new Date(ts)
    return `${d.getFullYear()}/${twoDigits(d.getMonth() + 1)}/${twoDigits(d.getDate())}`
}

// Message body classifiers
const messageMediaRegex = /(<Media omitted>|image omitted|video omitted|audio omitted|document omitted|sticker omitted|GIF omitted|Contact card omitted)/i
const messageAttachmentRegex = /(<attached:|\(file attached\))/i
const messageDeletedRegex = /^(This message was deleted|You deleted this message)$/i
const messageTypes = ['text', 'media', 'attachment', 'deleted', 'system']

// Returns the message type for the given sender/body
const classifyMessageType = (sender, body) => {
    const trimmed = body.trim()
    if (messageDeletedRegex.test(trimmed)) return 'deleted'
    if (messageAttachmentRegex.test(body)) return 'attachment'
    if (messageMediaRegex.test(body)) return 'media'
    if (sender === null) return 'system'
    return 'text'
}

// Parses a WhatsApp txt export into { messages, warnings }
// Continuation lines are appended to the previous message body with newlines
const parseChat = (content, options = {}) => {
    const split = content.split('\n')
    const lines = split[split.length - 1] === '' ? split.slice(0, -1) : split
    const context = options.context || buildDateContext(lines, options)
    const messages = []
    const warnings = []
    let current = null
    for (const rawLine of lines) {
        const line = rawLine.replace(/\r$/, '')
        const classified = classifyDateLine(line, context)
        if (classified && !Number.isNaN(classified.timestamp)) {
            const body = normalizeLineForDate(line).slice(classified.match[0].length).replace(/^ ?[-:]? ?/, '')
            const senderMatch = /^([^:\n]{1,80}): ([\s\S]*)$/.exec(body)
            const sender = senderMatch ? senderMatch[1] : null
            const text = senderMatch ? senderMatch[2] : body
            current = { date: new Date(classified.timestamp), sender, type: classifyMessageType(sender, text), body: text }
            messages.push(current)
        } else if (current) {
            current.body = current.body === '' ? line : `${current.body}\n${line}`
            current.type = classifyMessageType(current.sender, current.body)
        } else if (line.trim() !== '') {
            warnings.push(line)
        }
    }
    return { messages, warnings }
}

// Export timestamps can drift (seconds, DST, or whole timezones), so cross-file matching pairs
// identical bodies whose times are within this window instead of requiring exact minutes.
const MATCH_WINDOW_MS = 12 * 60 * 60 * 1000

// Matches incoming messages against a reference list by identical body within the time window.
// Returns { pairs, offsets }: pairs[i] is the matched reference index or -1;
// offsets[i] is referenceTime - incomingTime for matches (null when unmatched).
const matchByBody = (reference, incoming, windowMs = MATCH_WINDOW_MS) => {
    const refsByBody = new Map()
    reference.forEach((message, index) => {
        const entry = { time: message.date.getTime(), index }
        const list = refsByBody.get(message.body)
        if (list) list.push(entry)
        else refsByBody.set(message.body, [entry])
    })
    for (const list of refsByBody.values()) list.sort((a, b) => a.time - b.time)
    const incomingByBody = new Map()
    incoming.forEach((message, index) => {
        const list = incomingByBody.get(message.body)
        if (list) list.push(index)
        else incomingByBody.set(message.body, [index])
    })
    const pairs = new Array(incoming.length).fill(-1)
    const offsets = new Array(incoming.length).fill(null)
    for (const [body, indices] of incomingByBody) {
        const refs = refsByBody.get(body)
        if (!refs) continue
        // Pair each incoming occurrence (chronological) with the earliest unused reference inside the window.
        // This maximizes matches per body, unlike a per-message nearest-neighbour scan which can steal copies.
        const ordered = [...indices].sort((a, b) => incoming[a].date.getTime() - incoming[b].date.getTime())
        let refIndex = 0
        for (const index of ordered) {
            const time = incoming[index].date.getTime()
            while (refIndex < refs.length && refs[refIndex].time < time - windowMs) refIndex++
            if (refIndex >= refs.length) break
            if (refs[refIndex].time > time + windowMs) continue
            pairs[index] = refs[refIndex].index
            offsets[index] = refs[refIndex].time - time
            refIndex++
        }
    }
    return { pairs, offsets }
}

// Picks a time offset for an unmatched message from its nearest matched neighbors (piecewise-constant),
// falling back to the most common matched offset (rounded to the minute).
const buildOffsetPicker = (offsets) => {
    const matched = []
    const counts = new Map()
    offsets.forEach((offset, index) => {
        if (offset == null) return
        matched.push({ index, offset })
        const rounded = Math.round(offset / 60000) * 60000
        counts.set(rounded, (counts.get(rounded) || 0) + 1)
    })
    let dominant = 0
    let dominantCount = 0
    for (const [offset, count] of counts) {
        if (count > dominantCount) {
            dominant = offset
            dominantCount = count
        }
    }
    return (index) => {
        if (matched.length === 0) return dominant
        let low = 0
        let high = matched.length - 1
        while (low <= high) {
            const mid = (low + high) >> 1
            if (matched[mid].index < index) low = mid + 1
            else high = mid - 1
        }
        const next = matched[low]
        const prev = matched[low - 1]
        if (prev && next) return Math.abs(index - prev.index) <= Math.abs(next.index - index) ? prev.offset : next.offset
        if (prev) return prev.offset
        if (next) return next.offset
        return dominant
    }
}

// Merges an incoming list into a reference timeline: matched messages are dropped (reference copies win)
// and unmatched messages take the offset of their nearest matched neighbor.
const alignAndMerge = (reference, incoming, windowMs = MATCH_WINDOW_MS) => {
    const { pairs, offsets } = matchByBody(reference, incoming, windowMs)
    const offsetAt = buildOffsetPicker(offsets)
    const merged = reference.map(message => ({ date: message.date, sender: message.sender, type: message.type, body: message.body }))
    incoming.forEach((message, index) => {
        if (pairs[index] >= 0) return
        merged.push({
            date: new Date(message.date.getTime() + offsetAt(index)),
            sender: message.sender,
            type: message.type,
            body: message.body
        })
    })
    merged.sort((a, b) => a.date.getTime() - b.date.getTime())
    return merged
}

// Merges parsed message lists sequentially: the first list is the reference timeline.
const mergeMessages = (messageLists, windowMs = MATCH_WINDOW_MS) => {
    let merged = []
    for (const messages of messageLists) merged = alignAndMerge(merged, messages, windowMs)
    return merged
}

// Serializes messages as a pretty JSON array (dates use Date.prototype.toJSON)
const chatToJson = (messages) => JSON.stringify(messages, null, 2) + '\n'

// Parses an app-produced JSON conversation back into messages
const parseJsonChat = (content) => {
    const data = JSON.parse(content)
    if (!Array.isArray(data)) throw 'JSON conversation must be an array of messages'
    return data.map((item, index) => {
        if (!item || typeof item !== 'object') throw `message ${index} is not an object`
        const date = new Date(item.date)
        if (typeof item.date !== 'string' || Number.isNaN(date.valueOf())) throw `message ${index} has an invalid date`
        if (item.sender !== null && typeof item.sender !== 'string') throw `message ${index} has an invalid sender`
        if (typeof item.body !== 'string') throw `message ${index} has an invalid body`
        if (!messageTypes.includes(item.type)) throw `message ${index} has an invalid type`
        return { date, sender: item.sender, type: item.type, body: item.body }
    })
}

// Strips a duplicate-file suffix like " (1)" from a conversation name
const cleanDisplayName = (name) => name.replace(/\s*\(\d+\)\s*$/, '')

// Normalizes a conversation name for equivalence checks (punctuation/case insensitive)
const normalizeName = (name) => cleanDisplayName(name).normalize('NFKD').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')

const lastDateOf = (member) => member.messages.reduce((max, message) => Math.max(max, message.date.getTime()), -Infinity)
const firstDateOf = (member) => member.messages.reduce((min, message) => Math.min(min, message.date.getTime()), Infinity)

// Finds groups of conversations whose message histories substantially overlap (renamed contacts/groups).
// Returns { groups: [[memberIndex...]], edges: Map "a|b" -> { shared, coverage } }
const detectRenamedGroups = (members, options = {}) => {
    const minShared = options.minShared ?? 5
    const minCoverage = options.minCoverage ?? 0.6
    const windowMs = options.windowMs ?? MATCH_WINDOW_MS
    const distinctBodies = members.map(member => new Set(member.messages.map(message => message.body)).size)
    const bodyOwners = new Map()
    members.forEach((member, index) => {
        for (const body of new Set(member.messages.map(message => message.body))) {
            if (!bodyOwners.has(body)) bodyOwners.set(body, [])
            bodyOwners.get(body).push(index)
        }
    })
    const sharedBodies = new Map()
    for (const owners of bodyOwners.values()) {
        if (owners.length < 2 || owners.length > 100) continue
        for (let i = 0; i < owners.length; i++) {
            for (let j = i + 1; j < owners.length; j++) {
                const pairKey = `${owners[i]}|${owners[j]}`
                sharedBodies.set(pairKey, (sharedBodies.get(pairKey) || 0) + 1)
            }
        }
    }
    const parent = members.map((_, index) => index)
    const find = (index) => {
        while (parent[index] !== index) {
            parent[index] = parent[parent[index]]
            index = parent[index]
        }
        return index
    }
    const union = (a, b) => { const rootA = find(a); const rootB = find(b); if (rootA !== rootB) parent[rootB] = rootA }
    const edges = new Map()
    const grouped = new Set()
    for (const [pairKey, shared] of sharedBodies) {
        const [a, b] = pairKey.split('|').map(Number)
        const minSize = Math.min(members[a].messages.length, members[b].messages.length)
        const minDistinct = Math.min(distinctBodies[a], distinctBodies[b])
        if (shared < minShared || shared < minDistinct * 0.3) continue
        const [smaller, larger] = members[a].messages.length <= members[b].messages.length
            ? [members[a].messages, members[b].messages]
            : [members[b].messages, members[a].messages]
        const { pairs } = matchByBody(smaller, larger, windowMs)
        const matched = pairs.reduce((total, reference) => total + (reference >= 0 ? 1 : 0), 0)
        const coverage = matched / minSize
        if (matched < minShared || coverage < minCoverage) continue
        edges.set(pairKey, { shared: matched, coverage })
        union(a, b)
        grouped.add(a)
        grouped.add(b)
    }
    const byRoot = new Map()
    for (const index of grouped) {
        const root = find(index)
        if (!byRoot.has(root)) byRoot.set(root, [])
        byRoot.get(root).push(index)
    }
    const groups = [...byRoot.values()].filter(group => group.length > 1)
    for (const group of groups) group.sort((a, b) => lastDateOf(members[a]) - lastDateOf(members[b]))
    return { groups, edges }
}

// Merges a group of renamed conversations. Overlapping messages use the newest member's copy,
// unmatched messages are aligned to the reference timeline, and rename markers are inserted.
const mergeConversationGroup = (members, windowMs = MATCH_WINDOW_MS) => {
    const ordered = [...members].sort((a, b) => lastDateOf(a) - lastDateOf(b) || firstDateOf(a) - firstDateOf(b) || a.name.localeCompare(b.name))
    // Newest member first so overlapping messages keep the newest names
    const messages = mergeMessages([...ordered].reverse().map(member => member.messages), windowMs)
    const displayNames = ordered.map(member => cleanDisplayName(member.name))
    for (let i = 0; i < ordered.length - 1; i++) {
        if (normalizeName(displayNames[i]) === normalizeName(displayNames[i + 1])) continue
        const older = ordered[i]
        const { offsets } = matchByBody(messages, older.messages, windowMs)
        const offsetAt = buildOffsetPicker(offsets)
        const at = older.messages[older.messages.length - 1].date.getTime() + offsetAt(older.messages.length - 1)
        let insertAt = messages.length
        while (insertAt > 0 && messages[insertAt - 1].date.getTime() > at) insertAt--
        messages.splice(insertAt, 0, {
            date: new Date(at),
            sender: null,
            type: 'system',
            body: `Conversation name changed from "${displayNames[i]}" to "${displayNames[i + 1]}"`
        })
    }
    return { name: displayNames[displayNames.length - 1], messages }
}

// Approximate number of distinct messages shared by at least two members of a group (for reporting)
const groupSharedCount = (memberList) => {
    const owners = new Map()
    for (const member of memberList) {
        for (const body of new Set(member.messages.map(message => message.body))) {
            owners.set(body, (owners.get(body) || 0) + 1)
        }
    }
    let shared = 0
    for (const count of owners.values()) if (count >= 2) shared++
    return shared
}

// Main function
const main = (dirs, options = {}) => {
    // NOTE: FIRST DIR IN ARRAY IS TREATED DIFFERENTLY - Previous files are deleted and new ones placed there
    const dryRun = Boolean(options.dryRun)
    const parseOptions = { dateOrder: options.dateOrder }
    dirs = [...new Set(dirs)]

    // Phase 1: plan renames for every dir, aborting before touching anything on name collisions
    const plans = dirs.map(dir => ({ dir, files: planFileRenames(dir, getChatFiles(dir, true)) }))

    // Phase 2: read and validate every source before any rename, delete or write
    const ambiguous = []
    const problems = []
    const sources = new Map()
    plans.forEach(({ dir, files }) => {
        files.forEach(({ original, final }) => {
            const file = `${dir}/${original}`
            const raw = fs.readFileSync(file).toString()
            const key = conversationKey(final)
            if (original.toLowerCase().endsWith('.json')) {
                let messages
                try {
                    messages = parseJsonChat(raw)
                } catch (e) {
                    problems.push(`${file}: ${e}`)
                    return
                }
                if (messages.length === 0) {
                    problems.push(`${file}: no messages found`)
                    return
                }
                if (!sources.has(key)) sources.set(key, [])
                sources.get(key).push({ dir, original, messages })
            } else {
                const stripped = stripExportHeader(raw)
                const context = buildDateContext(stripped.split('\n'), { ...parseOptions, fileName: original })
                if (context.ambiguousCount > 0) ambiguous.push({ file, count: context.ambiguousCount, order: context.order, orderSource: context.orderSource })
                const parsed = parseChat(stripped, { context })
                if (parsed.warnings.length > 0) {
                    problems.push(`${file}: ${parsed.warnings.length} line(s) before the first date line`)
                    return
                }
                if (parsed.messages.length === 0) {
                    problems.push(`${file}: no date lines found`)
                    return
                }
                if (!sources.has(key)) sources.set(key, [])
                sources.get(key).push({ dir, original, messages: parsed.messages })
            }
        })
    })
    if (problems.length > 0) {
        throw `Aborting:\n${problems.map(problem => `  ${problem}`).join('\n')}`
    }

    // Phase 3: merge everything in memory, still before any mutation
    const summary = []
    const members = []
    sources.forEach((list, key) => {
        members.push({ key, name: key, messages: mergeMessages(list.map(source => source.messages)), sources: list })
    })
    const detected = options.mergeRenamed === false
        ? { groups: [], edges: new Map() }
        : detectRenamedGroups(members, { minShared: options.renameMinShared, minCoverage: options.renameMinCoverage })
    const groupedMembers = new Set(detected.groups.flat())
    detected.groups.forEach(group => {
        const memberList = group.map(index => members[index])
        const merged = mergeConversationGroup(memberList)
        const last = merged.messages[merged.messages.length - 1].date
        summary.push({
            name: merged.name,
            outName: `${ts2ds(last)} - ${merged.name}.json`,
            sources: memberList.reduce((total, member) => total + member.sources.length, 0),
            first: merged.messages[0].date,
            last,
            messages: merged.messages,
            cleanupKeys: memberList.map(member => member.key),
            group: { names: memberList.map(member => cleanDisplayName(member.name)), shared: groupSharedCount(memberList) }
        })
    })
    members.forEach((member, index) => {
        if (groupedMembers.has(index)) return
        const messages = member.messages
        const last = messages[messages.length - 1].date
        summary.push({ name: member.key, outName: `${ts2ds(last)} - ${member.key}.json`, sources: member.sources.length, first: messages[0].date, last, messages, cleanupKeys: [member.key] })
    })

    // Phase 4: apply renames, delete old outputs and write merged files
    if (!dryRun) {
        plans.forEach(({ dir, files }) => {
            files.forEach(({ original, final }) => {
                if (final !== original) fs.renameSync(`${dir}/${original}`, `${dir}/${final}`)
            })
        })
        summary.forEach(conversation => {
            for (const key of conversation.cleanupKeys) {
                for (const extension of ['.txt', '.json']) {
                    const existing = `${dirs[0]}/${key}${extension}`
                    if (fs.existsSync(existing)) fs.unlinkSync(existing)
                }
            }
            fs.writeFileSync(`${dirs[0]}/${conversation.outName}`, chatToJson(conversation.messages))
        })
    }

    console.log('')
    if (dryRun) console.log('=== Dry run: no files were renamed, deleted or written ===')
    const multi = summary.filter(s => !s.group && s.sources > 1)
    const single = summary.filter(s => !s.group && s.sources === 1)
    console.log(`=== Merged ${multi.length} conversation(s) from multiple sources ===`)
    multi.forEach(s => {
        const range = s.first ? `${ts2display(s.first)} -> ${ts2display(s.last)}` : 'no dates found'
        console.log(`  ${s.outName}  [${range}]  (${s.sources} sources)`)
    })
    console.log(`=== ${single.length} conversation(s) from a single source ===`)
    single.forEach(s => {
        const range = s.first ? `${ts2display(s.first)} -> ${ts2display(s.last)}` : 'no dates found'
        console.log(`  ${s.outName}  [${range}]`)
    })
    const renamed = summary.filter(s => s.group)
    if (renamed.length > 0) {
        const files = renamed.reduce((total, s) => total + s.cleanupKeys.length, 0)
        console.log(`=== Merged ${renamed.length} renamed conversation(s) (${files} files) ===`)
        renamed.forEach(s => {
            console.log(`  ${s.group.names.map(name => `"${name}"`).join(' + ')} -> "${s.name}"  (${s.group.shared} shared msgs)`)
        })
    }
    if (ambiguous.length > 0) {
        console.log('=== Ambiguous dates ===')
        ambiguous.forEach(item => {
            console.log(`  ${item.file}: ${item.count} ambiguous date line(s) resolved as ${item.order.toUpperCase()} (${item.orderSource})`)
        })
        console.log('  Override with --date-order=dmy|mdy|ymd if the interpretation is wrong')
    }

    // Machine-readable result (used by the web app's import API; the CLI ignores it)
    return {
        dryRun,
        conversations: summary.map(conversation => ({
            outName: conversation.outName,
            sources: conversation.sources,
            first: conversation.first ?? null,
            last: conversation.last ?? null,
            group: conversation.group ? { names: conversation.group.names, shared: conversation.group.shared } : null
        })),
        ambiguous
    }
}

// Actual run
if (require.main === module) {
    const usage = 'Usage: node WhatsAppTXT.js [--dry-run] [--no-merge-renamed]\n' +
        '                            [--date-order=auto|dmy|mdy|ymd]\n' +
        '                            [--rename-min-shared=5] [--rename-min-coverage=0.6] [--help]\n' +
        '                            <output-directory> [additional-source-directory] [...]\n\n' +
        'Merges WhatsApp TXT exports (.txt) and existing JSON outputs with the same conversation\n' +
        'name across directories. The first directory receives the merged JSON files; existing\n' +
        'outputs there are replaced.\n' +
        'Each conversation is written as a JSON array of {date, sender, type, body} messages.\n' +
        'Conversations whose histories overlap heavily (renamed contacts/groups) are merged, with the\n' +
        'name changes recorded as system messages; --no-merge-renamed disables that.\n' +
        'Ambiguous slash dates default to DMY; --date-order forces an interpretation (auto = infer per file).\n' +
        'Aborts without modifying anything if a directory has name collisions or a file cannot be parsed.'
    try {
        const args = process.argv.slice(2)
        if (args.includes('--no-normalize')) throw 'The --no-normalize text mode has been removed; conversations are always written as JSON'
        const flags = ['--dry-run', '--no-merge-renamed', '--help', '-h']
        const dirs = args.filter(arg => !flags.includes(arg)
            && !arg.startsWith('--date-order=')
            && !arg.startsWith('--rename-min-shared=')
            && !arg.startsWith('--rename-min-coverage='))
        if (args.includes('--help') || args.includes('-h') || dirs.length === 0) {
            console.log(usage)
            process.exit(args.length === 0 ? 2 : 0)
        }
        let dateOrder = 'auto'
        const dateOrderArg = args.find(arg => arg.startsWith('--date-order='))
        if (dateOrderArg) {
            dateOrder = dateOrderArg.slice('--date-order='.length)
            if (!['auto', 'dmy', 'mdy', 'ymd'].includes(dateOrder)) throw `Invalid --date-order: ${dateOrder}`
        }
        let renameMinShared = 5
        const minSharedArg = args.find(arg => arg.startsWith('--rename-min-shared='))
        if (minSharedArg) {
            renameMinShared = Number(minSharedArg.slice('--rename-min-shared='.length))
            if (!Number.isFinite(renameMinShared) || renameMinShared < 1) throw `Invalid --rename-min-shared: ${minSharedArg}`
        }
        let renameMinCoverage = 0.6
        const minCoverageArg = args.find(arg => arg.startsWith('--rename-min-coverage='))
        if (minCoverageArg) {
            renameMinCoverage = Number(minCoverageArg.slice('--rename-min-coverage='.length))
            if (!Number.isFinite(renameMinCoverage) || renameMinCoverage <= 0 || renameMinCoverage > 1) throw `Invalid --rename-min-coverage: ${minCoverageArg}`
        }
        dirs.forEach(dir => {
            if (!fs.existsSync(dir)) throw `Directory does not exist: ${dir}`
        })
        main(dirs, {
            dryRun: args.includes('--dry-run'),
            mergeRenamed: !args.includes('--no-merge-renamed'),
            renameMinShared,
            renameMinCoverage,
            dateOrder
        })
    } catch (err) {
        console.error(err)
        process.exit(-1)
    }
}

module.exports = { getChatFiles, conversationKey, matchFilenamePrefix, planFileRenames, exportHeaderLabels, normalizeLineForDate, matchExportHeader, stripExportHeader, dateFormats, genericDateRegex, classifyGenericLine, filenameDateFromName, analyzeOrder, chooseOrder, buildDateContext, classifyDateLine, returnDateLineIfValid, returnFirstLastDates, classifyMessageType, messageTypes, parseChat, MATCH_WINDOW_MS, matchByBody, buildOffsetPicker, alignAndMerge, mergeMessages, cleanDisplayName, normalizeName, detectRenamedGroups, mergeConversationGroup, groupSharedCount, chatToJson, parseJsonChat, ts2ds, ts2display, main }


