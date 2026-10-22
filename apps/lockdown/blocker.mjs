#!/usr/bin/env node
// Privileged port blocker. This process runs in a host-network pod with only
// CAP_NET_ADMIN; it never accepts a port number, path or command from the UI.

import crypto from 'node:crypto'
import http from 'node:http'
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import {
  MAX_DURATION_SECONDS,
  MIN_DURATION_SECONDS,
  PRESETS,
  validateBlockRequest,
  validateClearRequest,
} from './policy.mjs'

const execFileAsync = promisify(execFile)
const TABLE = 'dscpln_lockdown'
const SETS = {
  'vpn-only': 'vpn_only_tcp',
  'traefik-off': 'traefik_off_tcp',
  'srv0-tunnel-cut': 'tunnel_udp',
}
const TOKEN = String(process.env.PORT_BLOCKER_TOKEN ?? '')
const HOST = process.env.PORT_BLOCKER_HOST ?? '0.0.0.0'
const PORT = Number(process.env.PORT_BLOCKER_PORT ?? process.env.PORT ?? 8794)
const BODY_LIMIT = 16 * 1024
const pendingTimers = new Map()

if (!TOKEN) {
  console.error('PORT_BLOCKER_TOKEN is required')
  process.exit(1)
}

const log = (event, detail = {}) => {
  console.log(JSON.stringify({ ts: new Date().toISOString(), event, ...detail }))
}

let nftQueue = Promise.resolve()
function queueNft(fn) {
  const run = nftQueue.then(fn, fn)
  nftQueue = run.catch(() => {})
  return run
}

async function runNft(args) {
  try {
    const { stdout } = await execFileAsync('nft', args, {
      timeout: 10_000,
      maxBuffer: 1024 * 1024,
    })
    return stdout
  } catch (err) {
    const detail = String(err.stderr ?? err.message ?? '').trim()
    throw new Error(`nft ${args.join(' ')} failed${detail ? `: ${detail}` : ''}`, { cause: err })
  }
}

function runNftScript(script) {
  return new Promise((resolve, reject) => {
    const child = spawn('nft', ['-f', '-'], { stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve(stdout)
      else reject(new Error(`nft -f failed${stderr.trim() ? `: ${stderr.trim()}` : ''}`))
    })
    child.stdin.end(script)
  })
}

async function ensureTable() {
  try {
    await runNft(['list', 'table', 'inet', TABLE])
    return
  } catch {
    // Create the complete table in one transaction below.
  }
  await runNftScript(`
add table inet ${TABLE}
add set inet ${TABLE} vpn_only_tcp { type inet_service; flags timeout; }
add set inet ${TABLE} traefik_off_tcp { type inet_service; flags timeout; }
add set inet ${TABLE} tunnel_udp { type inet_service; flags timeout; }
add chain inet ${TABLE} input { type filter hook input priority -10; policy accept; }
add chain inet ${TABLE} output { type filter hook output priority -10; policy accept; }
add rule inet ${TABLE} input tcp dport @vpn_only_tcp drop
add rule inet ${TABLE} input tcp dport @traefik_off_tcp drop
add rule inet ${TABLE} output udp dport @tunnel_udp drop
`)
}

function setScript(preset, durationSeconds) {
  const setName = SETS[preset]
  const ports = PRESETS[preset].ports
  const timeout = durationSeconds == null ? '' : ` timeout ${durationSeconds}s`
  return [
    `flush set inet ${TABLE} ${setName}`,
    ...ports.map((port) => `add element inet ${TABLE} ${setName} { ${port}${timeout} }`),
  ].join('\n')
}

async function applyPreset(preset, durationSeconds) {
  return queueNft(async () => {
    await ensureTable()
    await runNftScript(setScript(preset, durationSeconds))
    log('block-applied', { preset, durationSeconds, ports: PRESETS[preset].ports })
  })
}

async function clearPreset(preset) {
  return queueNft(async () => {
    await ensureTable()
    await runNft(['flush', 'set', 'inet', TABLE, SETS[preset]])
    log('block-cleared', { preset })
  })
}

async function clearAll() {
  return queueNft(async () => {
    await ensureTable()
    for (const preset of Object.keys(SETS)) {
      await runNft(['flush', 'set', 'inet', TABLE, SETS[preset]])
    }
    log('blocks-cleared')
  })
}

function scheduleBlock(preset, durationSeconds, delaySeconds) {
  cancelPending(preset)
  const applyAt = Date.now() + delaySeconds * 1000
  if (delaySeconds <= 0) {
    return applyPreset(preset, durationSeconds).then(() => ({ applyAt: Date.now() }))
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pendingTimers.delete(preset)
      applyPreset(preset, durationSeconds).catch((err) => {
        log('block-failed', { preset, error: err.message })
      })
    }, delaySeconds * 1000)
    pendingTimers.set(preset, { timer, applyAt })
    resolve({ applyAt })
  })
}

function cancelPending(preset = null) {
  if (preset) {
    const entry = pendingTimers.get(preset)
    if (entry) clearTimeout(entry.timer)
    pendingTimers.delete(preset)
    return
  }
  for (const entry of pendingTimers.values()) clearTimeout(entry.timer)
  pendingTimers.clear()
}

