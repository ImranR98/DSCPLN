<script>
  import { onMount } from 'svelte'
  import { apiUrl, formatBytes, formatDateTime, getJson, postJson, ThemeToggle } from '@dscpln/ui-kit'
  import { Import, RefreshCw, Search, X } from 'lucide-svelte'

  let summary = $state(null)
  let listFilter = $state('')
  let conversations = $state([])
  let banner = $state('Loading…')

  // conversation view
  let activeId = $state(null)
  let active = $state(null) // { id, name, total, offset, messages }
  let loadingMessages = $state(false)

  // search view
  let searchOpen = $state(false)
  let searchQuery = $state('')
  let searchFilters = $state({ sender: '', type: '', from: '', to: '', whole: false, order: 'desc' })
  let searchResult = $state(null)
  let searching = $state(false)

  // import dialog
  let importDialog = $state(null)
  let importItems = $state([])
  let importBatch = $state(null)
  let importResult = $state('')
  let importDone = $state(false)
  let importStatus = $state('')
  let merging = $state(false)

  function setBanner(text) {
    banner = text
  }

  async function loadConversations() {
    try {
      conversations = await getJson('api/conversations')
      summary = await getJson('api/state')
      setBanner(`${summary.conversations} conversation(s) · ${summary.messages} message(s) · ${formatBytes(summary.bytes)}`)
    } catch (err) {
      setBanner(`Could not load conversations: ${err.message}`)
    }
  }

  async function openConversation(id, { around = null } = {}) {
    activeId = id
    searchOpen = false
    loadingMessages = true
    try {
      const query = around != null ? `?around=${around}&limit=200` : '?offset=0&limit=200'
      active = await getJson(`api/conversations/${encodeURIComponent(id)}/messages${query}`)
      history.replaceState(null, '', `#/c/${encodeURIComponent(id)}`)
    } catch (err) {
      setBanner(err.message)
    } finally {
      loadingMessages = false
    }
  }

  async function loadMore() {
    if (!active || active.offset + active.limit >= active.total) return
    loadingMessages = true
    try {
      const next = await getJson(
        `api/conversations/${encodeURIComponent(active.id)}/messages?offset=${active.offset + active.limit}&limit=${active.limit}`,
      )
      active = { ...next, messages: [...active.messages, ...next.messages] }
    } finally {
      loadingMessages = false
    }
  }

  async function runSearch(offset = 0) {
    searching = true
    try {
      const params = new URLSearchParams({ q: searchQuery, order: searchFilters.order, limit: '50', offset: String(offset) })
      if (searchFilters.sender) params.set('sender', searchFilters.sender)
      if (searchFilters.type) params.set('type', searchFilters.type)
      if (searchFilters.from) params.set('from', searchFilters.from)
      if (searchFilters.to) params.set('to', searchFilters.to)
      if (searchFilters.whole) params.set('whole', '1')
      const result = await getJson(`api/search?${params}`)
      searchResult = offset > 0 ? { ...result, results: [...searchResult.results, ...result.results] } : result
    } catch (err) {
      setBanner(err.message)
    } finally {
      searching = false
    }
  }

  async function reload() {
    setBanner('Reloading…')
    try {
      await postJson('api/reload', {})
      await loadConversations()
      if (activeId) await openConversation(activeId)
    } catch (err) {
      setBanner(err.message)
    }
  }

  /* ---------- import ---------- */

  function openImport() {
    importItems = []
    importResult = ''
    importDone = false
    importStatus = ''
    importBatch = `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
    importDialog.showModal()
  }

  function dismissImport() {
    if (merging) return
    importDialog.close()
    if (importBatch && !importDone) {
      postJson('api/import/cancel', { batch: importBatch }).catch(() => {})
      setBanner('Import cancelled — staged uploads discarded.')
    }
    importBatch = null
    importItems = []
  }

  function onDialogClick(event) {
    if (event.target === importDialog) dismissImport()
  }

  function onDialogCancel(event) {
    if (merging) {
      event.preventDefault()
      return
    }
    if (importItems.length && !importDone) setBanner('Import cancelled — staged uploads discarded.')
    if (importBatch && !importDone) postJson('api/import/cancel', { batch: importBatch }).catch(() => {})
    importBatch = null
    importItems = []
  }

  function updateItem(name, patch) {
    importItems = importItems.map((item) => (item.name === name ? { ...item, ...patch } : item))
  }

  function uploadFile(file) {
    return new Promise((resolve) => {
      importItems = [...importItems, { name: file.name, size: file.size, status: 'uploading', progress: 0 }]
      const xhr = new XMLHttpRequest()
      xhr.open('POST', apiUrl(`api/import/upload?batch=${encodeURIComponent(importBatch)}&name=${encodeURIComponent(file.name)}`))
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) updateItem(file.name, { progress: Math.round((event.loaded / event.total) * 100) })
      }
      xhr.onload = () => {
        if (xhr.status >= 400) {
          let error = `HTTP ${xhr.status}`
          try {
            error = JSON.parse(xhr.responseText).error ?? error
          } catch {
            // keep the status text
          }
          updateItem(file.name, { status: 'error', error })
          resolve(false)
        } else {
          updateItem(file.name, { status: 'done' })
          resolve(true)
        }
      }
      xhr.onerror = () => {
        updateItem(file.name, { status: 'error', error: 'upload failed' })
        resolve(false)
      }
      xhr.send(file)
    })
  }

  async function browse(event) {
    const files = [...event.target.files]
    event.target.value = ''
    for (const file of files) await uploadFile(file)
  }

  async function runMerge(dryRun) {
    if (!importBatch || merging) return
    merging = true
    importStatus = dryRun ? 'Previewing…' : 'Merging…'
    try {
      const result = await postJson('api/import/merge', { batch: importBatch, dryRun })
      if (dryRun) {
        importResult = ['Preview: no files were renamed, deleted or written', ...result.names].join('\n')
      } else {
        importDone = true
        importStatus = `Import complete — ${result.conversations} conversation(s)`
        importBatch = null
        await loadConversations()
      }
    } catch (err) {
      importStatus = `Failed: ${err.message}`
    } finally {
      merging = false
    }
  }

  /* ---------- boot ---------- */

  onMount(() => {
    loadConversations()
    const hash = /^#\/c\/(.+)$/.exec(location.hash)
    if (hash) openConversation(decodeURIComponent(hash[1]))
    const timer = setInterval(() => {
      if (!activeId) loadConversations()
    }, 15_000)
    return () => clearInterval(timer)
  })
</script>

<header class="app-header container">
  <div class="app-header__top">
    <h1>D<span class="accent">$</span>CPLN <span class="app-name">&middot; WhatsApp TXT</span></h1>
    <div class="app-header__actions">
      <button class="outline secondary" id="search-toggle" title="Search messages" onclick={() => { searchOpen = true; activeId = null; history.replaceState(null, '', location.pathname) }}>
        <Search size={16} />
      </button>
      <button class="outline secondary" id="reload" title="Reload index" onclick={reload}><RefreshCw size={16} /></button>
      <button class="outline secondary" id="import" title="Import exports" onclick={openImport}><Import size={16} /></button>
      <ThemeToggle />
    </div>
  </div>
  <p class="app-header__meta"><small id="banner-text">{banner}</small></p>
</header>

<main class="container layout">
  <aside>
    <input type="search" placeholder="Filter conversations…"
      oninput={(event) => (listFilter = event.target.value.toLowerCase())} />
    <ul id="conversation-list">
      {#each conversations.filter((c) => !listFilter || c.name.toLowerCase().includes(listFilter)) as conversation (conversation.id)}
        <li class:active={conversation.id === activeId}>
          <button class="plain" onclick={() => openConversation(conversation.id)}>
            <strong>{conversation.name}</strong>
            <small>{conversation.messageCount} msg · {formatDateTime(new Date(conversation.last).getTime())}</small>
          </button>
        </li>
      {/each}
    </ul>
  </aside>

  <section class="content">
    {#if searchOpen}
      <form class="search-form" onsubmit={(event) => { event.preventDefault(); runSearch(0) }}>
        <input type="search" placeholder="Search messages…" bind:value={searchQuery} />
        <div class="filters">
          <label>Sender <input bind:value={searchFilters.sender} placeholder="exact name" /></label>
          <label>Type
            <select bind:value={searchFilters.type}>
              <option value="">any</option>
              {#each ['text', 'media', 'attachment', 'deleted', 'system'] as type}<option value={type}>{type}</option>{/each}
            </select>
          </label>
          <label>From <input type="date" bind:value={searchFilters.from} /></label>
          <label>To <input type="date" bind:value={searchFilters.to} /></label>
          <label><input type="checkbox" bind:checked={searchFilters.whole} /> Whole word</label>
          <label>Order
            <select bind:value={searchFilters.order}><option value="desc">newest first</option><option value="asc">oldest first</option></select>
          </label>
        </div>
        <button disabled={searching}>Search</button>
      </form>

      {#if searchResult}
        <p><small>{searchResult.total} match(es)</small></p>
        <ul class="results">
          {#each searchResult.results as result (result.conversationId + ':' + result.index)}
            <li>
              <button class="plain" onclick={() => openConversation(result.conversationId, { around: result.index })}>
                <small>{result.conversationName} · {result.sender ?? 'system'} · {formatDateTime(new Date(result.date).getTime())}</small>
                <span>
                  {result.snippet.slice(0, result.matchStart)}<mark>{result.snippet.slice(result.matchStart, result.matchStart + result.matchLength)}</mark>{result.snippet.slice(result.matchStart + result.matchLength)}
                </span>
              </button>
            </li>
          {/each}
        </ul>
        {#if searchResult.offset + searchResult.limit < searchResult.total}
          <button class="secondary" onclick={() => runSearch(searchResult.offset + searchResult.limit)}>Load more</button>
        {/if}
      {/if}
    {:else if active}
      <article>
        <header>
          <strong>{active.name}</strong>
          <small>{active.total} message(s)</small>
        </header>
        {#if loadingMessages}<p><small>Loading…</small></p>{/if}
        <ol class="messages">
          {#each active.messages as message (message.index)}
            <li class={`message message--${message.type}`}>
              <small>{message.sender ?? 'system'} · {formatDateTime(new Date(message.date).getTime())}</small>
              <p>{message.body}</p>
            </li>
          {/each}
        </ol>
        {#if active.offset + active.limit < active.total}
          <button class="secondary" disabled={loadingMessages} onclick={loadMore}>Load more</button>
        {/if}
      </article>
    {:else}
      <p><small>Pick a conversation, or search all messages.</small></p>
    {/if}
  </section>
</main>

<dialog id="import-dialog" bind:this={importDialog} onclick={onDialogClick} oncancel={onDialogCancel}>
  <article>
    <header>
      <strong>Import WhatsApp exports</strong>
      <button class="close" aria-label="Close" onclick={dismissImport}>&times;</button>
    </header>
    <p><small>Drop-in .zip or .txt exports from the phone; they are staged, previewed and then merged with the existing conversations.</small></p>

    <label class="browse">
      <input type="file" multiple accept=".zip,.txt" onchange={browse} hidden />
      <span role="button" id="import-browse">Browse files…</span>
    </label>

    {#each importItems as item (item.name)}
      <div class={`import-item ${item.status === 'done' ? 'import-item--done' : item.status === 'error' ? 'import-item--error' : ''}`}>
        <span>{item.name}</span>
        <span class="import-item__meta">
          {#if item.status === 'uploading'}uploading {item.progress}%{:else if item.status === 'done'}uploaded · {formatBytes(item.size)}{:else}error: {item.error}{/if}
        </span>
      </div>
    {/each}

    <div class="actions">
      <button class="secondary" id="import-preview" disabled={!importItems.some((i) => i.status === 'done') || merging}
        onclick={() => runMerge(true)}>Preview</button>
      <button id="import-run" disabled={!importItems.some((i) => i.status === 'done') || merging}
        onclick={() => runMerge(false)}>Merge</button>
    </div>

    {#if importResult}
      <pre id="import-result">{importResult}</pre>
    {/if}
    {#if importStatus}
      <p id="import-status"><small>{importStatus}</small></p>
    {/if}
    {#if importDone}
      <div id="import-done"><strong>Done.</strong> <small>The conversation list is refreshed.</small></div>
    {/if}
  </article>
</dialog>

<style>
  .app-name {
    font-size: 0.7em;
    font-weight: 500;
    color: var(--pico-muted-color);
  }
  .layout {
    display: grid;
    grid-template-columns: minmax(14rem, 20rem) 1fr;
    gap: 1.5rem;
    align-items: start;
  }
  aside ul {
    list-style: none;
    padding: 0;
    max-height: 70vh;
    overflow: auto;
  }
  aside li.active {
    background: var(--pico-secondary-background);
  }
  button.plain {
    all: unset;
    display: block;
    width: 100%;
    cursor: pointer;
    padding: 0.35rem 0.5rem;
  }
  button.plain small {
    display: block;
    color: var(--pico-muted-color);
  }
  .messages {
    list-style: none;
    padding: 0;
  }
  .message {
    padding: 0.35rem 0.6rem;
    border-radius: 0.5rem;
    margin-block: 0.2rem;
    background: var(--pico-secondary-background);
  }
  .message p {
    margin: 0;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .message--system {
    opacity: 0.8;
    font-style: italic;
  }
  .message--media,
  .message--attachment {
    border-left: 3px solid var(--pico-primary);
  }
  .results {
    list-style: none;
    padding: 0;
  }
  .filters {
    display: flex;
    gap: 1rem;
    flex-wrap: wrap;
    align-items: end;
    margin-block: 0.5rem;
  }
  .filters label {
    margin: 0;
    font-size: 0.85rem;
  }
  #import-dialog article {
    width: min(44rem, 94vw);
  }
  .import-item {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    border-bottom: 1px solid var(--pico-muted-border-color);
    padding-block: 0.25rem;
  }
  .import-item--error {
    color: var(--pico-del-color);
  }
  .actions {
    display: flex;
    gap: 0.5rem;
    margin-block: 0.75rem;
  }
  #import-result {
    max-height: 16rem;
    overflow: auto;
  }
  .browse {
    display: inline-block;
  }
</style>
