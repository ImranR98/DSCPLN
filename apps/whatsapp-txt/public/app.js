const $ = (selector) => document.querySelector(selector)
const $$ = (selector) => [...document.querySelectorAll(selector)]

const api = async (route, params) => {
    const url = new URL(window.DSCPLN.apiUrl(route))
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

const debounce = (fn, ms) => {
    let timer = null
    return (...args) => {
        clearTimeout(timer)
        timer = setTimeout(() => fn(...args), ms)
    }
}

const ICONS = {
    menu: ['M4 6h16', 'M4 12h16', 'M4 18h16'],
    reload: ['M20 11a8 8 0 1 0-2.3 5.7', 'M20 5v6h-6'],
    import: ['M12 16V4', 'M7 9l5-5 5 5', 'M5 20h14'],
    clear: ['M6 6l12 12', 'M18 6L6 18'],
    up: ['M12 19V5', 'M5 12l7-7 7 7'],
    down: ['M12 5v14', 'M19 12l-7 7-7-7'],
    transcript: ['M4 6h16', 'M4 11h16', 'M4 16h16', 'M4 20h9'],
    bubbles: ['M5 5h14v4H5z', 'M5 10h11v4H5z', 'M5 15h14v4H5z'],
    compact: ['M4 6h16', 'M4 9h16', 'M4 12h16', 'M4 15h16', 'M4 18h16']
}

const svgIcon = (name, size = 18) => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.setAttribute('viewBox', '0 0 24 24')
    svg.setAttribute('width', size)
    svg.setAttribute('height', size)
    svg.setAttribute('fill', 'none')
    svg.setAttribute('stroke', 'currentColor')
    svg.setAttribute('stroke-width', '2')
    svg.setAttribute('stroke-linecap', 'round')
    svg.setAttribute('stroke-linejoin', 'round')
    svg.setAttribute('aria-hidden', 'true')
    for (const d of ICONS[name]) {
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
        path.setAttribute('d', d)
        svg.append(path)
    }
    return svg
}

const senderHue = (text) => {
    let hash = 0
    for (const char of text) hash = (hash * 31 + char.codePointAt(0)) % 360
    return hash
}

// Alternating saturation/lightness tones keep same-hue neighbours apart for large groups
const SENDER_TONES = [
    { s: 62, l: 34, ds: 55, dl: 72 },
    { s: 46, l: 45, ds: 44, dl: 80 },
    { s: 72, l: 39, ds: 62, dl: 76 }
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
            dark: `hsl(${hue} ${tone.ds}% ${tone.dl}%)`
        })
    })
    return palette
}

const getSenderPalette = (conversationId) => {
    if (!state.palettes.has(conversationId)) {
        const conversation = state.byId.get(conversationId)
        state.palettes.set(conversationId, buildSenderPalette(conversation ? conversation.senders : []))
    }
    return state.palettes.get(conversationId)
}

const colorFor = (conversationId, sender) => {
    if (!sender) return null
    return getSenderPalette(conversationId).get(sender) ?? {
        light: `hsl(${senderHue(sender)} 55% 38%)`,
        dark: `hsl(${senderHue(sender)} 60% 74%)`
    }
}

const applySenderColor = (node, color) => {
    if (!color) return
    node.style.setProperty('--sender-color', color.light)
    node.style.setProperty('--sender-color-dark', color.dark)
}

const initials = (name) => {
    const words = name.trim().split(/\s+/).filter(Boolean)
    if (words.length >= 2) return ([...words[0]][0] + [...words[1]][0]).toUpperCase()
    return [...(words[0] ?? '?')].slice(0, 2).join('').toUpperCase()
}

const pad = (value) => String(value).padStart(2, '0')

