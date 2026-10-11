// WhatsApp export date handling: export headers, per-file date-order
// inference (DMY/MDY/YMD) and date-line classification.

export const exportHeaderLabels = ['Chat exported on ', 'Last chat on ']

// NFKD-normalizes a line and strips leading direction marks (iOS adds U+200E to some lines)
export const normalizeLineForDate = (line) => line.normalize('NFKD').replace(/^[\u200e\u200f]+/, '')

// Returns { count, blankAfter, missing } for the recognized header lines at the start of a file
export const matchExportHeader = (lines) => {
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
export const stripExportHeader = (content) => {
    const lines = content.split('\n')
    const { count, blankAfter } = matchExportHeader(lines)
    if (count === 0) return content
    return lines.slice(count + (blankAfter ? 1 : 0)).join('\n')
}

// Explicit date formats whose component order is unambiguous (year first or bracketed year first)
export const dateFormats = [
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
export const dateShapeRegex = /^[\[(]?(\d{1,4})([-/.])(\d{1,2})\2(\d{1,4})/

// Generic matcher: optional bracket, three date components with a consistent separator,
// time H:MM[:SS], optional meridiem, optional closing bracket
export const genericDateRegex = /^([\[(])?(\d{1,4})([-/.])(\d{1,2})\3(\d{1,4})(?:,\s*|\s+)(\d{1,2}):(\d{1,2})(?::(\d{1,2})(?:\.\d{1,3})?)?(?:\s*([ap])\.?\s*m\.?)?(\s*[\])])?/i

// Normalizes a two-digit year to 2000+
export const normalizeYear = (value) => {
    if (value.length === 4) return Number(value)
    if (value.length <= 2) return 2000 + Number(value)
    return null
}

// Resolves the date components for the given order. Returns { year, month, day } or null
export const resolveDateComponents = (c1, c2, c3, order) => {
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
export const classifyGenericLine = (line, context) => {
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
export const filenameDateFromName = (name) => {
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
export const analyzeOrder = (lines, order) => {
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
export const chooseOrder = (lines, filenameDate, defaultOrder) => {
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
export const buildDateContext = (lines, options = {}) => {
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
export const classifyDateLine = (line, context) => {
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
export const returnDateLineIfValid = (line, context) => {
    const classified = classifyDateLine(line, context)
    return classified ? classified.timestamp : null
}

// Returns a 2-item array with the values of the first and last date lines for the given lines array (returns null if no values found)
export const returnFirstLastDates = (lines, options = {}) => {
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

