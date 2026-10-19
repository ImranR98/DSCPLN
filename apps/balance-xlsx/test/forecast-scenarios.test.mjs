'use strict'

import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import ExcelJS from 'exceljs'
import { ValidationError, ConflictError } from '../errors.mjs'
import { createTestProvider, git } from './helpers.mjs'

const scenario = (overrides = {}) => ({
    name: 'Base plan',
    currency: 'CAD',
    asOf: '2026-09-15',
    horizonMonths: 24,
    baselineMonths: 6,
    notes: '',
    target: { label: 'Savings target', amount: 100000, date: null },
    accounts: [{ name: 'Chequing', balance: 12000, include: true }],
    events: [],
    overrides: { income: {}, expense: {} },
    excludedCategories: [],
    ...overrides,
})

const saveNew = (provider, overrides = {}) => provider.saveForecast({
    scenario: { sheetName: null, revision: 0, ...scenario(overrides) },
})

const saveCurrent = (provider, current, overrides = {}) => provider.saveForecast({
    scenario: { ...current, ...overrides },
})

const readSheet = async (workbookFile, name) => {
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.readFile(workbookFile)
    return workbook.getWorksheet(name)
}

test('starts with no scenario sheet', async () => {
    const { provider } = createTestProvider()
    assert.deepEqual(await provider.getForecast(), { scenario: null, errors: [] })
})

test('creates an inputs-only scenario sheet and reads it back', async () => {
    const { provider, workbookFile } = createTestProvider()
    const saved = await saveNew(provider, {
        notes: 'Two lines\nof notes',
        target: { label: 'House fund', amount: 75000, date: '2030-01-01' },
        accounts: [
            { name: 'Chequing', balance: 12000, include: true },
            { name: 'Savings', balance: 30000.5, include: true },
            { name: 'Old card', balance: -500, include: false },
        ],
        events: [{ date: '2027-01-15', details: 'Plane tickets', kind: 'expense', amount: 2500, notes: 'Trip' }],
        overrides: { income: { Job: 5000 }, expense: { Rent: 1400 } },
        excludedCategories: ['Investment Buy', 'Snacks'],
    })
    const stored = saved.scenario
    assert.equal(stored.sheetName, 'Scenario - Base plan')
    assert.equal(stored.revision, 1)
    assert.equal(stored.name, 'Base plan')
    assert.equal(stored.currency, 'CAD')
    assert.equal(stored.asOf, '2026-09-15')
    assert.equal(stored.notes, 'Two lines\nof notes')
    assert.deepEqual(stored.target, { label: 'House fund', amount: 75000, date: '2030-01-01' })
    assert.deepEqual(stored.accounts.map((account) => [account.name, account.balance, account.include]), [
        ['Chequing', 12000, true],
        ['Savings', 30000.5, true],
        ['Old card', -500, false],
    ])
    assert.deepEqual(stored.events, [{ date: '2027-01-15', details: 'Plane tickets', kind: 'expense', amount: 2500, notes: 'Trip' }])
    assert.deepEqual(stored.overrides, { income: { Job: 5000 }, expense: { Rent: 1400 } })
    assert.deepEqual(stored.excludedCategories.sort(), ['Investment Buy', 'Snacks'].sort())

    const sheet = await readSheet(workbookFile, 'Scenario - Base plan')
    assert.equal(sheet.state, 'visible')
    assert.equal(sheet.getCell('A1').value, 'D$CPLN Scenario v1')
    assert.equal(sheet.getCell('B3').value, 'Base plan')
    assert.equal(sheet.getCell('B14').value, 75000)
    // Inputs only: no projection/results block is written.
    const values = []
    sheet.eachRow({ includeEmpty: false }, (row) => {
        row.eachCell({ includeEmpty: false }, (cell) => values.push(String(cell.value)))
    })
    assert.equal(values.includes('Projection'), false)
    assert.equal(values.includes('Target date'), false)
    assert.equal(fs.existsSync(`${workbookFile}.bak`), false)
})

test('updates the single scenario in place and increments its revision', async () => {
    const { provider } = createTestProvider()
    const first = await saveNew(provider)
    const updated = await saveCurrent(provider, first.scenario, {
        baselineMonths: 12,
        accounts: [{ name: 'Main account', balance: 5000, include: true }],
    })
    assert.equal(updated.scenario.revision, first.scenario.revision + 1)
    assert.equal(updated.scenario.sheetName, 'Scenario - Base plan')
    assert.equal(updated.scenario.baselineMonths, 12)
    assert.equal(updated.scenario.accounts[0].balance, 5000)

    const reread = await provider.getForecast()
    assert.equal(reread.scenario.revision, 2)
    assert.equal(reread.scenario.baselineMonths, 12)
})

test('rejects a stale revision without writing', async () => {
    const { provider } = createTestProvider()
    const first = await saveNew(provider)
    const current = first.scenario
    await assert.rejects(
        provider.saveForecast({
            scenario: { ...current, revision: 0, accounts: [{ name: 'Stale', balance: 1, include: true }] },
        }),
        (error) => error instanceof ConflictError && error.statusCode === 409,
    )
    const after = await provider.getForecast()
    assert.equal(after.scenario.accounts[0].name, 'Chequing')
    assert.equal(after.scenario.revision, 1)
})

test('refuses to create a second scenario when one already exists', async () => {
    const { provider } = createTestProvider()
    await saveNew(provider)
    await assert.rejects(
        saveNew(provider, { name: 'Second plan' }),
        (error) => error instanceof ConflictError && error.statusCode === 409,
    )
    const after = await provider.getForecast()
    assert.equal(after.scenario.name, 'Base plan')
})

