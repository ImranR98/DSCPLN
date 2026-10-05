'use strict'

// HTTP server: static pages and the JSON API. Budget-limit notifications live
// in notifications.js.
const express = require('express')
const path = require('path')
const { loadConfig } = require('./config')
const { ValidationError } = require('./errors')
const { startNotifications } = require('./notifications')

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

module.exports = { createApp, start }
