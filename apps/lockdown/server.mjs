#!/usr/bin/env node
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { asyncRoute, createApp } from '@dscpln/server-kit'
import {
  DEFAULT_CONFIG_PATH,
  addDerived,
  loadConfig,
  validateBlockRequest,
  validateClearRequest,
  validateConfig,
} from './config.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))

export function createLockdownApp(options = {}) {
  const blockerUrl = String(
    options.blockerUrl ?? process.env.PORT_BLOCKER_URL ?? 'http://127.0.0.1:8794',
  ).replace(/\/+$/, '')
  const blockerToken = String(options.blockerToken ?? process.env.PORT_BLOCKER_TOKEN ?? '')
  const fetchImpl = options.fetchImpl ?? fetch
  const basePath = options.basePath ?? process.env.BASE_PATH ?? ''
  const log = options.log ?? ((line) => console.log(line))
  const port = Number(options.port ?? process.env.PORT ?? 8086)
  const host = options.host ?? process.env.HOST ?? '0.0.0.0'
  const config = options.config ?? (options.presets
    ? addDerived(validateConfig({ presets: options.presets }))
    : loadConfig(options.configFile ?? process.env.LOCKDOWN_CONFIG ?? DEFAULT_CONFIG_PATH))

  if (!blockerToken) throw new Error('PORT_BLOCKER_TOKEN is required')

  async function callBlocker(pathname, body) {
    let response
    try {
      response = await fetchImpl(`${blockerUrl}${pathname}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          Authorization: `Bearer ${blockerToken}`,
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(10_000),
      })
    } catch (err) {
      const error = new Error(`port blocker unavailable: ${err.message}`)
      error.statusCode = 502
      throw error
    }
    const text = await response.text()
    let payload
    try {
      payload = text ? JSON.parse(text) : {}
    } catch {
      payload = { error: text.slice(0, 500) }
    }
    if (!response.ok) {
      const error = new Error(payload.error || `port blocker responded ${response.status}`)
      error.statusCode = 502
      throw error
    }
    return payload
  }

  const routes = (router) => {
    router.get('/api/status', asyncRoute(async (req, res) => {
      const result = await callBlocker('/v1/status')
      const active = result.presets ?? {}
      res.json({
        ...result,
        limits: config.limits,
        presets: config.presets.map((preset) => ({
          ...preset,
          active: Boolean(active[preset.id]?.active),
          activePorts: active[preset.id]?.ports ?? [],
          expiresAt: active[preset.id]?.expiresAt ?? null,
          remainingSeconds: active[preset.id]?.remainingSeconds ?? null,
        })),
      })
    }))

    router.post('/api/block', asyncRoute(async (req, res) => {
      let request
      try {
        request = validateBlockRequest(config, req.body ?? {})
      } catch (err) {
        err.statusCode = 400
        throw err
      }
      const result = await callBlocker('/v1/block', { ...request, delaySeconds: 3 })
      res.status(202).json(result)
    }))

    router.post('/api/clear', asyncRoute(async (req, res) => {
      let request
      try {
        request = validateClearRequest(config, req.body ?? {})
      } catch (err) {
        err.statusCode = 400
        throw err
      }
      const result = await callBlocker('/v1/clear', request)
      res.json(result)
    }))
  }

  const app = createApp({
    title: 'Lockdown',
    basePath,
    staticDir: path.join(here, 'static'),
    routes,
    auth: options.auth,
    log,
    healthExtra: () => ({ blocker: 'configured', presets: config.presets.length }),
  })

  return { app, port, host, config, start: async () => {} }
}

if (process.argv[1] && import.meta.url === `file://${path.resolve(process.argv[1])}`) {
  const lockdown = createLockdownApp()
  await lockdown.start()
  lockdown.app.listen(lockdown.port, lockdown.host, () => {
    console.log(`D$CPLN lockdown listening on http://${lockdown.host}:${lockdown.port}`)
  })
}
