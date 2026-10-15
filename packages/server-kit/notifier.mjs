// ntfy.sh-compatible push notifications. Apps post to the portal relay
// (DSCPLN_PORTAL_URL), which holds the ntfy URL + token and forwards; the
// portal itself posts directly to ntfy. Apps call notifyResult() after a run:
// failures always notify, successes only when notifySuccess is on.

// HTTP header values are ByteString (latin-1) and clients decode them loosely:
// even latin-1 high bytes (e.g. "·") can arrive as replacement characters. Keep
// header values printable ASCII; anything else is replaced so the notification
// itself is never lost.
function headerSafe(value) {
  return String(value).replace(/[^\u0020-\u007e]/g, '?')
}

export class Notifier {
  constructor(config = {}, log = () => {}) {
    this.log = log
    this.setConfig(config)
  }

  setConfig(config = {}) {
    const ntfy = config.ntfy ?? {}
    this.url = String(ntfy.url ?? '').trim()
    this.token = String(ntfy.token ?? '').trim()
    // When relayUrl is set the app sends to the portal instead of ntfy; the
    // portal is the only place that knows the ntfy URL + token.
    this.relayUrl = String(config.relayUrl ?? ntfy.relayUrl ?? '').trim().replace(/\/+$/, '')
    this.notifySuccess = Boolean(config.notifySuccess ?? ntfy.notifySuccess)
    this.app = String(config.app ?? ntfy.app ?? '').trim()
    this.click = String(config.click ?? ntfy.click ?? '').trim()
  }

  // Configured means there is somewhere to send: the portal relay (apps) or
  // the ntfy endpoint itself (portal).
  get configured() {
    return /^https?:\/\//i.test(this.relayUrl) || /^https?:\/\//i.test(this.url)
  }

  async notify(message, { title = 'D$CPLN', priority = 'default', tags = [], force = true } = {}) {
    if (!force && !this.notifySuccess) {
      return { ok: true, skipped: true }
    }
    if (!this.configured) {
      return {
        ok: false,
        error: this.relayUrl || this.url
          ? 'notification endpoint URL is invalid'
          : 'notifications are not configured',
      }
    }
    if (this.relayUrl) return this.#notifyRelay(message, { title, priority, tags })
    return this.#notifyNtfy(message, { title, priority, tags })
  }

  async #notifyRelay(message, { title, priority, tags }) {
    try {
      const payload = {
        message: String(message),
        title: title ? String(title) : undefined,
        priority: String(priority),
        tags: tags.map(String),
        click: /^https?:\/\//i.test(this.click) ? this.click : undefined,
        app: this.app || undefined,
      }
      const response = await fetch(`${this.relayUrl}/api/notify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10_000),
      })
      if (!response.ok) {
        const text = await response.text().catch(() => '')
        let detail = text.trim()
        try {
          detail = JSON.parse(text).error || detail
        } catch {
          // keep the raw text
        }
        return { ok: false, error: `notification relay returned ${response.status}${detail ? `: ${detail}` : ''}` }
      }
      return { ok: true }
    } catch (err) {
      return { ok: false, error: `notification relay request failed: ${err.message}` }
    }
  }

  async #notifyNtfy(message, { title, priority, tags }) {
    try {
      const headers = { 'Content-Type': 'text/plain' }
      if (title) headers['Title'] = headerSafe(title)
      if (priority) headers['Priority'] = String(priority)
      if (tags.length) headers['Tags'] = tags.join(',')
      if (this.click && /^https?:\/\//i.test(this.click)) headers['Click'] = headerSafe(this.click)
      if (this.token) headers['Authorization'] = `Bearer ${this.token}`
      const response = await fetch(this.url, {
        method: 'POST',
        headers,
        body: String(message),
        signal: AbortSignal.timeout(10_000),
      })
      if (!response.ok) {
        const text = await response.text().catch(() => '')
        return { ok: false, error: `ntfy returned ${response.status}${text ? `: ${text.trim()}` : ''}` }
      }
      return { ok: true }
    } catch (err) {
      return { ok: false, error: `ntfy request failed: ${err.message}` }
    }
  }

  // Standard post-run notification: failures always go out; successes only
  // when configured. Notification errors are logged, never thrown.
  async notifyResult({ ok, app, summary }) {
    const send = !ok || this.notifySuccess
    if (!send) return { ok: true, skipped: true }
    const result = await this.notify(summary || (ok ? 'Completed' : 'Failed'), {
      title: `D$CPLN - ${app} ${ok ? 'OK' : 'FAILED'}`,
      priority: ok ? 'default' : 'high',
      tags: ok ? ['white_check_mark'] : ['warning'],
    })
    if (!result.ok) {
      this.log(`notification failed: ${result.error}`)
    }
    return result
  }
}