const dateLabel = (iso) => {
    const date = new Date(iso)
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

const timeLabel = (iso) => {
    const date = new Date(iso)
    const hours = date.getHours() % 12 || 12
    const meridiem = date.getHours() >= 12 ? 'PM' : 'AM'
    return `${pad(hours)}:${pad(date.getMinutes())} ${meridiem}`
}

const relativeTime = (iso) => {
    const seconds = Math.round((Date.now() - Date.parse(iso)) / 1000)
    if (seconds < 60) return 'just now'
    if (seconds < 3600) return `${Math.round(seconds / 60)} min ago`
    if (seconds < 86400) return `${Math.round(seconds / 3600)} h ago`
    return `${Math.round(seconds / 86400)} d ago`
}

const URL_RE = /(https?:\/\/[^\s<]+)/g

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

const typeLabel = (type) => type === 'text' ? '' : type.charAt(0).toUpperCase() + type.slice(1)

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
    viewMode: localStorage.getItem('whatsapptxt-view') ?? 'transcript',
    searchController: null,
    palettes: new Map()
}

// ---- banner ---------------------------------------------------------------

let bannerTimer = null

const showBanner = (message) => {
    $('#banner-text').textContent = message
    $('#banner').hidden = false
    clearTimeout(bannerTimer)
    bannerTimer = setTimeout(() => { $('#banner').hidden = true }, 8000)
}

const hideBanner = () => {
    clearTimeout(bannerTimer)
    $('#banner').hidden = true
}

// ---- sidebar --------------------------------------------------------------

const moveListFocus = (event, item) => {
    const items = $$('#conversation-list .conversation-item')
    const index = items.indexOf(item)
    if (event.key === 'ArrowDown') { event.preventDefault(); items[Math.min(index + 1, items.length - 1)]?.focus() }
    else if (event.key === 'ArrowUp') { event.preventDefault(); items[Math.max(index - 1, 0)]?.focus() }
    else if (event.key === 'Home') { event.preventDefault(); items[0]?.focus() }
    else if (event.key === 'End') { event.preventDefault(); items[items.length - 1]?.focus() }
}

const renderSidebar = () => {
    const filter = $('#conversation-filter').value.trim().toLowerCase()
    const list = $('#conversation-list')
    list.replaceChildren()
    for (const conversation of state.conversations) {
        if (filter && !conversation.name.toLowerCase().includes(filter)) continue
        const item = el('li', 'conversation-item')
        item.tabIndex = 0
        item.setAttribute('role', 'button')
        if (state.conversation && conversation.id === state.conversation.id) {
            item.classList.add('active')
            item.setAttribute('aria-current', 'true')
        }
        const avatar = el('div', 'avatar', initials(conversation.name))
        applySenderColor(avatar, colorFor(conversation.id, (conversation.senders && conversation.senders[0]) ?? conversation.name))
        const info = el('div', 'info')
        info.append(el('div', 'name', conversation.name))
        const meta = el('div', 'meta')
        meta.append(el('span', null, `${conversation.messageCount.toLocaleString()} msgs`))
        meta.append(el('span', null, dateLabel(conversation.last)))
        info.append(meta)
        item.append(avatar, info)
        const open = () => {
            $('#sidebar').classList.remove('open')
            location.hash = `#/c/${encodeURIComponent(conversation.id)}`
        }
        item.addEventListener('click', open)
        item.addEventListener('keydown', event => {
            if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open() }
            else moveListFocus(event, item)
        })
        list.append(item)
    }
}

// ---- conversation view ----------------------------------------------------

const GROUP_WINDOW_MS = 5 * 60 * 1000

const applyViewClasses = () => {
    const content = $('#content')
    content.classList.toggle('view-transcript', state.viewMode === 'transcript')
    content.classList.toggle('view-bubbles', state.viewMode === 'bubbles')
    content.classList.toggle('view-compact', state.viewMode === 'compact')
}

const setViewMode = (mode) => {
    state.viewMode = mode
    localStorage.setItem('whatsapptxt-view', mode)
    for (const button of $$('.mode-btn')) button.setAttribute('aria-pressed', String(button.dataset.mode === mode))
    applyViewClasses()
    renderMessages()
}

const renderSkeletonRows = (container, count) => {
    container.replaceChildren()
    for (let i = 0; i < count; i++) {
        const row = el('div', 'skeleton-row')
        row.append(el('div', 'skeleton skeleton-line short'))
        row.append(el('div', 'skeleton skeleton-line'))
        row.append(el('div', 'skeleton skeleton-line medium'))
        container.append(row)
    }
}

