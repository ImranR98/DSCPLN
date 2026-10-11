'use strict'

// Portal grid: one card per function, each linked at its subpath with a
// non-blocking health pill (the app may be down; the link still works).
;(function () {
    const { el, apiUrl, initTheme, formatTime, formatDateTime } = window.DSCPLN

    const FUNCTIONS = [
        { path: 'balance', icon: '$', name: 'Balance XLSX', description: 'Budget dashboard backed by the live workbook' },
        { path: 'media', icon: '▶', name: 'Media Sync', description: 'Device media ingestion, review and cleanup' },
        { path: 'watxt', icon: '✓', name: 'WhatsApp TXT', description: 'Browse, import and merge WhatsApp exports' },
        { path: 'tasks', icon: '⚙', name: 'Task Runner', description: 'Config-driven backup and export workflows' },
        { path: 'contacts', icon: '@', name: 'Contacts + Calendar', description: 'Scheduled Nextcloud exports', scheduled: true },
        { path: 'compose', icon: '❒', name: 'Infra Compose State', description: 'Scheduled srv0/vps0 compose state backups', scheduled: true },
        { path: 'ytmusic', icon: '♪', name: 'YTMusic Downloads', description: 'Scheduled YouTube Music library downloads', scheduled: true },
    ]

    const grid = document.getElementById('portalGrid')
    const updated = document.getElementById('updatedLabel')
    const themeButton = document.getElementById('themeButton')
    initTheme(themeButton)

    const cards = new Map()

    function build() {
        grid.textContent = ''
        for (const fn of FUNCTIONS) {
            const pill = el('span', { class: 'portal-card__status muted', text: 'checking…' })
            const next = el('span', { class: 'portal-card__next', text: '' })
            const card = el('a', { class: 'portal-card', href: `/${fn.path}` },
                el('span', { class: 'portal-card__icon', text: fn.icon }),
                el('span', { class: 'portal-card__body' },
                    el('span', { class: 'portal-card__name', text: fn.name }),
                    el('span', { class: 'portal-card__desc', text: fn.description }),
                    next),
                pill)
            grid.append(card)
            cards.set(fn.path, { pill, next })
        }
    }

    async function ping(fn) {
        const { pill } = cards.get(fn.path)
        try {
            const response = await fetch(apiUrl(`${fn.path}/api/health`), { signal: AbortSignal.timeout(5000) })
            if (!response.ok) throw new Error(String(response.status))
            pill.textContent = 'online'
            pill.className = 'portal-card__status is-ok'
        } catch (err) {
            pill.textContent = 'unreachable'
            pill.className = 'portal-card__status is-fail'
        }
    }

    async function updateNext(fn) {
        const { next } = cards.get(fn.path)
        try {
            const response = await fetch(apiUrl(`${fn.path}/api/state`), { signal: AbortSignal.timeout(5000) })
            if (!response.ok) throw new Error(String(response.status))
            const state = await response.json()
            if (state.paused) next.textContent = 'paused'
            else if (Number.isFinite(state.nextRun)) next.textContent = `next ${formatDateTime(state.nextRun)}`
            else next.textContent = ''
        } catch (err) {
            next.textContent = ''
        }
    }

    async function refresh() {
        await Promise.all(FUNCTIONS.map((fn) => ping(fn)))
        await Promise.all(FUNCTIONS.filter((fn) => fn.scheduled).map((fn) => updateNext(fn)))
        updated.textContent = `checked ${formatTime(Date.now())}`
    }

    const refreshButton = document.getElementById('refreshButton')
    refreshButton.innerHTML = window.DSCPLN.icons.refresh
    refreshButton.addEventListener('click', refresh)

    build()
    refresh()
    setInterval(refresh, 60_000)
})()
