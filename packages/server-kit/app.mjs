import express from 'express'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { sameOrigin } from './http.mjs'

// Express app factory shared by every D$CPLN app.
//
// Responsibilities:
//   - mount app routes + static files under BASE_PATH ('' locally, '/media' in
//     k8s) so one host can serve every function as a subpath;
//   - serve the ui-kit at `<basePath>/ui/*`;
//   - inject `<base href>` + `window.DSCPLN_BASE` into served HTML;
//   - CSRF origin check for mutating requests;
//   - standard /api routes (state, config, run, cancel, pause, log, events,
//     health) for apps that provide the matching kit components;
//   - JSON errors for API paths, text errors otherwise.

const KIT_DIR = path.dirname(fileURLToPath(import.meta.url))
const DEFAULT_UI_DIR = path.resolve(KIT_DIR, '..', 'ui-kit')

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

export function csrfGuard(req, res, next) {
  if (MUTATING.has(req.method) && !sameOrigin(req)) {
    return res.status(403).json({ error: 'cross-origin request rejected' })
  }
  next()
}

function injectHtml(html, { basePath, title, extraHead = '' }) {
  const base = basePath ? `${basePath.replace(/\/+$/, '')}/` : '/'
  const tags = [
    `<base href="${base}">`,
    `<script>window.DSCPLN_BASE=${JSON.stringify(basePath || '')};</script>`,
    extraHead,
  ].filter(Boolean).join('\n')
  let out = html
  if (title && /<title\b[^>]*>[\s\S]*?<\/title>/i.test(out)) {
    out = out.replace(/<title\b[^>]*>[\s\S]*?<\/title>/i, `<title>${escapeHtml(title)}</title>`)
  }
  if (/<head\b[^>]*>/i.test(out)) {
    out = out.replace(/<head\b([^>]*)>/i, (m, attrs) => `<head${attrs}>\n${tags}`)
  } else {
    out = `${tags}\n${out}`
  }
  return out
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[ch])
}

// Serves *.html (and extensionless paths that map to `<name>.html`) from
// `dir` with the base tag injection applied. Non-HTML requests fall through
// to express.static.
export function htmlPages(dir, { basePath = '', title = '', extraHead = '' } = {}) {
  const root = path.resolve(dir)
  return async (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next()
    // Malformed percent-encoding (`/%`) must not throw: Express 4 does not
    // catch async middleware rejections, so this would crash the process.
    let rel
    try {
      rel = decodeURIComponent(req.path)
    } catch {
      return res.status(400).send('Bad request')
    }
    if (rel === '/' || rel === '') rel = '/index.html'
    else if (rel.endsWith('/')) rel = `${rel}index.html`
    else if (!path.extname(rel)) rel = `${rel}.html`
    if (!rel.endsWith('.html')) return next()
    const resolved = path.resolve(root, `.${path.posix.normalize(rel)}`)
    if (resolved !== root && !resolved.startsWith(root + path.sep)) return next()
    let html
    try {
      html = await fsp.readFile(resolved, 'utf8')
    } catch {
      return next()
    }
    res.type('html').send(injectHtml(html, { basePath, title, extraHead }))
  }
}