const renderConversationShell = () => {
    const content = $('#content')
    content.replaceChildren()
    if (!state.conversation) return
    const conversation = state.conversation
    const header = el('div', 'conversation-header')
    const titles = el('div', 'titles')
    titles.append(el('h2', null, conversation.name))
    titles.append(el('div', 'meta', `${conversation.messageCount.toLocaleString()} messages · ${dateLabel(conversation.first)} → ${dateLabel(conversation.last)} · ${conversation.senders.length} participants`))
    header.append(titles)
    const modeSwitch = el('div', 'mode-switch')
    for (const [mode, icon, label] of [['transcript', 'transcript', 'Transcript'], ['bubbles', 'bubbles', 'Bubbles'], ['compact', 'compact', 'Compact']]) {
        const button = el('button', 'mode-btn')
        button.dataset.mode = mode
        button.title = label
        button.setAttribute('aria-label', `${label} view`)
        button.setAttribute('aria-pressed', String(state.viewMode === mode))
        button.append(svgIcon(icon, 16))
        button.addEventListener('click', () => setViewMode(mode))
        modeSwitch.append(button)
    }
    header.append(modeSwitch)
    content.append(header)
    const scroll = el('div', 'message-scroll')
    scroll.id = 'message-scroll'
    const rows = el('div', 'message-rows')
    scroll.append(rows)
    scroll.addEventListener('scroll', onScroll)
    content.append(scroll)
    if (state.messages.size === 0) renderSkeletonRows(rows, 8)
    const controls = el('div', 'jump-controls')
    const topButton = el('button', 'jump-btn')
    topButton.title = 'Jump to the first message (Home)'
    topButton.setAttribute('aria-label', 'Jump to the first message')
    topButton.append(svgIcon('up', 16))
    topButton.addEventListener('click', () => jumpTo(0))
    const latestButton = el('button', 'jump-btn')
    latestButton.title = 'Jump to the latest message (End)'
    latestButton.setAttribute('aria-label', 'Jump to the latest message')
    latestButton.append(svgIcon('down', 16))
    latestButton.addEventListener('click', () => jumpTo(state.total - 1))
    controls.append(topButton, latestButton)
    content.append(controls)
    applyViewClasses()
    updateJumpVisibility()
}

const messageRow = (message, previous) => {
    const grouped = previous != null &&
        previous.sender === message.sender &&
        previous.type === message.type &&
        message.date - previous.date < GROUP_WINDOW_MS
    const row = el('div', `message type-${message.type}${grouped ? ' grouped' : ''}`)
    row.id = `m-${message.index}`
    if (message.sender && state.conversation) applySenderColor(row, colorFor(state.conversation.id, message.sender))
    if (state.viewMode === 'compact') {
        const body = el('div', 'body')
        const prefix = el('span', 'prefix')
        prefix.append(el('span', 'time', timeLabel(message.date)))
        if (!grouped && message.sender) prefix.append(el('span', 'sender', `${message.sender}: `))
        body.append(prefix)
        renderBody(body, message.body)
        row.append(body)
        return row
    }
    const container = state.viewMode === 'bubbles' ? el('div', 'bubble') : row
    if (!grouped) {
        const line = el('div', 'line1')
        if (message.sender) line.append(el('span', 'sender', message.sender))
        line.append(el('span', 'time', timeLabel(message.date)))
        container.append(line)
    }
    const body = el('div', 'body')
    renderBody(body, message.body)
    container.append(body)
    if (container !== row) row.append(container)
    return row
}

