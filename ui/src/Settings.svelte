<script>
  import { onMount } from 'svelte'
  import { ChartNoAxesColumn, LayoutDashboard } from 'lucide-svelte'
  import { showToast, ThemeToggle, Toasts } from '@dscpln/ui-kit'
  import { requestJson } from './lib/request.js'
  let tokenInput = $state(null)
  let reference = $state(null)
  let token = $state('')
  let regenerating = $state(false)

  const example = $derived(`curl -X POST ${location.origin}/api/transactions \\
  -H "Authorization: Bearer ${token}" \\
  -H "Content-Type: application/json" \\
  -d '{"amount":-12.34,"details":"Groceries","currency":"CAD","category":"Food Weekly"}'`)

  const listExampleText = `curl ${location.origin}/api/categories \\
  -H "Authorization: Bearer $API_TOKEN"`

  const scoreExampleText = `curl -G ${location.origin}/api/categories \\
  -H "Authorization: Bearer $API_TOKEN" \\
  --data-urlencode "details=Coffee beans" \\
  --data-urlencode "kind=expense"`

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

  // Serializes the visible reference card, swapping the live token for a
  // placeholder so the copied Markdown is safe to share.
  const referenceMarkdown = () => {
    const blocks = [...reference.children]
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

  async function load() {
    try {
      const result = await requestJson('/token')
      token = result.token
    } catch (e) {
      console.error(e)
      showToast('Could not load the API token', 'error')
    }
  }

  async function copyToken() {
    try {
      await navigator.clipboard.writeText(tokenInput.value)
      showToast('Token copied')
    } catch (e) {
      tokenInput.select()
      showToast('Press Ctrl/Cmd+C to copy the selected token', 'error')
    }
  }

  async function copyReference() {
    try {
      await navigator.clipboard.writeText(referenceMarkdown())
      showToast('API reference copied as Markdown')
    } catch (e) {
      console.error(e)
      showToast('Could not copy the API reference', 'error')
    }
  }

  async function regenerate() {
    if (!window.confirm('Regenerate the API token? The current token will stop working.')) {
      return
    }
    regenerating = true
    try {
      const result = await requestJson('/token/regenerate', { method: 'POST', body: '{}' })
      token = result.token
      showToast('API token regenerated')
    } catch (e) {
      console.error(e)
      showToast('Could not regenerate the API token', 'error')
    } finally {
      regenerating = false
    }
  }

  onMount(() => {
    load().finally(() => document.body.classList.remove('is-loading'))
  })
</script>

<header class="app-header">
  <div class="app-header__top">
    <h1><a class="app-header__brand" href="/">D<span class="accent">$</span>CPLN <span class="app-header__app">⋅ Balance XLSX</span></a></h1>
    <div class="app-header__actions">
      <a role="button" class="outline secondary icon-button" href="./" title="Dashboard" aria-label="Dashboard">
        <LayoutDashboard size={16} strokeWidth={1.8} />
      </a>
      <a role="button" class="outline secondary icon-button" href="insights" title="Insights" aria-label="Insights">
        <ChartNoAxesColumn size={16} strokeWidth={1.8} />
      </a>
      <ThemeToggle />
    </div>
  </div>
  <div class="app-header__meta">
    <span>API settings</span>
  </div>
</header>

<main>
  <section class="card">
    <div class="card__header">
      <h2>API token</h2>
    </div>
    <p class="hint">
      Send this token as <code>Authorization: Bearer &lt;token&gt;</code> on every request. Regenerating
      invalidates the old token immediately.
    </p>
    <div class="token-row">
      <input bind:this={tokenInput} type="text" readonly spellcheck="false" aria-label="API token" value={token} />
      <button class="outline secondary" onclick={copyToken}>Copy</button>
      <button class="danger" disabled={regenerating} onclick={regenerate}>Regenerate</button>
    </div>
  </section>

  <section class="card" bind:this={reference} id="apiReference">
    <div class="card__header">
      <h2>API reference</h2>
      <span class="card__header-tools">
        <button class="outline secondary" onclick={copyReference}>Copy as Markdown</button>
      </span>
    </div>
    <p class="hint">
      The external API lives under <code>/api/</code> (reachable without SSO). Every request needs
      <code>Authorization: Bearer &lt;token&gt;</code> and uses JSON bodies; it only supports these two
      calls.
    </p>

    <h3 class="api-heading">Find a category</h3>
    <p><code>GET /api/categories?details=&lt;text&gt;&amp;kind=expense|income</code></p>
    <p class="hint">
      Returns every category for the kind, grouped as in the Constants sheet and best match
      first, each with a score between <code>0</code> and <code>1</code> (<code>0</code> means no
      match). Without <code>details</code> the list is un-scored, and without <code>kind</code> it
      returns every group — so a plain <code>GET /api/categories</code> is the "list categories"
      call.
    </p>
    <pre class="code-block">{listExampleText}</pre>
    <pre class="code-block">{scoreExampleText}</pre>

    <h3 class="api-heading">Add a transaction</h3>
    <p><code>POST /api/transactions</code></p>
    <div class="table-wrap">
    <table class="api-table">
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
    <pre class="code-block">{example}</pre>
    <p class="hint">
      The response is <code>201 {'{"transaction":{...}}'}</code>; a category that doesn't fit the
      transaction's kind (or the missing kind on the categories call) is a <code>400</code>.
    </p>

    <h3 class="api-heading">Errors</h3>
    <div class="table-wrap">
    <table class="api-table">
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
