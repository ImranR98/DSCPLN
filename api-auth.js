'use strict'

// Credentials for the external API: a single bearer token, plus a separate
// secret used to sign the short-lived category-correction tokens handed out
// with auto-assigned transactions. Both live in a small JSON state file that
// is created on first use, so regenerating the token from the UI is enough to
// rotate it.
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const { UnauthorizedError } = require('./errors')

const EDIT_TOKEN_TTL_MS = 24 * 60 * 60 * 1000

const randomToken = () => crypto.randomBytes(32).toString('base64url')

const sign = (secret, value) => crypto.createHmac('sha256', secret).update(value).digest('base64url')

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
    if (!parsed || typeof parsed.token !== 'string' || typeof parsed.editSecret !== 'string') {
        throw new Error(`API state file ${file} is malformed. Delete it to regenerate the API token.`)
    }
    return parsed
}

const createApiAuth = (stateFile, options = {}) => {
    const file = path.resolve(stateFile)
    const ttlMs = options.editTokenTtlMs || EDIT_TOKEN_TTL_MS
    let state = null

    const load = () => {
        if (!state) {
            state = fs.existsSync(file) ?
                readState(file) :
                { token: randomToken(), editSecret: randomToken(), createdAt: new Date().toISOString() }
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
            save({ token: randomToken(), editSecret: randomToken(), createdAt: new Date().toISOString() })
            return state.token
        },
        checkToken: (candidate) => safeEqual(load().token, candidate || ''),
        createEditToken: (id, now = Date.now()) => {
            const payload = Buffer.from(JSON.stringify({ id, exp: now + ttlMs })).toString('base64url')
            return `${payload}.${sign(load().editSecret, payload)}`
        },
        verifyEditToken: (token, now = Date.now()) => {
            const [payload, signature] = String(token || '').split('.')
            if (!payload || !signature || !safeEqual(sign(load().editSecret, payload), signature)) {
                throw new UnauthorizedError('Invalid edit token')
            }
            let parsed
            try {
                parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
            } catch (e) {
                throw new UnauthorizedError('Invalid edit token')
            }
            if (typeof parsed.id !== 'string' || !Number.isFinite(parsed.exp) || parsed.exp < now) {
                throw new UnauthorizedError('Edit token expired')
            }
            return parsed.id
        },
    }
}

module.exports = { createApiAuth, EDIT_TOKEN_TTL_MS }
