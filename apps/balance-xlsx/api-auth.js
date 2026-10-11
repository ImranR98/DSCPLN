'use strict'

// Credentials for the external API: a single bearer token kept in a small JSON
// state file that is created on first use, so regenerating the token from the
// UI is enough to rotate it.
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

const randomToken = () => crypto.randomBytes(32).toString('base64url')

// Constant-time comparison; hashing first hides the length difference.
const safeEqual = (a, b) => {
    const left = crypto.createHash('sha256').update(String(a)).digest()
    const right = crypto.createHash('sha256').update(String(b)).digest()
    return crypto.timingSafeEqual(left, right)
}

const readState = (file) => {
    let parsed
    try {
        parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
    } catch (e) {
        throw new Error(`Could not read API state file ${file}: ${e.message}. Delete it to regenerate the API token.`)
    }
    if (!parsed || typeof parsed.token !== 'string') {
        throw new Error(`API state file ${file} is malformed. Delete it to regenerate the API token.`)
    }
    return parsed
}

const createApiAuth = (stateFile) => {
    const file = path.resolve(stateFile)
    let state = null

    const load = () => {
        if (!state) {
            state = fs.existsSync(file) ? readState(file) : { token: randomToken(), createdAt: new Date().toISOString() }
            if (!fs.existsSync(file)) {
                fs.mkdirSync(path.dirname(file), { recursive: true })
                fs.writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 })
            }
        }
        return state
    }

    const save = (next) => {
        state = next
        fs.mkdirSync(path.dirname(file), { recursive: true })
        fs.writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 })
    }

    return {
        getToken: () => load().token,
        regenerate: () => {
            save({ token: randomToken(), createdAt: new Date().toISOString() })
            return state.token
        },
        checkToken: (candidate) => safeEqual(load().token, candidate || ''),
    }
}

module.exports = { createApiAuth }
