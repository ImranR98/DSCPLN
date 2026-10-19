#!/usr/bin/env node
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  asyncRoute,
  configStore,
  createApp,
  isPrivateHost,
  Notifier,
  SECRET_MASK,
  ValidationError,
} from '@dscpln/server-kit'

// Portal: the D$CPLN root page. Always served at the host root (BASE_PATH is
// intentionally ignored); it links to every function subpath and owns the
// notification settings every app posts through (POST /api/notify).

const here = path.dirname(fileURLToPath(import.meta.url))

export const DEFAULT_FUNCTIONS = [
  { path: 'balance', icon: 'dollar', name: 'Balance XLSX', description: 'Budget dashboard backed by the live workbook', kind: 'balance' },
  { path: 'pipelines', icon: 'workflow', name: 'File Pipelines', description: 'Scheduled folder pipelines: standardize, copy, archive', kind: 'pipelines' },
  { path: 'watxt', icon: 'message', name: 'WhatsApp TXT', description: 'Browse, import and merge WhatsApp exports', kind: 'watxt' },
  { path: 'tasks', icon: 'wrench', name: 'Task Runner', description: 'Config-driven scheduled and on-demand workflows', kind: 'tasks' },
  { path: 'contacts', icon: 'contact', name: 'Contacts + Calendar', description: 'Scheduled Nextcloud exports', kind: 'scheduled' },
  { path: 'ytmusic', icon: 'music', name: 'YTMusic Downloads', description: 'Scheduled YouTube Music library downloads', kind: 'scheduled' },
]

export const DEFAULT_CONFIG = {
  ntfy: { url: '', token: '' },
  functions: DEFAULT_FUNCTIONS,
}

const MAX_MESSAGE = 4096
const MAX_TITLE = 200
const MAX_TAGS = 10
const PRIORITIES = new Set(['max', 'urgent', 'high', 'default', 'low', 'min'])

const FUNCTION_KINDS = new Set(['scheduled', 'pipelines', 'watxt', 'tasks', 'balance'])

export function normalizeFunctions(value) {
  if (!Array.isArray(value)) return DEFAULT_FUNCTIONS
  return value
    .map((entry) => (entry && typeof entry === 'object' ? entry : null))
    .filter(Boolean)
    .map((entry) => ({
      path: String(entry.path ?? '').replace(/^\/+|\/+$/g, ''),
      icon: String(entry.icon ?? 'boxes'),
      name: String(entry.name ?? entry.path ?? ''),
      description: String(entry.description ?? ''),
      kind: FUNCTION_KINDS.has(entry.kind) ? entry.kind : 'scheduled',
    }))
}

export function normalizeConfig(raw) {
  return {
    ...raw,
    ntfy: { url: '', token: '', ...(raw?.ntfy ?? {}) },
    functions: normalizeFunctions(raw?.functions),
  }
}

export function validateConfig(cfg) {
  const url = String(cfg.ntfy?.url ?? '').trim()
  if (url && !/^https?:\/\//i.test(url)) {
    throw new ValidationError('ntfy URL must start with http:// or https://')
  }
  const seen = new Set()
  for (const fn of cfg.functions ?? []) {
    if (!fn.path || !fn.name) throw new ValidationError('every function needs a path and a name')
    if (!/^[A-Za-z0-9._-]+$/.test(fn.path)) throw new ValidationError(`function path is invalid: ${fn.path}`)
    if (seen.has(fn.path)) throw new ValidationError(`duplicate function path: ${fn.path}`)
    seen.add(fn.path)
  }
}

function normalizePriority(value) {
  const priority = String(value ?? '').trim().toLowerCase()
  return PRIORITIES.has(priority) ? priority : 'default'
}

function normalizeTags(value) {
  if (!Array.isArray(value)) return []
  return value
    .map((tag) => String(tag).trim().slice(0, 32))
    .filter(Boolean)
    .slice(0, MAX_TAGS)
}

