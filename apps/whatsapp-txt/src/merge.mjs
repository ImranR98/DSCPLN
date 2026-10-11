// Merging conversations across files: body+time matching, offset
// alignment, renamed-contact/group detection.

export const MATCH_WINDOW_MS = 12 * 60 * 60 * 1000

// Matches incoming messages against a reference list by identical body within the time window.
// Returns { pairs, offsets }: pairs[i] is the matched reference index or -1;
// offsets[i] is referenceTime - incomingTime for matches (null when unmatched).
export const matchByBody = (reference, incoming, windowMs = MATCH_WINDOW_MS) => {
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
export const buildOffsetPicker = (offsets) => {
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
export const alignAndMerge = (reference, incoming, windowMs = MATCH_WINDOW_MS) => {
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
export const mergeMessages = (messageLists, windowMs = MATCH_WINDOW_MS) => {
    let merged = []
    for (const messages of messageLists) merged = alignAndMerge(merged, messages, windowMs)
    return merged
}

// Serializes messages as a pretty JSON array (dates use Date.prototype.toJSON)
export const cleanDisplayName = (name) => name.replace(/\s*\(\d+\)\s*$/, '')

// Normalizes a conversation name for equivalence checks (punctuation/case insensitive)
export const normalizeName = (name) => cleanDisplayName(name).normalize('NFKD').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')

export const lastDateOf = (member) => member.messages.reduce((max, message) => Math.max(max, message.date.getTime()), -Infinity)
export const firstDateOf = (member) => member.messages.reduce((min, message) => Math.min(min, message.date.getTime()), Infinity)

// Finds groups of conversations whose message histories substantially overlap (renamed contacts/groups).
// Returns { groups: [[memberIndex...]], edges: Map "a|b" -> { shared, coverage } }
export const detectRenamedGroups = (members, options = {}) => {
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
export const mergeConversationGroup = (members, windowMs = MATCH_WINDOW_MS) => {
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
export const groupSharedCount = (memberList) => {
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
