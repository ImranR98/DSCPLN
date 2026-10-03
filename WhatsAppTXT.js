const fs = require('fs')

// Finds text files in a dir (dotfiles such as backup state files are ignored)
const getTxts = (dir) => fs.readdirSync(dir).filter(fil => !fil.startsWith('.') && !fs.statSync(`${dir}/${fil}`).isDirectory() && fil.toLowerCase().endsWith('.txt'))

// Lists chat files in a dir; JSON mode also picks up previous .json outputs (dotfiles are ignored)
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

// Merge two TXT files
// - Find the first and last "date lines" of both files
// - If one has both older start date AND newer end date, return that (if both equal, return cont1)
// - Else, keep whichever file has the older start date and append the other file's lines from the
//   first date line that is newer than the kept file's end (equal ends keep the containing file)
const mergeContents = (cont1, cont2, options = {}) => {
    const [lines1, lines2] = [cont1.split('\n'), cont2.split('\n')]
    const [dates1, dates2] = [returnFirstLastDates(lines1, options), returnFirstLastDates(lines2, options)]
    if (!dates1 && !dates2) throw 'Date 1 and Date 2 both null!'
    if (dates1 === null) return [cont2, dates2[1]]
    if (dates2 === null) return [cont1, dates1[1]]
    if (dates1[0] <= dates2[0] && dates1[1] >= dates2[1]) return [cont1, dates1[1]]
    if (dates2[0] < dates1[0] && dates2[1] > dates1[1]) return [cont2, dates2[1]]
    const didStartWithCont1 = dates1[0] <= dates2[0]
    const baseContent = didStartWithCont1 ? cont1 : cont2
    const baseLines = didStartWithCont1 ? lines1 : lines2
    const baseLast = (didStartWithCont1 ? dates1 : dates2)[1]
    const otherLines = didStartWithCont1 ? lines2 : lines1
    const otherLast = (didStartWithCont1 ? dates2 : dates1)[1]
    const otherContext = buildDateContext(otherLines, options)
    let ind = -1
    for (let i = 0; i < otherLines.length && ind < 0; i++) {
        const num = returnDateLineIfValid(otherLines[i], otherContext)
        if (num && num > baseLast) ind = i
    }
    // No date line in the other file is newer than the base's end: the base range already covers it
    if (ind < 0) return [baseContent, baseLast]
    // Drop the base's trailing empty element so joining does not insert a blank line at the junction
    const trimmedBase = baseLines[baseLines.length - 1] === '' ? baseLines.slice(0, -1) : baseLines
    return [trimmedBase.concat(otherLines.slice(ind)).join('\n'), otherLast]
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

// Identity of a parsed message used for cross-source deduplication
const messageKey = (message) => `${message.date.getTime()}|${message.sender === null ? '' : message.sender}|${message.body}`

// Merges parsed message lists: union plus dedupe that keeps the max multiplicity seen in any single source
const mergeMessages = (messageLists) => {
    const maxCounts = new Map()
    for (const messages of messageLists) {
        const counts = new Map()
        for (const message of messages) {
            const key = messageKey(message)
            counts.set(key, (counts.get(key) || 0) + 1)
        }
        for (const [key, count] of counts) {
            if (!maxCounts.has(key) || count > maxCounts.get(key)) maxCounts.set(key, count)
        }
    }
    const remaining = new Map(maxCounts)
    const merged = []
    for (const messages of messageLists) {
        for (const message of messages) {
            const key = messageKey(message)
            const left = remaining.get(key) || 0
            if (left > 0) {
                merged.push(message)
                remaining.set(key, left - 1)
            }
        }
    }
    merged.sort((a, b) => a.date.getTime() - b.date.getTime())
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

// Main function
const main = (dirs, options = {}) => {
    // NOTE: FIRST DIR IN ARRAY IS TREATED DIFFERENTLY - Previous files are deleted and new ones placed there
    const dryRun = Boolean(options.dryRun)
    const textMode = options.normalize === false
    const parseOptions = { dateOrder: options.dateOrder }
    dirs = [...new Set(dirs)]

    // Phase 1: plan renames for every dir, aborting before touching anything on name collisions
    const plans = dirs.map(dir => ({ dir, files: planFileRenames(dir, textMode ? getTxts(dir) : getChatFiles(dir, true)) }))

    // Phase 2: read and validate every source before any rename, delete or write
    const ambiguous = []
    const problems = []
    const sources = new Map()
    plans.forEach(({ dir, files }) => {
        files.forEach(({ original, final }) => {
            const file = `${dir}/${original}`
            const raw = fs.readFileSync(file).toString()
            const key = conversationKey(final)
            if (textMode) {
                const stripped = stripExportHeader(raw)
                const context = buildDateContext(stripped.split('\n'), { ...parseOptions, fileName: original })
                if (context.ambiguousCount > 0) ambiguous.push({ file, count: context.ambiguousCount, order: context.order, orderSource: context.orderSource })
                if (returnFirstLastDates(stripped.split('\n'), { context }) === null) {
                    problems.push(`${file}: no date lines found`)
                    return
                }
                if (!sources.has(key)) sources.set(key, [])
                sources.get(key).push({ dir, original, content: stripped })
            } else if (original.toLowerCase().endsWith('.json')) {
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
    sources.forEach((list, key) => {
        if (textMode) {
            const allLines = list.flatMap(source => source.content.split('\n'))
            const conversationContext = buildDateContext(allLines, { ...parseOptions, fileName: list[0].original })
            const mergeOptions = { ...parseOptions, context: conversationContext }
            let content = ''
            let timestamp = null
            list.forEach(source => {
                try {
                    [content, timestamp] = mergeContents(content, source.content, mergeOptions)
                } catch (e) {
                    throw `Failed to merge ${source.dir}/${source.original}: ${e && e.message ? e.message : e}`
                }
            })
            if (timestamp === null) throw `Timestamp is null for ${key}!`
            const dates = returnFirstLastDates(content.split('\n'), mergeOptions)
            summary.push({ name: key, outName: `${ts2ds(timestamp)} - ${key}.txt`, sources: list.length, first: dates ? dates[0] : null, last: dates ? dates[1] : null, content })
        } else {
            const messages = mergeMessages(list.map(source => source.messages))
            const last = messages[messages.length - 1].date
            summary.push({ name: key, outName: `${ts2ds(last)} - ${key}.json`, sources: list.length, first: messages[0].date, last, messages })
        }
    })

    // Phase 4: apply renames, delete old outputs and write merged files
    if (!dryRun) {
        plans.forEach(({ dir, files }) => {
            files.forEach(({ original, final }) => {
                if (final !== original) fs.renameSync(`${dir}/${original}`, `${dir}/${final}`)
            })
        })
        summary.forEach(conversation => {
            for (const extension of ['.txt', '.json']) {
                const existing = `${dirs[0]}/${conversation.name}${extension}`
                if (fs.existsSync(existing)) fs.unlinkSync(existing)
            }
            fs.writeFileSync(`${dirs[0]}/${conversation.outName}`, textMode ? conversation.content : chatToJson(conversation.messages))
        })
    }

    console.log('')
    if (dryRun) console.log('=== Dry run: no files were renamed, deleted or written ===')
    const multi = summary.filter(s => s.sources > 1)
    const single = summary.filter(s => s.sources === 1)
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
    if (ambiguous.length > 0) {
        console.log('=== Ambiguous dates ===')
        ambiguous.forEach(item => {
            console.log(`  ${item.file}: ${item.count} ambiguous date line(s) resolved as ${item.order.toUpperCase()} (${item.orderSource})`)
        })
        console.log('  Override with --date-order=dmy|mdy|ymd if the interpretation is wrong')
    }
}

// Actual run
if (require.main === module) {
    const usage = 'Usage: node WhatsAppTXT.js [--dry-run] [--no-normalize] [--date-order=auto|dmy|mdy|ymd] [--help] <output-directory> [additional-source-directory] [...]\n\n' +
        'Merges WhatsApp TXT exports with the same conversation name across directories.\n' +
        'The first directory receives the merged files; existing outputs there are replaced.\n' +
        'By default each conversation is written as a JSON array of {date, sender, type, body} messages.\n' +
        'Use --no-normalize for the legacy verbatim .txt output instead.\n' +
        'Ambiguous slash dates default to DMY; --date-order forces an interpretation (auto = infer per file).\n' +
        'Aborts without modifying anything if a directory has name collisions or a file cannot be parsed.'
    try {
        const args = process.argv.slice(2)
        const flags = ['--dry-run', '--no-normalize', '--help', '-h']
        const dirs = args.filter(arg => !flags.includes(arg) && !arg.startsWith('--date-order='))
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
        dirs.forEach(dir => {
            if (!fs.existsSync(dir)) throw `Directory does not exist: ${dir}`
        })
        main(dirs, { dryRun: args.includes('--dry-run'), normalize: !args.includes('--no-normalize'), dateOrder })
    } catch (err) {
        console.error(err)
        process.exit(-1)
    }
}

module.exports = { getTxts, getChatFiles, conversationKey, matchFilenamePrefix, planFileRenames, exportHeaderLabels, normalizeLineForDate, matchExportHeader, stripExportHeader, dateFormats, genericDateRegex, classifyGenericLine, filenameDateFromName, analyzeOrder, chooseOrder, buildDateContext, classifyDateLine, returnDateLineIfValid, returnFirstLastDates, mergeContents, classifyMessageType, messageTypes, parseChat, messageKey, mergeMessages, chatToJson, parseJsonChat, ts2ds, ts2display, main }


