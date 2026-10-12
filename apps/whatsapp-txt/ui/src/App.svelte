<script>
  import { onMount, tick } from 'svelte'
  import {
    ArrowDown,
    ArrowUp,
    AlignJustify,
    AlignLeft,
    Import,
    Menu,
    MessageSquare,
    RefreshCw,
    X,
  } from 'lucide-svelte'
  import { apiUrl, formatDateTime, getJson, postJson, ThemeToggle } from '@dscpln/ui-kit'

  const PAGE_SIZE = 200
  const GROUP_WINDOW_MS = 5 * 60 * 1000

  const pad = (value) => String(value).padStart(2, '0')
  const dateLabel = (iso) => {
    const date = new Date(iso)
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  }
  const timeLabel = (iso) => {
    const date = new Date(iso)
    const hours = date.getHours() % 12 || 12
    return `${pad(hours)}:${pad(date.getMinutes())} ${date.getHours() >= 12 ? 'PM' : 'AM'}`
  }
  const relativeTime = (iso) => {
    const seconds = Math.round((Date.now() - Date.parse(iso)) / 1000)
    if (seconds < 60) return 'just now'
    if (seconds < 3600) return `${Math.round(seconds / 60)} min ago`
    if (seconds < 86400) return `${Math.round(seconds / 3600)} h ago`
    return `${Math.round(seconds / 86400)} d ago`
  }
  const initials = (name) => {
    const words = name.trim().split(/\s+/).filter(Boolean)
    if (words.length >= 2) return ([...words[0]][0] + [...words[1]][0]).toUpperCase()
    return [...(words[0] ?? '?')].slice(0, 2).join('').toUpperCase()
  }
  const typeLabel = (type) => (type === 'text' ? '' : type.charAt(0).toUpperCase() + type.slice(1))

  const senderHue = (text) => {
    let hash = 0
    for (const char of text) hash = (hash * 31 + char.codePointAt(0)) % 360
    return hash
  }
  const SENDER_TONES = [
    { s: 62, l: 34, ds: 55, dl: 72 },
    { s: 46, l: 45, ds: 44, dl: 80 },
    { s: 72, l: 39, ds: 62, dl: 76 },
  ]
  const buildSenderPalette = (senders) => {
    const unique = [...new Set((senders ?? []).filter(Boolean))].sort((a, b) => a.localeCompare(b))
    const palette = new Map()
    if (unique.length === 0) return palette
    const base = senderHue(unique.join('\u0000'))
    unique.forEach((sender, index) => {
      const hue = (base + (index * 360) / unique.length) % 360
      const tone = SENDER_TONES[index % SENDER_TONES.length]
      palette.set(sender, {
        light: `hsl(${hue} ${tone.s}% ${tone.l}%)`,
        dark: `hsl(${hue} ${tone.ds}% ${tone.dl}%)`,
      })
    })
    return palette
  }

  const URL_RE = /(https?:\/\/[^\s<]+)/g
  const bodyParts = (text) => {
    const parts = []
    let last = 0
    for (const match of text.matchAll(URL_RE)) {
      if (match.index > last) parts.push({ text: text.slice(last, match.index) })
      parts.push({ href: match[0] })
      last = match.index + match[0].length
    }
    if (last < text.length) parts.push({ text: text.slice(last) })
    return parts
  }

  let meta = $state(null)
  let conversations = $state([])
  let byId = $state(new Map())
  let conversation = $state(null)
  let total = $state(0)
  let messages = $state(new Map())
  let loadedFirst = $state(0)
  let loadedLast = $state(-1)
  let loading = $state(false)
  let viewToken = 0
  let viewMode = $state(localStorage.getItem('whatsapptxt-view') ?? 'transcript')
  let palettes = $state(new Map())
  let skeleton = $state(false)

  let bannerText = $state('')
  let bannerVisible = $state(false)
  let bannerTimer = null
  let sidebarOpen = $state(false)
  let listFilter = $state('')
  let reloading = $state(false)

  let searchInput = $state(null)
  let searchQuery = $state('')
  let searchActive = $state(false)
  let searchFilters = $state({ conversation: '', sender: '', type: '', from: '', to: '', order: 'desc', whole: '' })
  let searchResults = $state([])
  let searchRendered = $state(0)
  let searchTotal = $state(0)
  let searchSummary = $state('')
  let searchLoading = $state(false)
  let searchError = $state('')
  let searchRunToken = 0
  let sentinel = $state(null)

  let scrollEl = $state(null)
  let topButtonVisible = $state(false)
  let latestButtonVisible = $state(false)

  let importDialog = $state(null)
  let importBatch = $state(null)
  let importFiles = $state([])
  let importImported = $state(false)
  let importBusy = $state(false)
  let importStatus = $state('')
  let importStatusError = $state(false)
  let importResult = $state('')

  const banner = (message) => {
    bannerText = message
    bannerVisible = true
    clearTimeout(bannerTimer)
    bannerTimer = setTimeout(() => (bannerVisible = false), 8000)
  }
  const hideBanner = () => {
    clearTimeout(bannerTimer)
    bannerVisible = false
  }

  const senderColor = (conversationId, sender) => {
    if (!sender) return null
    if (!palettes.has(conversationId)) {
      const entry = byId.get(conversationId)
      palettes.set(conversationId, buildSenderPalette(entry ? entry.senders : []))
    }
    return palettes.get(conversationId).get(sender) ?? {
      light: `hsl(${senderHue(sender)} 55% 38%)`,
      dark: `hsl(${senderHue(sender)} 60% 74%)`,
    }
  }
  const senderStyle = (conversationId, sender) => {
    const color = senderColor(conversationId, sender)
    return color ? `--sender-color: ${color.light}; --sender-color-dark: ${color.dark}` : ''
  }

  const statusText = $derived.by(() => {
    if (!meta) return ''
    const skipped = meta.skipped.length ? ` · ${meta.skipped.length} skipped` : ''
    return `${meta.conversations} chats · ${meta.messages.toLocaleString()} msgs${skipped}`
  })
  const statusTitle = $derived.by(() => {
    if (!meta) return ''
    const skippedDetail = meta.skipped.length
      ? `\n\nSkipped:\n${meta.skipped.map((item) => `${item.file}: ${item.reason}`).join('\n')}`
      : ''
    return `Indexed ${relativeTime(meta.indexedAt)}${skippedDetail}`
  })

  const filteredConversations = $derived(conversations.filter(
    (entry) => !listFilter || entry.name.toLowerCase().includes(listFilter.toLowerCase())))

  const messageView = $derived.by(() => {
    if (!conversation) return []
    const view = []
    let previousDay = null
    let previousMessage = null
    for (let index = loadedFirst; index <= loadedLast; index += 1) {
      const message = messages.get(index)
      if (!message) {
        previousMessage = null
        continue
      }
      const day = dateLabel(message.date)
      if (day !== previousDay) {
        view.push({ kind: 'date', key: `d-${day}`, label: day })
        previousDay = day
        previousMessage = null
      }
      const grouped = previousMessage != null &&
        previousMessage.sender === message.sender &&
        previousMessage.type === message.type &&
        message.date - previousMessage.date < GROUP_WINDOW_MS
      view.push({ kind: 'message', key: message.index, message, grouped })
      previousMessage = message
    }
    return view
  })

  async function loadConversations() {
    conversations = await getJson('api/conversations')
    byId = new Map(conversations.map((entry) => [entry.id, entry]))
    palettes = new Map()
  }

  async function loadMeta() {
    meta = await getJson('api/state')
  }

  const updateJumpVisibility = () => {
    if (!scrollEl) return
    topButtonVisible = scrollEl.scrollTop >= 80
    latestButtonVisible = scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight >= 80
  }

  function prune() {
    const maxRows = 3000
    while (messages.size > maxRows) {
      const center = (loadedFirst + loadedLast) / 2
      if (loadedLast - center >= center - loadedFirst) {
        for (let index = loadedLast; index > loadedLast - PAGE_SIZE; index -= 1) messages.delete(index)
        loadedLast -= PAGE_SIZE
      } else {
        for (let index = loadedFirst; index < loadedFirst + PAGE_SIZE; index += 1) messages.delete(index)
        loadedFirst += PAGE_SIZE
      }
    }
  }

  async function loadPage(offset, { preserveScroll = false } = {}) {
    if (loading || !conversation) return
    loading = true
    const token = viewToken
    const beforeHeight = scrollEl ? scrollEl.scrollHeight : 0
    try {
      const data = await getJson(`api/conversations/${encodeURIComponent(conversation.id)}/messages?offset=${offset}&limit=${PAGE_SIZE}`)
      if (token !== viewToken) return
      for (const message of data.messages) messages.set(message.index, message)
      loadedFirst = Math.min(loadedFirst, data.offset)
      loadedLast = Math.max(loadedLast, data.offset + data.messages.length - 1)
      prune()
      await tick()
      if (preserveScroll && scrollEl) scrollEl.scrollTop += scrollEl.scrollHeight - beforeHeight
      updateJumpVisibility()
    } catch (error) {
      if (token === viewToken && messages.size === 0) banner(`Failed to load messages: ${error.message}`)
    } finally {
      loading = false
      skeleton = false
    }
  }

  function onMessageScroll() {
    if (!scrollEl || loading || !conversation) return
    if (scrollEl.scrollTop < 400 && loadedFirst > 0) {
      loadPage(Math.max(0, loadedFirst - PAGE_SIZE), { preserveScroll: true })
    } else if (scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight < 600 && loadedLast < total - 1) {
      loadPage(loadedLast + 1)
    }
    updateJumpVisibility()
  }

  async function openConversation(id, at = null) {
    searchActive = false
    const entry = byId.get(id)
    if (!entry) {
      conversation = null
      banner('Conversation not found')
      return
    }
    conversation = entry
    total = entry.messageCount
    messages = new Map()
    loadedFirst = 0
    loadedLast = -1
    viewToken += 1
    loading = false
    sidebarOpen = false
    skeleton = true
    const target = at != null ? Number.parseInt(at, 10) : null
    const offset = target != null && !Number.isNaN(target)
      ? Math.max(0, Math.min(target, entry.messageCount - 1) - Math.floor(PAGE_SIZE / 2))
      : 0
    await tick()
    await loadPage(offset)
    if (target != null && !Number.isNaN(target)) scrollToIndex(target)
    updateJumpVisibility()
  }

  function scrollToIndex(index) {
    const row = document.getElementById(`m-${index}`)
    if (!row) return
    row.scrollIntoView({ block: 'center' })
    row.classList.add('flash')
    setTimeout(() => row.classList.remove('flash'), 1600)
  }

  async function jumpTo(index) {
    if (!conversation || total === 0) return
    const target = Math.max(0, Math.min(index, total - 1))
    messages = new Map()
    loadedFirst = 0
    loadedLast = -1
    viewToken += 1
    loading = false
    skeleton = true
    await tick()
    const offset = Math.max(0, target - Math.floor(PAGE_SIZE / 2))
    await loadPage(offset)
    if (scrollEl) {
      if (target === 0) scrollEl.scrollTop = 0
      else if (target >= total - 1) scrollEl.scrollTop = scrollEl.scrollHeight
      else scrollToIndex(target)
    }
    updateJumpVisibility()
  }

  /* ---------- search ---------- */

  const syncSearchHash = () => {
    const params = new URLSearchParams()
    if (searchQuery) params.set('q', searchQuery)
    for (const key of ['conversation', 'sender', 'type', 'from', 'to']) if (searchFilters[key]) params.set(key, searchFilters[key])
    if (searchFilters.order === 'asc') params.set('order', 'asc')
    if (searchFilters.whole) params.set('whole', '1')
    history.replaceState(null, '', `#/search${params.toString() ? `?${params}` : ''}`)
  }

  async function runSearch(append = false) {
    if (!searchQuery.trim() && !['conversation', 'sender', 'type', 'from', 'to', 'whole'].some((key) => searchFilters[key])) {
      searchResults = []
      searchSummary = ''
      searchTotal = 0
      return
    }
    if (searchLoading) return
    searchLoading = true
    const token = ++searchRunToken
    const offset = append ? searchRendered : 0
    try {
      const params = new URLSearchParams({ q: searchQuery, order: searchFilters.order, limit: '50', offset: String(offset) })
      for (const key of ['conversation', 'sender', 'type', 'from', 'to']) if (searchFilters[key]) params.set(key, searchFilters[key])
      if (searchFilters.whole) params.set('whole', '1')
      const data = await getJson(`api/search?${params}`)
      if (token !== searchRunToken) return
      searchResults = append ? [...searchResults, ...data.results] : data.results
      searchRendered = offset + data.results.length
      searchTotal = data.total
      searchError = ''
      searchSummary = searchQuery.trim()
        ? `${data.total.toLocaleString()} result${data.total === 1 ? '' : 's'} for “${searchQuery.trim()}”`
        : `${data.total.toLocaleString()} message${data.total === 1 ? '' : 's'}`
    } catch (error) {
      if (token === searchRunToken) searchError = `Search failed: ${error.message}`
    } finally {
      if (token === searchRunToken) searchLoading = false
    }
  }

  let searchTimer = null
  function onSearchInput() {
    clearTimeout(searchTimer)
    searchTimer = setTimeout(() => {
      const query = searchQuery.trim()
      if (searchActive) {
        searchQuery = query
        syncSearchHash()
        runSearch(false)
      } else if (query) {
        location.hash = `#/search?q=${encodeURIComponent(query)}`
      }
    }, 250)
  }

  function clearSearch() {
    searchQuery = ''
    if (searchActive) {
      syncSearchHash()
      runSearch(false)
    }
    searchInput?.focus()
  }

  function submitSearch(event) {
    event.preventDefault()
    const query = searchQuery.trim()
    if (query) location.hash = `#/search?q=${encodeURIComponent(query)}`
    else if (searchActive) {
      syncSearchHash()
      runSearch(false)
    }
  }

  function useSearchSentinel(node) {
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting) && searchRendered < searchTotal && !searchLoading) {
        runSearch(true)
      }
    }, { rootMargin: '240px' })
    observer.observe(node)
    return { destroy: () => observer.disconnect() }
  }

  /* ---------- import ---------- */

  const formatSize = (bytes) => {
    if (!Number.isFinite(bytes)) return ''
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  }
  const newBatch = () => `imp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

  function openImport() {
    importImported = false
    importStatus = ''
    importStatusError = false
    importResult = ''
    importDialog.showModal()
  }

  async function dismissImport() {
    if (importBusy) return
    if (importFiles.length > 0 && importBatch) {
      await discardImport()
      banner('Import cancelled — staged uploads discarded.')
    }
    importDialog.close()
  }

  async function discardImport() {
    if (!importBatch) return
    await postJson('api/import/cancel', { batch: importBatch }).catch(() => {})
    importBatch = null
    importFiles = []
    importResult = ''
    importStatus = 'Uploads discarded.'
    importStatusError = false
  }

  async function chooseImportFiles(fileList) {
    if (importBusy || importImported) return
    const all = [...fileList]
    const accepted = all.filter((file) => /\.(zip|txt)$/i.test(file.name))
    if (accepted.length < all.length) {
      importStatus = `${all.length - accepted.length} file(s) skipped (only .zip and .txt are accepted)`
      importStatusError = true
    } else {
      importStatus = ''
      importStatusError = false
    }
    if (accepted.length === 0) return
    if (!importBatch) importBatch = newBatch()
    const patchItem = (name, values) => {
      importFiles = importFiles.map((item) => (item.name === name ? { ...item, ...values } : item))
    }
    for (const file of accepted) {
      if (importFiles.some((entry) => entry.name === file.name)) continue
      importFiles = [...importFiles, { name: file.name, size: file.size, state: 'uploading' }]
      try {
        const response = await fetch(apiUrl(`api/import/upload?batch=${encodeURIComponent(importBatch)}&name=${encodeURIComponent(file.name)}`), {
          method: 'POST',
          body: file,
        })
        const body = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(body.error ?? `${response.status} ${response.statusText}`)
        patchItem(file.name, { state: 'done', size: body.size })
      } catch (error) {
        patchItem(file.name, { state: 'error', error: error.message })
      }
    }
  }

  const importUploaded = $derived(importFiles.some((entry) => entry.state === 'done'))

  async function runImport(dryRun) {
    if (importBusy) return
    importBusy = true
    importResult = ''
    importStatus = dryRun ? 'Building preview…' : 'Merging…'
    importStatusError = false
    try {
      const summary = await postJson('api/import/merge', { batch: importBatch, dryRun })
      const lines = [dryRun ? '=== Preview: no files were renamed, deleted or written ===' : '=== Import complete ===']
      lines.push(`${summary.conversations} conversation(s) · ${summary.multiSource} merged from multiple sources · ${summary.renamedGroups} renamed group(s)`)
      for (const name of summary.names.slice(0, 30)) lines.push(`  ${name}`)
      if (summary.names.length > 30) lines.push(`  … and ${summary.names.length - 30} more`)
      for (const item of summary.ambiguous ?? []) {
        lines.push(`ambiguous dates: ${item.file} · ${item.count} line(s) resolved as ${item.order.toUpperCase()} (${item.orderSource})`)
      }
      importResult = lines.join('\n')
      if (dryRun) {
        importStatus = 'Preview only — nothing was written.'
      } else {
        importImported = true
        importBatch = null
        importFiles = []
        importStatus = 'Import complete.'
        await Promise.all([loadMeta(), loadConversations()])
        await handleRoute()
      }
    } catch (error) {
      importStatus = error.message
      importStatusError = true
    } finally {
      importBusy = false
    }
  }

  /* ---------- routing + chrome ---------- */

  function parseHash() {
    const raw = location.hash.replace(/^#\/?/, '')
    const [route, query] = raw.split('?')
    const params = new URLSearchParams(query ?? '')
    if (route.startsWith('c/')) return { view: 'conversation', id: decodeURIComponent(route.slice(2)), at: params.get('at') }
    if (route.startsWith('search')) return { view: 'search', q: params.get('q') ?? '', params }
    return { view: 'empty' }
  }

  async function handleRoute() {
    const route = parseHash()
    if (route.view === 'conversation') {
      searchActive = false
      await openConversation(route.id, route.at)
    } else if (route.view === 'search') {
      searchInput && (searchInput.value = route.q)
      searchQuery = route.q
      searchActive = true
      searchFilters = {
        conversation: route.params.get('conversation') ?? '',
        sender: route.params.get('sender') ?? '',
        type: route.params.get('type') ?? '',
        from: route.params.get('from') ?? '',
        to: route.params.get('to') ?? '',
        order: route.params.get('order') === 'asc' ? 'asc' : 'desc',
        whole: route.params.get('whole') === '1' ? '1' : '',
      }
      conversation = null
      searchResults = []
      searchRendered = 0
      if (route.q.trim() || [...route.params.keys()].some((key) => key !== 'q')) {
        await runSearch(false)
      } else {
        searchSummary = ''
        searchTotal = 0
      }
    } else {
      conversation = null
      searchActive = false
      searchResults = []
    }
  }

  async function reload() {
    if (reloading) return
    reloading = true
    try {
      meta = await postJson('api/reload', {})
      await loadConversations()
      await handleRoute()
    } catch (error) {
      banner(`Reindex failed: ${error.message}`)
    } finally {
      reloading = false
    }
  }

  function onKeydown(event) {
    if (importDialog?.open) return
    const typing = /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement?.tagName ?? '')
    if (event.key === '/' && !typing) {
      event.preventDefault()
      searchInput?.focus()
      return
    }
    if (event.key === 'Escape') {
      if (typing) document.activeElement.blur()
      else if (searchActive && document.activeElement?.classList.contains('result')) searchInput?.focus()
      else location.hash = '#/'
      return
    }
    if (typing) {
      const arrowIntoResults = searchActive &&
        (event.key === 'ArrowDown' || event.key === 'ArrowUp') &&
        (document.activeElement === searchInput || ['SELECT', 'INPUT'].includes(document.activeElement?.tagName ?? ''))
      if (arrowIntoResults) {
        event.preventDefault()
        moveResultFocus(event.key === 'ArrowDown' ? 1 : -1)
      }
      return
    }
    if (searchActive) {
      if (event.key === 'j' || event.key === 'ArrowDown') {
        event.preventDefault()
        moveResultFocus(1)
      } else if (event.key === 'k' || event.key === 'ArrowUp') {
        event.preventDefault()
        moveResultFocus(-1)
      }
      return
    }
    if (conversation) {
      if (event.key === 'Home') {
        event.preventDefault()
        jumpTo(0)
      } else if (event.key === 'End') {
        event.preventDefault()
        jumpTo(total - 1)
      } else if (event.key === 'j') {
        scrollEl?.scrollBy({ top: 120 })
      } else if (event.key === 'k') {
        scrollEl?.scrollBy({ top: -120 })
      }
    }
  }

  function moveResultFocus(delta) {
    const results = [...document.querySelectorAll('.search-results .result')]
    if (!results.length) return
    const current = results.indexOf(document.activeElement)
    const next = current === -1 ? (delta > 0 ? 0 : results.length - 1) : Math.min(Math.max(current + delta, 0), results.length - 1)
    results[next].focus()
  }

  function setViewMode(mode) {
    viewMode = mode
    localStorage.setItem('whatsapptxt-view', mode)
  }

  const openResult = (result) => {
    location.hash = `#/c/${encodeURIComponent(result.conversationId)}?at=${result.index}`
  }

  onMount(() => {
    const onHash = () => handleRoute()
    window.addEventListener('hashchange', onHash)
    window.addEventListener('keydown', onKeydown)
    ;(async () => {
      try {
        await Promise.all([loadMeta(), loadConversations()])
        await handleRoute()
      } catch (error) {
        banner(`Failed to load: ${error.message}`)
      }
    })()
    const timer = setInterval(() => {
      if (!conversation) loadConversations().catch(() => {})
    }, 15_000)
    return () => {
      window.removeEventListener('hashchange', onHash)
      window.removeEventListener('keydown', onKeydown)
      clearInterval(timer)
    }
  })
