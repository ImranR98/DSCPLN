'use strict'

const express = require('express')
const path = require('path')
const axios = require('axios')
const { loadConfig } = require('./config')
const { ValidationError } = require('./errors')

const asyncRoute = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next)

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

    app.get('/data', asyncRoute(async (req, res) => {
        res.send(await dataProvider.getData(parseDateQuery(req.query['date']), req.query['currency']))
    }))

    app.post('/budget', asyncRoute(async (req, res) => {
        const monthlyBudget = Number.parseFloat(req.body?.monthlyBudget)
        const firstDayBias = Number.parseFloat(req.body?.firstDayBias ?? 0)
        if (!Number.isFinite(monthlyBudget) || monthlyBudget <= 0 ||
            !Number.isFinite(firstDayBias) || firstDayBias < 0 || firstDayBias > monthlyBudget) {
            res.status(400).send('Invalid budget values')
            return
        }
        await dataProvider.updateMonthlyBudget(monthlyBudget, firstDayBias)
        res.send()
    }))

    const requireProviderMethod = (method) => (req, res, next) => {
        if (typeof dataProvider[method] !== 'function') {
            res.status(501).send('This data provider does not support transactions')
            return
        }
        next()
    }

    app.post('/transactions', requireProviderMethod('addTransaction'), asyncRoute(async (req, res) => {
        res.status(201).send(await dataProvider.addTransaction(req.body))
    }))

    app.put('/transactions/:id', requireProviderMethod('updateTransaction'), asyncRoute(async (req, res) => {
        res.send(await dataProvider.updateTransaction(req.params['id'], req.body))
    }))

    app.delete('/transactions/:id', requireProviderMethod('deleteTransaction'), asyncRoute(async (req, res) => {
        await dataProvider.deleteTransaction(req.params['id'])
        res.status(204).send()
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
    const { monthlyLimitUrl, weeklyLimitUrl, ntfyToken, checkIntervalMinutes } = config.notifications
    const onlyWarnOnce = config.notifications.onlyWarnOnce !== false
    if (!monthlyLimitUrl && !weeklyLimitUrl) {
        return
    }
    const ntfyAuthHeader = ntfyToken ? `Basic ${Buffer.from(`:${ntfyToken}`).toString('base64')}` : null
    const intervalMs = (checkIntervalMinutes > 0 ? checkIntervalMinutes : 30) * 60 * 1000
    let didWarnMonthly = false
    let didWarnWeekly = false
    let prevMonthSpend = -1
    let prevWeekSpend = -1
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
    const checkLimit = async () => {
        try {
            const data = await dataProvider.getData()
            if (data.monthlyBudget <= data.monthsSpend) {
                if (monthlyLimitUrl && !(didWarnMonthly && onlyWarnOnce) && data.monthsSpend != prevMonthSpend) {
                    if (await sendNotification(monthlyLimitUrl,
                        `$${data.monthsSpend.toFixed(2)} of $${data.monthlyBudget.toFixed(2)}`,
                        'Monthly Budget Limit Reached')) {
                        didWarnMonthly = true
                    }
                }
            } else {
                didWarnMonthly = false
            }
            if (data.weeklyBudget <= data.weeksSpend) {
                if (weeklyLimitUrl && !(didWarnWeekly && onlyWarnOnce) && data.weeksSpend != prevWeekSpend) {
                    if (await sendNotification(weeklyLimitUrl,
                        `$${data.weeksSpend.toFixed(2)} of $${data.weeklyBudget.toFixed(2)}`,
                        'Weekly Budget Limit Reached')) {
                        didWarnWeekly = true
                    }
                }
            } else {
                didWarnWeekly = false
            }
            prevMonthSpend = data.monthsSpend
            prevWeekSpend = data.weeksSpend
        } catch (e) {
            console.error(e)
        }
    }
    checkLimit()
    setInterval(checkLimit, intervalMs)
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
