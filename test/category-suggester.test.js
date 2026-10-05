'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { suggestCategories, normalize } = require('../category-suggester')

const samples = [
    { details: 'Groceries', category: 'Food Weekly', date: new Date('2026-08-01') },
    { details: 'Groceries', category: 'Food Weekly', date: new Date('2026-07-01') },
    { details: 'Groceries', category: 'Food Weekly', date: new Date('2026-06-01') },
    { details: 'Netflix', category: 'Subscriptions', date: new Date('2026-08-09') },
    { details: 'Rent August', category: 'Rent', date: new Date('2026-08-01') },
    { details: 'Uber', category: 'Transport Private', date: new Date('2026-08-12') },
    { details: 'Coffee beans', category: 'Snacks', date: new Date('2026-08-18') },
    { details: 'Job', category: 'Job', date: new Date('2026-08-03') },
]

test('normalizes case, punctuation and accents', () => {
    assert.equal(normalize('  Café—AU  '), 'cafe au')
    assert.equal(normalize('Rent (August) #2'), 'rent august 2')
})

test('suggests the matching category for similar details', () => {
    const result = suggestCategories('Groceries run', samples)
    assert.equal(result.confident, true)
    assert.equal(result.suggestions[0].category, 'Food Weekly')
    assert.ok(result.suggestions[0].score > 0.7)
})

test('suggests near-exact matches even with typos', () => {
    const result = suggestCategories('grocries', samples)
    assert.equal(result.suggestions[0].category, 'Food Weekly')
})

test('does not confidently match unrelated details', () => {
    const result = suggestCategories('random xyz', samples)
    assert.equal(result.confident, false)
    assert.ok(result.suggestions.length === 0 || result.suggestions[0].score < 0.55)
})

test('prefers the more frequent category for the same details', () => {
    const conflicting = [
        { details: 'Amazon', category: 'Electronics', date: new Date('2026-08-01') },
        { details: 'Amazon', category: 'Electronics', date: new Date('2026-07-01') },
        { details: 'Amazon', category: 'Electronics', date: new Date('2026-06-01') },
        { details: 'Amazon', category: 'Clothes', date: new Date('2026-05-01') },
    ]
    const result = suggestCategories('Amazon order', conflicting)
    assert.equal(result.suggestions[0].category, 'Electronics')
})

test('handles empty input and empty corpora', () => {
    assert.deepEqual(suggestCategories('', samples), { confident: false, suggestions: [] })
    assert.deepEqual(suggestCategories('Groceries', []), { confident: false, suggestions: [] })
})