</script>

<header class="topbar app-header">
  <div class="app-header__top">
    <button id="sidebar-toggle" class="outline secondary icon-button" aria-label="Toggle conversation list" onclick={() => (sidebarOpen = !sidebarOpen)}>
      <Menu size={16} strokeWidth={1.8} />
    </button>
    <h1>D<span class="accent">$</span>CPLN <span class="app-header__app">⋅ WhatsApp TXT</span></h1>
    <form id="search-form" class="search-form" role="search" onsubmit={submitSearch}>
      <span class="search-box">
        <input id="search-input" bind:this={searchInput} type="search" placeholder="Search messages…  /" autocomplete="off" spellcheck="false"
          aria-label="Search messages" oninput={onSearchInput} />
        {#if searchQuery}
          <button type="button" id="search-clear" class="clear-btn" aria-label="Clear search" onclick={clearSearch}>
            <X size={15} strokeWidth={1.8} />
          </button>
        {/if}
      </span>
    </form>
    <span id="status" class="status muted" role="status" title={statusTitle}>{statusText}</span>
    <span class="app-header__actions">
      <button id="import" class="outline secondary icon-button" aria-label="Import chat exports" title="Import exports" onclick={openImport}>
        <Import size={16} strokeWidth={1.8} />
      </button>
      <button id="reload" class="outline secondary icon-button" aria-label="Reindex the data directory" title="Reindex" class:spin={reloading} onclick={reload}>
        <RefreshCw size={16} strokeWidth={1.8} />
      </button>
      <ThemeToggle />
    </span>
  </div>
</header>

<div id="banner" class="banner" role="alert" hidden={!bannerVisible}>
  <span id="banner-text">{bannerText}</span>
  <button id="banner-close" class="icon-btn" aria-label="Dismiss notification" onclick={hideBanner}>
    <X size={15} strokeWidth={1.8} />
  </button>
</div>

<main class="layout">
  <aside id="sidebar" class="sidebar" class:open={sidebarOpen} aria-label="Conversations">
    <div class="sidebar-head">
      <input id="conversation-filter" type="search" placeholder="Filter conversations" autocomplete="off" spellcheck="false"
        aria-label="Filter conversations" bind:value={listFilter} />
    </div>
    <ul id="conversation-list" class="conversation-list">
      {#each filteredConversations as entry (entry.id)}
        <!-- svelte-ignore a11y_no_noninteractive_element_interactions, a11y_no_static_element_interactions -->
        <li
          class="conversation-item"
          class:active={conversation?.id === entry.id}
          tabindex="0"
          role="button"
          aria-current={conversation?.id === entry.id ? 'true' : undefined}
          onclick={() => (location.hash = `#/c/${encodeURIComponent(entry.id)}`)}
          onkeydown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              location.hash = `#/c/${encodeURIComponent(entry.id)}`
            }
          }}
        >
          <div class="avatar" style={senderStyle(entry.id, (entry.senders && entry.senders[0]) ?? entry.name)}>{initials(entry.name)}</div>
          <div class="info">
            <div class="name">{entry.name}</div>
            <div class="meta">
              <span>{entry.messageCount.toLocaleString()} msgs</span>
              <span>{dateLabel(entry.last)}</span>
            </div>
          </div>
        </li>
      {/each}
    </ul>
  </aside>

  <section id="content" class="content" class:view-transcript={viewMode === 'transcript'} class:view-bubbles={viewMode === 'bubbles'} class:view-compact={viewMode === 'compact'}>
    {#if searchActive}
      <div class="search-view">
        <div class="search-filters">
          <select aria-label="Filter by conversation" value={searchFilters.conversation}
            onchange={(event) => { searchFilters = { ...searchFilters, conversation: event.target.value }; syncSearchHash(); runSearch(false) }}>
            <option value="">All conversations</option>
            {#each conversations as entry (entry.id)}
              <option value={entry.id}>{entry.name}</option>
            {/each}
          </select>
          <input class="sender-input" placeholder="Sender" aria-label="Filter by sender" value={searchFilters.sender}
            oninput={(event) => { searchFilters = { ...searchFilters, sender: event.target.value }; syncSearchHash(); runSearch(false) }} />
          <select aria-label="Filter by type" value={searchFilters.type}
            onchange={(event) => { searchFilters = { ...searchFilters, type: event.target.value }; syncSearchHash(); runSearch(false) }}>
            <option value="">Any type</option>
            {#each ['text', 'media', 'attachment', 'deleted', 'system'] as type}
              <option value={type}>{typeLabel(type)}</option>
            {/each}
          </select>
          <input type="date" title="From date" aria-label="From date" value={searchFilters.from}
            onchange={(event) => { searchFilters = { ...searchFilters, from: event.target.value }; syncSearchHash(); runSearch(false) }} />
          <input type="date" title="To date" aria-label="To date" value={searchFilters.to}
            onchange={(event) => { searchFilters = { ...searchFilters, to: event.target.value }; syncSearchHash(); runSearch(false) }} />
          <select aria-label="Result order" value={searchFilters.order}
            onchange={(event) => { searchFilters = { ...searchFilters, order: event.target.value }; syncSearchHash(); runSearch(false) }}>
            <option value="desc">Newest first</option>
            <option value="asc">Oldest first</option>
          </select>
          <label class="whole-toggle">
            <input type="checkbox" checked={searchFilters.whole === '1'}
              onchange={(event) => { searchFilters = { ...searchFilters, whole: event.target.checked ? '1' : '' }; syncSearchHash(); runSearch(false) }} />
            <span>Whole words</span>
          </label>
        </div>
        <div class="search-summary">{searchSummary}</div>
        <div class="search-results">
          {#if searchError}
            <div class="search-error">
              <span>{searchError}</span>
              <button onclick={() => runSearch(false)}>Retry</button>
            </div>
          {:else if !searchSummary}
            <div class="empty-state">Type to search, or use the filters above.</div>
          {/if}
          {#each searchResults as result (result.conversationId + ':' + result.index)}
            <!-- svelte-ignore a11y_no_noninteractive_element_interactions, a11y_no_static_element_interactions -->
            <div class="result" tabindex="0" role="button"
              onclick={() => openResult(result)}
              onkeydown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  openResult(result)
                }
              }}
            >
              <div class="line1">
                <span class="conversation-name">{result.conversationName}</span>
                <span class="result-time">{dateLabel(result.date)} {timeLabel(result.date)}</span>
                {#if result.sender}
                  <span class="sender-chip" style={senderStyle(result.conversationId, result.sender)}>{result.sender}</span>
                {/if}
                {#if typeLabel(result.type)}<span class="type-badge">{typeLabel(result.type)}</span>{/if}
              </div>
              <div class="snippet">
                {#if !result.matchLength}
                  {result.snippet}
                {:else}
                  {result.snippet.slice(0, result.matchStart)}<mark>{result.snippet.slice(result.matchStart, result.matchStart + result.matchLength)}</mark>{result.snippet.slice(result.matchStart + result.matchLength)}
                {/if}
              </div>
            </div>
          {/each}
          {#if searchRendered < searchTotal}
            <div class="sentinel" bind:this={sentinel} use:useSearchSentinel></div>
          {/if}
        </div>
      </div>
    {:else if conversation}
      <div class="conversation-header">
        <div class="titles">
          <h2>{conversation.name}</h2>
          <div class="meta">
            {conversation.messageCount.toLocaleString()} messages · {dateLabel(conversation.first)} → {dateLabel(conversation.last)} · {conversation.senders.length} participants
          </div>
        </div>
        <div class="mode-switch">
          <button class="mode-btn" data-mode="transcript" title="Transcript" aria-label="Transcript view" aria-pressed={viewMode === 'transcript'} onclick={() => setViewMode('transcript')}>
            <AlignLeft size={16} strokeWidth={1.8} />
          </button>
          <button class="mode-btn" data-mode="bubbles" title="Bubbles" aria-label="Bubbles view" aria-pressed={viewMode === 'bubbles'} onclick={() => setViewMode('bubbles')}>
            <MessageSquare size={16} strokeWidth={1.8} />
          </button>
          <button class="mode-btn" data-mode="compact" title="Compact" aria-label="Compact view" aria-pressed={viewMode === 'compact'} onclick={() => setViewMode('compact')}>
            <AlignJustify size={16} strokeWidth={1.8} />
          </button>
        </div>
      </div>
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div id="message-scroll" class="message-scroll" bind:this={scrollEl} onscroll={onMessageScroll}>
        {#if skeleton}
          <div class="message-rows">
            {#each Array(8) as _, index (index)}
              <div class="skeleton-row">
                <div class="skeleton skeleton-line short"></div>
                <div class="skeleton skeleton-line"></div>
                <div class="skeleton skeleton-line medium"></div>
              </div>
            {/each}
          </div>
        {:else}
          <div class="message-rows">
            {#each messageView as row (row.key)}
              {#if row.kind === 'date'}
                <div class="date-separator"><span>{row.label}</span></div>
              {:else}
                {@const message = row.message}
                <div
                  class={`message type-${message.type}${row.grouped ? ' grouped' : ''}`}
                  id={`m-${message.index}`}
                  style={message.sender ? senderStyle(conversation.id, message.sender) : ''}
                >
                  {#if viewMode === 'compact'}
                    <div class="body">
                      <span class="prefix">
                        <span class="time">{timeLabel(message.date)}</span>
                        {#if !row.grouped && message.sender}<span class="sender">{message.sender}: </span>{/if}
                      </span>
                      {#each bodyParts(message.body) as part}
                        {#if part.href}<a href={part.href} target="_blank" rel="noopener noreferrer">{part.href}</a>{:else}{part.text}{/if}
                      {/each}
                    </div>
                  {:else if viewMode === 'bubbles'}
                    <div class="bubble">
                      {#if !row.grouped}
                        <div class="line1">
                          {#if message.sender}<span class="sender">{message.sender}</span>{/if}
                          <span class="time">{timeLabel(message.date)}</span>
                        </div>
                      {/if}
                      <div class="body">
                        {#each bodyParts(message.body) as part}
                          {#if part.href}<a href={part.href} target="_blank" rel="noopener noreferrer">{part.href}</a>{:else}{part.text}{/if}
                        {/each}
                      </div>
                    </div>
                  {:else}
                    {#if !row.grouped}
                      <div class="line1">
                        {#if message.sender}<span class="sender">{message.sender}</span>{/if}
                        <span class="time">{timeLabel(message.date)}</span>
                      </div>
                    {/if}
                    <div class="body">
                      {#each bodyParts(message.body) as part}
                        {#if part.href}<a href={part.href} target="_blank" rel="noopener noreferrer">{part.href}</a>{:else}{part.text}{/if}
                      {/each}
                    </div>
                  {/if}
                </div>
              {/if}
            {/each}
          </div>
        {/if}
      </div>
      <div class="jump-controls">
        <button class="jump-btn" class:hidden={!topButtonVisible} title="Jump to the first message (Home)" aria-label="Jump to the first message" onclick={() => jumpTo(0)}>
          <ArrowUp size={16} strokeWidth={1.8} />
        </button>
        <button class="jump-btn" class:hidden={!latestButtonVisible} title="Jump to the latest message (End)" aria-label="Jump to the latest message" onclick={() => jumpTo(total - 1)}>
          <ArrowDown size={16} strokeWidth={1.8} />
        </button>
      </div>
    {:else}
      <div class="empty-state">
        <div>Pick a conversation or search your messages.</div>
        <div>Press / to search · Home / End jump within a conversation</div>
      </div>
    {/if}
  </section>
</main>

<dialog id="import-dialog" class="import-dialog" bind:this={importDialog}
  onclick={(event) => { if (event.target === importDialog) dismissImport() }}
  oncancel={(event) => { event.preventDefault(); dismissImport() }}>
  <article>
    <header class="card__header">
      <h2>Import chat exports</h2>
      <button class="outline secondary icon-button" aria-label="Close" onclick={dismissImport}>&times;</button>
    </header>
    <p class="import-hint">Upload WhatsApp exports (<code>.zip</code> or <code>.txt</code>). They are merged with the conversations stored here; nothing changes until you press Import. Preview shows the plan without writing anything.</p>
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div id="import-drop" class="import-drop"
      ondragover={(event) => { event.preventDefault(); event.currentTarget.classList.add('import-drop--over') }}
      ondragleave={(event) => event.currentTarget.classList.remove('import-drop--over')}
      ondrop={(event) => { event.preventDefault(); event.currentTarget.classList.remove('import-drop--over'); chooseImportFiles(event.dataTransfer.files) }}
    >
      <input id="import-files" type="file" multiple accept=".zip,.txt,application/zip,text/plain" hidden
        onchange={(event) => { chooseImportFiles(event.target.files); event.target.value = '' }} />
      <button type="button" id="import-browse" onclick={(event) => event.currentTarget.parentElement.querySelector('input').click()}>Choose files</button>
      <span class="import-drop__hint">or drop them here</span>
    </div>
    <ul id="import-list" class="import-list">
      {#each importFiles as entry (entry.name)}
        <li class={`import-item import-item--${entry.state}`}>
          <span class="import-item__name">{entry.name}</span>
          <span class="import-item__meta">
            {entry.state === 'done' ? `${formatSize(entry.size)} uploaded` : entry.state === 'error' ? (entry.error ?? 'failed') : entry.state}
          </span>
        </li>
      {/each}
    </ul>
    <p id="import-status" class="import-status" class:import-status--error={importStatusError} hidden={!importStatus}>{importStatus}</p>
    <pre id="import-result" class="import-result" hidden={!importResult}>{importResult}</pre>
    <div class="import-actions">
      <button type="button" id="import-discard" class="outline secondary" hidden={!(importFiles.length > 0 && !importBusy && !importImported)} onclick={discardImport}>Discard uploads</button>
      <span class="import-actions__spacer"></span>
      <button type="button" id="import-preview" disabled={!importUploaded || importBusy || importImported} onclick={() => runImport(true)}>Preview</button>
      <button type="button" id="import-run" disabled={!importUploaded || importBusy || importImported} onclick={() => runImport(false)}>Import</button>
      <button type="button" id="import-done" hidden={!importImported} onclick={() => importDialog.close()}>Done</button>
    </div>
  </article>
</dialog>
