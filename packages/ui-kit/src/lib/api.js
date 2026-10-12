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

// Thrown by every request helper; carries the HTTP status so callers can
// special-case conflicts (409) and auth failures (401).
export class ApiError extends Error {
  constructor(message, status = 0) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

async function toError(response) {
  const text = await response.text().catch(() => '')
  let message = text.trim()
  if (message) {
    try {
      const parsed = JSON.parse(message)
      message = parsed?.error || parsed?.detail || message
    } catch {
      // plain-text body: keep it as the message
    }
  }
  if (!message) message = `${response.status} ${response.statusText}`
  return new ApiError(message, response.status)
}

async function parseBody(response) {
  const text = await response.text()
  return text ? JSON.parse(text) : null
}

export async function getJson(path, { timeout = 5000, ...options } = {}) {
  const response = await fetch(apiUrl(path), { ...options, signal: AbortSignal.timeout(timeout) })
  if (!response.ok) throw await toError(response)
  return parseBody(response)
}

export async function postJson(path, body = {}, { timeout = 30000, ...options } = {}) {
  return sendJson('POST', path, body, { timeout, ...options })
}

export async function putJson(path, body = {}, { timeout = 30000, ...options } = {}) {
  return sendJson('PUT', path, body, { timeout, ...options })
}

export async function deleteJson(path, { timeout = 30000, ...options } = {}) {
  return sendJson('DELETE', path, null, { timeout, ...options })
}

async function sendJson(method, path, body, { timeout = 30000, ...options } = {}) {
  const response = await fetch(apiUrl(path), {
    method,
    headers: body == null ? undefined : { 'Content-Type': 'application/json' },
    body: body == null ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeout),
    ...options,
  })
  if (!response.ok) throw await toError(response)
  return parseBody(response)
}

// Uploads a file with progress (XHR; fetch cannot report upload progress).
// The returned promise also carries `.abort()` for cancel buttons.
export function uploadFile(path, file, { onProgress } = {}) {
  let xhr
  const promise = new Promise((resolve, reject) => {
    xhr = new XMLHttpRequest()
    xhr.open('POST', apiUrl(path))
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) onProgress?.(event.loaded / event.total)
    }
    xhr.onload = () => {
      let data = null
      try {
        data = JSON.parse(xhr.responseText || 'null')
      } catch {
        // non-JSON response: keep null
      }
      if (xhr.status >= 400) {
        reject(new ApiError(data?.error || data?.detail || `HTTP ${xhr.status}`, xhr.status))
      } else {
        resolve(data)
      }
    }
    xhr.onabort = () => reject(new ApiError('Upload cancelled', 0))
    xhr.onerror = () => reject(new ApiError(`Upload of ${file.name} failed`, 0))
    xhr.send(file)
  })
  promise.abort = () => xhr?.abort()
  return promise
}

// True when the endpoint answers successfully; used for portal status tiles.
export async function ping(path, { timeout = 5000 } = {}) {
  try {
    const response = await fetch(apiUrl(path), { signal: AbortSignal.timeout(timeout) })
    return response.ok
  } catch {
    return false
  }
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
