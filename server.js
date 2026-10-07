'use strict'

// HTTP server: static pages and the JSON API. Budget-limit notifications live
// in notifications.js.
const express = require('express')
const path = require('path')
const { loadConfig } = require('./config')
const { ValidationError, ConflictError, UnprocessableError } = require('./errors')
const { startNotifications } = require('./notifications')
const { createApiAuth } = require('./api-auth')

const asyncRoute = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next)

const todayIso = () => {
    const date = new Date()
    const pad = (value) => String(value).padStart(2, '0')
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

// The external API takes a signed amount: negative is an expense, positive is
// income. The sign is stripped before the amount reaches the provider.
const signedAmountToInput = (value) => {
    const amount = Number.parseFloat(value)
    if (!Number.isFinite(amount) || amount === 0) {
        throw new ValidationError('Amount must be a non-zero number')
    }
    return { kind: amount < 0 ? 'expense' : 'income', amount: Math.abs(amount) }
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

    const apiStateFile = config.api?.stateFile || './api-state.json'
    const apiAuth = createApiAuth(path.resolve(config.configDir || process.cwd(), apiStateFile))
    apiAuth.getToken() // create the state file up front so permission errors surface early

    const app = express()
    app.use(express.static(path.join(__dirname, 'static')))
    app.use(express.json({ limit: '256kb' }))

    app.get('/insights', (req, res) => {
        res.sendFile(path.join(__dirname, 'static', 'insights.html'))
    })

    app.get('/data', asyncRoute(async (req, res) => {
        res.send(await dataProvider.getData(parseDateQuery(req.query['date'])))
    }))

    app.post('/budget', asyncRoute(async (req, res) => {
        await dataProvider.updateMonthlyBudget(req.body?.monthlyBudget, req.body?.firstDayBias ?? 0, req.body?.currency)
        res.send()
    }))

    const requireProviderMethod = (method, feature = 'transactions') => (req, res, next) => {
        if (typeof dataProvider[method] !== 'function') {
            res.status(501).send(`This data provider does not support ${feature}`)
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

    app.get('/details-suggestions', requireProviderMethod('suggestDetails', 'details suggestions'), asyncRoute(async (req, res) => {
        res.send(await dataProvider.suggestDetails(req.query['q'], req.query['kind']))
    }))

    app.get('/category-suggestions', requireProviderMethod('suggestCategories', 'category suggestions'), asyncRoute(async (req, res) => {
        res.send(await dataProvider.suggestCategories(req.query['q'], req.query['kind']))
    }))

    app.get('/settings', (req, res) => {
        res.sendFile(path.join(__dirname, 'static', 'settings.html'))
    })

    app.get('/token', (req, res) => {
        res.send({ token: apiAuth.getToken() })
    })

    app.post('/token/regenerate', (req, res) => {
        // Requiring JSON keeps cross-site form posts from rotating the token.
        if (!req.is('application/json')) {
            res.status(415).send('Expected application/json')
            return
        }
        res.send({ token: apiAuth.regenerate() })
    })

    const requireApiToken = (req, res, next) => {
        const match = /^Bearer\s+(.+)$/i.exec(req.get('authorization') || '')
        if (!match || !apiAuth.checkToken(match[1].trim())) {
            res.status(401).json({ error: 'Invalid or missing API token' })
            return
        }
        next()
    }

    const requireApiMethod = (method, feature) => {
        if (typeof dataProvider[method] !== 'function') {
            const error = new Error(`This data provider does not support ${feature}`)
            error.statusCode = 501
            throw error
        }
    }

    // Add-only external API. A signed amount sets the direction, a missing
    // category is auto-assigned, and auto-assigned transactions come back with
    // a short-lived edit token for correcting that one category.
    app.post('/api/transactions', requireApiToken, asyncRoute(async (req, res) => {
        requireApiMethod('addTransaction', 'transactions')
        const input = req.body || {}
        const { kind, amount } = signedAmountToInput(input.amount)
        let category = typeof input.category === 'string' ? input.category.trim() : ''
        let assignedCategory = null
        if (!category) {
            requireApiMethod('suggestCategories', 'category suggestions')
            const details = typeof input.details === 'string' ? input.details.trim() : ''
            if (!details) {
                throw new ValidationError('Details is required')
            }
            const result = await dataProvider.suggestCategories(details, kind)
            if (!result.confident || result.suggestions.length === 0) {
                const error = new UnprocessableError('Could not assign a category; provide one explicitly')
                error.suggestions = result.suggestions.map((suggestion) => suggestion.category)
                throw error
            }
            category = result.suggestions[0].category
            assignedCategory = category
        }
        const transaction = await dataProvider.addTransaction({
            kind,
            amount,
            details: input.details,
            date: typeof input.date === 'string' && input.date.trim() ? input.date : todayIso(),
            category,
            currency: input.currency,
            notes: input.notes,
        })
        const body = { transaction }
        if (assignedCategory) {
            body.assignedCategory = assignedCategory
            body.editToken = apiAuth.createEditToken(transaction.id)
        }
        res.status(201).send(body)
    }))

    // The only edit the external API allows: correcting the category of the
    // transaction the edit token was issued for.
    app.patch('/api/transactions/:editToken', requireApiToken, asyncRoute(async (req, res) => {
        requireApiMethod('reassignCategory', 'category corrections')
        const id = apiAuth.verifyEditToken(req.params['editToken'])
        const category = typeof req.body?.category === 'string' ? req.body.category.trim() : ''
        if (!category) {
            throw new ValidationError('category is required')
        }
        try {
            res.send({ transaction: await dataProvider.reassignCategory(id, category) })
        } catch (e) {
            if (e instanceof ConflictError) {
                throw new ConflictError('The transaction has changed since the edit token was issued')
            }
            throw e
        }
    }))

    app.use('/api', (req, res) => {
        res.status(404).json({ error: 'Not found' })
    })

    app.use((err, req, res, next) => {
        const isApi = req.path.startsWith('/api/')
        if (err.type === 'entity.parse.failed') {
            if (isApi) {
                res.status(400).json({ error: 'Invalid JSON body' })
            } else {
                res.status(400).send('Invalid JSON body')
            }
            return
        }
        if (isApi) {
            const statusCode = err.statusCode || 500
            if (statusCode === 500) {
                console.error(err)
            }
            const body = { error: statusCode === 500 ? 'Internal server error' : err.message }
            if (err.suggestions) {
                body.suggestions = err.suggestions
            }
            res.status(statusCode).json(body)
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
