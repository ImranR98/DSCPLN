'use strict'

const fs = require('fs')
const path = require('path')

const DEFAULT_CONFIG_PATH = './config.json'

const DEFAULTS = {
    port: 3300,
    dataProvider: 'excelDataProvider',
    providers: {},
    notifications: {
        monthlyLimitUrl: null,
        ntfyToken: null,
        checkIntervalMinutes: 30,
        onlyWarnOnce: false,
    },
    api: {
        stateFile: './api-state.json',
    },
}

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

const mergeDeep = (base, override) => {
    const result = { ...base }
    for (const [key, value] of Object.entries(override || {})) {
        result[key] = isPlainObject(value) && isPlainObject(base[key]) ? mergeDeep(base[key], value) : value
    }
    return result
}

const validateConfig = (config) => {
    const port = Number(config.port)
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error('Config error: "port" must be an integer between 1 and 65535')
    }
    config.port = port

    if (typeof config.dataProvider !== 'string' || config.dataProvider.trim() === '') {
        throw new Error('Config error: "dataProvider" must be a non-empty string')
    }
    if (!isPlainObject(config.providers)) {
        throw new Error('Config error: "providers" must be an object')
    }
    if (!isPlainObject(config.providers[config.dataProvider])) {
        throw new Error(`Config error: "providers.${config.dataProvider}" must be an object`)
    }

    if (!isPlainObject(config.notifications)) {
        throw new Error('Config error: "notifications" must be an object')
    }
    for (const key of ['monthlyLimitUrl', 'ntfyToken']) {
        if (config.notifications[key] != null && typeof config.notifications[key] !== 'string') {
            throw new Error(`Config error: "notifications.${key}" must be a string or null`)
        }
    }
    const checkIntervalMinutes = Number(config.notifications.checkIntervalMinutes)
    if (!Number.isFinite(checkIntervalMinutes) || checkIntervalMinutes <= 0) {
        throw new Error('Config error: "notifications.checkIntervalMinutes" must be greater than 0')
    }
    config.notifications.checkIntervalMinutes = checkIntervalMinutes
    if (typeof config.notifications.onlyWarnOnce !== 'boolean') {
        throw new Error('Config error: "notifications.onlyWarnOnce" must be true or false')
    }

    if (!isPlainObject(config.api)) {
        throw new Error('Config error: "api" must be an object')
    }
    if (typeof config.api.stateFile !== 'string' || config.api.stateFile.trim() === '') {
        throw new Error('Config error: "api.stateFile" must be a non-empty string')
    }

    return config
}

const loadConfig = (configPath) => {
    const requestedPath = configPath || process.env['DSCPLN_CONFIG'] || DEFAULT_CONFIG_PATH
    const resolvedPath = path.resolve(requestedPath)
    if (!fs.existsSync(resolvedPath) || !fs.statSync(resolvedPath).isFile()) {
        throw new Error(`Config file not found: ${resolvedPath}. Copy config.example.json to config.json and edit it, or set DSCPLN_CONFIG to its path.`)
    }
    let parsed
    try {
        parsed = JSON.parse(fs.readFileSync(resolvedPath, 'utf8'))
    } catch (e) {
        throw new Error(`Could not parse config file ${resolvedPath}: ${e.message}`)
    }
    if (!isPlainObject(parsed)) {
        throw new Error(`Config file ${resolvedPath} must contain a JSON object`)
    }
    const config = validateConfig(mergeDeep(DEFAULTS, parsed))
    config.configDir = path.dirname(resolvedPath)
    return config
}

module.exports = { loadConfig }
