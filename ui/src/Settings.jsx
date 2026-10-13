import { useEffect, useRef, useState } from 'react'
import { ChartNoAxesColumn, LayoutDashboard } from 'lucide-react'
import { getJson, postJson, showToast, ThemeToggle, Toasts } from '@dscpln/ui-kit'


/* ---------- API reference export ---------- */

const cleanText = (value) => value.replace(/\s+/g, ' ').trim()

// Renders inline markup (code pills) as backticks.
const inlineMarkdown = (node) => [...node.childNodes].map((child) => {
  if (child.nodeType === Node.TEXT_NODE) {
    return child.textContent
  }
  if (child.tagName === 'CODE') {
    return `\`${child.textContent}\``
  }
  return inlineMarkdown(child)
}).join('')

const tableMarkdown = (table) => {
  const rows = [...table.rows].map((row) => [...row.cells].map((cell) => cleanText(inlineMarkdown(cell))))
  return [
    `| ${rows[0].join(' | ')} |`,
    `| ${rows[0].map(() => '---').join(' | ')} |`,
    ...rows.slice(1).map((row) => `| ${row.join(' | ')} |`),
  ].join('\n')
}

export default function Settings() {
  const tokenInputRef = useRef(null)
  const referenceRef = useRef(null)
  const [token, setToken] = useState('')
  const [regenerating, setRegenerating] = useState(false)

  const origin = typeof location !== 'undefined' ? location.origin : ''
  const example = `curl -X POST ${origin}/api/transactions \\
  -H "Authorization: Bearer ${token}" \\
  -H "Content-Type: application/json" \\
  -d '{"amount":-12.34,"details":"Groceries","currency":"CAD","category":"Food Weekly"}'`
  const listExampleText = `curl ${origin}/api/categories \\
  -H "Authorization: Bearer $API_TOKEN"`
  const scoreExampleText = `curl -G ${origin}/api/categories \\
  -H "Authorization: Bearer $API_TOKEN" \\
  --data-urlencode "details=Coffee beans" \\
  --data-urlencode "kind=expense"`

  // Serializes the visible reference card, swapping the live token for a
  // placeholder so the copied Markdown is safe to share.
  const referenceMarkdown = () => {
    const blocks = [...referenceRef.current.children]
      .filter((node) => node.matches('h3, p, pre, table'))
      .map((node) => {
        if (node.tagName === 'H3') {
          return `## ${cleanText(node.textContent)}`
        }
        if (node.tagName === 'PRE') {
          return `\`\`\`sh\n${node.textContent.trim()}\n\`\`\``
        }
        if (node.tagName === 'TABLE') {
          return tableMarkdown(node)
        }
        return cleanText(inlineMarkdown(node))
      })
    const markdown = `# D$CPLN API reference\n\n${blocks.join('\n\n')}\n`
    return token ? markdown.replaceAll(token, '$API_TOKEN') : markdown
  }

  const load = async () => {
    try {
      const result = await getJson('/token')
      setToken(result.token)
    } catch (e) {
      console.error(e)
      showToast('Could not load the API token', 'error')
    }
  }

  const copyToken = async () => {
    try {
      await navigator.clipboard.writeText(tokenInputRef.current.value)
      showToast('Token copied')
    } catch (e) {
      tokenInputRef.current.select()
      showToast('Press Ctrl/Cmd+C to copy the selected token', 'error')
    }
  }

  const copyReference = async () => {
    try {
      await navigator.clipboard.writeText(referenceMarkdown())
      showToast('API reference copied as Markdown')
    } catch (e) {
      console.error(e)
      showToast('Could not copy the API reference', 'error')
    }
  }

  const regenerate = async () => {
    if (!window.confirm('Regenerate the API token? The current token will stop working.')) {
      return
    }
    setRegenerating(true)
    try {
      const result = await postJson('/token/regenerate', {})
      setToken(result.token)
      showToast('API token regenerated')
    } catch (e) {
      console.error(e)
      showToast('Could not regenerate the API token', 'error')
    } finally {
      setRegenerating(false)
    }
  }

  useEffect(() => {
    load().finally(() => document.body.classList.remove('is-loading'))
  }, [])

  return (
    <>
      <header className="app-header">
        <div className="app-header__top">
          <h1><a className="app-header__brand" href="/">D<span className="accent">$</span>CPLN <span className="app-header__app">⋅ Balance XLSX</span></a></h1>
          <div className="app-header__actions">
            <a role="button" className="outline secondary icon-button" href="./" title="Dashboard" aria-label="Dashboard">
              <LayoutDashboard size={16} strokeWidth={1.8} />
            </a>
            <a role="button" className="outline secondary icon-button" href="insights" title="Insights" aria-label="Insights">
              <ChartNoAxesColumn size={16} strokeWidth={1.8} />
            </a>
            <ThemeToggle />
          </div>
        </div>
        <div className="app-header__meta">
          <span>API settings</span>
        </div>
      </header>

      <main>
        <section className="card">
          <div className="card__header">
            <h2>API token</h2>
          </div>
          <p className="hint">
            Send this token as <code>Authorization: Bearer &lt;token&gt;</code> on every request. Regenerating
            invalidates the old token immediately.
          </p>
          <div className="token-row">
            <input ref={tokenInputRef} type="text" readOnly spellCheck="false" aria-label="API token" value={token} onChange={() => {}} />
            <button className="outline secondary" onClick={copyToken}>Copy</button>
            <button className="danger" disabled={regenerating} onClick={regenerate}>Regenerate</button>
          </div>
        </section>

        <section className="card" ref={referenceRef} id="apiReference">
          <div className="card__header">
            <h2>API reference</h2>
            <span className="card__header-tools">
              <button className="outline secondary" onClick={copyReference}>Copy as Markdown</button>
            </span>
          </div>
          <p className="hint">
            The external API lives under <code>/api/</code> (reachable without SSO). Every request needs
            <code>Authorization: Bearer &lt;token&gt;</code> and uses JSON bodies; it only supports these two
            calls.
          </p>

          <h3 className="api-heading">Find a category</h3>
          <p><code>GET /api/categories?details=&lt;text&gt;&amp;kind=expense|income</code></p>
          <p className="hint">
            Returns every category for the kind, grouped as in the Constants sheet and best match
            first, each with a score between <code>0</code> and <code>1</code> (<code>0</code> means no
            match). Without <code>details</code> the list is un-scored, and without <code>kind</code> it
            returns every group — so a plain <code>GET /api/categories</code> is the "list categories"
            call.
          </p>
          <pre className="code-block">{listExampleText}</pre>
          <pre className="code-block">{scoreExampleText}</pre>

          <h3 className="api-heading">Add a transaction</h3>
          <p><code>POST /api/transactions</code></p>
          <div className="table-wrap">
          <table className="api-table">
            <thead>
              <tr>
                <th>Field</th>
                <th>Required</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><code>amount</code></td>
                <td>yes</td>
                <td>Signed: negative is an expense, positive is income; <code>0</code> is rejected.</td>
              </tr>
              <tr>
                <td><code>details</code></td>
                <td>yes</td>
                <td>The description; also used for category suggestions.</td>
              </tr>
              <tr>
                <td><code>currency</code></td>
                <td>yes</td>
                <td>One of the currencies listed in the Constants sheet.</td>
              </tr>
              <tr>
                <td><code>date</code></td>
                <td>no</td>
                <td><code>YYYY-MM-DD</code>; defaults to today.</td>
              </tr>
              <tr>
                <td><code>notes</code></td>
                <td>no</td>
                <td>Optional single line.</td>
              </tr>
              <tr>
                <td><code>category</code></td>
                <td>yes</td>
                <td>A category from the Constants sheet that fits the transaction's kind.</td>
              </tr>
            </tbody>
          </table>
          </div>
          <pre className="code-block">{example}</pre>
          <p className="hint">
            The response is <code>201 {'{"transaction":{...}}'}</code>; a category that doesn't fit the
            transaction's kind (or the missing kind on the categories call) is a <code>400</code>.
          </p>

          <h3 className="api-heading">Errors</h3>
          <div className="table-wrap">
          <table className="api-table">
            <thead>
              <tr>
                <th>Status</th>
                <th>Meaning</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>401</td>
                <td>Missing or invalid API token.</td>
              </tr>
              <tr>
                <td>400</td>
                <td>Invalid input: a zero amount, a missing or unknown category, an unknown kind, or
                  <code>details</code> without <code>kind</code>.</td>
              </tr>
            </tbody>
          </table>
          </div>
        </section>
      </main>

      <Toasts />
    </>
  )
}
