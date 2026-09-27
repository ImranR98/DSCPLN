require('dotenv').config()
const express = require('express')
const path = require('path')
const axios = require('axios')

process.env['DATA_PROVIDER'] = process.env['DATA_PROVIDER'] || 'textFileDataProvider'

const dataProvider = require(`./dataProviders/${process.env['DATA_PROVIDER']}`)
const monthlyLimitNtfyURL = process.env['MONTHLY_LIMIT_NTFY_URL']
const weeklyLimitNtfyURL = process.env['WEEKLY_LIMIT_NTFY_URL']
const ntfyCheckIntervalMinutes = Number.parseFloat(process.env['NTFY_CHECK_INTERVAL_MINUTES'] || 30)
const ntfyAuthHeader = process.env['NTFY_TOKEN'] ? `Basic ${Buffer.from(`:${process.env['NTFY_TOKEN']}`).toString('base64')}` : null
const onlyWarnOnce = process.env['ONLY_WARN_ONCE'] != 'false' && process.env['ONLY_WARN_ONCE'] != false

const app = express()
const port = process.env.PORT || 3300

app.use(express.static(path.join(__dirname, 'static')))
app.use(express.json())

const parseDateQuery = (dateStr) => {
    if (!dateStr) return new Date()
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr)
    const date = match ?
        new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])) :
        new Date(dateStr)
    if (isNaN(date.getTime()) ||
        (match && (date.getFullYear() != Number(match[1]) ||
            date.getMonth() != Number(match[2]) - 1 ||
            date.getDate() != Number(match[3])))) {
        throw new Error('Invalid date')
    }
    return date
}

app.get('/data', async (req, res) => {
    let date
    try {
        date = parseDateQuery(req.query['date'])
    } catch (e) {
        res.status(400).send('Invalid date')
        return
    }
    try {
        res.send(await dataProvider.getData(date))
    } catch (e) {
        console.error(e)
        res.status(500).send('Internal server error')
    }
})

app.post('/budget', async (req, res) => {
    const monthlyBudget = Number.parseFloat(req.body?.monthlyBudget)
    const firstWeekBias = Number.parseFloat(req.body?.firstWeekBias ?? 0)
    if (!Number.isFinite(monthlyBudget) || monthlyBudget <= 0 ||
        !Number.isFinite(firstWeekBias) || firstWeekBias < 0 || firstWeekBias > monthlyBudget) {
        res.status(400).send('Invalid budget values')
        return
    }
    try {
        await dataProvider.updateMonthlyBudget(monthlyBudget, firstWeekBias)
        res.send()
    } catch (e) {
        console.error(e)
        res.status(500).send('Internal server error')
    }
})

app.listen(port, async () => {
    console.log(`Server is running on port ${port}`)
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
    if (monthlyLimitNtfyURL || weeklyLimitNtfyURL) {
        const checkLimit = async () => {
            try {
                const data = await dataProvider.getData()
                if (data.monthlyBudget <= data.monthsSpend) {
                    if (monthlyLimitNtfyURL && !(didWarnMonthly && onlyWarnOnce) && data.monthsSpend != prevMonthSpend) {
                        if (await sendNotification(monthlyLimitNtfyURL,
                            `$${data.monthsSpend.toFixed(2)} of $${data.monthlyBudget.toFixed(2)}`,
                            'Monthly Budget Limit Reached')) {
                            didWarnMonthly = true
                        }
                    }
                } else {
                    didWarnMonthly = false
                }
                if (data.weeklyBudget <= data.weeksSpend) {
                    if (weeklyLimitNtfyURL && !(didWarnWeekly && onlyWarnOnce) && data.weeksSpend != prevWeekSpend) {
                        if (await sendNotification(weeklyLimitNtfyURL,
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
        await checkLimit()
        const checkIntervalMs = (Number.isFinite(ntfyCheckIntervalMinutes) && ntfyCheckIntervalMinutes > 0 ? ntfyCheckIntervalMinutes : 30) * 60 * 1000
        setInterval(checkLimit, checkIntervalMs)
    }
})