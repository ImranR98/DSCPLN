'use strict'

// Standard app frame for D$CPLN apps: header (title, status, actions),
// overview card (last/next run, run now/stop), live log dialog and settings
// dialog (schedule + app fields), wired to the server-kit's standard routes
// (api/state, api/config, api/run, api/cancel, api/pause, api/log,
// api/events).
//
// Usage (app.js):
//   DSCPLNShell.mount({
//     name: 'Contacts + Calendar',
//     fields: [{ path: 'destination', label: 'Destination', type: 'text' }],
//     onState(state) { ... },
//   })
;(function (global) {
    const { el, apiUrl, requestJson, toast, initTheme, formatDateTime, formatDuration, humanAgo, icons } = global.DSCPLN

    const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

    function getPath(obj, dotted) {
        return String(dotted).split('.').reduce((node, part) => (node == null ? undefined : node[part]), obj)
    }

    function setPath(obj, dotted, value) {
        const parts = String(dotted).split('.')
        let node = obj
        for (const part of parts.slice(0, -1)) {
            if (typeof node[part] !== 'object' || node[part] == null) node[part] = {}
            node = node[part]
        }
        node[parts.at(-1)] = value
        return obj
    }

    function iconButton({ id, icon, label, title, variant, onClick }) {
        const button = el('sl-button', { id, size: 'small', class: label ? '' : 'icon-button', variant, title: title ?? label })
        if (icon) button.innerHTML = icon
        if (label) button.append(document.createTextNode(label))
        if (onClick) button.addEventListener('click', onClick)
        return button
    }

    /* ---------- Events (SSE with reconnect) ---------- */

    function connectEvents({ onLine, onState, onConfig, onMessage } = {}) {
        let source = null
        let closed = false
        const open = () => {
            if (closed) return
            source = new EventSource(apiUrl('api/events'))
            source.onmessage = (event) => {
                let payload = null
                try {
                    payload = JSON.parse(event.data)
                } catch (e) {
                    return
                }
                if (payload.type === 'line') onLine?.(payload.line)
                else if (payload.type === 'state') onState?.(payload.state)
                else if (payload.type === 'config') onConfig?.(payload.config)
                onMessage?.(payload)
            }
            source.onerror = () => {
                source?.close()
                source = null
                if (!closed) setTimeout(open, 3000)
            }
        }
        open()
        return {
            close() {
                closed = true
                source?.close()
                source = null
            },
        }
    }

    /* ---------- Log dialog ---------- */

    function makeLogDialog({ title = 'Log' } = {}) {
        const output = el('pre', { class: 'code-block log-dialog__output', text: '' })
        const footer = el('div', { slot: 'footer', class: 'dialog-actions' }, el('sl-button', { variant: 'primary' }, 'Close'))
        const dialog = el('sl-dialog', { label: title, class: 'wide-dialog' }, output, footer)
        document.body.append(dialog)
        footer.firstChild.addEventListener('click', () => dialog.hide())
        return {
            el: dialog,
            async open() {
                dialog.show()
                try {
                    const { lines } = await requestJson('api/log?limit=500')
                    output.textContent = (lines ?? []).join('\n')
                } catch (err) {
                    output.textContent = `Could not load log: ${err.message}`
                }
                output.scrollTop = output.scrollHeight
            },
            append(line) {
                output.textContent += `${line}\n`
                output.scrollTop = output.scrollHeight
            },
            clear() {
                output.textContent = ''
            },
        }
    }

    /* ---------- Settings dialog ---------- */

    function renderField(field, value) {
        const { path: fieldPath, label, type = 'text', help, placeholder, options } = field
        let control
        if (type === 'checkbox') {
            control = el('sl-checkbox', { checked: Boolean(value), dataset: { path: fieldPath, type } }, label ?? fieldPath)
        } else if (type === 'textarea') {
            control = el('sl-textarea', { label: label ?? fieldPath, value: value ?? '', rows: field.rows ?? 5, placeholder, spellcheck: 'false', dataset: { path: fieldPath, type } })
        } else if (type === 'select') {
            control = el('sl-select', { label: label ?? fieldPath, value: value ?? '', dataset: { path: fieldPath, type } })
            for (const option of options ?? []) {
                control.append(el('sl-option', { value: option.value }, option.label))
            }
        } else {
            control = el('sl-input', {
                label: label ?? fieldPath,
                type: type === 'password' ? 'password' : type,
                value: value ?? '',
                placeholder,
                autocomplete: 'off',
                dataset: { path: fieldPath, type },
            })
        }
        const wrapper = el('div', { class: 'settings-field' }, control)
        if (help && type !== 'checkbox') wrapper.append(el('p', { class: 'hint', text: help }))
        return wrapper
    }

    function readField(control, type) {
        if (type === 'checkbox') return Boolean(control.checked)
        if (type === 'number') return control.value === '' ? null : Number(control.value)
        return control.value
    }

    // Applies every [data-path] control under `container` to a clone of
    // `base` (used by the settings dialog and by custom settings sections that
    // want the current form values, e.g. before a Discover call).
    function readForm(container, base) {
        const config = structuredClone(base ?? {})
        for (const control of container.querySelectorAll('[data-path]')) {
            setPath(config, control.dataset.path, readField(control, control.dataset.type))
        }
        return config
    }

    function makeSettingsDialog({ fields = [], schedule = true, notice = null, extra = null, onSave, getConfig }) {
        const body = el('div', { class: 'settings-body' })
        const error = el('p', { class: 'form-error', hidden: true })
        const dialog = el('sl-dialog', { label: 'Settings', class: 'wide-dialog' },
            notice ? el('p', { class: 'hint', text: notice }) : null,
            body, error)
        const cancel = el('sl-button', {}, 'Cancel')
        const save = el('sl-button', { variant: 'primary' }, 'Save')
        dialog.append(el('div', { slot: 'footer', class: 'dialog-actions' }, cancel, save))
        document.body.append(dialog)

        let scheduleControls = null
        dialog.addEventListener('sl-after-hide', () => { error.hidden = true })

        function build(config) {
            body.textContent = ''
            if (schedule) {
                const spec = config?.schedule ?? {}
                const enabled = el('sl-switch', { checked: Boolean(spec.enabled) })
                const at = el('sl-input', { label: 'At', type: 'time', value: spec.at ?? '03:00', class: 'schedule-at' })
                const catchUp = el('sl-switch', { checked: spec.catchUp !== false })
                const dayBoxes = DAY_LABELS.map((label, index) => el('sl-checkbox', {
                    checked: (spec.days ?? []).includes(index),
                    dataset: { day: String(index) },
                }, label))
                scheduleControls = { enabled, at, catchUp, dayBoxes }
                body.append(el('section', { class: 'settings-section' },
                    el('h3', { text: 'Schedule' }),
                    el('div', { class: 'settings-row' }, el('span', { text: 'Enabled' }), enabled),
                    el('div', { class: 'settings-row' }, el('span', { text: 'Catch up missed runs' }), catchUp),
                    at,
                    el('p', { class: 'hint', text: 'No days selected = every day.' }),
                    el('div', { class: 'settings-days' }, dayBoxes)))
            }
            for (const field of fields) {
                body.append(renderField(field, getPath(config ?? {}, field.path)))
            }
            if (extra) {
                extra(body, config ?? {}, { field: renderField, setPath })
            }
        }

        cancel.addEventListener('click', () => dialog.hide())
        save.addEventListener('click', async () => {
            error.hidden = true
            const config = structuredClone(getConfig() ?? {})
            if (scheduleControls) {
                config.schedule = {
                    ...(config.schedule ?? {}),
                    enabled: Boolean(scheduleControls.enabled.checked),
                    at: scheduleControls.at.value || '03:00',
                    catchUp: Boolean(scheduleControls.catchUp.checked),
                    days: scheduleControls.dayBoxes.filter((box) => box.checked).map((box) => Number(box.dataset.day)),
                }
            }
            Object.assign(config, readForm(body, config))
            try {
                const saved = await onSave(config)
                dialog.hide()
                toast('Settings saved')
                return saved
            } catch (err) {
                error.textContent = err.message
                error.hidden = false
            }
        })

        return {
            el: dialog,
            open() {
                build(getConfig())
                dialog.show()
            },
        }
    }

    /* ---------- Full shell ---------- */

    function mount(options = {}) {
        const {
            name,
            actions = [],
            pause = true,
            showRun = true,
            runLabel = 'Run now',
            schedule = true,
            fields = [],
            settingsNotice = null,
            settingsExtra = null,
            onState = null,
            onConfig = null,
            onEvent = null,
            overviewTiles = null,
            showLog = true,
            refreshMs = 15_000,
        } = options

        let currentConfig = {}
        const configOverride = (saved) => { currentConfig = saved }

        const statusTag = el('span', { class: 'status-tag' }, el('span', { text: 'live' }))
        const updatedLabel = el('span', { class: 'muted', text: '' })
        const pauseButton = iconButton({
            id: 'pauseButton',
            icon: icons.pause,
            title: 'Pause',
            onClick: async () => {
                const paused = !currentConfig.paused
                try {
                    await requestJson('api/pause', { method: 'POST', body: JSON.stringify({ paused }) })
                    toast(paused ? 'Paused' : 'Resumed')
                    await refresh()
                } catch (err) {
                    toast(err.message, 'error')
                }
            },
        })
        const settingsButton = iconButton({ id: 'settingsButton', icon: icons.settings, title: 'Settings', onClick: () => settings.open() })
        const refreshButton = iconButton({
            id: 'refreshButton',
            icon: icons.refresh,
            title: 'Refresh',
            onClick: () => refresh(),
        })
        const themeButton = el('sl-button', { id: 'themeButton', size: 'small', class: 'icon-button' })
        initTheme(themeButton)

        const headerActions = [
            pause ? pauseButton : null,
            ...actions.map((action) => iconButton(action)),
            settingsButton,
            refreshButton,
            themeButton,
        ].filter(Boolean)

        const header = el('header', { class: 'app-header' },
            el('div', { class: 'app-header__top' },
                el('h1', { html: `D<span class="accent">$</span>CPLN <span class="app-header__app">⋅ ${name}</span>` }),
                el('div', { class: 'app-header__actions' }, headerActions)),
            el('div', { class: 'app-header__meta' },
                statusTag,
                el('span', { class: 'app-header__meta-tools' }, updatedLabel)))
        document.title = `D$CPLN ⋅ ${name}`
        document.body.prepend(header)

        /* Overview card */
        const tileHost = el('div', { class: 'stat-tiles' })
        const context = el('span', { class: 'card__context' })
        const runButton = showRun ? el('sl-button', { variant: 'primary', size: 'small' }, runLabel) : null
        const stopButton = el('sl-button', { variant: 'danger', size: 'small', hidden: true }, 'Stop')
        const logButton = showLog ? el('sl-button', { size: 'small' }, 'Log') : null
        const historyHost = el('div', { class: 'run-history', hidden: true })
        const overviewCard = el('section', { class: 'card card--hero', id: 'overviewCard' },
            el('div', { class: 'card__header' },
                el('h2', { text: 'Overview' }),
                el('span', { class: 'card__header-tools' }, context)),
            tileHost,
            el('div', { class: 'overview__actions' }, runButton, stopButton, logButton),
            historyHost)
        const main = document.querySelector('main') ?? document.body
        main.prepend(overviewCard)

        const logDialog = showLog ? makeLogDialog({ title: 'Live log' }) : null
        if (logButton) logButton.addEventListener('click', () => logDialog.open())

        const settings = makeSettingsDialog({
            fields,
            schedule,
            notice: settingsNotice,
            extra: settingsExtra,
            onSave: async (config) => {
                const saved = await requestJson('api/config', { method: 'PUT', body: JSON.stringify(config) })
                configOverride(saved)
                onConfig?.(saved)
                await refresh()
                return saved
            },
            getConfig: () => currentConfig,
        })

        const setRunning = (running) => {
            if (runButton) runButton.disabled = running
            if (stopButton) stopButton.hidden = !running
            statusTag.className = `status-tag status-tag--${running ? 'running' : currentConfig.paused ? 'paused' : 'live'}`
        }

        if (runButton) {
            runButton.addEventListener('click', async () => {
                runButton.disabled = true
                try {
                    await requestJson('api/run', { method: 'POST', body: '{}' })
                    toast(`${name}: run started`)
                } catch (err) {
                    toast(err.message, 'error')
                    runButton.disabled = false
                }
            })
        }
        if (stopButton) {
            stopButton.addEventListener('click', async () => {
                try {
                    await requestJson('api/cancel', { method: 'POST', body: '{}' })
                    toast('Cancelling…')
                } catch (err) {
                    toast(err.message, 'error')
                }
            })
        }

        function renderTiles(state) {
            const tiles = overviewTiles ? overviewTiles(state) : defaultTiles(state)
            tileHost.textContent = ''
            for (const tile of tiles) {
                tileHost.append(el('div', { class: 'stat-tile' },
                    el('span', { class: 'stat-tile__label', text: tile.label }),
                    el('span', { class: `stat-tile__value ${tile.tone ? `is-${tile.tone}` : ''}`, text: tile.value ?? '—' })))
            }
        }

        function defaultTiles(state) {
            const last = state.lastRun
            return [
                { label: 'Last run', value: last ? humanAgo(last.endedAt) : 'Never' },
                {
                    label: 'Result',
                    value: last ? (last.ok ? 'OK' : 'Failed') : '—',
                    tone: last ? (last.ok ? 'ok' : 'over') : null,
                },
                { label: 'Duration', value: last ? formatDuration(last.durationSec) : '—' },
                { label: 'Next run', value: state.nextRun ? formatDateTime(state.nextRun) : 'Manual' },
                state.missed ? { label: 'Missed', value: String(state.missed), tone: 'warn' } : null,
            ].filter(Boolean)
        }

        function renderState(state) {
            if (!state) return
            currentConfig = state.config ?? currentConfig
            if (state.paused !== undefined) currentConfig.paused = state.paused
            if (pauseButton) {
                pauseButton.innerHTML = currentConfig.paused ? icons.play : icons.pause
                pauseButton.title = currentConfig.paused ? 'Resume' : 'Pause'
            }
            context.textContent = state.nextRun ? `next ${formatDateTime(state.nextRun)}` : ''
            renderTiles(state)
            setRunning(Boolean(state.run?.running ?? state.running))
            const history = state.history ?? []
            historyHost.hidden = history.length === 0
            if (history.length) {
                historyHost.textContent = ''
                historyHost.append(el('h3', { text: 'Recent runs' }))
                const list = el('ul', { class: 'run-history__list' })
                for (const run of history.slice(0, 10)) {
                    list.append(el('li', { class: run.ok ? 'is-ok' : 'is-fail' },
                        el('span', { text: formatDateTime(run.endedAt) }),
                        el('span', { text: run.ok ? 'OK' : 'Failed' }),
                        el('span', { class: 'muted', text: formatDuration(run.durationSec) }),
                        el('span', { class: 'run-history__summary', text: run.summary ?? '' })))
                }
                historyHost.append(list)
            }
            updatedLabel.textContent = `updated ${DSCPLN.formatTime(Date.now())}`
            onState?.(state)
        }

        async function refresh() {
            try {
                const state = await requestJson('api/state')
                renderState(state)
            } catch (err) {
                statusTag.className = 'status-tag status-tag--paused'
            }
        }

        connectEvents({
            onLine: (line) => logDialog?.append(line),
            onState,
            onMessage: (payload) => {
                if (payload.type === 'update') refresh()
                onEvent?.(payload)
            },
        })
        refresh()
        if (refreshMs) {
            const timer = setInterval(refresh, refreshMs)
            window.addEventListener('beforeunload', () => clearInterval(timer))
        }

        return { refresh, renderState, log: logDialog, settings, header }
    }

    global.DSCPLNShell = { mount, connectEvents, makeLogDialog, makeSettingsDialog, iconButton, readForm, getPath, setPath }
})(window)