export function createApp(options = {}) {
  const {
    title = 'D$CPLN',
    pageTitle,
    basePath = '',
    staticDir = null,
    uiDir = DEFAULT_UI_DIR,
    routes = null,
    config = null,
    state = null,
    runner = null,
    run = null,
    bodyLimit = '1mb',
    jsonBody = true,
    allowPause = Boolean(state),
    events = null,
    stateExtra = null,
    healthExtra = null,
    log = () => {},
  } = options

  const normalizedBase = basePath && basePath !== '/' ? basePath.replace(/\/+$/, '') : ''
  // pageTitle: undefined -> `D$CPLN ⋅ <title>`; a string overrides; null keeps
  // the page's own <title> (apps with several pages manage their own).
  const resolvedPageTitle = pageTitle === undefined ? `D$CPLN ⋅ ${title}` : pageTitle
  const app = express()
  app.disable('x-powered-by')
  app.set('trust proxy', true)
  app.use(csrfGuard)
  if (jsonBody) {
    app.use(express.json({ limit: bodyLimit, type: ['application/json'] }))
  }

  const router = express.Router()

  if (staticDir) {
    router.use(htmlPages(staticDir, { basePath: normalizedBase, title: resolvedPageTitle }))
    router.use(express.static(staticDir, { index: false, dotfiles: 'ignore' }))
  }
  if (uiDir) {
    router.use('/ui', express.static(uiDir, { maxAge: '1d', fallthrough: true }))
  }

  // App-specific routes first: they can override any standard route.
  if (routes) {
    routes(router)
  }

  const api = express.Router()

  if (config || state || runner) {
    api.get('/state', async (req, res) => {
      const body = {
        ...(state ? state.snapshot() : {}),
        ...(config ? { config: config.public?.() ?? config.get() } : {}),
        run: runner ? runner.status() : null,
      }
      if (stateExtra) Object.assign(body, await stateExtra())
      res.json(body)
    })
  }

  if (config) {
    api.get('/config', (req, res) => {
      res.json(config.public?.() ?? config.get())
    })
    api.put('/config', async (req, res, next) => {
      try {
        const saved = await config.save(req.body ?? {})
        res.json(config.public?.() ?? saved)
      } catch (err) {
        next(err)
      }
    })
  }

  if (run) {
    api.post('/run', async (req, res, next) => {
      try {
        if (runner?.running) {
          res.status(409).json({ error: 'A run is already active' })
          return
        }
        const result = await run({ trigger: 'manual', body: req.body ?? {} })
        res.json({ started: true, result: result ?? null })
      } catch (err) {
        next(err)
      }
    })
  }

  if (runner) {
    api.post('/cancel', (req, res) => {
      const cancelled = runner.cancel()
      res.json({ cancelled })
    })
    api.get('/log', (req, res) => {
      const limit = Number(req.query.limit ?? 200)
      res.json({ lines: runner.recent(Number.isFinite(limit) ? limit : 200), running: runner.running })
    })
  }

  if (state && allowPause) {
    api.post('/pause', async (req, res, next) => {
      try {
        await state.setPaused(req.body?.paused)
        res.json({ paused: state.snapshot().paused })
      } catch (err) {
        next(err)
      }
    })
  }

  api.get('/health', (req, res) => {
    res.json({ ok: true, app: title, basePath: normalizedBase, ...(healthExtra ? healthExtra() : {}) })
  })

  if ((state || runner || config) && events !== false) {
    const clients = new Set()
    const broadcast = (payload) => {
      const frame = `data: ${JSON.stringify(payload)}\n\n`
      for (const client of clients) {
        try {
          client.write(frame)
        } catch {
          clients.delete(client)
        }
      }
    }
    api.get('/events', (req, res) => {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-store',
        Connection: 'keep-alive',
      })
      res.write(`data: ${JSON.stringify({ type: 'hello' })}\n\n`)
      clients.add(res)
      req.on('close', () => clients.delete(res))
    })
    if (runner) {
      runner.onLine((line) => broadcast({ type: 'line', line }))
      runner.onState((status) => broadcast({ type: 'run', run: status }))
    }
    if (state) {
      state.onChange(() => broadcast({ type: 'state', state: state.snapshot() }))
    }
    if (config) {
      config.onChange(() => broadcast({ type: 'config', config: config.public?.() ?? config.get() }))
    }
    app.locals.broadcast = broadcast
  }

  router.use('/api', api)

  // Root-level health alias for probes that do not know the base path. Only
  // registered when the app is mounted at a prefix; at the root the router's
  // /api/health (which apps may override) answers instead.
  if (normalizedBase) {
    app.get('/api/health', (req, res) => {
      res.json({ ok: true, app: title, basePath: normalizedBase })
    })
  }

  app.use(normalizedBase || '/', router)

  app.use((req, res) => {
    const apiPrefix = `${normalizedBase}/api`
    if (req.path.startsWith(`${apiPrefix}/`) || req.path === apiPrefix) {
      res.status(404).json({ error: 'Not found' })
      return
    }
    res.status(404).send('Not found')
  })

  // JSON errors for API paths, plain text otherwise (matches the balance app's
  // historical behaviour).
  app.use((err, req, res, next) => {
    const apiPrefix = `${normalizedBase}/api/`
    const isApi = req.path.startsWith(apiPrefix) || req.path.startsWith('/api/')
    if (res.headersSent) return next(err)
    if (err.type === 'entity.parse.failed') {
      if (isApi) res.status(400).json({ error: 'Invalid JSON body' })
      else res.status(400).send('Invalid JSON body')
      return
    }
    const statusCode = err.statusCode || err.status || 500
    if (isApi) {
      if (statusCode >= 500) log(`error: ${err.stack ?? err.message}`)
      const body = { error: statusCode >= 500 && !err.statusCode ? 'Internal server error' : err.message }
      if (err.suggestions) body.suggestions = err.suggestions
      res.status(statusCode).json(body)
      return
    }
    if (err.statusCode) {
      res.status(err.statusCode).send(err.message)
      return
    }
    log(`error: ${err.stack ?? err.message}`)
    res.status(500).send('Internal server error')
  })

  return app
}
