import { useEffect, useMemo, useRef, useState } from 'react'
import { Import as ImportIcon, Menu, RefreshCw, X } from 'lucide-react'
import { getJson, postJson, ThemeToggle, uploadFile, usePolling } from '@dscpln/ui-kit'
import { buildSenderPalette, dateLabel, relativeTime } from './lib/format.js'
import Banner from './components/Banner.jsx'
import ConversationView from './components/ConversationView.jsx'
import ImportDialog from './components/ImportDialog.jsx'
import SearchView from './components/SearchView.jsx'
import Sidebar from './components/Sidebar.jsx'

const PAGE_SIZE = 200
const GROUP_WINDOW_MS = 5 * 60 * 1000
const MAX_ROWS = 3000

export default function App() {
  const [meta, setMeta] = useState(null)
  const [conversations, setConversations] = useState([])
  const [byId, setById] = useState(new Map())
  const [conversation, setConversation] = useState(null)
  const [total, setTotal] = useState(0)
  const [messages, setMessages] = useState(new Map())
  const [loadedFirst, setLoadedFirst] = useState(0)
  const [loadedLast, setLoadedLast] = useState(-1)
  const [loading, setLoading] = useState(false)
  const [skeleton, setSkeleton] = useState(false)
  const [bannerText, setBannerText] = useState('')
  const [bannerVisible, setBannerVisible] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [listFilter, setListFilter] = useState('')
  const [reloading, setReloading] = useState(false)

  const [searchQuery, setSearchQuery] = useState('')
  const [searchActive, setSearchActive] = useState(false)
  const [searchFilters, setSearchFilters] = useState({ conversation: '', sender: '', type: '', from: '', to: '', order: 'desc', whole: '' })
  const [searchResults, setSearchResults] = useState([])
  const [searchRendered, setSearchRendered] = useState(0)
  const [searchTotal, setSearchTotal] = useState(0)
  const [searchSummary, setSearchSummary] = useState('')
  const [searchLoading, setSearchLoading] = useState(false)
  const [searchError, setSearchError] = useState('')

  const [topButtonVisible, setTopButtonVisible] = useState(false)
  const [latestButtonVisible, setLatestButtonVisible] = useState(false)

  const [importOpen, setImportOpen] = useState(false)
  const [importBatch, setImportBatch] = useState(null)
  const [importFiles, setImportFiles] = useState([])
  const [importImported, setImportImported] = useState(false)
  const [importBusy, setImportBusy] = useState(false)
  const [importStatus, setImportStatus] = useState('')
  const [importStatusError, setImportStatusError] = useState(false)
  const [importResult, setImportResult] = useState('')

  const viewTokenRef = useRef(0)
  const bannerTimerRef = useRef(null)
  const searchTimerRef = useRef(null)
  const searchInputRef = useRef(null)
  const searchRunTokenRef = useRef(0)
  const sentinelRef = useRef(null)
  const scrollElRef = useRef(null)

  // Handlers read live state through this ref so the window listeners and
  // intervals never capture a stale render.
  const latest = useRef({})

  /* ---------- banner ---------- */

  const banner = (message) => {
    setBannerText(message)
    setBannerVisible(true)
    clearTimeout(bannerTimerRef.current)
    bannerTimerRef.current = setTimeout(() => setBannerVisible(false), 8000)
  }

  const hideBanner = () => {
    clearTimeout(bannerTimerRef.current)
    setBannerVisible(false)
  }

  /* ---------- sender colors ---------- */

  // Deterministic sender colors, computed once per conversation list (never
  // during render): storing this in state used to trigger React error #301
  // ("too many re-renders") with one nested update per conversation.
  const palettes = useMemo(() => {
    const map = new Map()
    for (const entry of conversations) {
      map.set(entry.id, buildSenderPalette(entry.senders))
    }
    return map
  }, [conversations])

  const senderColor = (conversationId, sender) => {
    if (!sender) return null
    return palettes.get(conversationId)?.get(sender) ?? {
      light: `hsl(${senderColorFallback(sender)} 55% 38%)`,
      dark: `hsl(${senderColorFallback(sender)} 60% 74%)`,
    }
  }

  const senderStyle = (conversationId, sender) => {
    const color = senderColor(conversationId, sender)
    return color ? { '--sender-color': color.light, '--sender-color-dark': color.dark } : undefined
  }

  const statusText = (() => {
    if (!meta) return ''
    const skipped = meta.skipped.length ? ` · ${meta.skipped.length} skipped` : ''
    return `${meta.conversations} chats · ${meta.messages.toLocaleString()} msgs${skipped}`
  })()
  const statusTitle = (() => {
    if (!meta) return ''
    const skippedDetail = meta.skipped.length
      ? `\n\nSkipped:\n${meta.skipped.map((item) => `${item.file}: ${item.reason}`).join('\n')}`
      : ''
    return `Indexed ${relativeTime(meta.indexedAt)}${skippedDetail}`
  })()

  const filteredConversations = conversations.filter(
    (entry) => !listFilter || entry.name.toLowerCase().includes(listFilter.toLowerCase()))

  const messageView = (() => {
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
  })()

  /* ---------- loading ---------- */

  const loadConversations = async () => {
    const next = await getJson('api/conversations')
    setConversations(next)
    setById(new Map(next.map((entry) => [entry.id, entry])))
  }

  const loadMeta = async () => {
    setMeta(await getJson('api/state'))
  }

  const updateJumpVisibility = () => {
    const scrollEl = scrollElRef.current
    if (!scrollEl) return
    setTopButtonVisible(scrollEl.scrollTop >= 80)
    setLatestButtonVisible(scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight >= 80)
  }

  const loadPage = async (offset, { preserveScroll = false } = {}) => {
    if (loading || !latest.current.conversation) return
    setLoading(true)
    const token = viewTokenRef.current
    const scrollEl = scrollElRef.current
    const beforeHeight = scrollEl ? scrollEl.scrollHeight : 0
    try {
      const target = latest.current.conversation
      const data = await getJson(`api/conversations/${encodeURIComponent(target.id)}/messages?offset=${offset}&limit=${PAGE_SIZE}`)
      if (token !== viewTokenRef.current) return

      const nextMessages = new Map(messages)
      for (const message of data.messages) nextMessages.set(message.index, message)
      let first = Math.min(loadedFirst, data.offset)
      let last = Math.max(loadedLast, data.offset + data.messages.length - 1)
      // Drop the oldest/newest pages farthest from the centre so jumping
      // around a huge conversation keeps the DOM bounded.
      while (nextMessages.size > MAX_ROWS) {
        const center = (first + last) / 2
        if (last - center >= center - first) {
          for (let index = last; index > last - PAGE_SIZE; index -= 1) nextMessages.delete(index)
          last -= PAGE_SIZE
        } else {
          for (let index = first; index < first + PAGE_SIZE; index += 1) nextMessages.delete(index)
          first += PAGE_SIZE
        }
      }
      setMessages(nextMessages)
      setLoadedFirst(first)
      setLoadedLast(last)
      await new Promise((resolve) => requestAnimationFrame(() => resolve()))
      if (preserveScroll && scrollElRef.current) {
        scrollElRef.current.scrollTop += scrollElRef.current.scrollHeight - beforeHeight
      }
      updateJumpVisibility()
    } catch (error) {
      if (token === viewTokenRef.current && messages.size === 0) banner(`Failed to load messages: ${error.message}`)
    } finally {
      setLoading(false)
      setSkeleton(false)
    }
  }

  const onMessageScroll = () => {
    const scrollEl = scrollElRef.current
    if (!scrollEl || loading || !latest.current.conversation) return
    if (scrollEl.scrollTop < 400 && loadedFirst > 0) {
      loadPage(Math.max(0, loadedFirst - PAGE_SIZE), { preserveScroll: true })
    } else if (scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight < 600 && loadedLast < total - 1) {
      loadPage(loadedLast + 1)
    }
    updateJumpVisibility()
  }

  const scrollToIndex = (index) => {
    const row = document.getElementById(`m-${index}`)
    if (!row) return
    row.scrollIntoView({ block: 'center' })
    row.classList.add('flash')
    setTimeout(() => row.classList.remove('flash'), 1600)
  }

  const openConversation = async (id, at = null) => {
    setSearchActive(false)
    const entry = byId.get(id)
    if (!entry) {
      setConversation(null)
      banner('Conversation not found')
      return
    }
    setConversation(entry)
    setTotal(entry.messageCount)
    setMessages(new Map())
    setLoadedFirst(0)
    setLoadedLast(-1)
    viewTokenRef.current += 1
    setLoading(false)
    setSidebarOpen(false)
    setSkeleton(true)
    const target = at != null ? Number.parseInt(at, 10) : null
    const offset = target != null && !Number.isNaN(target)
      ? Math.max(0, Math.min(target, entry.messageCount - 1) - Math.floor(PAGE_SIZE / 2))
      : 0
    await new Promise((resolve) => requestAnimationFrame(() => resolve()))
    await loadPage(offset)
    if (target != null && !Number.isNaN(target)) scrollToIndex(target)
    updateJumpVisibility()
  }

  const jumpTo = async (index) => {
    if (!latest.current.conversation || latest.current.total === 0) return
    const target = Math.max(0, Math.min(index, latest.current.total - 1))
    setMessages(new Map())
    setLoadedFirst(0)
    setLoadedLast(-1)
    viewTokenRef.current += 1
    setLoading(false)
    setSkeleton(true)
    await new Promise((resolve) => requestAnimationFrame(() => resolve()))
    const offset = Math.max(0, target - Math.floor(PAGE_SIZE / 2))
    await loadPage(offset)
    const scrollEl = scrollElRef.current
    if (scrollEl) {
      if (target === 0) scrollEl.scrollTop = 0
      else if (target >= latest.current.total - 1) scrollEl.scrollTop = scrollEl.scrollHeight
      else scrollToIndex(target)
    }
    updateJumpVisibility()
  }

  /* ---------- search ---------- */

  const syncSearchHash = (filters = searchFilters, query = searchQuery) => {
    const params = new URLSearchParams()
    if (query) params.set('q', query)
    for (const key of ['conversation', 'sender', 'type', 'from', 'to']) if (filters[key]) params.set(key, filters[key])
    if (filters.order === 'asc') params.set('order', 'asc')
    if (filters.whole) params.set('whole', '1')
    history.replaceState(null, '', `#/search${params.toString() ? `?${params}` : ''}`)
  }

  const runSearch = async (append = false) => {
    const filters = searchFilters
    if (!searchQuery.trim() && !['conversation', 'sender', 'type', 'from', 'to', 'whole'].some((key) => filters[key])) {
      setSearchResults([])
      setSearchSummary('')
      setSearchTotal(0)
      return
    }
    if (searchLoading) return
    setSearchLoading(true)
    const token = ++searchRunTokenRef.current
    const offset = append ? searchRendered : 0
    try {
      const params = new URLSearchParams({ q: searchQuery, order: filters.order, limit: '50', offset: String(offset) })
      for (const key of ['conversation', 'sender', 'type', 'from', 'to']) if (filters[key]) params.set(key, filters[key])
      if (filters.whole) params.set('whole', '1')
      const data = await getJson(`api/search?${params}`)
      if (token !== searchRunTokenRef.current) return
      setSearchResults((current) => (append ? [...current, ...data.results] : data.results))
      setSearchRendered(offset + data.results.length)
      setSearchTotal(data.total)
      setSearchError('')
      setSearchSummary(searchQuery.trim()
        ? `${data.total.toLocaleString()} result${data.total === 1 ? '' : 's'} for “${searchQuery.trim()}”`
        : `${data.total.toLocaleString()} message${data.total === 1 ? '' : 's'}`)
    } catch (error) {
      if (token === searchRunTokenRef.current) setSearchError(`Search failed: ${error.message}`)
    } finally {
      if (token === searchRunTokenRef.current) setSearchLoading(false)
    }
  }

  const searchValue = () => (searchInputRef.current ? searchInputRef.current.value : '').trim()

  const onSearchInput = () => {
    clearTimeout(searchTimerRef.current)
    searchTimerRef.current = setTimeout(() => {
      const value = searchValue()
      setSearchQuery(value)
      if (latest.current.searchActive) {
        syncSearchHash(searchFilters, value)
        runSearch(false)
      } else if (value) {
        location.hash = `#/search?q=${encodeURIComponent(value)}`
      }
    }, 250)
  }

  const clearSearch = () => {
    if (searchInputRef.current) searchInputRef.current.value = ''
    setSearchQuery('')
    if (latest.current.searchActive) {
      syncSearchHash(searchFilters, '')
      runSearch(false)
    }
    searchInputRef.current?.focus()
  }

  const submitSearch = (event) => {
    event.preventDefault()
    const value = searchValue()
    setSearchQuery(value)
    if (value) location.hash = `#/search?q=${encodeURIComponent(value)}`
    else if (latest.current.searchActive) {
      syncSearchHash(searchFilters, '')
      runSearch(false)
    }
  }

  const setSearchFilter = (key, value) => {
    const next = { ...searchFilters, [key]: value }
    setSearchFilters(next)
    syncSearchHash(next)
    runSearch(false)
  }

  /* ---------- import ---------- */

  const openImport = () => {
    setImportImported(false)
    setImportStatus('')
    setImportStatusError(false)
    setImportResult('')
    setImportOpen(true)
  }

  const dismissImport = async () => {
    if (importBusy) return
    if (importFiles.length > 0 && importBatch) {
      await discardImport()
      banner('Import cancelled — staged uploads discarded.')
    }
    setImportOpen(false)
  }

  const discardImport = async () => {
    if (!importBatch) return
    await postJson('api/import/cancel', { batch: importBatch }).catch(() => {})
    setImportBatch(null)
    setImportFiles([])
    setImportResult('')
    setImportStatus('Uploads discarded.')
    setImportStatusError(false)
  }

  const chooseImportFiles = async (fileList) => {
    if (importBusy || importImported) return
    const all = [...fileList]
    const accepted = all.filter((file) => /\.(zip|txt)$/i.test(file.name))
    if (accepted.length < all.length) {
      setImportStatus(`${all.length - accepted.length} file(s) skipped (only .zip and .txt are accepted)`)
      setImportStatusError(true)
    } else {
      setImportStatus('')
      setImportStatusError(false)
    }
    if (accepted.length === 0) return
    const batch = importBatch ?? `imp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    if (!importBatch) setImportBatch(batch)
    const patchItem = (name, values) => {
      setImportFiles((current) => current.map((item) => (item.name === name ? { ...item, ...values } : item)))
    }
    for (const file of accepted) {
      let skipped = false
      setImportFiles((current) => {
        if (current.some((entry) => entry.name === file.name)) {
          skipped = true
          return current
        }
        return [...current, { name: file.name, size: file.size, state: 'uploading' }]
      })
      if (skipped) continue
      try {
        const body = await uploadFile(
          `api/import/upload?batch=${encodeURIComponent(batch)}&name=${encodeURIComponent(file.name)}`,
          file,
        )
        patchItem(file.name, { state: 'done', size: body.size })
      } catch (error) {
        patchItem(file.name, { state: 'error', error: error.message })
      }
    }
  }

  const importUploaded = importFiles.some((entry) => entry.state === 'done')

  const runImport = async (dryRun) => {
    if (importBusy) return
    setImportBusy(true)
    setImportResult('')
    setImportStatus(dryRun ? 'Building preview…' : 'Merging…')
    setImportStatusError(false)
    try {
      const summary = await postJson('api/import/merge', { batch: importBatch, dryRun })
      const lines = [dryRun ? '=== Preview: no files were renamed, deleted or written ===' : '=== Import complete ===']
      lines.push(`${summary.conversations} conversation(s) · ${summary.multiSource} merged from multiple sources · ${summary.renamedGroups} renamed group(s)`)
      for (const name of summary.names.slice(0, 30)) lines.push(`  ${name}`)
      if (summary.names.length > 30) lines.push(`  … and ${summary.names.length - 30} more`)
      for (const item of summary.ambiguous ?? []) {
        lines.push(`ambiguous dates: ${item.file} · ${item.count} line(s) resolved as ${item.order.toUpperCase()} (${item.orderSource})`)
      }
      setImportResult(lines.join('\n'))
      if (dryRun) {
        setImportStatus('Preview only — nothing was written.')
      } else {
        setImportImported(true)
        setImportBatch(null)
        setImportFiles([])
        setImportStatus('Import complete.')
        await Promise.all([loadMeta(), loadConversations()])
        await latest.current.handleRoute()
      }
    } catch (error) {
      setImportStatus(error.message)
      setImportStatusError(true)
    } finally {
      setImportBusy(false)
    }
  }

  /* ---------- routing + chrome ---------- */

  const parseHash = () => {
    const raw = location.hash.replace(/^#\/?/, '')
    const [route, query] = raw.split('?')
    const params = new URLSearchParams(query ?? '')
    if (route.startsWith('c/')) return { view: 'conversation', id: decodeURIComponent(route.slice(2)), at: params.get('at') }
    if (route.startsWith('search')) return { view: 'search', q: params.get('q') ?? '', params }
    return { view: 'empty' }
  }

  const handleRoute = async () => {
    const route = parseHash()
    if (route.view === 'conversation') {
      setSearchActive(false)
      await openConversation(route.id, route.at)
    } else if (route.view === 'search') {
      if (searchInputRef.current) searchInputRef.current.value = route.q
      setSearchQuery(route.q)
      setSearchActive(true)
      setSearchFilters({
        conversation: route.params.get('conversation') ?? '',
        sender: route.params.get('sender') ?? '',
        type: route.params.get('type') ?? '',
        from: route.params.get('from') ?? '',
        to: route.params.get('to') ?? '',
        order: route.params.get('order') === 'asc' ? 'asc' : 'desc',
        whole: route.params.get('whole') === '1' ? '1' : '',
      })
      setConversation(null)
      setSearchResults([])
      setSearchRendered(0)
      if (route.q.trim() || [...route.params.keys()].some((key) => key !== 'q')) {
        await runSearch(false)
      } else {
        setSearchSummary('')
        setSearchTotal(0)
      }
    } else {
      setConversation(null)
      setSearchActive(false)
      setSearchResults([])
    }
  }

  const reload = async () => {
    if (reloading) return
    setReloading(true)
    try {
      setMeta(await postJson('api/reload', {}))
      await loadConversations()
      await latest.current.handleRoute()
    } catch (error) {
      banner(`Reindex failed: ${error.message}`)
    } finally {
      setReloading(false)
    }
  }

  const moveResultFocus = (delta) => {
    const results = [...document.querySelectorAll('.search-results .result')]
    if (!results.length) return
    const current = results.indexOf(document.activeElement)
    const next = current === -1 ? (delta > 0 ? 0 : results.length - 1) : Math.min(Math.max(current + delta, 0), results.length - 1)
    results[next].focus()
  }

  const openResult = (result) => {
    location.hash = `#/c/${encodeURIComponent(result.conversationId)}?at=${result.index}`
  }

  const onKeydown = (event) => {
    const current = latest.current
    if (current.importOpen) return
    const typing = /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement?.tagName ?? '')
    if (event.key === '/' && !typing) {
      event.preventDefault()
      searchInputRef.current?.focus()
      return
    }
    if (event.key === 'Escape') {
      if (typing) document.activeElement.blur()
      else if (current.searchActive && document.activeElement?.classList.contains('result')) searchInputRef.current?.focus()
      else location.hash = '#/'
      return
    }
    if (typing) {
      const arrowIntoResults = current.searchActive &&
        (event.key === 'ArrowDown' || event.key === 'ArrowUp') &&
        (document.activeElement === searchInputRef.current || ['SELECT', 'INPUT'].includes(document.activeElement?.tagName ?? ''))
      if (arrowIntoResults) {
        event.preventDefault()
        current.moveResultFocus(event.key === 'ArrowDown' ? 1 : -1)
      }
      return
    }
    if (current.searchActive) {
      if (event.key === 'j' || event.key === 'ArrowDown') {
        event.preventDefault()
        current.moveResultFocus(1)
      } else if (event.key === 'k' || event.key === 'ArrowUp') {
        event.preventDefault()
        current.moveResultFocus(-1)
      }
      return
    }
    if (current.conversation) {
      if (event.key === 'Home') {
        event.preventDefault()
        current.jumpTo(0)
      } else if (event.key === 'End') {
        event.preventDefault()
        current.jumpTo(current.total - 1)
      } else if (event.key === 'j') {
        scrollElRef.current?.scrollBy({ top: 120 })
      } else if (event.key === 'k') {
        scrollElRef.current?.scrollBy({ top: -120 })
      }
    }
  }

  latest.current = {
    conversation,
    searchActive,
    total,
    importOpen,
    jumpTo,
    moveResultFocus,
    handleRoute,
    runSearch,
  }

  /* ---------- effects ---------- */

  useEffect(() => {
    const onHash = () => latest.current.handleRoute()
    const onKey = (event) => onKeydown(event)
    window.addEventListener('hashchange', onHash)
    window.addEventListener('keydown', onKey)
    ;(async () => {
      try {
        await Promise.all([loadMeta(), loadConversations()])
        await latest.current.handleRoute()
      } catch (error) {
        banner(`Failed to load: ${error.message}`)
      }
    })()
    return () => {
      window.removeEventListener('hashchange', onHash)
      window.removeEventListener('keydown', onKey)
    }
  }, [])

  // Refresh the conversation list in the background while browsing.
  usePolling(() => {
    if (!latest.current.conversation) return loadConversations()
    return undefined
  }, 15_000, { runImmediately: false })

  // Infinite scrolling for search results.
  useEffect(() => {
    const node = sentinelRef.current
    if (!node) return undefined
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting) && searchRendered < searchTotal && !searchLoading) {
        latest.current.runSearch(true)
      }
    }, { rootMargin: '240px' })
    observer.observe(node)
    return () => observer.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchRendered < searchTotal])

  /* ---------- render ---------- */

  return (
    <>
      <header className="topbar app-header">
        <div className="app-header__top">
          <h1><a className="app-header__brand" href="/">D<span className="accent">$</span>CPLN</a> <span className="app-header__app">⋅ WhatsApp TXT</span></h1>
          <button id="sidebar-toggle" className="outline secondary icon-button" aria-label="Toggle conversation list" onClick={() => setSidebarOpen((open) => !open)}>
            <Menu size={16} strokeWidth={1.8} />
          </button>
          <form id="search-form" className="search-form" role="search" onSubmit={submitSearch}>
            <span className="search-box">
              <input id="search-input" ref={searchInputRef} type="search" placeholder="Search messages…  /" autoComplete="off" spellCheck="false"
                aria-label="Search messages" onInput={onSearchInput} />
              {searchQuery ? (
                <button type="button" id="search-clear" className="clear-btn" aria-label="Clear search" onClick={clearSearch}>
                  <X size={15} strokeWidth={1.8} />
                </button>
              ) : null}
            </span>
          </form>
          <span id="status" className="status muted" role="status" title={statusTitle}>{statusText}</span>
          <span className="app-header__actions">
            <button id="import" className="outline secondary icon-button" aria-label="Import chat exports" title="Import exports" onClick={openImport}>
              <ImportIcon size={16} strokeWidth={1.8} />
            </button>
            <button id="reload" className={`outline secondary icon-button${reloading ? ' spin' : ''}`} aria-label="Reindex the data directory" title="Reindex" onClick={reload}>
              <RefreshCw size={16} strokeWidth={1.8} />
            </button>
            <ThemeToggle />
          </span>
        </div>
      </header>

      <Banner text={bannerText} visible={bannerVisible} onDismiss={hideBanner} />

      <main className="layout">
        <Sidebar
          conversations={filteredConversations}
          activeId={conversation?.id}
          open={sidebarOpen}
          filter={listFilter}
          onFilterChange={setListFilter}
          senderStyle={senderStyle}
          onOpen={(id) => (location.hash = `#/c/${encodeURIComponent(id)}`)}
        />

        <section id="content" className="content view-bubbles">
          {searchActive ? (
            <SearchView
              conversations={conversations}
              filters={searchFilters}
              summary={searchSummary}
              error={searchError}
              results={searchResults}
              renderedCount={searchRendered}
              totalCount={searchTotal}
              onFilter={setSearchFilter}
              onRetry={() => runSearch(false)}
              onOpenResult={openResult}
              senderStyle={senderStyle}
              sentinelRef={sentinelRef}
            />
          ) : conversation ? (
            <ConversationView
              conversation={conversation}
              messageView={messageView}
              skeleton={skeleton}
              scrollRef={scrollElRef}
              onScroll={onMessageScroll}
              topVisible={topButtonVisible}
              latestVisible={latestButtonVisible}
              onJumpFirst={() => jumpTo(0)}
              onJumpLatest={() => jumpTo(total - 1)}
              senderStyle={senderStyle}
            />
          ) : (
            <div className="empty-state">
              <div>Pick a conversation or search your messages.</div>
              <div>Press / to search · Home / End jump within a conversation</div>
            </div>
          )}
        </section>
      </main>

      <ImportDialog
        open={importOpen}
        busy={importBusy}
        imported={importImported}
        uploaded={importUploaded}
        files={importFiles}
        status={importStatus}
        statusError={importStatusError}
        result={importResult}
        onChooseFiles={chooseImportFiles}
        onDiscard={discardImport}
        onRun={runImport}
        onClose={dismissImport}
      />
    </>
  )
}

// Fallback hue for senders that are not part of the conversation's palette
// (e.g. search results from older data) — kept out of lib/format.js because
// it shares the hue math with buildSenderPalette.
function senderColorFallback(sender) {
  let hash = 0
  for (const char of sender) hash = (hash * 31 + char.codePointAt(0)) % 360
  return hash
}
