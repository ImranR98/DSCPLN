'use strict'

const express = require('express')
const path = require('path')
const axios = require('axios')
const { loadConfig } = require('./config')
const { ValidationError } = require('./errors')

const asyncRoute = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next)

// Shows at least 2 decimals and enough more to keep the value's significant
// digits (e.g. fractional XMR), without excessive trailing zeros.
const formatAmount = (value) => {
    const amount = Number.isFinite(value) ? value : 0
    const absolute = Math.abs(amount)
    const decimals = absolute >= 1 ? 2 : Math.min(12, Math.max(2, 8 - 1 - Math.floor(Math.log10(absolute || 1))))
    const [integerPart, fractionPart = ''] = amount.toFixed(decimals).split('.')
    const trimmed = fractionPart.replace(/0+$/, '')
    const fraction = trimmed.length < 2 ? fractionPart.slice(0, 2) : trimmed
    return `${integerPart}.${fraction}`
}

const parseDateQuery = (dateStr) => {
    if (!dateStr) {
        return new Date()
    }
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr)
    const date = match ?
        new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])) :
        new Date(dateStr)
    if (isNaN(date.getTime()) ||
        (match && (date.getFullYear() != Number(match[1]) ||
            date.getMonth() != Number(match[2]) - 1 ||
            date.getDate() != Number(match[3])))) {
        throw new ValidationError('Invalid date')
    }
    return date
}

const createApp = (config) => {
    let providerFactory
    try {
        providerFactory = require(path.join(__dirname, 'dataProviders', config.dataProvider))
    } catch (e) {
        throw new Error(`Could not load data provider "${config.dataProvider}": ${e.message}`)
    }
    if (typeof providerFactory !== 'function') {
        throw new Error(`Data provider "${config.dataProvider}" must export a factory function`)
    }
    const dataProvider = providerFactory(config.providers[config.dataProvider] || {}, config.configDir || process.cwd())

    const app = express()
    app.use(express.static(path.join(__dirname, 'static')))
    app.use(express.json())

    app.get('/insights', (req, res) => {
        res.sendFile(path.join(__dirname, 'static', 'insights.html'))
    })

    app.get('/data', asyncRoute(async (req, res) => {
        res.send(await dataProvider.getData(parseDateQuery(req.query['date'])))
    }))

    app.post('/budget', asyncRoute(async (req, res) => {
        const monthlyBudget = Number.parseFloat(req.body?.monthlyBudget)
        const firstDayBias = Number.parseFloat(req.body?.firstDayBias ?? 0)
        const currency = req.body?.currency
        if (!Number.isFinite(monthlyBudget) || monthlyBudget <= 0 ||
            !Number.isFinite(firstDayBias) || firstDayBias < 0 || firstDayBias > monthlyBudget) {
            res.status(400).send('Invalid budget values')
            return
        }
        await dataProvider.updateMonthlyBudget(monthlyBudget, firstDayBias, currency)
        res.send()
    }))

    const requireProviderMethod = (method) => (req, res, next) => {
        if (typeof dataProvider[method] !== 'function') {
            res.status(501).send('This data provider does not support transactions')
            return
        }
        next()
    }

    app.get('/transactions', requireProviderMethod('getTransactions'), asyncRoute(async (req, res) => {
        const start = req.query['start']
        const end = req.query['end']
        if (!start || !end) {
            throw new ValidationError('start and end query parameters are required')
        }
        res.send(await dataProvider.getTransactions(start, end))
    }))

    app.post('/transactions', requireProviderMethod('addTransaction'), asyncRoute(async (req, res) => {
        res.status(201).send(await dataProvider.addTransaction(req.body))
    }))

    app.post('/transactions/import', requireProviderMethod('importTransactions'), asyncRoute(async (req, res) => {
        res.status(201).send(await dataProvider.importTransactions(req.body?.text))
    }))

    app.put('/transactions/:id', requireProviderMethod('updateTransaction'), asyncRoute(async (req, res) => {
        res.send(await dataProvider.updateTransaction(req.params['id'], req.body))
    }))

    app.delete('/transactions/:id', requireProviderMethod('deleteTransaction'), asyncRoute(async (req, res) => {
        await dataProvider.deleteTransaction(req.params['id'])
        res.status(204).send()
    }))

    app.get('/details-suggestions', requireProviderMethod('suggestDetails'), asyncRoute(async (req, res) => {
        res.send(await dataProvider.suggestDetails(req.query['q'], req.query['kind']))
    }))

    app.get('/category-suggestions', asyncRoute(async (req, res) => {
        if (typeof dataProvider.suggestCategories !== 'function') {
            res.status(501).send('This data provider does not support category suggestions')
            return
        }
        res.send(await dataProvider.suggestCategories(req.query['q'], req.query['kind']))
    }))

    app.use((err, req, res, next) => {
        if (err.type === 'entity.parse.failed') {
            res.status(400).send('Invalid JSON body')
            return
        }
        if (err.statusCode) {
            res.status(err.statusCode).send(err.message)
            return
        }
        console.error(err)
        res.status(500).send('Internal server error')
    })

    return { app, dataProvider }
}

const startNotifications = (config, dataProvider) => {
    const { monthlyLimitUrl, ntfyToken, checkIntervalMinutes } = config.notifications
    const onlyWarnOnce = config.notifications.onlyWarnOnce !== false
    if (!monthlyLimitUrl) {
        return
    }
    const ntfyAuthHeader = ntfyToken ? `Basic ${Buffer.from(`:${ntfyToken}`).toString('base64')}` : null
    const intervalMs = (checkIntervalMinutes > 0 ? checkIntervalMinutes : 30) * 60 * 1000
    const warnedCurrencies = new Set()
    const previousSpend = new Map()
    const sendNotification = async (url, message, title) => {
        try {
            await axios.post(url, message, {
                headers: {
                    Title: title,
                    Authorization: ntfyAuthHeader
                },
                timeout: 10000
            })
            return true
        } catch (e) {
            console.error(`Failed to send notification: ${e.message}`)
            return false
        }
    }
    const checkLimits = async () => {
        try {
            const overview = await dataProvider.getData()
            for (const entry of overview.currencies || []) {
                if (!entry || entry.monthlyBudget <= 0) {
                    continue
                }
                if (entry.monthlyBudget <= entry.monthsSpend) {
                    if (!(warnedCurrencies.has(entry.code) && onlyWarnOnce) && entry.monthsSpend !== previousSpend.get(entry.code)) {
                        if (await sendNotification(monthlyLimitUrl,
                            `${entry.code} $${formatAmount(entry.monthsSpend)} of $${formatAmount(entry.monthlyBudget)}`,
                            `Monthly Budget Limit Reached (${entry.code})`)) {
                            warnedCurrencies.add(entry.code)
                        }
                    }
                } else {
                    warnedCurrencies.delete(entry.code)
                }
                previousSpend.set(entry.code, entry.monthsSpend)
            }
        } catch (e) {
            console.error(e)
        }
    }
    checkLimits()
    setInterval(checkLimits, intervalMs)
}

const start = (config) => {
    const { app, dataProvider } = createApp(config)
    const server = app.listen(config.port, () => {
        console.log(`Server is running on port ${config.port}`)
        startNotifications(config, dataProvider)
    })
    return server
}

if (require.main === module) {
    const config = loadConfig()
    start(config)
}

module.exports = { createApp, start, startNotifications }
