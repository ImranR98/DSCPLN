'use strict'

// Media Sync UI. Renders the dashboard from /api/state, drives actions through
// the JSON API, and keeps itself fresh via Server-Sent Events. Interactive
// components come from Shoelace (dialogs, buttons, inputs, badges, details).
;(function () {
    const { el, requestJson, initTheme, showToast, formatBytes, formatTime, formatDateTime, formatDuration, icons } = window.IMM
    const toastContainer = document.querySelector('#toasts')
    const $ = (selector) => document.querySelector(selector)

    const state = {
        data: null,
        dirty: false,
        expanded: new Set(),
    }

    const STATUS_RANK = {
        error: 0,
        conflict: 1,
        queued: 2,
        processing: 3,
        pending: 4,
        done: 5,
        duplicate: 6,
        cleaned: 7,
        ignored: 8,
    }
    const STATUS_VARIANT = {
        pending: 'neutral',
        queued: 'brand',
        processing: 'brand',
        done: 'success',
        duplicate: 'neutral',
        error: 'danger',
        conflict: 'warning',
        ignored: 'neutral',
        cleaned: 'neutral',
    }
    const METHOD_VARIANT = { standardize: 'brand', snapchat: 'neutral', copy: 'warning' }
    const FILE_LIMIT = 300

    /* ---------- small builders ---------- */

    const button = (props = {}, ...children) => {
        const node = el('sl-button', { size: 'small', ...props })
        for (const child of children) {
            node.append(child instanceof Node ? child : document.createTextNode(child))
        }
        return node
    }

    const iconButton = (icon, title, action, dataset = {}, { small = false } = {}) => {
        const node = el('sl-button', {
            size: 'small',
            class: `icon-button${small ? ' icon-button--small' : ''}`,
            title,
            'aria-label': title,
            dataset: { action, ...dataset },
        })
        node.innerHTML = icon
        return node
    }

    const badge = (text, variant) => el('sl-badge', { variant, pill: true, text })

    const input = (fieldName, value, type = 'text') =>
        el('sl-input', { size: 'small', type, dataset: { field: fieldName }, value: value ?? '' })

    const fieldValue = (name) => {
        const node = document.querySelector(`#settingsBody [data-field="${name}"]`)
        return node ? node.value : ''
    }

    // Shoelace's dialog/drawer emit `sl-request-close` and close by default on
    // backdrop clicks and Escape; `sl-after-hide` is the "fully closed" signal.
    const onDialogClosed = (dialog, handler) => dialog.addEventListener('sl-after-hide', handler)

    /* ---------- header ---------- */

    function renderHeader() {
        const { data } = state
        let pending = 0
        let issues = 0
        for (const folder of data.folders) {
            pending += folder.counts.pending || 0
            issues += (folder.counts.error || 0) + (folder.counts.conflict || 0)
        }
        const tag = $('#statusTag')
        tag.className = `status-tag${data.paused ? ' status-tag--paused' : data.dryRun ? ' status-tag--dry' : ''}`
        tag.querySelector('span').textContent = data.paused ? 'paused' : data.dryRun ? 'dry run' : 'live'
        $('#pauseButton').innerHTML = data.paused ? icons.play : icons.pause
        $('#pauseButton').title = data.paused ? 'Resume processing' : 'Pause processing'
        $('#countsLabel').textContent = `${pending} pending · ${issues} issue${issues === 1 ? '' : 's'}`
        $('#updatedLabel').textContent = `updated ${formatTime(Date.now())}`
    }

    /* ---------- overview ---------- */

    function renderOverview() {
        const counters = { pending: 0, processing: 0, processed: 0, issues: 0 }
        for (const folder of state.data.folders) {
            const counts = folder.counts
            counters.pending += counts.pending || 0
            counters.processing += (counts.queued || 0) + (counts.processing || 0)
            counters.processed += (counts.done || 0) + (counts.duplicate || 0)
            counters.issues += (counts.error || 0) + (counts.conflict || 0)
        }
        $('#ovPending').textContent = String(counters.pending)
        $('#ovProcessing').textContent = String(counters.processing)
        $('#ovProcessed').textContent = String(counters.processed)
        const issuesTile = $('#ovIssues')
        issuesTile.textContent = String(counters.issues)
        issuesTile.classList.toggle('is-over', counters.issues > 0)
        $('#overviewContext').textContent = `${state.data.folders.length} folder${state.data.folders.length === 1 ? '' : 's'} watched`

        const cleanupButton = $('#cleanupAllButton')
        cleanupButton.textContent = counters.processed > 0 ? `Cleanup all (${counters.processed})` : 'Cleanup all'
        cleanupButton.toggleAttribute('disabled', counters.processed === 0)
    }

    /* ---------- folder cards ---------- */

    function folderContext(folder) {
        const parts = [`settle ${formatDuration(folder.settleSeconds)}`]
        if (folder.method === 'snapchat') {
            parts.push(`window ${formatDuration(folder.groupWindowSeconds)}`)
        }
        if (folder.filePattern) {
            parts.push(folder.filePattern)
        }
        return parts.join(' · ')
    }

    function fileActions(folder, file) {
        const actions = []
        if (file.status === 'error' || file.status === 'conflict') {
            actions.push(iconButton(icons.retry, 'Retry', 'file-retry', { folder: folder.name, file: file.name }, { small: true }))
        }
        if (file.status === 'error') {
            actions.push(iconButton(icons.wrench, 'Repair (ffmpeg remux)', 'file-repair', { folder: folder.name, file: file.name }, { small: true }))
            actions.push(iconButton(icons.calendar, 'Set date and retry', 'file-setdate', { folder: folder.name, file: file.name }, { small: true }))
        }
        if (file.status === 'error' || file.status === 'conflict' || file.status === 'pending') {
            actions.push(iconButton(icons.import, 'Import as-is', 'file-import', { folder: folder.name, file: file.name }, { small: true }))
        }
        return el('div', { class: 'file__actions' }, actions)
    }

    function fileRow(folder, file) {
        const notes = []
        if (file.message) {
            notes.push(file.message)
        }
        if (file.attempts) {
            notes.push(`attempt ${file.attempts}`)
        }
        return el('li', { class: `file file--${file.status}` },
            el('div', { class: 'file__main' },
                el('span', { class: 'file__name', text: file.name }),
                notes.length > 0 ? el('span', { class: 'file__notes', text: notes.join(' · ') }) : null,
                file.destName ? el('span', { class: 'file__dest', text: `→ ${file.destName}` }) : null),
            el('div', { class: 'file__meta' },
                el('span', { class: 'file__size', text: formatBytes(file.size) }),
                el('span', { class: 'file__date', text: formatDateTime(file.mtimeMs) }),
                badge(file.status, STATUS_VARIANT[file.status] ?? 'neutral'),
                fileActions(folder, file)))
    }

    function folderFiles(folder) {
        const files = [...folder.files].sort((a, b) => {
            const rank = (STATUS_RANK[a.status] ?? 9) - (STATUS_RANK[b.status] ?? 9)
            return rank !== 0 ? rank : a.name.localeCompare(b.name)
        })
        const shown = files.slice(0, FILE_LIMIT)
        const details = el('sl-details', {
            class: 'folder-details',
            summary: `Files · ${files.length} file${files.length === 1 ? '' : 's'}`,
        })
        if (state.expanded.has(folder.name)) {
            details.setAttribute('open', '')
        }
        details.append(
            files.length > 0
                ? el('ul', { class: 'files__list' }, shown.map((file) => fileRow(folder, file)))
                : el('p', { class: 'muted files-empty', text: 'No files in this folder right now.' }))
        if (files.length > shown.length) {
            details.append(el('p', { class: 'muted files-empty', text: `… and ${files.length - shown.length} more file(s)` }))
        }
        details.addEventListener('sl-after-show', () => state.expanded.add(folder.name))
        details.addEventListener('sl-after-hide', () => state.expanded.delete(folder.name))
        return details
    }

    function folderCard(folder) {
        const counts = folder.counts || {}
        const total = folder.files.length
        const pending = counts.pending || 0
        const processing = (counts.queued || 0) + (counts.processing || 0)
        const processed = (counts.done || 0) + (counts.duplicate || 0)
        const issues = (counts.error || 0) + (counts.conflict || 0)
        const ignored = counts.ignored || 0
        const considered = Math.max(1, total - ignored)
        const percent = Math.min(100, Math.round((processed / considered) * 100))

        const card = el('section', {
            class: `card folder-card folder-card--${folder.method}${counts.conflict ? ' card--over' : issues ? ' card--warn' : ''}`,
        })
        card.append(el('div', { class: 'card__header' },
            el('div', { class: 'folder-title' },
                el('h2', { text: folder.name }),
                badge(folder.method, METHOD_VARIANT[folder.method] ?? 'neutral'),
                folder.exists ? null : badge('source unavailable', 'danger')),
            el('span', { class: 'card__context', text: folderContext(folder) })))

        card.append(el('p', { class: 'figure' },
            el('span', { class: 'figure__spend', text: String(pending) }),
            el('span', { class: 'figure__meta' },
                el('span', { class: 'figure__of', text: 'pending of' }),
                el('span', { class: 'figure__budget', text: `${total} file${total === 1 ? '' : 's'}` }))))

        card.append(el('div', {
            class: 'progress',
            role: 'progressbar',
            'aria-valuemin': 0,
            'aria-valuemax': 100,
            'aria-valuenow': percent,
        }, el('div', { class: 'progress__fill', style: { width: `${percent}%` } })))

        const context = []
        if (folder.lastEventAt) {
            context.push(`last change ${formatDateTime(folder.lastEventAt)}`)
        }
        context.push(`${processed} processed`)
        if (ignored > 0) {
            context.push(`${ignored} ignored`)
        }
        card.append(el('p', { class: 'pace', text: context.join(' · ') }))

        card.append(el('div', { class: 'stat-tiles' },
            statTile('pending', pending),
            statTile('processing', processing),
            statTile('processed', processed),
            statTile('issues', issues, issues > 0 ? 'is-over' : '')))

        card.append(el('p', { class: 'folder-paths' },
            el('code', { text: folder.source }),
            el('span', { class: 'folder-paths__arrow', text: '→' }),
            el('code', { text: folder.destination })))

        const actions = [button({ dataset: { action: 'process', folder: folder.name } }, 'Process now')]
        if (processed > 0) {
            actions.push(button({ variant: 'primary', dataset: { action: 'cleanup', folder: folder.name } }, `Cleanup ${processed}`))
        }
        card.append(el('div', { class: 'folder-card__actions' }, actions))

        card.append(folderFiles(folder))
        return card
    }

    const statTile = (label, value, className = '') => el('div', { class: 'stat-tile' },
        el('span', { class: 'stat-tile__label', text: label }),
        el('span', { class: `stat-tile__value${className ? ` ${className}` : ''}`, text: String(value) }))

    function renderFolders() {
        const grid = $('#folderGrid')
        grid.textContent = ''
        if (state.data.folders.length === 0) {
            grid.append(el('section', { class: 'card' },
                el('p', { class: 'muted', text: 'No folders configured yet — open Settings to add one.' })))
            return
        }
        for (const folder of state.data.folders) {
            grid.append(folderCard(folder))
        }
    }

    /* ---------- panels ---------- */

    let trashIndex = new Map()

    const selectedTrashItems = () =>
        [...document.querySelectorAll('#trashList sl-checkbox')]
            .filter((box) => box.checked)
            .map((box) => ({ day: box.dataset.day, name: box.dataset.name }))

    function updateTrashSelection() {
        const count = selectedTrashItems().length
        const button = $('#trashRestoreSelected')
        button.textContent = count > 0 ? `Restore selected (${count})` : 'Restore selected'
        button.toggleAttribute('disabled', count === 0)
    }

    async function refreshTrash() {
        const { entries } = await requestJson('/api/trash')
        const totalFiles = entries.reduce((sum, entry) => sum + entry.count, 0)
        const totalBytes = entries.reduce((sum, entry) => sum + entry.bytes, 0)
        trashIndex = new Map()
        const list = $('#trashList')
        list.textContent = ''
        for (const entry of entries) {
            const details = el('sl-details', {
                class: 'trash__day',
                summary: `${entry.day} · ${entry.count} file${entry.count === 1 ? '' : 's'} · ${formatBytes(entry.bytes)}`,
            })
            for (const file of entry.files.slice(0, 300)) {
                trashIndex.set(`${entry.day}/${file.name}`, file)
                const origin = file.folder ?? file.sourceDir ?? 'origin unknown'
                details.append(el('div', { class: 'checklist__row' },
                    el('sl-checkbox', { size: 'small', dataset: { day: entry.day, name: file.name } }),
                    el('span', { class: 'checklist__main', text: file.name }),
                    el('span', { class: 'checklist__meta', text: `${formatBytes(file.size)} · ${origin}` }),
                    iconButton(icons.restore, 'Restore this file', 'trash-restore', { day: entry.day, name: file.name }, { small: true })))
            }
            if (entry.count > 300) {
                details.append(el('p', { class: 'muted files-empty', text: `… and ${entry.count - 300} more` }))
            }
            list.append(details)
        }
        list.hidden = entries.length === 0
        $('#trashEmpty').hidden = entries.length > 0
        $('#trashSelectAll').hidden = entries.length === 0
        $('#trashSelectAll').checked = false
        $('#emptyTrashButton').hidden = entries.length === 0
        $('#trashRestoreSelected').hidden = entries.length === 0
        updateTrashSelection()
        $('#trashContext').textContent = `keeping ${state.data ? state.data.trashRetentionDays : '?'} days`
        const trashTile = $('#ovTrash')
        trashTile.textContent = totalFiles > 0 ? formatBytes(totalBytes) : '—'
        trashTile.title = totalFiles > 0 ? `${totalFiles} file(s)` : ''
    }

    async function refreshLog() {
        const { lines } = await requestJson('/api/log?limit=200')
        const log = $('#activityLog')
        log.textContent = lines.join('\n')
        log.scrollTop = log.scrollHeight
    }

    function render() {
        if (!state.data) {
            return
        }
        if (document.querySelector('sl-dialog[open]')) {
            state.dirty = true
            return
        }
        state.dirty = false
        renderHeader()
        renderOverview()
        renderFolders()
    }

    async function refresh() {
        try {
            state.data = await requestJson('/api/state')
            render()
        } catch (err) {
            showToast(toastContainer, `Could not load state: ${err.message}`, 'error')
        }
    }

    /* ---------- dialogs ---------- */

    const confirmDialog = $('#confirmDialog')
    let confirmResolve = null
    let confirmAccepted = false

    function askConfirm({ title, text, confirmLabel, danger = true }) {
        confirmDialog.setAttribute('label', title)
        $('#confirmText').textContent = text
        const accept = $('#confirmButton')
        accept.textContent = confirmLabel
        accept.setAttribute('variant', danger ? 'danger' : 'primary')
        confirmAccepted = false
        confirmDialog.show()
        return new Promise((resolve) => {
            confirmResolve = resolve
        })
    }

    $('#confirmCancel').addEventListener('click', () => confirmDialog.hide())
    $('#confirmButton').addEventListener('click', () => {
        confirmAccepted = true
        confirmDialog.hide()
    })
    onDialogClosed(confirmDialog, () => {
        if (confirmResolve) {
            confirmResolve(confirmAccepted)
            confirmResolve = null
        }
        if (state.dirty) {
            render()
        }
    })

    const reportDialog = $('#reportDialog')
    function showReport(title, entries) {
        reportDialog.setAttribute('label', title)
        const list = $('#reportList')
        list.textContent = ''
        list.append(...entries.map((entry) => el('div', { class: 'checklist__row' },
            el('span', { class: 'checklist__main', text: entry.name }),
            el('span', { class: 'msg error', text: entry.reason || '' }))))
        reportDialog.show()
    }
    $('#reportClose').addEventListener('click', () => reportDialog.hide())

    /* ---------- cleanup ---------- */

    const cleanupDialog = $('#cleanupDialog')
    let cleanupFolderName = null

    async function openCleanup(folderName) {
        const preview = await requestJson(`/api/cleanup/${encodeURIComponent(folderName)}`)
        cleanupFolderName = folderName
        if (preview.files.length === 0) {
            showToast(toastContainer, 'Nothing to clean up in this folder.', 'error')
            return
        }
        cleanupDialog.setAttribute('label', `Cleanup ${folderName}`)
        $('#cleanupHint').textContent =
            `${preview.files.length} processed file(s), ${formatBytes(preview.totalBytes)}. Each destination copy is verified before the original is moved to trash.`
        const list = $('#cleanupList')
        list.textContent = ''
        list.append(...preview.files.map((file) => el('div', { class: 'checklist__row' },
            el('sl-checkbox', { size: 'small', checked: true, dataset: { name: file.name } }),
            el('span', { class: 'checklist__main', text: file.name }),
            el('span', { class: 'checklist__meta', text: file.destName ? `→ ${file.destName}` : '' }))))
        $('#cleanupAll').checked = true
        cleanupDialog.show()
    }

    $('#cleanupAll').addEventListener('sl-change', (event) => {
        for (const box of document.querySelectorAll('#cleanupList sl-checkbox')) {
            box.checked = event.target.checked
        }
    })
    $('#cleanupCancel').addEventListener('click', () => cleanupDialog.hide())
    $('#cleanupConfirm').addEventListener('click', async (event) => {
        const names = [...document.querySelectorAll('#cleanupList sl-checkbox')]
            .filter((box) => box.checked)
            .map((box) => box.dataset.name)
        if (names.length === 0) {
            showToast(toastContainer, 'No files selected.', 'error')
            return
        }
        event.target.disabled = true
        try {
            const { results } = await requestJson(`/api/cleanup/${encodeURIComponent(cleanupFolderName)}`, {
                method: 'POST',
                body: JSON.stringify({ names }),
            })
            cleanupDialog.hide()
            const ok = results.filter((result) => result.ok).length
            const failed = results.filter((result) => !result.ok)
            showToast(toastContainer, `Moved ${ok} file(s) to trash.`, failed.length === 0 ? 'success' : 'error')
            if (failed.length > 0) {
                showReport('Cleanup finished with issues', failed)
            }
            await refresh()
            await refreshLog()
            await refreshTrash()
        } catch (err) {
            showToast(toastContainer, `Cleanup failed: ${err.message}`, 'error')
        } finally {
            event.target.disabled = false
        }
    })

    /* ---------- set date ---------- */

    const setDateDialog = $('#setDateDialog')
    let setDateTarget = null

    function openSetDate(folderName, fileName) {
        setDateTarget = { folderName, fileName }
        setDateDialog.setAttribute('label', `Set date — ${fileName}`)
        $('#setDateValue').value = ''
        $('#setDateTime').value = '00:00'
        $('#setDateError').hidden = true
        setDateDialog.show()
    }

    $('#setDateCancel').addEventListener('click', () => setDateDialog.hide())
    $('#setDateSubmit').addEventListener('click', async () => {
        const date = $('#setDateValue').value
        const time = $('#setDateTime').value || '00:00'
        if (!date) {
            $('#setDateError').textContent = 'Pick a date first.'
            $('#setDateError').hidden = false
            return
        }
        try {
            await requestJson(`/api/actions/${encodeURIComponent(setDateTarget.folderName)}/${encodeURIComponent(setDateTarget.fileName)}`, {
                method: 'POST',
                body: JSON.stringify({ action: 'setDate', date: `${date} ${time}` }),
            })
            setDateDialog.hide()
            showToast(toastContainer, `Standardizing ${setDateTarget.fileName} with the chosen date.`)
            await refresh()
            await refreshLog()
        } catch (err) {
            showToast(toastContainer, `Set date failed: ${err.message}`, 'error')
        }
    })

    /* ---------- trash restore ---------- */

    const restoreDialog = $('#restoreDialog')
    let pendingRestore = null

    function openRestore(items) {
        pendingRestore = items
        $('#restoreDir').value = ''
        $('#restoreError').hidden = true
        restoreDialog.show()
    }

    async function restoreItems(items, targetDir) {
        const { results } = await requestJson('/api/trash/restore', {
            method: 'POST',
            body: JSON.stringify({ files: items, targetDir: targetDir || null }),
        })
        const ok = results.filter((result) => result.ok).length
        const failed = results.filter((result) => !result.ok)
        showToast(toastContainer, `Restored ${ok} file(s).`, failed.length ? 'error' : 'success')
        if (failed.length > 0) {
            showReport('Restore finished with issues', failed.map((f) => ({ name: f.name, reason: f.reason })))
        }
        await refreshTrash()
        await refreshLog()
    }

    $('#restoreCancel').addEventListener('click', () => restoreDialog.hide())
    $('#restoreConfirm').addEventListener('click', async () => {
        const dir = $('#restoreDir').value.trim()
        if (!dir) {
            $('#restoreError').textContent = 'Enter a directory first.'
            $('#restoreError').hidden = false
            return
        }
        const items = pendingRestore ?? []
        pendingRestore = null
        restoreDialog.hide()
        await restoreItems(items, dir)
    })

    /* ---------- settings ---------- */

    const settingsDialog = $('#settingsDialog')
    const field = (label, control) => el('div', { class: 'field' },
        el('span', { class: 'field__label', text: label }), control)

    function folderEditor(folder) {
        const editor = el('div', { class: 'folder-edit' })
        editor.append(el('div', { class: 'folder-edit__head' },
            el('h3', { text: folder.name || 'New folder' }),
            iconButton(icons.close, 'Remove this folder', 'remove-folder', {}, { small: true })))
        editor.append(el('div', { class: 'form-grid' },
            field('Name', input('name', folder.name)),
            field('Source', input('source', folder.source)),
            field('Destination', input('destination', folder.destination)),
            field('Settle (s)', input('settleSeconds', folder.settleSeconds ?? 60, 'number')),
            field('Group window (s)', input('groupWindowSeconds', folder.groupWindowSeconds ?? 15, 'number')),
            field('File pattern', input('filePattern', folder.filePattern ?? ''))))
        const methodSelect = el('sl-select', { size: 'small', dataset: { field: 'method' } },
            ...['standardize', 'snapchat', 'copy'].map((method) => el('sl-option', { value: method, text: method })))
        methodSelect.setAttribute('value', folder.method || 'standardize')
        editor.append(el('div', { class: 'form-grid' }, field('Method', methodSelect)))
        return editor
    }

    function openSettings() {
        const config = state.data.config
        const body = $('#settingsBody')
        body.textContent = ''

        body.append(el('div', { class: 'form-grid' },
            field('Concurrency', input('concurrency', config.concurrency, 'number')),
            field('Trash retention (days)', input('retention', config.trashRetentionDays, 'number')),
            field('Default settle (s)', input('settle', config.settleSeconds, 'number')),
            field('ntfy URL', input('ntfyUrl', config.ntfy?.url ?? '')),
            field('ntfy token', input('ntfyToken', config.ntfy?.token ?? ''))))

        const notifySuccess = el('sl-checkbox', { id: 'cfg-notify-success', size: 'small' },
            'Notify when files are processed successfully')
        notifySuccess.checked = config.ntfy?.notifySuccess !== false
        body.append(el('div', { class: 'form-grid' },
            el('div', { class: 'field field--wide' }, notifySuccess)))

        body.append(el('div', { class: 'form-grid' },
            el('div', { class: 'field field--wide' }, el('span', { class: 'field__label', text: 'Staging directory' }), input('stagingDir', config.stagingDir)),
            el('div', { class: 'field field--wide' }, el('span', { class: 'field__label', text: 'Trash directory' }), input('trashDir', config.trashDir))))

        body.append(el('div', { class: 'ntfy-test' },
            el('span', { id: 'ntfyTestResult', class: 'hint', hidden: true }),
            button({ dataset: { action: 'ntfy-test' } }, 'Send test notification')))

        body.append(el('h3', { class: 'settings-section', text: 'Folders' }))
        body.append(el('div', { id: 'folderEditors' }, config.folders.map(folderEditor)))
        body.append(el('div', { class: 'folder-actions' },
            button({ dataset: { action: 'add-folder' } }, 'Add folder')))
        settingsDialog.show()
    }

    $('#settingsCancel').addEventListener('click', () => settingsDialog.hide())
    $('#settingsSave').addEventListener('click', async (event) => {
        const config = { ...state.data.config }
        config.concurrency = Number(fieldValue('concurrency'))
        config.trashRetentionDays = Number(fieldValue('retention'))
        config.settleSeconds = Number(fieldValue('settle'))
        config.stagingDir = fieldValue('stagingDir').trim()
        config.trashDir = fieldValue('trashDir').trim()
        config.ntfy = {
            ...state.data.config.ntfy,
            url: fieldValue('ntfyUrl').trim(),
            token: fieldValue('ntfyToken').trim(),
            notifySuccess: $('#cfg-notify-success').checked,
        }
        config.folders = [...document.querySelectorAll('#folderEditors .folder-edit')].map((editor) => {
            const get = (name) => editor.querySelector(`[data-field="${name}"]`).value
            return {
                name: get('name').trim(),
                source: get('source').trim(),
                destination: get('destination').trim(),
                method: get('method'),
                settleSeconds: Number(get('settleSeconds')),
                groupWindowSeconds: Number(get('groupWindowSeconds')),
                filePattern: get('filePattern').trim() || null,
            }
        })
        event.target.disabled = true
        try {
            await requestJson('/api/config', { method: 'PUT', body: JSON.stringify(config) })
            settingsDialog.hide()
            showToast(toastContainer, 'Settings saved.')
            await refresh()
            await refreshLog()
        } catch (err) {
            showToast(toastContainer, `Save failed: ${err.message}`, 'error')
        } finally {
            event.target.disabled = false
        }
    })

    /* ---------- actions ---------- */

    async function postAction(folder, file, action, body = {}) {
        return requestJson(`/api/actions/${encodeURIComponent(folder)}/${encodeURIComponent(file)}`, {
            method: 'POST',
            body: JSON.stringify({ action, ...body }),
        })
    }

    document.addEventListener('click', async (event) => {
        const target = event.target.closest('[data-action]')
        if (!target) {
            return
        }
        const { action, folder, file } = target.dataset
        try {
            if (action === 'pause') {
                const paused = !state.data.paused
                await requestJson('/api/pause', { method: 'POST', body: JSON.stringify({ paused }) })
                showToast(toastContainer, paused ? 'Processing paused.' : 'Processing resumed.')
                await refresh()
            } else if (action === 'dry-run') {
                const dryRun = !state.data.dryRun
                await requestJson('/api/dry-run', { method: 'POST', body: JSON.stringify({ dryRun }) })
                showToast(toastContainer, dryRun ? 'Dry-run mode enabled — nothing will be written.' : 'Dry-run mode disabled.')
                await refresh()
            } else if (action === 'process') {
                target.disabled = true
                const result = await requestJson(`/api/process/${encodeURIComponent(folder)}`, { method: 'POST', body: '{}' })
                showToast(toastContainer, result.processed > 0 ? `Queued ${result.processed} file(s).` : 'Nothing to process.')
                await refresh()
            } else if (action === 'cleanup') {
                await openCleanup(folder)
            } else if (action === 'cleanup-all') {
                const ok = await askConfirm({
                    title: 'Cleanup all folders',
                    text: 'Verify and move every processed original to trash? Files stay recoverable in trash for the retention period.',
                    confirmLabel: 'Move all to trash',
                })
                if (ok) {
                    await requestJson('/api/cleanup-all', { method: 'POST', body: '{}' })
                    showToast(toastContainer, 'Cleanup finished.')
                    await refresh()
                    await refreshLog()
                    await refreshTrash()
                }
            } else if (action === 'settings') {
                openSettings()
            } else if (action === 'trash') {
                $('#trashCard').scrollIntoView({ behavior: 'smooth', block: 'start' })
            } else if (action === 'trash-restore') {
                const item = { day: target.dataset.day, name: target.dataset.name }
                const info = trashIndex.get(`${item.day}/${item.name}`)
                if (info?.sourceDir) {
                    await restoreItems([item], null)
                } else {
                    openRestore([item])
                }
            } else if (action === 'trash-restore-selected') {
                const items = selectedTrashItems()
                if (items.length === 0) {
                    showToast(toastContainer, 'No files selected.', 'error')
                    return
                }
                const allHaveOrigin = items.every((item) => trashIndex.get(`${item.day}/${item.name}`)?.sourceDir)
                if (allHaveOrigin) {
                    await restoreItems(items, null)
                } else {
                    openRestore(items)
                }
            } else if (action === 'refresh-log') {
                await refreshLog()
            } else if (action === 'refresh-trash') {
                await refreshTrash()
            } else if (action === 'empty-trash') {
                const ok = await askConfirm({
                    title: 'Empty trash',
                    text: 'Permanently delete everything in the trash? This cannot be undone.',
                    confirmLabel: 'Delete permanently',
                })
                if (ok) {
                    await requestJson('/api/trash/empty', { method: 'POST', body: '{}' })
                    showToast(toastContainer, 'Trash emptied.')
                    await refreshTrash()
                    await refreshLog()
                }
            } else if (action === 'add-folder') {
                $('#folderEditors').append(folderEditor({ method: 'standardize', settleSeconds: state.data.config.settleSeconds }))
            } else if (action === 'ntfy-test') {
                const result = $('#ntfyTestResult')
                target.disabled = true
                result.hidden = true
                try {
                    await requestJson('/api/ntfy-test', {
                        method: 'POST',
                        body: JSON.stringify({ url: fieldValue('ntfyUrl'), token: fieldValue('ntfyToken') }),
                    })
                    result.textContent = 'Test notification sent.'
                    result.className = 'hint'
                } catch (err) {
                    result.textContent = `Test failed: ${err.message}`
                    result.className = 'form-error'
                } finally {
                    result.hidden = false
                    target.disabled = false
                }
            } else if (action === 'remove-folder') {
                target.closest('.folder-edit').remove()
            } else if (action === 'file-retry') {
                await postAction(folder, file, 'retry')
                showToast(toastContainer, `Retrying ${file}…`)
                await refresh()
            } else if (action === 'file-repair') {
                await postAction(folder, file, 'repair')
                showToast(toastContainer, `Repairing ${file}…`)
                await refresh()
            } else if (action === 'file-import') {
                await postAction(folder, file, 'importAsIs')
                showToast(toastContainer, `Importing ${file} as-is…`)
                await refresh()
            } else if (action === 'file-setdate') {
                openSetDate(folder, file)
            }
        } catch (err) {
            showToast(toastContainer, err.message, 'error')
        }
    })

    /* ---------- boot ---------- */

    $('#pauseButton').innerHTML = icons.pause
    $('#dryRunButton').innerHTML = icons.dry
    $('#settingsButton').innerHTML = icons.settings
    $('#refreshButton').innerHTML = icons.refresh
    $('#trashCard [data-action="refresh-trash"]').innerHTML = icons.refresh
    $('#activityCard [data-action="refresh-log"]').innerHTML = icons.refresh
    initTheme($('#themeButton'))
    $('#refreshButton').addEventListener('click', async () => {
        await refresh()
        await refreshLog()
        await refreshTrash()
    })
    $('#trashSelectAll').addEventListener('sl-change', (event) => {
        for (const box of document.querySelectorAll('#trashList sl-checkbox')) {
            box.checked = event.target.checked
        }
        updateTrashSelection()
    })
    document.addEventListener('sl-change', (event) => {
        if (event.target?.closest?.('#trashList')) {
            updateTrashSelection()
        }
    })

    for (const dialog of document.querySelectorAll('sl-dialog')) {
        onDialogClosed(dialog, () => {
            if (state.dirty) {
                render()
            }
        })
    }

    let refreshTimer = null
    new EventSource('/api/events').onmessage = () => {
        clearTimeout(refreshTimer)
        refreshTimer = setTimeout(() => {
            refresh()
            refreshLog()
        }, 400)
    }

    ;(async () => {
        await refresh()
        await refreshLog()
        await refreshTrash()
    })()
    setInterval(() => {
        refresh()
        refreshTrash()
    }, 15000)
})()
