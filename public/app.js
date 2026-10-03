const $ = (selector) => document.querySelector(selector)

const api = async (route, params) => {
    const url = new URL(route, location.origin)
    for (const [key, value] of Object.entries(params ?? {})) {
        if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, value)
    }
    const response = await fetch(url)
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
    return response.json()
}

const el = (tag, className, text) => {
    const node = document.createElement(tag)
    if (className) node.className = className
    if (text !== undefined) node.textContent = text
    return node
}

const URL_RE = /(https?:\/\/[^\s<]+)/g

const state = {
    meta: null,
    conversations: [],
    byId: new Map(),
    conversation: null,
    total: 0,
    loadedFirst: 0,
    loadedLast: -1,
    messages: new Map(),
    pageSize: 200,
    maxRows: 3000,
    token: 0,
    loading: false,
    search: null
}

const senderColor = (sender) => {
    if (!sender) return 'var(--muted)'
    let hash = 0
    for (const char of sender) hash = (hash * 31 + char.codePointAt(0)) % 360
    const lightness = document.documentElement.dataset.theme === 'dark' ? '70%' : '42%'
    return `hsl(${hash} 55% ${lightness})`
}

const pad = (value) => String(value).padStart(2, '0')

// YYYY-MM-DD in the browser's local timezone (also used to group messages by day)
const dayKey = (iso) => {
    const date = new Date(iso)
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

const dateLabel = dayKey

// hh:mm AM/PM in the browser's local timezone
const timeLabel = (iso) => {
    const date = new Date(iso)
    const hours = date.getHours() % 12 || 12
    const meridiem = date.getHours() >= 12 ? 'PM' : 'AM'
    return `${pad(hours)}:${pad(date.getMinutes())} ${meridiem}`
}

const renderBody = (node, text) => {
    let last = 0
    for (const match of text.matchAll(URL_RE)) {
        if (match.index > last) node.append(text.slice(last, match.index))
        const link = el('a', null, match[0])
        link.href = match[0]
        link.target = '_blank'
        link.rel = 'noopener noreferrer'
        node.append(link)
        last = match.index + match[0].length
    }
    if (last < text.length) node.append(text.slice(last))
}

const renderSnippet = (result) => {
    const node = el('div', 'snippet')
    if (!result.matchLength) {
        node.textContent = result.snippet
        return node
    }
    node.append(result.snippet.slice(0, result.matchStart))
    node.append(el('mark', null, result.snippet.slice(result.matchStart, result.matchStart + result.matchLength)))
    node.append(result.snippet.slice(result.matchStart + result.matchLength))
    return node
}

// ---- sidebar ----------------------------------------------------------------

const renderSidebar = () => {
    const filter = $('#conversation-filter').value.trim().toLowerCase()
    const list = $('#conversation-list')
    list.replaceChildren()
    for (const conversation of state.conversations) {
        if (filter && !conversation.name.toLowerCase().includes(filter)) continue
        const item = el('li', 'conversation-item')
        if (state.conversation && conversation.id === state.conversation.id) item.classList.add('active')
        item.append(el('div', 'name', conversation.name))
        const meta = el('div', 'meta')
        meta.append(el('span', null, `${conversation.messageCount.toLocaleString()} msgs`))
        meta.append(el('span', null, dateLabel(conversation.last)))
        item.append(meta)
        item.addEventListener('click', () => { location.hash = `#/c/${encodeURIComponent(conversation.id)}` })
        list.append(item)
    }
}

// ---- conversation view ------------------------------------------------------

const renderConversationShell = () => {
    const content = $('#content')
    content.replaceChildren()
    if (!state.conversation) return
    const conversation = state.conversation
    const header = el('div', 'conversation-header')
    header.append(el('h2', null, conversation.name))
    const meta = el('div', 'meta')
    meta.textContent = `${conversation.messageCount.toLocaleString()} messages · ${dateLabel(conversation.first)} → ${dateLabel(conversation.last)} · ${conversation.senders.length} participants`
    header.append(meta)
    content.append(header)
    const scroll = el('div', 'message-scroll')
    scroll.id = 'message-scroll'
    scroll.append(el('div', 'message-rows'))
    scroll.addEventListener('scroll', onScroll)
    content.append(scroll)
    const controls = el('div', 'jump-controls')
    const topButton = el('button', 'jump-btn', '↑ Top')
    topButton.title = 'Jump to the first message (Home)'
    topButton.setAttribute('aria-label', 'Jump to the first message')
    topButton.addEventListener('click', () => jumpTo(0))
    const latestButton = el('button', 'jump-btn', '↓ Latest')
    latestButton.title = 'Jump to the latest message (End)'
    latestButton.setAttribute('aria-label', 'Jump to the latest message')
    latestButton.addEventListener('click', () => jumpTo(state.total - 1))
    controls.append(topButton, latestButton)
    content.append(controls)
    updateJumpVisibility()
}

const messageRow = (message, previous) => {
    const row = el('div', `message type-${message.type}`)
    row.id = `m-${message.index}`
    const line = el('div', 'line1')
    if (message.sender) {
        const sender = el('span', 'sender', message.sender)
        sender.style.color = senderColor(message.sender)
        line.append(sender)
    }
    line.append(el('span', 'time', timeLabel(message.date)))
    row.append(line)
    const body = el('div', 'body')
    renderBody(body, message.body)
    row.append(body)
    return row
}

const renderMessages = () => {
    const scroll = $('#message-scroll')
    if (!scroll) return
    const rows = scroll.querySelector('.message-rows')
    const fragment = document.createDocumentFragment()
    let previousDay = null
    for (let index = state.loadedFirst; index <= state.loadedLast; index++) {
        const message = state.messages.get(index)
        if (!message) continue
        const day = dayKey(message.date)
        if (day !== previousDay) {
            const separator = el('div', 'date-separator')
            separator.append(el('span', null, dateLabel(message.date)))
            fragment.append(separator)
            previousDay = day
        }
        fragment.append(messageRow(message, index > state.loadedFirst ? state.messages.get(index - 1) : null))
    }
    rows.replaceChildren(fragment)
}

const prune = () => {
    while (state.messages.size > state.maxRows) {
        const center = (state.loadedFirst + state.loadedLast) / 2
        if (state.loadedLast - center >= center - state.loadedFirst) {
            for (let index = state.loadedLast; index > state.loadedLast - state.pageSize; index--) state.messages.delete(index)
            state.loadedLast -= state.pageSize
        } else {
            for (let index = state.loadedFirst; index < state.loadedFirst + state.pageSize; index++) state.messages.delete(index)
            state.loadedFirst += state.pageSize
        }
    }
}

const loadPage = async (offset, { preserveScroll = false } = {}) => {
    if (state.loading || !state.conversation) return
    state.loading = true
    const token = state.token
    const scroll = $('#message-scroll')
    const beforeHeight = scroll ? scroll.scrollHeight : 0
    try {
        const data = await api(`/api/conversations/${encodeURIComponent(state.conversation.id)}/messages`, { offset, limit: state.pageSize })
        if (token !== state.token) return
        for (const message of data.messages) state.messages.set(message.index, message)
        state.loadedFirst = Math.min(state.loadedFirst, data.offset)
        state.loadedLast = Math.max(state.loadedLast, data.offset + data.messages.length - 1)
        prune()
        renderMessages()
        if (preserveScroll && scroll) scroll.scrollTop += scroll.scrollHeight - beforeHeight
    } finally {
        state.loading = false
    }
}

const updateJumpVisibility = () => {
    const scroll = $('#message-scroll')
    const controls = $('.jump-controls')
    if (!scroll || !controls) return
    const [topButton, latestButton] = controls.children
    topButton.classList.toggle('hidden', scroll.scrollTop < 80)
    latestButton.classList.toggle('hidden', scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 80)
}

const onScroll = () => {
    const scroll = $('#message-scroll')
    if (!scroll || state.loading) return
    if (scroll.scrollTop < 400 && state.loadedFirst > 0) {
        loadPage(Math.max(0, state.loadedFirst - state.pageSize), { preserveScroll: true })
    } else if (scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 600 && state.loadedLast < state.total - 1) {
        loadPage(state.loadedLast + 1)
    }
    updateJumpVisibility()
}

const openConversation = async (id, at) => {
    const conversation = state.byId.get(id)
    if (!conversation) {
        $('#content').replaceChildren(el('div', 'empty-state', 'Conversation not found'))
        return
    }
    state.conversation = conversation
    state.total = conversation.messageCount
    state.messages = new Map()
    state.loadedFirst = 0
    state.loadedLast = -1
    state.token++
    state.loading = false
    renderSidebar()
    renderConversationShell()
    const target = at != null ? Number.parseInt(at, 10) : null
    const offset = target != null && !Number.isNaN(target)
        ? Math.max(0, Math.min(target, conversation.messageCount - 1) - Math.floor(state.pageSize / 2))
        : 0
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
    if (!state.conversation || state.total === 0) return
    const target = Math.max(0, Math.min(index, state.total - 1))
    const scroll = $('#message-scroll')
    state.messages = new Map()
    state.loadedFirst = 0
    state.loadedLast = -1
    state.token++
    state.loading = false
    const offset = Math.max(0, target - Math.floor(state.pageSize / 2))
    await loadPage(offset)
    if (target === 0) {
        if (scroll) scroll.scrollTop = 0
    } else if (target >= state.total - 1) {
        if (scroll) scroll.scrollTop = scroll.scrollHeight
    } else {
        scrollToIndex(target)
    }
    updateJumpVisibility()
}

// ---- search view ------------------------------------------------------------

const renderSearchView = async (query) => {
    const content = $('#content')
    content.replaceChildren()
    const view = el('div', 'search-view')
    const filters = el('div', 'search-filters')

    const conversationSelect = el('select')
    conversationSelect.append(el('option', null, 'All conversations'))
    conversationSelect.firstChild.value = ''
    for (const conversation of state.conversations) {
        const option = el('option', null, conversation.name)
        option.value = conversation.id
        conversationSelect.append(option)
    }

    const senderInput = el('input')
    senderInput.placeholder = 'Sender'
    const typeSelect = el('select')
    for (const type of ['', 'text', 'media', 'attachment', 'deleted', 'system']) {
        const option = el('option', null, type === '' ? 'Any type' : type)
        option.value = type
        typeSelect.append(option)
    }
    const fromInput = el('input')
    fromInput.type = 'date'
    fromInput.title = 'From date'
    const toInput = el('input')
    toInput.type = 'date'
    toInput.title = 'To date'
    const orderSelect = el('select')
    const newest = el('option', null, 'Newest first')
    newest.value = 'desc'
    const oldest = el('option', null, 'Oldest first')
    oldest.value = 'asc'
    orderSelect.append(newest, oldest)

    const wholeLabel = el('label', 'whole-toggle')
    const wholeInput = el('input')
    wholeInput.type = 'checkbox'
    wholeLabel.append(wholeInput, el('span', null, 'Whole words'))

    filters.append(conversationSelect, senderInput, typeSelect, fromInput, toInput, orderSelect, wholeLabel)
    view.append(filters)
    const summary = el('div', 'search-summary', 'Searching…')
    view.append(summary)
    const resultsNode = el('div', 'search-results')
    view.append(resultsNode)
    content.append(view)

    const filtersState = { conversation: '', sender: '', type: '', from: '', to: '', order: 'desc', whole: '' }
    const run = async (offset, append) => {
        const data = await api('/api/search', { q: query, ...filtersState, offset, limit: 50 })
        if (!append) resultsNode.replaceChildren()
        summary.textContent = `${data.total.toLocaleString()} result${data.total === 1 ? '' : 's'} for “${query}”`
        for (const result of data.results) {
            const row = el('div', 'result')
            const line = el('div', 'line1')
            line.append(el('span', 'conversation-name', result.conversationName))
            line.append(el('span', null, `${dateLabel(result.date)} ${timeLabel(result.date)}`))
            if (result.sender) line.append(el('span', null, result.sender))
            line.append(el('span', null, result.type))
            row.append(line)
            row.append(renderSnippet(result))
            row.addEventListener('click', () => {
                location.hash = `#/c/${encodeURIComponent(result.conversationId)}?at=${result.index}`
            })
            resultsNode.append(row)
        }
        if (offset + data.results.length < data.total) {
            const more = el('button', 'load-more', 'Load more')
            more.addEventListener('click', async () => {
                more.disabled = true
                await run(offset + data.results.length, true)
                more.remove()
            })
            resultsNode.append(more)
        }
        filtersState.offset = offset + data.results.length
    }
    const rerun = () => run(0, false)
    conversationSelect.addEventListener('change', () => { filtersState.conversation = conversationSelect.value; rerun() })
    senderInput.addEventListener('input', () => { filtersState.sender = senderInput.value; rerun() })
    typeSelect.addEventListener('change', () => { filtersState.type = typeSelect.value; rerun() })
    fromInput.addEventListener('change', () => { filtersState.from = fromInput.value; rerun() })
    toInput.addEventListener('change', () => { filtersState.to = toInput.value; rerun() })
    orderSelect.addEventListener('change', () => { filtersState.order = orderSelect.value; rerun() })
    wholeInput.addEventListener('change', () => { filtersState.whole = wholeInput.checked ? '1' : ''; rerun() })
    await rerun()
}

// ---- routing ----------------------------------------------------------------

const parseHash = () => {
    const raw = location.hash.replace(/^#\/?/, '')
    const [route, query] = raw.split('?')
    const params = new URLSearchParams(query ?? '')
    if (route.startsWith('c/')) return { view: 'conversation', id: decodeURIComponent(route.slice(2)), at: params.get('at') }
    if (route.startsWith('search')) return { view: 'search', q: params.get('q') ?? '' }
    return { view: 'empty' }
}

const handleRoute = async () => {
    const route = parseHash()
    if (route.view === 'conversation') {
        await openConversation(route.id, route.at)
    } else if (route.view === 'search') {
        $('#search-input').value = route.q
        if (route.q.trim()) await renderSearchView(route.q.trim())
        else renderEmpty()
    } else {
        state.conversation = null
        renderSidebar()
        renderEmpty()
    }
}

const renderEmpty = () => {
    const content = $('#content')
    content.replaceChildren()
    const empty = el('div', 'empty-state')
    empty.append(el('div', null, 'Pick a conversation or search your messages.'))
    empty.append(el('div', null, 'Press / to search.'))
    content.append(empty)
}

// ---- chrome -----------------------------------------------------------------

const renderStatus = () => {
    if (!state.meta) return
    const skipped = state.meta.skipped.length ? ` · ${state.meta.skipped.length} skipped` : ''
    $('#status').textContent = `${state.meta.conversations} chats · ${state.meta.messages.toLocaleString()} msgs${skipped}`
    $('#status').title = state.meta.skipped.map(item => `${item.file}: ${item.reason}`).join('\n')
}

const refreshConversations = async () => {
    state.conversations = await api('/api/conversations')
    state.byId = new Map(state.conversations.map(conversation => [conversation.id, conversation]))
    renderSidebar()
}

const reload = async () => {
    $('#reload').disabled = true
    try {
        state.meta = await fetch('/api/reload', { method: 'POST' }).then(response => response.json())
        await refreshConversations()
        renderStatus()
        await handleRoute()
    } finally {
        $('#reload').disabled = false
    }
}

const applyTheme = (theme) => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem('whatsapptxt-theme', theme)
}

const setup = async () => {
    applyTheme(localStorage.getItem('whatsapptxt-theme')
        ?? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'))

    $('#theme').addEventListener('click', () => {
        applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark')
        renderMessages()
        renderSidebar()
    })
    $('#reload').addEventListener('click', reload)
    $('#sidebar-toggle').addEventListener('click', () => $('#sidebar').classList.toggle('open'))
    $('#conversation-filter').addEventListener('input', renderSidebar)

    $('#search-form').addEventListener('submit', (event) => {
        event.preventDefault()
        const query = $('#search-input').value.trim()
        location.hash = query ? `#/search?q=${encodeURIComponent(query)}` : '#/'
    })

    document.addEventListener('keydown', (event) => {
        const typing = /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement?.tagName ?? '')
        if (event.key === '/' && !typing) {
            event.preventDefault()
            $('#search-input').focus()
        } else if (event.key === 'Escape') {
            if (typing) document.activeElement.blur()
            else location.hash = '#/'
        } else if (!typing && (event.key === 'Home' || event.key === 'End')) {
            if (!state.conversation) return
            event.preventDefault()
            jumpTo(event.key === 'Home' ? 0 : state.total - 1)
        } else if (!typing && (event.key === 'j' || event.key === 'k')) {
            const scroll = $('#message-scroll')
            if (scroll) scroll.scrollBy({ top: event.key === 'j' ? 120 : -120 })
        }
    })

    window.addEventListener('hashchange', handleRoute)
    state.meta = await api('/api/state')
    renderStatus()
    await refreshConversations()
    await handleRoute()
}

setup().catch(error => {
    $('#content').replaceChildren(el('div', 'empty-state', `Failed to load: ${error.message}`))
})
