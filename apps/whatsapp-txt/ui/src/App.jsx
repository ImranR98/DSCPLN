import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, Import, Menu, RefreshCw, X } from 'lucide-react'
import { apiUrl, formatDateTime, getJson, postJson, ThemeToggle } from '@dscpln/ui-kit'

const PAGE_SIZE = 200
const GROUP_WINDOW_MS = 5 * 60 * 1000
const MAX_ROWS = 3000

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

const formatSize = (bytes) => {
  if (!Number.isFinite(bytes)) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
const newBatch = () => `imp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()))

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
  const sentinelRef = useRef(null)
  const scrollElRef = useRef(null)
  const importDialogRef = useRef(null)

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
      light: `hsl(${senderHue(sender)} 55% 38%)`,
      dark: `hsl(${senderHue(sender)} 60% 74%)`,
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

  const latest = useRef({})

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
      // prune() keeps the DOM bounded while jumping around (same policy as the
      // Svelte implementation: drop the page farthest from the centre).
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
      await nextFrame()
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
    await nextFrame()
    await loadPage(offset)
    if (target != null && !Number.isNaN(target)) scrollToIndex(target)
    updateJumpVisibility()
  }

  const scrollToIndex = (index) => {
    const row = document.getElementById(`m-${index}`)
    if (!row) return
    row.scrollIntoView({ block: 'center' })
    row.classList.add('flash')
    setTimeout(() => row.classList.remove('flash'), 1600)
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
    await nextFrame()
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
  const searchRunTokenRef = useRef(0)

  const searchValue = () => (searchInputRef.current ? searchInputRef.current.value : '').trim()

  const onSearchInput = () => {
    clearTimeout(searchTimerRef.current)
    searchTimerRef.current = setTimeout(() => {
      setSearchQuery(searchValue())
      if (latest.current.searchActive) {
        syncSearchHash(searchFilters, searchValue())
        runSearch(false)
      } else if (searchValue()) {
        location.hash = `#/search?q=${encodeURIComponent(searchValue())}`
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

  useEffect(() => {
    const node = sentinelRef.current
    if (!node) return undefined
    const observer = new IntersectionObserver((entries) => {
      const current = latest.current
      if (entries.some((entry) => entry.isIntersecting) && current.searchRendered < current.searchTotal && !current.searchLoading) {
        current.runSearch(true)
      }
    }, { rootMargin: '240px' })
    observer.observe(node)
    return () => observer.disconnect()
  }, [searchRendered < searchTotal])

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

  const dismissImportRef = useRef(null)
  dismissImportRef.current = dismissImport

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
    const batch = importBatch ?? newBatch()
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
        const response = await fetch(apiUrl(`api/import/upload?batch=${encodeURIComponent(batch)}&name=${encodeURIComponent(file.name)}`), {
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
        await handleRoute()
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
    const timer = setInterval(() => {
      if (!latest.current.conversation) loadConversations().catch(() => {})
    }, 15_000)
    return () => {
      window.removeEventListener('hashchange', onHash)
      window.removeEventListener('keydown', onKey)
      clearInterval(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const element = importDialogRef.current
    if (!element) return undefined
    const handleCancel = (event) => {
      event.preventDefault()
      dismissImportRef.current?.()
    }
    element.addEventListener('cancel', handleCancel)
    return () => element.removeEventListener('cancel', handleCancel)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const element = importDialogRef.current
    if (!element) return
    if (importOpen && !element.open) element.showModal()
    else if (!importOpen && element.open) element.close()
  }, [importOpen])

  latest.current = {
    conversation,
    searchActive,
    total,
    importOpen,
    jumpTo,
    moveResultFocus,
    handleRoute,
    runSearch,
    reload,
    searchLoading,
    searchRendered,
    searchTotal,
  }

  const setFilter = (key, value) => {
    const next = { ...searchFilters, [key]: value }
    setSearchFilters(next)
    syncSearchHash(next)
    runSearch(false)
  }

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
              <Import size={16} strokeWidth={1.8} />
            </button>
            <button id="reload" className={`outline secondary icon-button${reloading ? ' spin' : ''}`} aria-label="Reindex the data directory" title="Reindex" onClick={reload}>
              <RefreshCw size={16} strokeWidth={1.8} />
            </button>
            <ThemeToggle />
          </span>
        </div>
      </header>

      <div id="banner" className="banner" role="alert" hidden={!bannerVisible}>
        <span id="banner-text">{bannerText}</span>
        <button id="banner-close" className="icon-btn" aria-label="Dismiss notification" onClick={hideBanner}>
          <X size={15} strokeWidth={1.8} />
        </button>
      </div>

      <main className="layout">
        <aside id="sidebar" className={`sidebar${sidebarOpen ? ' open' : ''}`} aria-label="Conversations">
          <div className="sidebar-head">
            <input id="conversation-filter" type="search" placeholder="Filter conversations" autoComplete="off" spellCheck="false"
              aria-label="Filter conversations" value={listFilter} onChange={(event) => setListFilter(event.target.value)} />
          </div>
          <ul id="conversation-list" className="conversation-list">
            {filteredConversations.map((entry) => (
              <li
                key={entry.id}
                className={`conversation-item${conversation?.id === entry.id ? ' active' : ''}`}
                tabIndex="0"
                role="button"
                aria-current={conversation?.id === entry.id ? 'true' : undefined}
                onClick={() => (location.hash = `#/c/${encodeURIComponent(entry.id)}`)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    location.hash = `#/c/${encodeURIComponent(entry.id)}`
                  }
                }}
              >
                <div className="avatar" style={senderStyle(entry.id, (entry.senders && entry.senders[0]) ?? entry.name)}>{initials(entry.name)}</div>
                <div className="info">
                  <div className="name">{entry.name}</div>
                  <div className="meta">
                    <span>{entry.messageCount.toLocaleString()} msgs</span>
                    <span>{dateLabel(entry.last)}</span>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </aside>

        <section id="content" className="content view-bubbles">
          {searchActive ? (
            <div className="search-view">
              <div className="search-filters">
                <select aria-label="Filter by conversation" value={searchFilters.conversation}
                  onChange={(event) => setFilter('conversation', event.target.value)}>
                  <option value="">All conversations</option>
                  {conversations.map((entry) => (
                    <option key={entry.id} value={entry.id}>{entry.name}</option>
                  ))}
                </select>
                <input className="sender-input" placeholder="Sender" aria-label="Filter by sender" value={searchFilters.sender}
                  onChange={(event) => {
                    const next = { ...searchFilters, sender: event.target.value }
                    setSearchFilters(next)
                    syncSearchHash(next)
                    runSearch(false)
                  }} />
                <select aria-label="Filter by type" value={searchFilters.type}
                  onChange={(event) => setFilter('type', event.target.value)}>
                  <option value="">Any type</option>
                  {['text', 'media', 'attachment', 'deleted', 'system'].map((type) => (
                    <option key={type} value={type}>{typeLabel(type)}</option>
                  ))}
                </select>
                <input type="date" title="From date" aria-label="From date" value={searchFilters.from}
                  onChange={(event) => setFilter('from', event.target.value)} />
                <input type="date" title="To date" aria-label="To date" value={searchFilters.to}
                  onChange={(event) => setFilter('to', event.target.value)} />
                <select aria-label="Result order" value={searchFilters.order}
                  onChange={(event) => setFilter('order', event.target.value)}>
                  <option value="desc">Newest first</option>
                  <option value="asc">Oldest first</option>
                </select>
                <label className="whole-toggle">
                  <input type="checkbox" checked={searchFilters.whole === '1'}
                    onChange={(event) => setFilter('whole', event.target.checked ? '1' : '')} />
                  <span>Whole words</span>
                </label>
              </div>
              <div className="search-summary">{searchSummary}</div>
              <div className="search-results">
                {searchError ? (
                  <div className="search-error">
                    <span>{searchError}</span>
                    <button onClick={() => runSearch(false)}>Retry</button>
                  </div>
                ) : !searchSummary ? (
                  <div className="empty-state">Type to search, or use the filters above.</div>
                ) : null}
                {searchResults.map((result) => (
                  <div className="result" tabIndex="0" role="button" key={`${result.conversationId}:${result.index}`}
                    onClick={() => openResult(result)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        openResult(result)
                      }
                    }}
                  >
                    <div className="line1">
                      <span className="conversation-name">{result.conversationName}</span>
                      <span className="result-time">{dateLabel(result.date)} {timeLabel(result.date)}</span>
                      {result.sender ? (
                        <span className="sender-chip" style={senderStyle(result.conversationId, result.sender)}>{result.sender}</span>
                      ) : null}
                      {typeLabel(result.type) ? <span className="type-badge">{typeLabel(result.type)}</span> : null}
                    </div>
                    <div className="snippet">
                      {!result.matchLength ? (
                        result.snippet
                      ) : (
                        <>
                          {result.snippet.slice(0, result.matchStart)}<mark>{result.snippet.slice(result.matchStart, result.matchStart + result.matchLength)}</mark>{result.snippet.slice(result.matchStart + result.matchLength)}
                        </>
                      )}
                    </div>
                  </div>
                ))}
                {searchRendered < searchTotal ? (
                  <div className="sentinel" ref={sentinelRef}></div>
                ) : null}
              </div>
            </div>
          ) : conversation ? (
            <>
              <div className="conversation-header">
                <div className="titles">
                  <h2>{conversation.name}</h2>
                  <div className="meta">
                    {conversation.messageCount.toLocaleString()} messages · {dateLabel(conversation.first)} → {dateLabel(conversation.last)} · {conversation.senders.length} participants
                  </div>
                </div>
              </div>
              <div id="message-scroll" className="message-scroll" ref={scrollElRef} onScroll={onMessageScroll}>
                {skeleton ? (
                  <div className="message-rows">
                    {Array.from({ length: 8 }, (_, index) => (
                      <div className="skeleton-row" key={index}>
                        <div className="skeleton skeleton-line short"></div>
                        <div className="skeleton skeleton-line"></div>
                        <div className="skeleton skeleton-line medium"></div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="message-rows">
                    {messageView.map((row) => {
                      if (row.kind === 'date') {
                        return <div className="date-separator" key={row.key}><span>{row.label}</span></div>
                      }
                      const message = row.message
                      return (
                        <div
                          key={row.key}
                          className={`message type-${message.type}${row.grouped ? ' grouped' : ''}`}
                          id={`m-${message.index}`}
                          style={message.sender ? senderStyle(conversation.id, message.sender) : undefined}
                        >
                          <div className="bubble">
                            {!row.grouped ? (
                              <div className="line1">
                                {message.sender ? <span className="sender">{message.sender}</span> : null}
                                <span className="time">{timeLabel(message.date)}</span>
                              </div>
                            ) : null}
                            <div className="body">
                              {bodyParts(message.body).map((part, index) => (
                                part.href
                                  ? <a key={index} href={part.href} target="_blank" rel="noopener noreferrer">{part.href}</a>
                                  : part.text
                              ))}
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
              <div className="jump-controls">
                <button className={`jump-btn${topButtonVisible ? '' : ' hidden'}`} title="Jump to the first message (Home)" aria-label="Jump to the first message" onClick={() => jumpTo(0)}>
                  <ArrowUp size={16} strokeWidth={1.8} />
                </button>
                <button className={`jump-btn${latestButtonVisible ? '' : ' hidden'}`} title="Jump to the latest message (End)" aria-label="Jump to the latest message" onClick={() => jumpTo(total - 1)}>
                  <ArrowDown size={16} strokeWidth={1.8} />
                </button>
              </div>
            </>
          ) : (
            <div className="empty-state">
              <div>Pick a conversation or search your messages.</div>
              <div>Press / to search · Home / End jump within a conversation</div>
            </div>
          )}
        </section>
      </main>

      <dialog id="import-dialog" className="import-dialog" ref={importDialogRef}
        onClick={(event) => { if (event.target === importDialogRef.current) dismissImport() }}>
        <article>
          <header className="card__header">
            <h2>Import chat exports</h2>
            <button className="outline secondary icon-button" aria-label="Close" onClick={dismissImport}>&times;</button>
          </header>
          <p className="import-hint">Upload WhatsApp exports (<code>.zip</code> or <code>.txt</code>). They are merged with the conversations stored here; nothing changes until you press Import. Preview shows the plan without writing anything.</p>
          <div id="import-drop" className="import-drop"
            onDragOver={(event) => { event.preventDefault(); event.currentTarget.classList.add('import-drop--over') }}
            onDragLeave={(event) => event.currentTarget.classList.remove('import-drop--over')}
            onDrop={(event) => { event.preventDefault(); event.currentTarget.classList.remove('import-drop--over'); chooseImportFiles(event.dataTransfer.files) }}
          >
            <input id="import-files" type="file" multiple accept=".zip,.txt,application/zip,text/plain" hidden
              onChange={(event) => { chooseImportFiles(event.target.files); event.target.value = '' }} />
            <button type="button" id="import-browse" onClick={(event) => event.currentTarget.parentElement.querySelector('input').click()}>Choose files</button>
            <span className="import-drop__hint">or drop them here</span>
          </div>
          <ul id="import-list" className="import-list">
            {importFiles.map((entry) => (
              <li className={`import-item import-item--${entry.state}`} key={entry.name}>
                <span className="import-item__name">{entry.name}</span>
                <span className="import-item__meta">
                  {entry.state === 'done' ? `${formatSize(entry.size)} uploaded` : entry.state === 'error' ? (entry.error ?? 'failed') : entry.state}
                </span>
              </li>
            ))}
          </ul>
          <p id="import-status" className={`import-status${importStatusError ? ' import-status--error' : ''}`} hidden={!importStatus}>{importStatus}</p>
          <pre id="import-result" className="import-result" hidden={!importResult}>{importResult}</pre>
          <div className="import-actions">
            <button type="button" id="import-discard" className="outline secondary" hidden={!(importFiles.length > 0 && !importBusy && !importImported)} onClick={discardImport}>Discard uploads</button>
            <span className="import-actions__spacer"></span>
            <button type="button" id="import-preview" disabled={!importUploaded || importBusy || importImported} onClick={() => runImport(true)}>Preview</button>
            <button type="button" id="import-run" disabled={!importUploaded || importBusy || importImported} onClick={() => runImport(false)}>Import</button>
            <button type="button" id="import-done" hidden={!importImported} onClick={() => setImportOpen(false)}>Done</button>
          </div>
        </article>
      </dialog>
    </>
  )
}
