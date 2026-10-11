<script>
  import { onMount } from 'svelte'
  import { getJson, postJson, ThemeToggle } from '@dscpln/ui-kit'
  import { ArrowLeft } from 'lucide-svelte'

  let token = $state('')
  let health = $state(null)
  let error = $state('')
  let copied = $state(false)

  const apiBase = $derived(`${location.origin}${health?.basePath ?? ''}/api`)

  async function load() {
    try {
      token = (await getJson('token')).token
      health = await getJson('api/health')
      error = ''
    } catch (err) {
      error = err.message
    }
  }

  async function regenerate() {
    if (!confirm('Regenerate the API token? Existing clients must be updated.')) return
    try {
      token = (await postJson('token/regenerate', {})).token
    } catch (err) {
      error = err.message
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(token)
      copied = true
      setTimeout(() => (copied = false), 2000)
    } catch {
      error = 'Copy failed — select the token manually.'
    }
  }

  onMount(load)
</script>

<header class="app-header container">
  <div class="app-header__top">
    <h1>D<span class="accent">$</span>CPLN <span class="app-name">&middot; Balance settings</span></h1>
    <div class="app-header__actions">
      <a role="button" class="secondary" href="./"><ArrowLeft size={16} /> Dashboard</a>
      <ThemeToggle />
    </div>
  </div>
</header>

<main class="container">
  {#if error}<article class="error">{error}</article>{/if}

  <article>
    <header><strong>Data source</strong></header>
    <p>Provider: <code>{health?.provider ?? '…'}</code> · served at <code>{health?.basePath ?? '…'}</code></p>
    <p><small>The workbook is the source of truth; edits made here are written back to it and committed to its git repository.</small></p>
  </article>

  <article>
    <header><strong>API token</strong></header>
    <p><small>External clients (phone shortcuts, scripts) post transactions with this bearer token. The endpoint is not behind SSO.</small></p>
    <pre>{token || '…'}</pre>
    <div class="actions">
      <button class="secondary" onclick={copy}>{copied ? 'Copied' : 'Copy'}</button>
      <button class="secondary" onclick={regenerate}>Regenerate</button>
    </div>
    <h3>Example</h3>
    <pre>curl -X POST {apiBase}/transactions \
  -H "Authorization: Bearer {token || '<token>'}" \
  -H "Content-Type: application/json" \
  -d '{`{"date":"2026-10-11","details":"Coffee","expenses":4.5,"currency":"CAD"}`}'</pre>
  </article>
</main>

<style>
  .app-name {
    font-size: 0.7em;
    font-weight: 500;
    color: var(--pico-muted-color);
  }
  .actions {
    display: flex;
    gap: 0.5rem;
  }
  .actions button {
    width: auto;
    margin: 0;
  }
  pre {
    overflow-wrap: anywhere;
    white-space: pre-wrap;
  }
</style>
