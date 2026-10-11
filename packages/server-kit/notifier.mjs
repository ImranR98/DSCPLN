// ntfy.sh-compatible push notifications. Apps call notifyResult() after a run:
// failures always notify, successes only when notifySuccess is on.

// HTTP header values are ByteString (latin-1); a stray emoji in a title makes
// fetch throw and silently loses the notification. Replace what cannot encode.
function headerSafe(value) {
  return String(value).replace(/[^\u0000-\u00ff]/g, '?')
}

export class Notifier {
  constructor(config = {}, log = () => {}) {
    this.setConfig(config)
    this.log = log
  }

  setConfig(config = {}) {
    const ntfy = config.ntfy ?? config ?? {}
    this.url = String(ntfy.url ?? '').trim()
    this.token = String(ntfy.token ?? '').trim()
    this.notifySuccess = Boolean(ntfy.notifySuccess)
    this.click = String(config.click ?? ntfy.click ?? '').trim()
  }

  get configured() {
    return Boolean(this.url) && /^https?:\/\//i.test(this.url)
  }

  async notify(message, { title = 'D$CPLN', priority = 'default', tags = [], force = true } = {}) {
    if (!force && !this.notifySuccess) {
      return { ok: true, skipped: true }
    }
    if (!this.configured) {
      return { ok: false, error: 'ntfy URL not configured' }
    }
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
      title: `D$CPLN · ${app} ${ok ? 'OK' : 'FAILED'}`,
      priority: ok ? 'default' : 'high',
      tags: ok ? ['white_check_mark'] : ['warning'],
    })
    if (!result.ok) {
      this.log(`notification failed: ${result.error}`)
    }
    return result
  }
}
