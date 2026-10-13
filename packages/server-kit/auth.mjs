// Proxy-identity guard shared by every app.
//
// In deployments every request reaches an app through Traefik + Authelia,
// which stamps Remote-User (traefik.yaml forwards it after a successful
// login). Requiring the header means a request that bypasses the proxy — a
// direct-in-cluster client, a new ingress route missing the middleware — is
// refused even though the app itself has no login of its own.
//
// AUTH_MODE=proxy-header enables the guard. Unset/"off" keeps the historical
// behaviour for local development. Health endpoints stay exempt so kubelet
// probes (which never pass through Traefik) keep working.

export function isAuthorized(req, { header = 'Remote-User', exempt = [] } = {}) {
  const path = req.path || ''
  for (const entry of exempt) {
    const clean = String(entry).trim()
    if (!clean) continue
    // Exact, base-path-suffixed (…/api/health) or a path prefix segment
    // (entry /api exempts /balance/api/…).
    if (path === clean || path.endsWith(clean) || path.includes(`${clean}/`)) return true
  }
  const value = req.headers[String(header).toLowerCase()]
  return typeof value === 'string' && value.trim() !== ''
}

export function proxyAuth(config) {
  return (req, res, next) => {
    if (req.method === 'OPTIONS') return next()
    if (isAuthorized(req, config)) return next()
    res.status(401).json({ error: 'authentication required' })
  }
}

export function authFromEnv(env = process.env) {
  const mode = String(env.AUTH_MODE ?? '').toLowerCase()
  if (!mode || mode === 'off') return null
  if (mode !== 'proxy-header') {
    throw new Error(`AUTH_MODE "${env.AUTH_MODE}" is not supported (use "proxy-header" or "off")`)
  }
  const extra = String(env.AUTH_EXEMPT_PATHS || '').split(',').map((entry) => entry.trim()).filter(Boolean)
  return {
    header: env.AUTH_HEADER || 'Remote-User',
    exempt: ['/api/health', ...extra],
  }
}
