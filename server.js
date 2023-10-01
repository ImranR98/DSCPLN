require('dotenv').config()
const express = require('express')
const path = require('path')

process.env['DATA_PROVIDER'] = process.env['DATA_PROVIDER'] || 'textFileDataProvider'

const dataProvider = require(`./dataProviders/${process.env['DATA_PROVIDER']}`)

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

app.listen(port, () => {
    console.log(`Server is running on port ${port}`)
})