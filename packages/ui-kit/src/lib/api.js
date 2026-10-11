// Base-path-aware URLs. Every fetch/asset URL must go through apiUrl() so the
// apps work both at the host root (local dev) and under a BASE_PATH prefix; the
// server injects <base href="<basePath>/"> into the built index.html.

export function apiUrl(path) {
  const raw = String(path ?? '')
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.startsWith('//')) {
    return raw
  }
  const clean = raw.replace(/^\/+/, '')
  if (typeof document !== 'undefined' && document.baseURI) {
    return new URL(clean, document.baseURI).toString()
  }
  return `/${clean}`
}

export async function getJson(path, { timeout = 5000, ...options } = {}) {
  const response = await fetch(apiUrl(path), { ...options, signal: AbortSignal.timeout(timeout) })
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`)
  }
  return response.json()
}

export async function postJson(path, body = {}, { timeout = 30000, ...options } = {}) {
  const response = await fetch(apiUrl(path), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeout),
    ...options,
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(data.error || data.detail || `${response.status} ${response.statusText}`)
  }
  return data
}

// SSE helper with reconnect: `onEvent(event)` receives each parsed message.
export function subscribe(basePath, onEvent, { events = 'events' } = {}) {
  let source = null
  let closed = false
  const connect = () => {
    if (closed) return
    source = new EventSource(apiUrl(`${basePath}/api/${events}`))
    source.onmessage = (message) => {
      try {
        onEvent(JSON.parse(message.data))
      } catch {
        // ignore malformed frames
      }
    }
    source.onerror = () => {
      source?.close()
      source = null
      if (!closed) setTimeout(connect, 5000)
    }
  }
  connect()
  return () => {
    closed = true
    source?.close()
  }
}