const renderMessages = () => {
    const scroll = $('#message-scroll')
    if (!scroll) return
    const rows = scroll.querySelector('.message-rows')
    const fragment = document.createDocumentFragment()
    let previousDay = null
    let previousMessage = null
    for (let index = state.loadedFirst; index <= state.loadedLast; index++) {
        const message = state.messages.get(index)
        if (!message) { previousMessage = null; continue }
        const day = dateLabel(message.date)
        if (day !== previousDay) {
            const separator = el('div', 'date-separator')
            separator.append(el('span', null, day))
            fragment.append(separator)
            previousDay = day
            previousMessage = null
        }
        fragment.append(messageRow(message, previousMessage))
        previousMessage = message
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
    } catch (error) {
        if (token === state.token) {
            const rows = $('#message-scroll .message-rows')
            if (rows && state.messages.size === 0) rows.replaceChildren(el('div', 'empty-state', 'Failed to load messages'))
            showBanner(`Failed to load messages: ${error.message}`)
        }
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
    state.searchController = null
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
    if (scroll) renderSkeletonRows(scroll.querySelector('.message-rows'), 6)
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

// ---- search view ----------------------------------------------------------

const skeletonCards = (count) => {
    const fragment = document.createDocumentFragment()
    for (let i = 0; i < count; i++) {
        const card = el('div', 'skeleton-row')
        card.append(el('div', 'skeleton skeleton-line short'))
        card.append(el('div', 'skeleton skeleton-line medium'))
        fragment.append(card)
    }
    return fragment
}

const moveResultFocus = (delta) => {
    const results = $$('.search-results .result')
    if (results.length === 0) return
    const current = results.indexOf(document.activeElement)
    const next = current === -1 ? (delta > 0 ? 0 : results.length - 1) : Math.min(Math.max(current + delta, 0), results.length - 1)
    results[next].focus()
}

const renderSearchView = (query, params) => {
    const content = $('#content')
    content.replaceChildren()
    const view = el('div', 'search-view')
    const filters = el('div', 'search-filters')
    const filtersState = {
        conversation: params.get('conversation') ?? '',
        sender: params.get('sender') ?? '',
        type: params.get('type') ?? '',
        from: params.get('from') ?? '',
        to: params.get('to') ?? '',
        order: params.get('order') === 'asc' ? 'asc' : 'desc',
        whole: params.get('whole') === '1' ? '1' : ''
    }
    let currentQuery = query
    let rendered = 0
    let total = 0
    let loading = false
    let runToken = 0

    const conversationSelect = el('select')
    conversationSelect.setAttribute('aria-label', 'Filter by conversation')
    conversationSelect.append(el('option', null, 'All conversations'))
    conversationSelect.firstChild.value = ''
    for (const conversation of state.conversations) {
        const option = el('option', null, conversation.name)
        option.value = conversation.id
        conversationSelect.append(option)
    }
    conversationSelect.value = filtersState.conversation

    const senderInput = el('input', 'sender-input')
    senderInput.placeholder = 'Sender'
    senderInput.setAttribute('aria-label', 'Filter by sender')
    senderInput.value = filtersState.sender

    const typeSelect = el('select')
    typeSelect.setAttribute('aria-label', 'Filter by type')
    for (const type of ['', 'text', 'media', 'attachment', 'deleted', 'system']) {
        const option = el('option', null, type === '' ? 'Any type' : typeLabel(type))
        option.value = type
        typeSelect.append(option)
    }
    typeSelect.value = filtersState.type

    const fromInput = el('input')
    fromInput.type = 'date'
    fromInput.title = 'From date'
    fromInput.setAttribute('aria-label', 'From date')
    fromInput.value = filtersState.from
    const toInput = el('input')
    toInput.type = 'date'
    toInput.title = 'To date'
    toInput.setAttribute('aria-label', 'To date')
    toInput.value = filtersState.to

    const orderSelect = el('select')
    orderSelect.setAttribute('aria-label', 'Result order')
    const newest = el('option', null, 'Newest first')
    newest.value = 'desc'
    const oldest = el('option', null, 'Oldest first')
    oldest.value = 'asc'
    orderSelect.append(newest, oldest)
    orderSelect.value = filtersState.order

    const wholeLabel = el('label', 'whole-toggle')
    const wholeInput = el('input')
    wholeInput.type = 'checkbox'
    wholeInput.checked = filtersState.whole === '1'
    wholeLabel.append(wholeInput, el('span', null, 'Whole words'))

    filters.append(conversationSelect, senderInput, typeSelect, fromInput, toInput, orderSelect, wholeLabel)
    view.append(filters)
    const summary = el('div', 'search-summary', 'Searching…')
    view.append(summary)
    const resultsNode = el('div', 'search-results')
    view.append(resultsNode)
    content.append(view)

    const syncHash = () => {
        const next = new URLSearchParams()
        if (currentQuery) next.set('q', currentQuery)
        for (const key of ['conversation', 'sender', 'type', 'from', 'to']) if (filtersState[key]) next.set(key, filtersState[key])
        if (filtersState.order === 'asc') next.set('order', 'asc')
        if (filtersState.whole) next.set('whole', '1')
        history.replaceState(null, '', `#/search${next.toString() ? `?${next}` : ''}`)
    }

    const resultCard = (result) => {
        const row = el('div', 'result')
        row.tabIndex = 0
        row.setAttribute('role', 'button')
        const line = el('div', 'line1')
        line.append(el('span', 'conversation-name', result.conversationName))
        line.append(el('span', 'result-time', `${dateLabel(result.date)} ${timeLabel(result.date)}`))
        if (result.sender) {
            const chip = el('span', 'sender-chip', result.sender)
            applySenderColor(chip, colorFor(result.conversationId, result.sender))
            line.append(chip)
        }
        const label = typeLabel(result.type)
        if (label) line.append(el('span', 'type-badge', label))
        row.append(line, renderSnippet(result))
        const open = () => { location.hash = `#/c/${encodeURIComponent(result.conversationId)}?at=${result.index}` }
        row.addEventListener('click', open)
        row.addEventListener('keydown', event => {
            if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open() }
        })
        return row
    }

    const sentinel = el('div', 'sentinel')
    const observer = new IntersectionObserver(entries => {
        if (entries.some(entry => entry.isIntersecting) && rendered < total && !loading) run(true)
    }, { rootMargin: '240px' })

    const run = async (append) => {
        if (!currentQuery && !['conversation', 'sender', 'type', 'from', 'to', 'whole'].some(key => filtersState[key])) {
            resultsNode.replaceChildren(el('div', 'empty-state', 'Type to search, or use the filters above.'))
            summary.textContent = ''
            return
        }
        if (loading) return
        loading = true
        const token = ++runToken
        if (!append) resultsNode.replaceChildren(skeletonCards(4))
        try {
            const data = await api('/api/search', { q: currentQuery, ...filtersState, offset: rendered, limit: 50 })
            if (token !== runToken) return
            if (!append) { resultsNode.replaceChildren(); rendered = 0 }
            for (const result of data.results) resultsNode.append(resultCard(result))
            rendered += data.results.length
            total = data.total
            summary.textContent = currentQuery
                ? `${total.toLocaleString()} result${total === 1 ? '' : 's'} for “${currentQuery}”`
                : `${total.toLocaleString()} message${total === 1 ? '' : 's'}`
            sentinel.style.display = rendered >= total ? 'none' : ''
            resultsNode.append(sentinel)
        } catch (error) {
            if (token !== runToken) return
            const errorNode = el('div', 'search-error')
            errorNode.append(el('span', null, `Search failed: ${error.message}`))
            const retry = el('button', null, 'Retry')
            retry.addEventListener('click', () => run(false))
            errorNode.append(retry)
            if (!append) resultsNode.replaceChildren(errorNode)
            else resultsNode.append(errorNode)
        } finally {
            if (token === runToken) loading = false
        }
    }

    observer.observe(sentinel)
    conversationSelect.addEventListener('change', () => { filtersState.conversation = conversationSelect.value; syncHash(); run(false) })
    senderInput.addEventListener('input', debounce(() => { filtersState.sender = senderInput.value; syncHash(); run(false) }, 250))
    typeSelect.addEventListener('change', () => { filtersState.type = typeSelect.value; syncHash(); run(false) })
    fromInput.addEventListener('change', () => { filtersState.from = fromInput.value; syncHash(); run(false) })
    toInput.addEventListener('change', () => { filtersState.to = toInput.value; syncHash(); run(false) })
    orderSelect.addEventListener('change', () => { filtersState.order = orderSelect.value; syncHash(); run(false) })
    wholeInput.addEventListener('change', () => { filtersState.whole = wholeInput.checked ? '1' : ''; syncHash(); run(false) })

    state.searchController = {
        setQuery(nextQuery) {
            currentQuery = nextQuery
            syncHash()
            run(false)
        },
        setFilter(key, value) {
            filtersState[key] = value
            syncHash()
            run(false)
        }
    }
    run(false)
}

// ---- routing --------------------------------------------------------------

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
        await openConversation(route.id, route.at)
    } else if (route.view === 'search') {
        $('#search-input').value = route.q
        updateClearButton()
        if (route.q.trim() || [...route.params.keys()].some(key => key !== 'q')) {
            renderSearchView(route.q.trim(), route.params)
        } else {
            state.searchController = null
            renderEmpty()
        }
    } else {
        state.conversation = null
        state.searchController = null
        renderSidebar()
        renderEmpty()
    }
}

