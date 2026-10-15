// Small HTTP helpers shared by the kit and the apps' custom servers.

export function sendJson(res, code, body) {
  res.status(code).json(body)
}

// Reads a text/JSON request body with a hard size cap; rejects with a 413
// statusCode so the kit's error handler renders it like any validation error.
export function readBody(req, limit = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        // Stop reading; the error handler answers 413 while the client drains.
        req.pause()
        reject(Object.assign(new Error('request body too large'), { statusCode: 413 }))
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

// True when the request either has no Origin (same-origin fetches from the
// shell, curl) or an Origin whose host matches the request host.
export function sameOrigin(req) {
  const origin = req.headers.origin
  if (!origin) return true
  try {
    return new URL(origin).host === req.headers.host
  } catch {
    return false
  }
}

// True for hosts that should never be reachable from a user-supplied URL
// (loopback/link-local/private literals and *.local names).
export function isPrivateHost(hostname) {
  const host = String(hostname ?? '').toLowerCase().replace(/^\[|\]$/g, '')
  if (!host) return true
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return true
  if (host === '::1' || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80:')) return true
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    const [a, b] = host.split('.').map(Number)
    return a === 0 || a === 10 || a === 127 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 169 && b === 254)
  }
  return false
}

// Wraps an async route handler so rejections reach express's error handler.
export function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next)
}
