require('dotenv').config()
const express = require('express')
const path = require('path')
const axios = require('axios')

process.env['DATA_PROVIDER'] = process.env['DATA_PROVIDER'] || 'textFileDataProvider'

const dataProvider = require(`./dataProviders/${process.env['DATA_PROVIDER']}`)
const monthlyLimitNtfyURL = process.env['MONTHLY_LIMIT_NTFY_URL']
const weeklyLimitNtfyURL = process.env['WEEKLY_LIMIT_NTFY_URL']
const ntfyCheckIntervalMinutes = process.env['NTFY_CHECK_INTERVAL_MINUTES'] || 30
const ntfyAuthHeader = process.env['NTFY_TOKEN'] ? `Basic ${Buffer.from(`:${process.env['NTFY_TOKEN']}`).toString('base64')}` : null

const app = express()
const port = process.env.PORT || 3300

app.use(express.static(path.join(__dirname, 'static')))
app.use(express.json())

app.get('/data', async (req, res) => {
    try {
        res.send(await dataProvider.getData())
    } catch (e) {
        console.error(e)
        res.status(500).send(e)
    }
})

app.post('/budget', async (req, res) => {
    try {
        await dataProvider.updateMonthlyBudget(req.body.monthlyBudget)
        res.send()
    } catch (e) {
        console.error(e)
        res.status(500).send(e)
    }
})

app.listen(port, async () => {
    console.log(`Server is running on port ${port}`)
    let didWarnMonthly = false
    let didWarnWeekly = false
    if (monthlyLimitNtfyURL || weeklyLimitNtfyURL) {
        const checkLimit = async () => {
            const data = await dataProvider.getData()
            data.weeklyBudget = (data.monthlyBudget / 4)
            if (data.monthlyBudget <= data.monthsSpend) {
                if (monthlyLimitNtfyURL && !didWarnMonthly) {
                    await axios.post(monthlyLimitNtfyURL,
                        `$${data.monthsSpend} of ${data.monthlyBudget}`,
                        {
                            headers: {
                                Title: 'Monthly Budget Limit Reached',
                                Authorization: ntfyAuthHeader
                            }
                        }
                    )
                    didWarnMonthly = true
                }
            } else {
                didWarnMonthly = false
            }
            if (data.weeklyBudget <= data.weeksSpend) {
                if (weeklyLimitNtfyURL && !didWarnWeekly) {
                    await axios.post(weeklyLimitNtfyURL,
                        `$${data.weeksSpend} of ${data.weeklyBudget}`,
                        {
                            headers: {
                                Title: 'Weekly Budget Limit Reached',
                                Authorization: ntfyAuthHeader
                            }
                        }
                    )
                    didWarnWeekly = true
                }
            } else {
                didWarnWeekly = false
            }
        }
        await checkLimit()
        setInterval(async () => {
            await checkLimit()
        }, Number.parseFloat(ntfyCheckIntervalMinutes) * 60 * 1000)
    }
})