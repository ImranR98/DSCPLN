'use strict'

import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createApiAuth } from '../api-auth.mjs'

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

test('accepts state files with extra fields from older versions', () => {
    const file = stateFile()
    fs.writeFileSync(file, JSON.stringify({ token: 'legacy-token', editSecret: 'old', createdAt: 'x' }))
    const auth = createApiAuth(file)
    assert.equal(auth.getToken(), 'legacy-token')
    assert.equal(auth.checkToken('legacy-token'), true)
})

test('refuses malformed state files instead of silently rotating', () => {
    const file = stateFile()
    fs.writeFileSync(file, 'not json')
    assert.throws(() => createApiAuth(file).getToken(), /Delete it to regenerate/)

    fs.writeFileSync(file, JSON.stringify({ createdAt: 'x' }))
    assert.throws(() => createApiAuth(file).getToken(), /Delete it to regenerate/)
})

test('atomic saves tighten permissions and leave no temp files', () => {
    const file = stateFile()
    fs.writeFileSync(file, JSON.stringify({ token: 'loose-token' }))
    fs.chmodSync(file, 0o644)
    const auth = createApiAuth(file)
    auth.regenerate()
    assert.equal(fs.statSync(file).mode & 0o777, 0o600, 'existing loose permissions are tightened')
    assert.deepEqual(fs.readdirSync(path.dirname(file)), ['api-state.json'], 'no temp files left behind')
    assert.match(JSON.parse(fs.readFileSync(file, 'utf8')).token, /^[A-Za-z0-9_-]{40,}$/)
})
