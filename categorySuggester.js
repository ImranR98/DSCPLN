'use strict'

// Fuzzy category suggestions based on historical details -> category pairs.
// Pure functions so they can be unit tested without a workbook.

const DEFAULT_OPTIONS = {
    limit: 5,
    confidence: 0.55,
    margin: 0.08,
}

const normalize = (value) => String(value == null ? '' : value)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

const tokenSet = (value) => new Set(normalize(value).split(' ').filter(Boolean))

const trigramSet = (value) => {
    const padded = ` ${normalize(value)} `
    const grams = new Set()
    for (let i = 0; i < padded.length - 2; i++) {
        grams.add(padded.slice(i, i + 3))
    }
    return grams
}

const dice = (a, b) => {
    if (a.size === 0 || b.size === 0) {
        return 0
    }
    let intersection = 0
    for (const item of a) {
        if (b.has(item)) {
            intersection++
        }
    }
    return (2 * intersection) / (a.size + b.size)
}

const levenshtein = (a, b) => {
    const previous = new Array(b.length + 1)
    const current = new Array(b.length + 1)
    for (let j = 0; j <= b.length; j++) {
        previous[j] = j
    }
    for (let i = 1; i <= a.length; i++) {
        current[0] = i
        for (let j = 1; j <= b.length; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1
            current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost)
        }
        for (let j = 0; j <= b.length; j++) {
            previous[j] = current[j]
        }
    }
    return previous[b.length]
}

const levenshteinRatio = (a, b) => {
    const max = Math.max(a.length, b.length)
    return max === 0 ? 1 : 1 - levenshtein(a, b) / max
}

const similarity = (a, b) => {
    const left = normalize(a)
    const right = normalize(b)
    if (!left || !right) {
        return 0
    }
    if (left === right) {
        return 1
    }
    const tokenScore = dice(tokenSet(left), tokenSet(right))
    const trigramScore = dice(trigramSet(left), trigramSet(right))
    const editScore = levenshteinRatio(left, right)
    let score = 0.45 * tokenScore + 0.4 * trigramScore + 0.15 * editScore
    if (left.includes(right) || right.includes(left)) {
        score = Math.min(1, score + 0.1)
    }
    return score
}

const recencyBonus = (date, now) => {
    if (!(date instanceof Date) || isNaN(date)) {
        return 0
    }
    const days = (now - date) / (24 * 60 * 60 * 1000)
    return days >= 0 && days <= 365 ? 0.05 : 0
}

// samples: [{ details, category, date }] already filtered to the relevant kind.
const suggestCategories = (description, samples, options = {}) => {
    const { limit, confidence, margin } = { ...DEFAULT_OPTIONS, ...options }
    const now = options.now instanceof Date ? options.now : new Date()
    const stats = new Map()
    for (const sample of samples || []) {
        if (!sample || !sample.category) {
            continue
        }
        const base = similarity(description, sample.details)
        if (base <= 0) {
            continue
        }
        const current = stats.get(sample.category)
        if (!current) {
            stats.set(sample.category, {
                category: sample.category,
                score: base,
                count: 1,
                example: sample.details,
                latest: sample.date instanceof Date ? sample.date : null,
            })
        } else {
            current.count++
            if (base > current.score) {
                current.score = base
                current.example = sample.details
            }
            if (sample.date instanceof Date && (!current.latest || sample.date > current.latest)) {
                current.latest = sample.date
            }
        }
    }
    const suggestions = [...stats.values()]
        .map((stat) => ({
            category: stat.category,
            score: Math.min(1, stat.score + 0.1 * Math.min(stat.count, 5) / 5 + recencyBonus(stat.latest, now)),
            count: stat.count,
            example: stat.example,
        }))
        .sort((a, b) => b.score - a.score || a.category.localeCompare(b.category))
        .slice(0, limit)
    const confident = suggestions.length > 0 &&
        suggestions[0].score >= confidence &&
        (suggestions.length === 1 || suggestions[0].score - suggestions[1].score >= margin)
    return { suggestions, confident }
}

module.exports = { suggestCategories, similarity, normalize, DEFAULT_OPTIONS }
