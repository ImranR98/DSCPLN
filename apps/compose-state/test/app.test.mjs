import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { once } from 'node:events'
import { createComposeApp } from '../server.mjs'

const stubCommands = () => [[process.execPath, '-e', 'console.log("stub: backed up")']]

async function withApp(fn, options = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'compose-app-'))
  const app = createComposeApp({ dataDir, basePath: '', commands: stubCommands, ...options })
  await app.start()
  const server = app.app.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const base = `http://127.0.0.1:${server.address().port}`
  try {
    await fn({ base, app, dataDir })
  } finally {
    app.stop()
    await new Promise((resolve) => server.close(resolve))
    fs.rmSync(dataDir, { recursive: true, force: true })
  }
}

test('first boot generates an SSH key and serves the standard API', async () => {
  await withApp(async ({ base, app, dataDir }) => {
    const state = await (await fetch(`${base}/api/state`)).json()
    assert.ok(state.config.sshPublicKey.startsWith('ssh-ed25519 '), 'public key generated')
    assert.equal(state.config.sshPrivateKey.startsWith('-----BEGIN OPENSSH PRIVATE KEY-----'), true)
    assert.equal(state.run.running, false)
    assert.ok(state.nextRun)

    const configStat = await fs.promises.stat(path.join(dataDir, 'config.json'))
    assert.equal(configStat.mode & 0o777, 0o600, 'config with the private key is mode 0600')
  })
})

test('regenerating the key replaces both halves', async () => {
  await withApp(async ({ base, app }) => {
    const before = app.config.get().sshPublicKey
    const res = await fetch(`${base}/api/key/regenerate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
    assert.equal(res.status, 200)
    const { sshPublicKey } = await res.json()
    assert.notEqual(sshPublicKey, before)
    assert.equal(app.config.get().sshPublicKey, sshPublicKey)
  })
})

test('archives endpoint lists per-target archives', async () => {
  await withApp(async ({ base, app, dataDir }) => {
    const destination = path.join(dataDir, 'backups')
    fs.mkdirSync(destination, { recursive: true })
    fs.writeFileSync(path.join(destination, 'srv0-backup-20260101_000000.tar'), 'x')
    fs.writeFileSync(path.join(destination, 'vps0-backup-20260201_000000.tar'), 'yy')
    await fetch(`${base}/api/config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ destination }),
    })
    const body = await (await fetch(`${base}/api/archives`)).json()
    assert.equal(body.entries.length, 2)
    const srv0 = body.entries.find((entry) => entry.name.startsWith('srv0-'))
    assert.equal(srv0.target, 'srv0')
    assert.equal(srv0.size, 1)
    assert.equal(body.entries[0].name, 'vps0-backup-20260201_000000.tar', 'newest first')
  })
})

test('config validation enforces targets and retention', async () => {
  await withApp(async ({ base }) => {
    const badTargets = await fetch(`${base}/api/config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targets: [] }),
    })
    assert.equal(badTargets.status, 400)
    assert.match((await badTargets.json()).error, /at least one target/)

    const badSsh = await fetch(`${base}/api/config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targets: [{ name: 'x', mode: 'ssh', path: '/x' }] }),
    })
    assert.equal(badSsh.status, 400)
    assert.match((await badSsh.json()).error, /need a host/)

    const dupes = await fetch(`${base}/api/config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targets: [{ name: 'x', mode: 'local', path: '/x' }, { name: 'x', mode: 'local', path: '/y' }] }),
    })
    assert.equal(dupes.status, 400)
    assert.match((await dupes.json()).error, /duplicate target/)
  })
})

test('run records state and streams the log under BASE_PATH', async () => {
  await withApp(async ({ base }) => {
    const run = await fetch(`${base}/compose/api/run`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
    assert.equal(run.status, 200)
    const state = await waitFor(async () => {
      const body = await (await fetch(`${base}/compose/api/state`)).json()
      return body.lastRun ? body : null
    })
    assert.equal(state.lastRun.ok, true)
    assert.match(state.lastRun.summary, /Backed up 2 target/)
    const log = await (await fetch(`${base}/compose/api/log`)).json()
    assert.ok(log.lines.some((line) => line.includes('stub: backed up')))
  }, { basePath: '/compose' })
})

async function waitFor(fn, timeoutMs = 10_000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const value = await fn()
    if (value) return value
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error('timeout waiting for condition')
}