function parseStatus(tableJson) {
  const now = Date.now()
  const found = new Map()
  let table = null
  try {
    const parsed = JSON.parse(tableJson)
    for (const item of parsed.nftables ?? []) {
      if (item.table?.name === TABLE) table = item.table
      if (!item.set?.name || item.set.table !== TABLE) continue
      const elements = (item.set.elem ?? []).map((entry) => {
        const value = entry.elem ?? {}
        return {
          port: Number(value.val),
          expiresAt: Number.isFinite(Number(value.expires)) ? now + Number(value.expires) * 1000 : null,
          remainingSeconds: Number.isFinite(Number(value.expires)) ? Number(value.expires) : null,
        }
      })
      found.set(item.set.name, elements)
    }
  } catch {
    // Treat an unreadable table as empty; the action API reports the real
    // nft error if the table is broken.
  }

  const presets = {}
  for (const [preset, setName] of Object.entries(SETS)) {
    const elements = found.get(setName) ?? []
    const finite = elements.filter((entry) => entry.expiresAt !== null)
    presets[preset] = {
      active: elements.length > 0,
      ports: [...new Set(elements.map((entry) => entry.port).filter(Number.isFinite))].sort((a, b) => a - b),
      expiresAt: elements.length && finite.length === elements.length
        ? Math.min(...finite.map((entry) => entry.expiresAt))
        : null,
      remainingSeconds: elements.length && finite.length === elements.length
        ? Math.min(...finite.map((entry) => entry.remainingSeconds))
        : null,
    }
  }

  const pending = {}
  for (const [preset, entry] of pendingTimers.entries()) {
    pending[preset] = { applyAt: entry.applyAt }
  }

  return {
    ok: true,
    now,
    table,
    presets,
    pending,
    limits: { minDurationSeconds: MIN_DURATION_SECONDS, maxDurationSeconds: MAX_DURATION_SECONDS },
  }
}

async function getStatus() {
  try {
    const stdout = await runNft(['-j', 'list', 'table', 'inet', TABLE])
    return parseStatus(stdout)
  } catch {
    return {
      ok: true,
      now: Date.now(),
      table: null,
      presets: Object.fromEntries(Object.keys(SETS).map((preset) => [preset, {
        active: false,
        ports: [],
        expiresAt: null,
        remainingSeconds: null,
      }])),
      pending: {},
      limits: { minDurationSeconds: MIN_DURATION_SECONDS, maxDurationSeconds: MAX_DURATION_SECONDS },
    }
  }
}

function authorized(req) {
  const header = String(req.headers.authorization ?? '')
  const expected = `Bearer ${TOKEN}`
  const actualBuffer = Buffer.from(header)
  const expectedBuffer = Buffer.from(expected)
  return actualBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(actualBuffer, expectedBuffer)
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > BODY_LIMIT) {
        req.pause()
        reject(Object.assign(new Error('request body too large'), { statusCode: 413 }))
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (!chunks.length) return resolve({})
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch {
        reject(Object.assign(new Error('invalid JSON body'), { statusCode: 400 }))
      }
    })
    req.on('error', reject)
  })
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(payload),
  })
  res.end(payload)
}

async function route(req, res) {
  if (req.method === 'GET' && req.url === '/healthz') {
    sendJson(res, 200, { ok: true })
    return
  }
  if (!authorized(req)) {
    sendJson(res, 401, { error: 'authentication required' })
    return
  }

  if (req.method === 'GET' && req.url === '/v1/status') {
    sendJson(res, 200, await getStatus())
    return
  }

  if (req.method === 'POST' && req.url === '/v1/block') {
    const body = await readBody(req)
    const request = validateBlockRequest(body)
    const delaySeconds = Math.max(0, Math.min(10, Number(body.delaySeconds ?? 0) || 0))
    const result = await scheduleBlock(request.preset, request.durationSeconds, delaySeconds)
    sendJson(res, delaySeconds > 0 ? 202 : 200, {
      ok: true,
      preset: request.preset,
      durationSeconds: request.durationSeconds,
      applyAt: result.applyAt,
    })
    return
  }

  if (req.method === 'POST' && req.url === '/v1/clear') {
    const body = await readBody(req)
    const request = validateClearRequest(body)
    cancelPending(request.preset)
    if (request.preset) await clearPreset(request.preset)
    else await clearAll()
    sendJson(res, 200, { ok: true, cleared: request.preset ?? 'all' })
    return
  }

  sendJson(res, 404, { error: 'Not found' })
}

const server = http.createServer((req, res) => {
  route(req, res).catch((err) => {
    const statusCode = err.statusCode || 500
    log('request-failed', { path: req.url, method: req.method, error: err.message })
    sendJson(res, statusCode, { error: statusCode >= 500 ? 'port blocker failed' : err.message })
  })
})

await ensureTable()
server.listen(PORT, HOST, () => {
  log('listening', { host: HOST, port: PORT })
})
