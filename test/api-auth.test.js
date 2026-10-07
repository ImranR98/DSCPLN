'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { createApiAuth } = require('../api-auth')
const { UnauthorizedError } = require('../errors')

const stateFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dscpln-api-')), 'api-state.json')

test('creates, persists and checks a single token', () => {
    const file = stateFile()
    const token = createApiAuth(file).getToken()
    assert.match(token, /^[A-Za-z0-9_-]{40,}$/)
    assert.equal(fs.statSync(file).mode & 0o777, 0o600)

    const second = createApiAuth(file)
    assert.equal(second.getToken(), token)
    assert.equal(second.checkToken(token), true)
    assert.equal(second.checkToken('nope'), false)
    assert.equal(second.checkToken(''), false)
    assert.equal(second.checkToken(undefined), false)
})

test('regenerating rotates the token and invalidates the old one', () => {
    const auth = createApiAuth(stateFile())
    const before = auth.getToken()
    const after = auth.regenerate()
    assert.notEqual(after, before)
    assert.equal(auth.checkToken(before), false)
    assert.equal(auth.checkToken(after), true)
})

test('edit tokens verify, expire and reject tampering', () => {
    const auth = createApiAuth(stateFile())
    const token = auth.createEditToken('42-abcdef123456', 1000)
    assert.equal(auth.verifyEditToken(token, 1000), '42-abcdef123456')
    assert.throws(() => auth.verifyEditToken(`${token}x`, 1000), UnauthorizedError)
    assert.throws(() => auth.verifyEditToken('garbage', 1000), UnauthorizedError)
    assert.throws(() => auth.verifyEditToken(token, 1000 + 25 * 60 * 60 * 1000), UnauthorizedError)
})

test('regenerating invalidates outstanding edit tokens', () => {
    const auth = createApiAuth(stateFile())
    const token = auth.createEditToken('42-abcdef123456', 1000)
    auth.regenerate()
    assert.throws(() => auth.verifyEditToken(token, 1000), UnauthorizedError)
})

test('refuses a malformed state file instead of silently rotating', () => {
    const file = stateFile()
    fs.writeFileSync(file, 'not json')
    assert.throws(() => createApiAuth(file).getToken(), /Delete it to regenerate/)
})
