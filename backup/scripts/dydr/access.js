// Uses the Reddit API and an App CLIENT_ID and CLIENT_SECRET from secrets.josn to get Access tokens for the User's Reddit account and save them to ${userName}-access.json

const fs = require('fs')
const express = require('express')

const simpleRequests = require('./simpleRequests')

const apiUrl = 'https://www.reddit.com/api/v1'
const redirectUrl = 'http://localhost:8080/authRedirect'
const scopes = [
    'mysubreddits',
    'read',
    'privatemessages',
    'identity',
    'history',
    'edit',
    'mysubreddits',
    'report'
]

if (process.argv.length <= 2) {
    console.log('Please provide the path to save creds in the arguments.')
    process.exit()
}
let userName = process.argv[2].split('/')
userName = userName[userName.length - 1]

const loadCreds = () => {
    let creds = null
    try {
        creds = JSON.parse(fs.readFileSync(`./secrets.json`).toString())
    } catch (err) {
        console.log('Error loading creds. Make sure you Reddit API client ID and Secret are stored in secrets.json. secrets.template.json can be used as a starting point.')
        process.exit(-1)
    }
    return creds
}
const loadAccess = () => JSON.parse(fs.readFileSync(`./${userName}-access.json`).toString())

const getAuthorizationURL = () => {
    let creds = loadCreds()
    let scopesString = ''
    scopes.forEach(scope => scopesString += scope + '+')
    scopesString.length > 0 ? scopesString = scopesString.substr(0, scopesString.length - 1) : null
    return `${apiUrl}/authorize?client_id=${creds.CLIENT_ID}&response_type=code&state=done&redirect_uri=${redirectUrl}&duration=permanent&scope=${scopesString}`
}

const getAccess = async (code) => {
    let creds = loadCreds()
    let data = await simpleRequests.simpleHttpPost(
        'https://www.reddit.com/api/v1/access_token',
        {
            grant_type: 'authorization_code',
            code: code,
            redirect_uri: redirectUrl
        },
        {
            Authorization: 'Basic ' + Buffer.from(creds.CLIENT_ID + ':' + creds.CLIENT_SECRET).toString('base64')
        }
    )
    let accessCreds = JSON.parse(data.body)
    fs.writeFileSync(`./${userName}-access.json`, JSON.stringify(accessCreds, null, '\t'))
}

const refreshAccess = async (refreshToken) => {
    let creds = loadCreds()
    let data = await simpleRequests.simpleHttpPost(
        'https://www.reddit.com/api/v1/access_token',
        {
            grant_type: 'refresh_token',
            refresh_token: refreshToken
        },
        {
            Authorization: 'Basic ' + Buffer.from(creds.CLIENT_ID + ':' + creds.CLIENT_SECRET).toString('base64')
        }
    )
    let accessCreds = JSON.parse(data.body)
    accessCreds.refresh_token = refreshToken
    fs.writeFileSync(`./${userName}-access.json`, JSON.stringify(accessCreds, null, '\t'))
}

const app = express()
const port = process.env.PORT || 8080

app.get('/authRedirect', (req, res) => {
    getAccess(req.query.code).then(() => {
        console.log('Access was granted.')
        process.exit()
    }).catch((err) => {
        console.log('An error occured:')
        console.log(err)
        process.exit()
    })
    res.send('You can close this window.')
})

app.listen(port, () => {
    let accessCreds = null
    try {
        accessCreds = loadAccess()
    } catch (err) {
        console.log(`Access credentials are missing or could not be read. Visit the following URL to give access to the App:\n\n${getAuthorizationURL()}\n\nWaiting...`)
    }
    if (accessCreds) {
        console.log('Refreshing access tokens...')
        refreshAccess(accessCreds.refresh_token).then(() => {
            console.log('Access was updated.')
            process.exit()
        }).catch((err) => {
            console.log('An error occured:')
            console.log(err)
            if (fs.existsSync(`./${userName}-access.json`)) {
                fs.unlinkSync(`./${userName}-access.json`)
            }
            console.log('Please try again.')
            process.exit()
        })
    }
})