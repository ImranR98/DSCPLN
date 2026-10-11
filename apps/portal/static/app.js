'use strict'

// Portal grid: one card per function, each linked at its subpath with a
// non-blocking health pill, a last-run/summary line pulled from the app's own
// state API, and the next scheduled run for the scheduled apps. Nothing here
// blocks the card links; every fetch fails soft.
;(function () {
    const { el, apiUrl, initTheme, formatTime, formatDateTime, humanAgo } = window.DSCPLN

    const FUNCTIONS = [
        { path: 'balance', icon: '$', name: 'Balance XLSX', description: 'Budget dashboard backed by the live workbook', kind: 'balance' },
        { path: 'media', icon: '▶', name: 'Media Sync', description: 'Device media ingestion, review and cleanup', kind: 'media' },
        { path: 'watxt', icon: '✓', name: 'WhatsApp TXT', description: 'Browse, import and merge WhatsApp exports', kind: 'watxt' },
        { path: 'tasks', icon: '⚙', name: 'Task Runner', description: 'Config-driven backup and export workflows', kind: 'tasks' },
        { path: 'contacts', icon: '@', name: 'Contacts + Calendar', description: 'Scheduled Nextcloud exports', kind: 'scheduled' },
        { path: 'compose', icon: '❒', name: 'Infra Compose State', description: 'Scheduled srv0/vps0 compose state backups', kind: 'scheduled' },
        { path: 'ytmusic', icon: '♪', name: 'YTMusic Downloads', description: 'Scheduled YouTube Music library downloads', kind: 'scheduled' },
    ]

    const grid = document.getElementById('portalGrid')
    const updated = document.getElementById('updatedLabel')
    const attentionLabel = document.getElementById('attentionLabel')
    const themeButton = document.getElementById('themeButton')
    initTheme(themeButton)

    const cards = new Map()

    function build() {
        grid.textContent = ''
        for (const fn of FUNCTIONS) {
            const pill = el('span', { class: 'portal-card__status muted', text: 'checking…' })
            const detail = el('span', { class: 'portal-card__detail', dataset: { base: 'portal-card__detail' }, text: '' })
            const next = el('span', { class: 'portal-card__next', dataset: { base: 'portal-card__next' }, text: '' })
            const card = el('a', { class: 'portal-card', href: `/${fn.path}` },
                el('span', { class: 'portal-card__icon', text: fn.icon }),
                el('span', { class: 'portal-card__body' },
                    el('span', { class: 'portal-card__name', text: fn.name }),
                    el('span', { class: 'portal-card__desc', text: fn.description }),
                    detail,
                    next),
                pill)
            grid.append(card)
            cards.set(fn.path, { pill, detail, next, online: true, issue: false })
        }
    }

    async function getJson(url) {
        const response = await fetch(apiUrl(url), { signal: AbortSignal.timeout(5000) })
        if (!response.ok) throw new Error(String(response.status))
        return response.json()
    }

    function setText(node, text, tone) {
        node.textContent = text ?? ''
        node.className = `${node.dataset.base}${tone ? ` is-${tone}` : ''}`
    }

    async function ping(fn) {
        const ui = cards.get(fn.path)
        try {
            const response = await fetch(apiUrl(`${fn.path}/api/health`), { signal: AbortSignal.timeout(5000) })
            if (!response.ok) throw new Error(String(response.status))
            ui.pill.textContent = 'online'
            ui.pill.className = 'portal-card__status is-ok'
            ui.online = true
        } catch (err) {
            ui.pill.textContent = 'unreachable'
            ui.pill.className = 'portal-card__status is-fail'
            ui.online = false
        }
    }

    function setDetail(ui, text, tone) {
        setText(ui.detail, text, tone)
    }

    function setNext(ui, text, tone) {
        setText(ui.next, text, tone)
    }

    async function updateScheduled(fn, ui) {
        const state = await getJson(`${fn.path}/api/state`)
        const last = state.lastRun
        ui.issue = false
        if (state.runMarker) {
            setDetail(ui, 'running now', 'ok')
        } else if (last) {
            setDetail(ui, `last ${humanAgo(last.endedAt)} · ${last.ok ? 'OK' : 'Failed'}`, last.ok ? 'ok' : 'over')
            if (!last.ok) ui.issue = true
        } else {
            setDetail(ui, 'never run', null)
        }
        if (state.paused) {
            setNext(ui, 'paused', 'warn')
        } else if (Number.isFinite(state.nextRun)) {
            const missed = state.missed ? ` · ${state.missed} missed` : ''
            setNext(ui, `next ${formatDateTime(state.nextRun)}${missed}`, state.missed ? 'warn' : null)
            if (state.missed) ui.issue = true
        } else {
            setNext(ui, 'manual only', null)
        }
    }

    async function updateMedia(fn, ui) {
        const state = await getJson(`${fn.path}/api/state`)
        ui.issue = false
        if (state.paused) {
            setDetail(ui, 'paused', 'warn')
            return
        }
        let active = 0
        let review = 0
        let errors = 0
        for (const folder of state.folders ?? []) {
            const counts = folder.counts ?? {}
            active += (counts.pending ?? 0) + (counts.queued ?? 0) + (counts.processing ?? 0)
            review += counts.review ?? 0
            errors += (counts.error ?? 0) + (counts.conflict ?? 0)
        }
        const parts = []
        if (active) parts.push(`${active} active`)
        if (review) parts.push(`${review} in review`)
        if (errors) parts.push(`${errors} errors`)
        setDetail(ui, parts.length ? parts.join(' · ') : 'idle', errors ? 'over' : review ? 'warn' : 'ok')
        ui.issue = errors > 0
    }

    async function updateWatxt(fn, ui) {
        const state = await getJson(`${fn.path}/api/state`)
        ui.issue = false
        setDetail(ui, `${state.conversations ?? 0} conversations · ${state.messages ?? 0} messages`, null)
    }

    async function updateTasks(fn, ui) {
        const data = await getJson(`${fn.path}/api/tasks`)
        ui.issue = false
        const tasks = (data.groups ?? []).flatMap((group) => group.tasks ?? [])
        const running = tasks.filter((task) => task.running).length
        const failing = tasks.filter((task) => task.state && task.state.ok === false && !task.running).length
        let text = `${tasks.length} tasks`
        if (running) text += ` · ${running} running`
        if (failing) text += ` · ${failing} failing`
        setDetail(ui, text, failing ? 'over' : 'ok')
        ui.issue = failing > 0
    }

    async function updateBalance(fn, ui) {
        const status = await getJson(`${fn.path}/status`)
        ui.issue = false
        if (status.overBudget?.length) {
            setDetail(ui, `${status.overBudget.join(', ')} over budget`, 'over')
            ui.issue = true
        } else {
            setDetail(ui, 'within budget', 'ok')
        }
    }

    const UPDATERS = {
        scheduled: updateScheduled,
        media: updateMedia,
        watxt: updateWatxt,
        tasks: updateTasks,
        balance: updateBalance,
    }

    async function refreshDetail(fn) {
        const ui = cards.get(fn.path)
        try {
            await UPDATERS[fn.kind](fn, ui)
        } catch (err) {
            setDetail(ui, '', null)
            setNext(ui, '', null)
            ui.issue = false
        }
    }

    function updateAttention() {
        let issues = 0
        for (const ui of cards.values()) {
            if (!ui.online || ui.issue) issues += 1
        }
        if (!issues) {
            attentionLabel.textContent = 'all good'
            attentionLabel.className = 'portal-attention is-ok'
        } else if (issues === 1) {
            attentionLabel.textContent = '1 needs attention'
            attentionLabel.className = 'portal-attention is-over'
        } else {
            attentionLabel.textContent = `${issues} need attention`
            attentionLabel.className = 'portal-attention is-over'
        }
    }

    async function refresh() {
        await Promise.all(FUNCTIONS.map((fn) => ping(fn)))
        await Promise.allSettled(FUNCTIONS.map((fn) => refreshDetail(fn)))
        updateAttention()
        updated.textContent = `checked ${formatTime(Date.now())}`
    }

    const refreshButton = document.getElementById('refreshButton')
    refreshButton.innerHTML = window.DSCPLN.icons.refresh
    refreshButton.addEventListener('click', refresh)

    build()
    refresh()
    setInterval(refresh, 60_000)
})()