const renderEmpty = () => {
    const content = $('#content')
    content.replaceChildren()
    const empty = el('div', 'empty-state')
    empty.append(el('div', null, 'Pick a conversation or search your messages.'))
    empty.append(el('div', null, 'Press / to search · Home / End jump within a conversation'))
    content.append(empty)
}

// ---- chrome ---------------------------------------------------------------

const updateClearButton = () => {
    $('#search-clear').hidden = $('#search-input').value.length === 0
}

const renderStatus = () => {
    if (!state.meta) return
    const skipped = state.meta.skipped.length ? ` · ${state.meta.skipped.length} skipped` : ''
    $('#status').textContent = `${state.meta.conversations} chats · ${state.meta.messages.toLocaleString()} msgs${skipped}`
    const skippedDetail = state.meta.skipped.length
        ? `\n\nSkipped:\n${state.meta.skipped.map(item => `${item.file}: ${item.reason}`).join('\n')}`
        : ''
    $('#status').title = `Indexed ${relativeTime(state.meta.indexedAt)}${skippedDetail}`
}

const refreshConversations = async () => {
    state.conversations = await api('/api/conversations')
    state.byId = new Map(state.conversations.map(conversation => [conversation.id, conversation]))
    state.palettes.clear()
    renderSidebar()
}