export function createPortalApp(options = {}) {
  const dataDir = options.dataDir ?? process.env.DSCPLN_DATA_DIR ?? '/data'
  const configFile = options.configFile ?? process.env.DSCPLN_CONFIG_FILE ?? path.join(dataDir, 'config.json')
  const log = options.log ?? ((line) => console.log(line))
  const port = Number(process.env.PORT ?? 8080)
  const host = process.env.HOST ?? '0.0.0.0'

  const config = configStore(configFile, {
    defaults: DEFAULT_CONFIG,
    normalize: normalizeConfig,
    validate: validateConfig,
    secrets: ['ntfy.token'],
  })

  // Resolves a request payload against the stored (or a draft) channel and
  // sends it. Returns { status, body } so callers stay thin.
  const dispatch = async (payload, { draft = null } = {}) => {
    const message = String(payload?.message ?? '').trim()
    if (!message) return { status: 400, body: { error: 'message is required' } }
    if (message.length > MAX_MESSAGE) {
      return { status: 400, body: { error: `message must be at most ${MAX_MESSAGE} characters` } }
    }
    const stored = config.get()?.ntfy ?? {}
    const url = String(draft?.url ?? '').trim() || String(stored.url ?? '').trim()
    let token = String(draft?.token ?? '').trim()
    if (!token || token === SECRET_MASK) token = String(stored.token ?? '').trim()
    if (!url) return { status: 400, body: { error: 'ntfy URL is not configured' } }
    if (!/^https?:\/\//i.test(url)) {
      return { status: 400, body: { error: 'ntfy URL must start with http:// or https://' } }
    }
    const title = String(payload.title ?? '').trim().slice(0, MAX_TITLE) || 'D$CPLN'
    const result = await new Notifier({ ntfy: { url, token }, click: payload.click }).notify(message, {
      title,
      priority: normalizePriority(payload.priority),
      tags: normalizeTags(payload.tags),
    })
    if (!result.ok) {
      log(`notification failed: ${result.error}`)
      return { status: 502, body: { error: result.error } }
    }
    return { status: 200, body: { ok: true } }
  }

  const routes = (router) => {
    // The card grid is deployment-specific: show only the apps this host
    // actually runs. The default list is the full generic suite.
    router.get('/api/functions', (req, res) => {
      res.json({ functions: config.get()?.functions ?? DEFAULT_FUNCTIONS })
    })

    // Apps relay every notification through here; the portal is the only
    // component that knows the ntfy URL and token.
    router.post('/api/notify', asyncRoute(async (req, res) => {
      const { status, body } = await dispatch(req.body ?? {})
      res.status(status).json(body)
    }))

    // Settings UI test button: may carry a not-yet-saved draft URL/token. A
    // draft may only target the configured host; any other private/LAN
    // destination is refused (SSRF guard).
    router.post('/api/notify/test', asyncRoute(async (req, res) => {
      const body = req.body ?? {}
      const draftUrl = String(body.url ?? '').trim()
      if (draftUrl) {
        let draftHost
        let configuredHost
        try {
          draftHost = new URL(draftUrl).hostname
        } catch {
          res.status(400).json({ error: 'ntfy URL is not a valid URL' })
          return
        }
        try {
          configuredHost = new URL(config.get()?.ntfy?.url ?? '').hostname
        } catch {
          configuredHost = ''
        }
        if (isPrivateHost(draftHost) && draftHost !== configuredHost) {
          res.status(400).json({ error: 'ntfy URL must not target a private address' })
          return
        }
      }
      const { status, body: result } = await dispatch(
        { message: 'Portal test notification', title: 'D$CPLN - Portal test', priority: 'low', tags: ['white_check_mark'] },
        { draft: { url: body.url, token: body.token } },
      )
      res.status(status).json(result)
    }))
  }

  const app = createApp({
    title: 'Portal',
    pageTitle: 'D$CPLN',
    basePath: '',
    staticDir: path.join(here, 'static'),
    config,
    routes,
    log,
  })

  const start = async () => {
    await config.load()
    return { config }
  }

  return { app, config, start, port, host }
}

if (process.argv[1] && import.meta.url === `file://${path.resolve(process.argv[1])}`) {
  const portal = createPortalApp()
  await portal.start()
  portal.app.listen(portal.port, portal.host, () => {
    console.log(`D$CPLN portal listening on http://${portal.host}:${portal.port}`)
  })
}
