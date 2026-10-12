// Same JSON contract as the balance app's requestJson (server messages + status).
export async function requestJson(url, options = {}) {
  const headers = { Accept: 'application/json' }
  if (options.body) headers['Content-Type'] = 'application/json'
  const response = await fetch(url, { ...options, headers: { ...headers, ...options.headers } })
  const text = await response.text().catch(() => '')
  if (!response.ok) {
    let message = text.trim() || `Request failed (${response.status})`
    try {
      const parsed = JSON.parse(text)
      if (parsed && typeof parsed.error === 'string') message = parsed.error
    } catch {
      // not JSON
    }
    const error = new Error(message)
    error.status = response.status
    throw error
  }
  return text ? JSON.parse(text) : null
}