const reload = async () => {
    const button = $('#reload')
    button.disabled = true
    button.querySelector('svg')?.classList.add('spin')
    try {
        state.meta = await fetch(window.DSCPLN.apiUrl('/api/reload'), { method: 'POST' }).then(response => response.json())
        await refreshConversations()
        renderStatus()
        await handleRoute()
    } catch (error) {
        showBanner(`Reindex failed: ${error.message}`)
    } finally {
        button.disabled = false
        button.querySelector('svg')?.classList.remove('spin')
    }
}

const updateTopbarHeight = () => {
    document.documentElement.style.setProperty('--topbar-height', `${$('.topbar').offsetHeight}px`)
}

const onSearchInput = debounce(() => {
    const query = $('#search-input').value.trim()
    updateClearButton()
    if (state.searchController) {
        state.searchController.setQuery(query)
    } else if (query) {
        location.hash = `#/search?q=${encodeURIComponent(query)}`
    }
}, 250)

// ---- import ----------------------------------------------------------------

const importState = {
    batch: null,
    files: [],
    imported: false,
    busy: false
}

const formatSize = (bytes) => {
    if (!Number.isFinite(bytes)) return ''
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

const newBatch = () => `imp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

const setImportStatus = (text, isError = false) => {
    const node = $('#import-status')
    node.textContent = text ?? ''
    node.hidden = !text
    node.classList.toggle('import-status--error', isError)
}

const renderImportList = () => {
    const list = $('#import-list')
    list.replaceChildren()
    for (const entry of importState.files) {
        const item = el('li', `import-item import-item--${entry.state}`)
        item.append(el('span', 'import-item__name', entry.name))
        const meta = entry.state === 'done' ? `${formatSize(entry.size)} uploaded`
            : entry.state === 'error' ? entry.error ?? 'failed'
                : entry.state
        item.append(el('span', 'import-item__meta', meta))
        list.append(item)
    }
    const hasFiles = importState.files.length > 0
    const uploaded = importState.files.some(entry => entry.state === 'done')
    $('#import-discard').hidden = !hasFiles || importState.busy
    $('#import-preview').disabled = !uploaded || importState.busy || importState.imported
    $('#import-run').disabled = !uploaded || importState.busy || importState.imported
    $('#import-done').hidden = !importState.imported
}

const chooseImportFiles = async (fileList) => {
    if (importState.busy || importState.imported) return
    const all = [...fileList]
    const accepted = all.filter(file => /\.(zip|txt)$/i.test(file.name))
    if (accepted.length < all.length) {
        setImportStatus(`${all.length - accepted.length} file(s) skipped (only .zip and .txt are accepted)`, true)
    } else {
        setImportStatus('')
    }
    if (accepted.length === 0) return
    if (!importState.batch) importState.batch = newBatch()
    for (const file of accepted) {
        if (importState.files.some(entry => entry.name === file.name)) continue
        const entry = { name: file.name, size: file.size, state: 'uploading' }
        importState.files.push(entry)
        renderImportList()
        try {
            const response = await fetch(window.DSCPLN.apiUrl(`/api/import/upload?batch=${encodeURIComponent(importState.batch)}&name=${encodeURIComponent(file.name)}`), {
                method: 'POST',
                body: file
            })
            const body = await response.json().catch(() => ({}))
            if (!response.ok) throw new Error(body.error ?? `${response.status} ${response.statusText}`)
            entry.state = 'done'
            entry.size = body.size
        } catch (error) {
            entry.state = 'error'
            entry.error = error.message
        }
        renderImportList()
    }
}

const showImportResult = (summary) => {
    const lines = [summary.dryRun
        ? '=== Preview: no files were renamed, deleted or written ==='
        : '=== Import complete ===']
    lines.push(`${summary.conversations} conversation(s) · ${summary.multiSource} merged from multiple sources · ${summary.renamedGroups} renamed group(s)`)
    for (const name of summary.names.slice(0, 30)) lines.push(`  ${name}`)
    if (summary.names.length > 30) lines.push(`  … and ${summary.names.length - 30} more`)
    for (const item of summary.ambiguous ?? []) {
        lines.push(`ambiguous dates: ${item.file} · ${item.count} line(s) resolved as ${item.order.toUpperCase()} (${item.orderSource})`)
    }
    const node = $('#import-result')
    node.textContent = lines.join('\n')
    node.hidden = false
}

const runImport = async (dryRun) => {
    if (importState.busy) return
    importState.busy = true
    $('#import-result').hidden = true
    renderImportList()
    setImportStatus(dryRun ? 'Building preview…' : 'Merging…')
    try {
        const response = await fetch(window.DSCPLN.apiUrl('/api/import/merge'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ batch: importState.batch, dryRun })
        })
        const body = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(body.error ?? `${response.status} ${response.statusText}`)
        showImportResult(body)
        if (dryRun) {
            setImportStatus('Preview only — nothing was written.')
        } else {
            importState.imported = true
            importState.batch = null
            importState.files = []
            state.meta = await api('/api/state')
            renderStatus()
            await refreshConversations()
            await handleRoute()
            setImportStatus('Import complete.')
        }
    } catch (error) {
        setImportStatus(error.message, true)
    } finally {
        importState.busy = false
        renderImportList()
    }
}

const discardImport = async () => {
    if (!importState.batch) return
    await fetch(window.DSCPLN.apiUrl('/api/import/cancel'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batch: importState.batch })
    }).catch(() => {})
    importState.batch = null
    importState.files = []
    $('#import-result').hidden = true
    setImportStatus('Uploads discarded.')
    renderImportList()
}

const openImport = () => {
    importState.imported = false
    setImportStatus('')
    $('#import-result').hidden = true
    renderImportList()
    $('#import-dialog').showModal()
}

// Dismissing the panel (backdrop click or Escape) acts as a cancel: staged
// uploads are discarded. While an upload or merge is running the panel stays
// open so an in-flight operation is never lost track of.
const dismissImport = async () => {
    if (importState.busy) return
    if (importState.files.length > 0 && importState.batch) {
        await discardImport()
        showBanner('Import cancelled — staged uploads discarded.')
    }
    $('#import-dialog').close()
}

const setupImport = () => {
    $('#import').addEventListener('click', openImport)
    $('#import-browse').addEventListener('click', () => $('#import-files').click())
    $('#import-files').addEventListener('change', () => {
        chooseImportFiles($('#import-files').files)
        $('#import-files').value = ''
    })
    const drop = $('#import-drop')
    drop.addEventListener('dragover', event => {
        event.preventDefault()
        drop.classList.add('import-drop--over')
    })
    drop.addEventListener('dragleave', () => drop.classList.remove('import-drop--over'))
    drop.addEventListener('drop', event => {
        event.preventDefault()
        drop.classList.remove('import-drop--over')
        chooseImportFiles(event.dataTransfer.files)
    })
    $('#import-preview').addEventListener('click', () => runImport(true))
    $('#import-run').addEventListener('click', () => runImport(false))
    $('#import-discard').addEventListener('click', discardImport)
    $('#import-done').addEventListener('click', () => $('#import-dialog').close())

    const dialog = $('#import-dialog')
    // Backdrop clicks: the target is the dialog element itself; check the
    // coordinates so clicks on the dialog's own padding do not dismiss it.
    dialog.addEventListener('click', event => {
        if (event.target !== dialog) return
        const rect = dialog.getBoundingClientRect()
        const outside = event.clientX < rect.left || event.clientX > rect.right
            || event.clientY < rect.top || event.clientY > rect.bottom
        if (outside) dismissImport()
    })
    // Escape (native cancel event) follows the same rules.
    dialog.addEventListener('cancel', event => {
        event.preventDefault()
        dismissImport()
    })
}

const setup = async () => {
    $('#sidebar-toggle').append(svgIcon('menu'))
    $('#import').append(svgIcon('import'))
    $('#reload').append(svgIcon('reload'))
    $('#search-clear').append(svgIcon('clear', 15))
    $('#banner-close').append(svgIcon('clear', 15))

    setupImport()
    $('#reload').addEventListener('click', reload)
    $('#sidebar-toggle').addEventListener('click', () => $('#sidebar').classList.toggle('open'))
    $('#conversation-filter').addEventListener('input', debounce(renderSidebar, 150))
    $('#banner-close').addEventListener('click', hideBanner)

    $('#search-form').addEventListener('submit', event => {
        event.preventDefault()
        const query = $('#search-input').value.trim()
        if (query) location.hash = `#/search?q=${encodeURIComponent(query)}`
        else if (state.searchController) state.searchController.setQuery('')
    })
    $('#search-input').addEventListener('input', onSearchInput)
    $('#search-clear').addEventListener('click', () => {
        $('#search-input').value = ''
        updateClearButton()
        if (state.searchController) state.searchController.setQuery('')
        $('#search-input').focus()
    })

    document.addEventListener('keydown', event => {
        const typing = /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement?.tagName ?? '')
        const searchView = Boolean(state.searchController)
        if (event.key === '/' && !typing) {
            event.preventDefault()
            $('#search-input').focus()
            return
        }
        if (event.key === 'Escape') {
            if (typing) document.activeElement.blur()
            else if (searchView && document.activeElement?.classList.contains('result')) $('#search-input').focus()
            else location.hash = '#/'
            return
        }
        if (typing) {
            const target = document.activeElement
            const arrowIntoResults = searchView &&
                (event.key === 'ArrowDown' || event.key === 'ArrowUp') &&
                (target === $('#search-input') || target?.tagName === 'SELECT' || target?.type === 'checkbox')
            if (arrowIntoResults) {
                event.preventDefault()
                moveResultFocus(event.key === 'ArrowDown' ? 1 : -1)
            }
            return
        }
        if (searchView) {
            if (event.key === 'j' || event.key === 'ArrowDown') { event.preventDefault(); moveResultFocus(1) }
            else if (event.key === 'k' || event.key === 'ArrowUp') { event.preventDefault(); moveResultFocus(-1) }
            return
        }
        if (state.conversation) {
            if (event.key === 'Home') { event.preventDefault(); jumpTo(0) }
            else if (event.key === 'End') { event.preventDefault(); jumpTo(state.total - 1) }
            else if (event.key === 'j') { $('#message-scroll')?.scrollBy({ top: 120 }) }
            else if (event.key === 'k') { $('#message-scroll')?.scrollBy({ top: -120 }) }
        }
    })

    window.addEventListener('hashchange', handleRoute)
    window.addEventListener('resize', updateTopbarHeight)
    updateTopbarHeight()

    state.meta = await api('/api/state')
    renderStatus()
    await refreshConversations()
    await handleRoute()
}

setup().catch(error => {
    renderEmpty()
    showBanner(`Failed to load: ${error.message}`)
})