test('validates scenario input', async () => {
    const { provider } = createTestProvider()
    await assert.rejects(saveNew(provider, { currency: 'EUR' }), ValidationError)
    await assert.rejects(saveNew(provider, { horizonMonths: 0 }), ValidationError)
    await assert.rejects(saveNew(provider, { events: [{ date: '2027-01-01', details: '', kind: 'expense', amount: 10 }] }), ValidationError)
    await assert.rejects(saveNew(provider, { events: [{ date: '2027-01-01', details: 'Bad', kind: 'expense', amount: 0 }] }), ValidationError)
    await assert.rejects(saveNew(provider, { target: { amount: 10, label: 'T', date: 'not-a-date' } }), ValidationError)
    assert.equal((await provider.getForecast()).scenario, null)
})

test('ignores non-scenario sheets', async () => {
    const { provider, workbookFile } = createTestProvider()
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.readFile(workbookFile)
    const manual = workbook.addWorksheet('Scenario - Manual')
    manual.getCell('A1').value = 'Just a normal sheet'
    await workbook.xlsx.writeFile(workbookFile)

    assert.equal((await provider.getForecast()).scenario, null)
    const saved = await saveNew(provider)
    assert.equal(saved.scenario.sheetName, 'Scenario - Base plan')
})

test('reports malformed scenario sheets without treating them as active', async () => {
    const { provider, workbookFile } = createTestProvider()
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.readFile(workbookFile)
    const broken = workbook.addWorksheet('Scenario - Broken')
    broken.getCell('A1').value = 'D$CPLN Scenario v1'
    broken.getCell('A3').value = 'Scenario name'
    broken.getCell('B3').value = 'Broken'
    // Currency/as-of/horizon/baseline are deliberately missing.
    await workbook.xlsx.writeFile(workbookFile)

    const result = await provider.getForecast()
    assert.equal(result.scenario, null)
    assert.equal(result.errors.length, 1)
    assert.equal(result.errors[0].sheetName, 'Scenario - Broken')
})

test('round-trips model settings, recurring adjustments and scheduled changes', async () => {
    const { provider, workbookFile } = createTestProvider()
    const saved = await saveNew(provider, {
        baselineMethod: 'robust',
        recurringDetection: false,
        uncertainty: false,
        recurringAdjustments: [{
            kind: 'expense',
            category: 'Rent',
            details: 'rent',
            label: 'Rent',
            include: true,
            amount: 1500,
            cadence: 'monthly',
            nextDate: '2026-10-05',
        }],
        changes: [{ from: '2027-01', kind: 'expense', category: 'Rent', amount: 1600 }],
    })
    const stored = saved.scenario
    assert.equal(stored.baselineMethod, 'robust')
    assert.equal(stored.recurringDetection, false)
    assert.equal(stored.uncertainty, false)
    assert.deepEqual(stored.recurringAdjustments, [{
        kind: 'expense',
        category: 'Rent',
        details: 'rent',
        label: 'Rent',
        include: true,
        amount: 1500,
        cadence: 'monthly',
        nextDate: '2026-10-05',
    }])
    assert.deepEqual(stored.changes, [{ from: '2027-01', kind: 'expense', category: 'Rent', amount: 1600 }])

    const sheet = await readSheet(workbookFile, stored.sheetName)
    assert.equal(sheet.getCell('D3').value, 'Baseline method')
    assert.equal(sheet.getCell('E3').value, 'Robust')
    assert.equal(sheet.getCell('D4').value, 'Recurring detection')
    assert.equal(sheet.getCell('E4').value, 'Off')
    assert.equal(sheet.getCell('D5').value, 'Uncertainty')
    assert.equal(sheet.getCell('E5').value, 'Off')
    const values = []
    sheet.eachRow({ includeEmpty: false }, (row) => {
        row.eachCell({ includeEmpty: false }, (cell) => values.push(String(cell.value)))
    })
    assert.ok(values.includes('Recurring adjustments'))
    assert.ok(values.includes('Scheduled changes'))
    assert.ok(values.includes('2027-01'))
})

test('rejects invalid recurring adjustments and scheduled changes', async () => {
    const { provider } = createTestProvider()
    await assert.rejects(saveNew(provider, {
        recurringAdjustments: [{ kind: 'expense', category: 'Rent', details: 'rent', cadence: 'hourly' }],
    }), ValidationError)
    await assert.rejects(saveNew(provider, {
        recurringAdjustments: [{ kind: 'expense', category: 'Rent', details: 'rent', amount: -1 }],
    }), ValidationError)
    await assert.rejects(saveNew(provider, {
        changes: [{ from: '2027-13', kind: 'expense', category: 'Rent', amount: 100 }],
    }), ValidationError)
    await assert.rejects(saveNew(provider, {
        changes: [{ from: '2027-01', kind: 'expense', category: 'Nope', amount: 100 }],
    }), ValidationError)
})

test('commits scenario changes and creates no backup file', async () => {
    const { provider, workbookFile, dir } = createTestProvider()
    await saveNew(provider)
    assert.equal(fs.existsSync(`${workbookFile}.bak`), false)
    const log = git(['log', '-1', '--format=%s'], dir)
    assert.match(log, /update forecast/)
})

test('round-trips a blank as-of date as today', async () => {
    const { provider, workbookFile } = createTestProvider()
    const saved = await saveNew(provider, { asOf: null })
    assert.equal(saved.scenario.asOf, null)
    assert.equal(saved.scenario.sheetName, 'Scenario - Base plan')

    const sheet = await readSheet(workbookFile, saved.scenario.sheetName)
    assert.equal(sheet.getCell('B5').value, null)

    const reread = await provider.getForecast()
    assert.equal(reread.scenario.asOf, null)
})
