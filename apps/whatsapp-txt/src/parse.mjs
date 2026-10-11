// Chat parsing and (de)serialization: .txt exports into
// {date, sender, type, body} messages and back to JSON.

import { buildDateContext, classifyDateLine, normalizeLineForDate } from './dates.mjs';

export const messageMediaRegex = /(<Media omitted>|image omitted|video omitted|audio omitted|document omitted|sticker omitted|GIF omitted|Contact card omitted)/i
export const messageAttachmentRegex = /(<attached:|\(file attached\))/i
export const messageDeletedRegex = /^(This message was deleted|You deleted this message)$/i
export const messageTypes = ['text', 'media', 'attachment', 'deleted', 'system']

// Returns the message type for the given sender/body
export const classifyMessageType = (sender, body) => {
    const trimmed = body.trim()
    if (messageDeletedRegex.test(trimmed)) return 'deleted'
    if (messageAttachmentRegex.test(body)) return 'attachment'
    if (messageMediaRegex.test(body)) return 'media'
    if (sender === null) return 'system'
    return 'text'
}

// Parses a WhatsApp txt export into { messages, warnings }
// Continuation lines are appended to the previous message body with newlines
export const parseChat = (content, options = {}) => {
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
export const chatToJson = (messages) => JSON.stringify(messages, null, 2) + '\n'

// Parses an app-produced JSON conversation back into messages
export const parseJsonChat = (content) => {
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
