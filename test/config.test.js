'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { loadConfig } = require('../config')

const writeConfig = (value) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dscpln-config-'))
    const file = path.join(dir, 'config.json')
    fs.writeFileSync(file, JSON.stringify(value))
    return { dir, file }
}

const minimalConfig = {
    dataProvider: 'excelDataProvider',
    providers: { excelDataProvider: {} },
}

test('applies defaults for missing fields', () => {
    const { dir, file } = writeConfig(minimalConfig)
    const config = loadConfig(file)
    assert.equal(config.port, 3300)
    assert.equal(config.notifications.checkIntervalMinutes, 30)
    assert.equal(config.notifications.onlyWarnOnce, false)
    assert.equal(config.notifications.monthlyLimitUrl, null)
    assert.equal('weeklyLimitUrl' in config.notifications, false)
    assert.equal(config.api.stateFile, './api-state.json')
    assert.equal(config.configDir, dir)
})

test('keeps values from the config file', () => {
    const { file } = writeConfig({
        ...minimalConfig,
        port: 8080,
        providers: { excelDataProvider: { workbookFile: '/tmp/notes.xlsx' } },
        notifications: { monthlyLimitUrl: 'https://example.com/topic', onlyWarnOnce: true },
    })
    const config = loadConfig(file)
    assert.equal(config.port, 8080)
    assert.equal(config.providers.excelDataProvider.workbookFile, '/tmp/notes.xlsx')
    assert.equal(config.notifications.monthlyLimitUrl, 'https://example.com/topic')
    assert.equal(config.notifications.onlyWarnOnce, true)
    assert.equal(config.notifications.checkIntervalMinutes, 30)
})

test('uses DSCPLN_CONFIG when no path is passed', () => {
    const { file } = writeConfig(minimalConfig)
    const previous = process.env['DSCPLN_CONFIG']
    process.env['DSCPLN_CONFIG'] = file
    try {
        const config = loadConfig()
        assert.equal(config.dataProvider, 'excelDataProvider')
    } finally {
        if (previous === undefined) {
            delete process.env['DSCPLN_CONFIG']
        } else {
            process.env['DSCPLN_CONFIG'] = previous
        }
    }
})

test('throws when the config file is missing', () => {
    assert.throws(() => loadConfig('/tmp/dscpln-does-not-exist/config.json'), /Config file not found/)
})

test('throws on invalid values', () => {
    assert.throws(() => loadConfig(writeConfig({ ...minimalConfig, port: 0 }).file), /"port"/)
    assert.throws(() => loadConfig(writeConfig({ ...minimalConfig, port: 'abc' }).file), /"port"/)
    assert.throws(() => loadConfig(writeConfig({ dataProvider: 'excelDataProvider' }).file), /providers/)
    assert.throws(() => loadConfig(writeConfig({ ...minimalConfig, providers: { excelDataProvider: 5 } }).file), /providers/)
    assert.throws(() => loadConfig(writeConfig({
        ...minimalConfig,
        notifications: { onlyWarnOnce: 'yes' },
    }).file), /onlyWarnOnce/)
    assert.throws(() => loadConfig(writeConfig({ ...minimalConfig, api: 5 }).file), /"api"/)
    assert.throws(() => loadConfig(writeConfig({ ...minimalConfig, api: { stateFile: '' } }).file), /api\.stateFile/)
})
