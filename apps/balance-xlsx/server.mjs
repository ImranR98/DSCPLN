'use strict'

// HTTP server: static pages and the JSON API, mounted through the server kit so
// the app works both at the host root (local dev) and under BASE_PATH (e.g.
// /balance). Budget-limit notifications live in notifications.js.
import path from 'node:path'
import { createApp as createKitApp } from '@dscpln/server-kit'
import { loadConfig } from './config.mjs'
import { ValidationError } from './errors.mjs'
import { startNotifications } from './notifications.mjs'
import { createApiAuth } from './api-auth.mjs'

import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const require = createRequire(import.meta.url)


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
        const loaded = require(path.join(__dirname, 'dataProviders', `${config.dataProvider}.mjs`))
        providerFactory = loaded.default ?? loaded
    } catch (e) {
        throw new Error(`Could not load data provider "${config.dataProvider}": ${e.message}`, { cause: e })
    }
    if (typeof providerFactory !== 'function') {
        throw new Error(`Data provider "${config.dataProvider}" must export a factory function`)
    }
    const dataProvider = providerFactory(config.providers[config.dataProvider] || {}, config.configDir || process.cwd())

    const apiStateFile = config.api?.stateFile || './api-state.json'
    const apiAuth = createApiAuth(path.resolve(config.configDir || process.cwd(), apiStateFile))
    apiAuth.getToken() // create the state file up front so permission errors surface early

    const staticDir = path.join(__dirname, 'static')
    const basePath = config.basePath ?? process.env.BASE_PATH ?? ''

    const requireProviderMethod = (method, feature = 'transactions') => (req, res, next) => {
        if (typeof dataProvider[method] !== 'function') {
            res.status(501).send(`This data provider does not support ${feature}`)
            return
        }
        next()
    }

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

    const app = createKitApp({
        title: 'Balance XLSX',
        pageTitle: null,
        basePath,
        staticDir,
        bodyLimit: '256kb',
        healthExtra: () => ({ provider: config.dataProvider }),
        routes: (router) => {
            router.get('/data', asyncRoute(async (req, res) => {
                // Repeated ?exclude=Category params override the workbook's
                // "Excluded from Budget by Default" list for this view; when
                // the param is absent the workbook defaults apply.
                const excludeParam = req.query['exclude']
                const excludeCategories = excludeParam === undefined ? undefined :
                    (Array.isArray(excludeParam) ? excludeParam : [excludeParam])
                        .map((value) => String(value).trim())
                        .filter(Boolean)
                res.send(await dataProvider.getData(parseDateQuery(req.query['date']), { excludeCategories }))
            }))

            // Compact budget status for the portal tile. Memoized briefly so the
            // portal's 60s poll does not re-read the workbook every time.
            let statusCache = null
            router.get('/status', asyncRoute(async (req, res) => {
                if (!statusCache || Date.now() - statusCache.at > 60_000) {
                    const overview = await dataProvider.getData()
                    const currencies = (overview.currencies || []).map((entry) => ({
                        code: entry.code,
                        symbol: entry.symbol || '',
                        monthlyBudget: entry.monthlyBudget,
                        monthsSpend: entry.monthsSpend,
                        overBudget: entry.monthlyBudget > 0 && entry.monthsSpend >= entry.monthlyBudget,
                    }))
                    statusCache = {
                        at: Date.now(),
                        body: {
                            currencies,
                            overBudget: currencies.filter((c) => c.overBudget).map((c) => c.code),
                        },
                    }
                }
                res.send(statusCache.body)
            }))

            router.post('/budget', asyncRoute(async (req, res) => {
                await dataProvider.updateMonthlyBudget(req.body?.monthlyBudget, req.body?.firstDayBias ?? 0, req.body?.currency)
                res.send()
            }))

            // Persists the current dashboard selection as the workbook default
            // ("Excluded from Budget by Default" in the Constants sheet).
            router.post('/excluded-defaults', requireProviderMethod('updateDefaultExcludedCategories', 'default excluded categories'), asyncRoute(async (req, res) => {
                res.send(await dataProvider.updateDefaultExcludedCategories(req.body?.categories))
            }))

            router.get('/forecast', requireProviderMethod('getForecast', 'forecast scenarios'), asyncRoute(async (req, res) => {
                res.send(await dataProvider.getForecast())
            }))

            router.put('/forecast', requireProviderMethod('saveForecast', 'forecast scenarios'), asyncRoute(async (req, res) => {
                res.send(await dataProvider.saveForecast(req.body || {}))
            }))

            router.get('/transactions', requireProviderMethod('getTransactions'), asyncRoute(async (req, res) => {
                const start = req.query['start']
                const end = req.query['end']
                if (!start || !end) {
                    throw new ValidationError('start and end query parameters are required')
                }
                res.send(await dataProvider.getTransactions(start, end))
            }))

            router.post('/transactions', requireProviderMethod('addTransaction'), asyncRoute(async (req, res) => {
                res.status(201).send(await dataProvider.addTransaction(req.body))
            }))

            router.post('/transactions/import', requireProviderMethod('importTransactions'), asyncRoute(async (req, res) => {
                res.status(201).send(await dataProvider.importTransactions(req.body?.text))
            }))

            router.put('/transactions/:id', requireProviderMethod('updateTransaction'), asyncRoute(async (req, res) => {
                res.send(await dataProvider.updateTransaction(req.params['id'], req.body))
            }))

            router.delete('/transactions/:id', requireProviderMethod('deleteTransaction'), asyncRoute(async (req, res) => {
                await dataProvider.deleteTransaction(req.params['id'])
                res.status(204).send()
            }))

            router.get('/details-suggestions', requireProviderMethod('suggestDetails', 'details suggestions'), asyncRoute(async (req, res) => {
                res.send(await dataProvider.suggestDetails(req.query['q'], req.query['kind']))
            }))

            router.get('/category-suggestions', requireProviderMethod('suggestCategories', 'category suggestions'), asyncRoute(async (req, res) => {
                res.send(await dataProvider.suggestCategories(req.query['q'], req.query['kind']))
            }))

            router.get('/token', (req, res) => {
                res.send({ token: apiAuth.getToken() })
            })

            router.post('/token/regenerate', (req, res) => {
                // Requiring JSON keeps cross-site form posts from rotating the token.
                if (!req.is('application/json')) {
                    res.status(415).send('Expected application/json')
                    return
                }
                res.send({ token: apiAuth.regenerate() })
            })

            // Category list and scoring. Without details every category comes back
            // with score 0, so it doubles as a "get the categories" call.
            router.get('/api/categories', requireApiToken, asyncRoute(async (req, res) => {
                requireApiMethod('scoreCategories', 'category suggestions')
                const details = typeof req.query['details'] === 'string' ? req.query['details'] : ''
                const kind = typeof req.query['kind'] === 'string' ? req.query['kind'] : null
                res.send({ groups: await dataProvider.scoreCategories(details, kind) })
            }))

            // Add-only external API: a signed amount sets the direction and the
            // category must be one from the Constants sheet.
            router.post('/api/transactions', requireApiToken, asyncRoute(async (req, res) => {
                requireApiMethod('addTransaction', 'transactions')
                const input = req.body || {}
                const { kind, amount } = signedAmountToInput(input.amount)
                const transaction = await dataProvider.addTransaction({
                    kind,
                    amount,
                    details: input.details,
                    date: typeof input.date === 'string' && input.date.trim() ? input.date : todayIso(),
                    category: input.category,
                    currency: input.currency,
                    notes: input.notes,
                })
                res.status(201).send({ transaction })
            }))

            // Batch import helpers for automations (same text format as the
            // UI's import dialog): check which lines already exist in the
            // workbook, then import only the missing ones.
            router.post('/api/transactions/check', requireApiToken, asyncRoute(async (req, res) => {
                requireApiMethod('checkImportLines', 'transaction imports')
                res.send(await dataProvider.checkImportLines(req.body?.text))
            }))

            router.post('/api/transactions/import', requireApiToken, asyncRoute(async (req, res) => {
                requireApiMethod('importTransactions', 'transaction imports')
                res.status(201).send(await dataProvider.importTransactions(req.body?.text, {
                    skipDuplicates: req.body?.skipDuplicates === true,
                }))
            }))
        },
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

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    start(loadConfig())
}

export { createApp, start }
