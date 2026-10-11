'use strict'

// Task Runner UI: config-driven task cards with drop zones, prompts, serial
// queues, live logs (polled /api/status) and the paste dialog. Built on the
// shared ui-kit core/builder and Shoelace components, like every other app.
;(function () {
  const { el, apiUrl, toast: kitToast, initTheme, icons } = window.DSCPLN
  const $ = (selector) => document.querySelector(selector)

  const STATE = { tasks: [], groups: [], queues: {}, uploading: new Map(), uploadAborts: new Map(), liveLogs: new Map(), openLogRef: null }

  async function api(path, options = {}) {
    const res = await fetch(apiUrl(path), options)
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      data.error = data.error || (data.detail || `HTTP ${res.status}`)
      return data
    }
    return data
  }

  function apiPost(path, body = {}) {
    return api(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  }

  // The old toast types map onto the shared kit toasts.
  const TOAST_TYPES = { positive: 'success', negative: 'error', warning: 'info' }
  function toast(message, type = 'positive') {
    return kitToast(message, TOAST_TYPES[type] ?? 'info')
  }

  // Standard Shoelace dialog for every modal (prompts, logs, paste output).
  function openModal({ title, body, buttons }) {
    const dialog = el('sl-dialog', { label: title, class: 'task-dialog' })
    if (body) dialog.append(body)
    const footer = el('div', { slot: 'footer', class: 'dialog-actions' })
    for (const b of buttons) {
      const btn = el('sl-button', { variant: b.cls === 'btn-primary' ? 'primary' : 'default' }, b.label)
      btn.addEventListener('click', () => b.onClick(dialog))
      footer.append(btn)
    }
    dialog.append(footer)
    dialog.addEventListener('sl-after-hide', () => dialog.remove())
    $('#modal-root').append(dialog)
    dialog.show()
    return dialog
  }

  function confirmModal(title, submitLabel = 'Run', body = null) {
    return new Promise((resolve) => {
      openModal({
        title,
        body,
        buttons: [
          { label: 'Cancel', cls: 'btn-ghost', onClick: (o) => { o.hide(); resolve(false) } },
          { label: submitLabel, cls: 'btn-primary', onClick: (o) => { o.hide(); resolve(true) } },
        ],
      })
    })
  }

  function fieldsModal(title, fields, submitLabel = 'Run') {
    return new Promise((resolve) => {
      const body = el('div', { class: 'modal-fields' })
      const inputs = []
      for (const f of fields) {
        const inp = el('sl-input', { type: 'password', label: f.label, autocomplete: 'off' })
        inputs.push(inp)
        body.append(inp)
      }
      openModal({
        title,
        body,
        buttons: [
          { label: 'Cancel', cls: 'btn-ghost', onClick: (o) => { o.hide(); resolve(null) } },
          { label: submitLabel, cls: 'btn-primary', onClick: (o) => { o.hide(); resolve(inputs.map((i) => i.value)) } },
        ],
      })
      window.setTimeout(() => inputs[0]?.focus(), 60)
    })
  }

  function pickerModal(title, tasks) {
    return new Promise((resolve) => {
      const list = el('div', { class: 'modal-fields' })
      for (const t of tasks) {
        const b = el('sl-button', { class: 'picker-option' }, t.name)
        b.addEventListener('click', () => resolve(t))
        list.append(b)
      }
      openModal({
        title,
        body: list,
        buttons: [{ label: 'Cancel', cls: 'btn-ghost', onClick: (o) => { o.hide(); resolve(null) } }],
      })
    })
  }

  function formatElapsed(sec) {
    sec = Math.max(0, Math.floor(sec))
    const h = Math.floor(sec / 3600)
    const m = Math.floor((sec % 3600) / 60)
    const s = sec % 60
    const mm = String(m).padStart(2, '0')
    const ss = String(s).padStart(2, '0')
    return h ? `${h}:${mm}:${ss}` : `${m}:${ss}`
  }

  async function loadTasks() {
    const data = await api('/api/tasks')
    STATE.groups = data.groups || []
    STATE.tasks = STATE.groups.flatMap((g) => g.tasks)
    $('#config-warning').hidden = !data.missing_config
    render()
  }

  function render() {
    const page = $('#page')
    page.textContent = ''
    for (const group of STATE.groups) {
      const header = el('div', { class: 'category-header' },
        el('span', { class: 'category-title', text: group.name }),
        el('span', { class: 'category-count', text: `${group.tasks.length} task(s)` }))
      page.append(header)
      const grid = el('div', { class: 'task-grid' })
      for (const t of group.tasks) grid.append(card(t))
      page.append(grid)
    }
  }

  function card(t) {
    const isRunning = t.running
    const isUploading = STATE.uploading.has(t.name)
    const isQueued = t.queued
    const busy = isRunning || isUploading || isQueued
    let pillText
    let pillClass
    if (isRunning) {
      pillText = `Running · ${formatElapsed(Date.now() / 1000 - (t.started ?? Date.now() / 1000))}`
      pillClass = 'running'
    } else if (isUploading) {
      pillText = `Uploading… ${Math.round(STATE.uploading.get(t.name))}%`
      pillClass = 'running'
    } else if (isQueued) {
      pillText = 'Queued…'
      pillClass = 'neutral'
    } else {
      pillText = t.state ? t.state.last_run_text : 'Never run'
      pillClass = t.pill
    }
    const liveText = isRunning ? t.live : ''

    const c = el('section', { class: 'card task-card', dataset: { task: t.name } },
      el('div', { class: 'card__header' },
        el('h2', { class: 'card-title', text: t.name }),
        el('span', { class: `pill pill--${pillClass}`, text: pillText })),
      liveText ? el('div', { class: 'card-live', text: liveText }) : null,
      isUploading ? el('div', { class: 'upload-bar' }, el('div', { class: 'upload-fill' })) : null,
      !t.avail ? el('span', { class: 'alert-badge badge-unavail', text: t.avail_reason }) : null)

    if (t.uploads) {
      const note = el('span', { class: 'dropzone-note', text: t.note || 'Drop files here or click to browse' })
      const input = el('input', { type: 'file', multiple: true, hidden: true })
      const zone = el('div', { class: 'dropzone-box', tabindex: '0' }, note, input)
      c.append(zone, el('div', { class: 'queue-list' }))
      wireDropzone(zone, input, (files) => queueFiles(t, files))
      const list = c.querySelector('.queue-list')
      for (const file of STATE.queues[t.name] ?? []) {
        const it = el('div', { class: 'queue-item' },
          el('span', { class: 'queue-name', text: file.name }))
        const rm = el('sl-button', { size: 'small', class: 'icon-button', title: 'Remove from queue' })
        rm.innerHTML = icons.close
        rm.addEventListener('click', () => {
          STATE.queues[t.name] = (STATE.queues[t.name] ?? []).filter((f) => f !== file)
          render()
        })
        it.append(rm)
        list.append(it)
      }
    } else if (t.note) {
      c.append(el('div', { class: 'card-note', text: t.note }))
    }

    const fill = c.querySelector('.upload-fill')
    if (fill) fill.style.width = `${Math.round(STATE.uploading.get(t.name) ?? 0)}%`

    const actions = el('div', { class: 'card-actions' })
    if (t.export_url) {
      const exportBtn = el('sl-button', { size: 'small', href: t.export_url, target: '_blank' }, 'Generate Export')
      actions.append(exportBtn)
    }
    const runBtn = el('sl-button', {
      size: 'small',
      variant: busy ? 'default' : 'primary',
      disabled: !busy && (!t.avail || (t.uploads && !(STATE.queues[t.name] ?? []).length)),
    }, busy ? 'Stop' : 'Run')
    runBtn.addEventListener('click', () => (busy ? cancelRun(t.name) : runTask(t)))
    const logBtn = el('sl-button', { size: 'small' }, 'Log')
    logBtn.addEventListener('click', () => openLog(t))
    actions.append(runBtn, logBtn)
    c.append(actions)
    return c
  }

  function wireDropzone(zone, input, handler) {
    zone.onclick = () => input.click()
    zone.ondragover = (e) => { e.preventDefault(); zone.classList.add('dragover') }
    zone.ondragleave = () => zone.classList.remove('dragover')
    zone.ondrop = (e) => {
      e.preventDefault()
      zone.classList.remove('dragover')
      handler(e.dataTransfer.files)
    }
    input.onchange = () => { handler(input.files); input.value = '' }
  }

  function uploadFile(task, file, onProgress = () => {}) {
    return new Promise((resolve) => {
      const xhr = new XMLHttpRequest()
      xhr.open('POST', apiUrl(`/api/upload/${encodeURIComponent(task.name)}?name=${encodeURIComponent(file.name)}`))
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && e.total > 0) onProgress(e.loaded / e.total)
      }
      xhr.onload = () => {
        let data = {}
        try { data = JSON.parse(xhr.responseText || '{}') } catch { /* ignore */ }
        if (xhr.status >= 400) {
          toast(data.detail || `HTTP ${xhr.status}`, 'warning')
          resolve(false)
        } else {
          resolve(true)
        }
      }
      xhr.onabort = () => resolve(false)
      xhr.onerror = () => {
        toast(`Upload of ${file.name} failed`, 'warning')
        resolve(false)
      }
      STATE.uploadAborts.set(task.name, xhr)
      xhr.send(file)
    })
  }

  function queueFiles(task, fileList) {
    const q = (STATE.queues[task.name] ??= [])
    for (const file of fileList) {
      const i = q.findIndex((f) => f.name === file.name)
      if (i !== -1) q.splice(i, 1)
      q.push(file)
    }
    render()
  }

  async function handleGlobalFiles(fileList) {
    const byTask = new Map()
    for (const file of Array.from(fileList)) {
      const res = await api(`/api/detect?name=${encodeURIComponent(file.name)}`, { method: 'POST' })
      const r = res.result
      if (!r) {
        toast(`No task matches ${file.name} — drop it onto the matching card instead`, 'warning')
        continue
      }
      let taskName = r.task
      if (r.ambiguous.length > 1) {
        const options = r.ambiguous.map((n) => STATE.tasks.find((t) => t.name === n)).filter(Boolean)
        const picked = await pickerModal(`Which task is ${file.name} for?`, options)
        if (!picked) continue
        taskName = picked.name
      }
      const task = STATE.tasks.find((t) => t.name === taskName)
      if (!task) continue
      if (!byTask.has(task.name)) byTask.set(task.name, { task, files: [] })
      byTask.get(task.name).files.push(file)
    }
    const entries = [...byTask.values()]
    if (!entries.length) return

    for (const { task, files } of entries) queueFiles(task, files)

    const body = el('div', { class: 'modal-fields' })
    for (const { task, files } of entries) {
      body.append(el('div', { text: `${task.name} (${files.length} file${files.length > 1 ? 's' : ''})` }))
    }
    const ok = await confirmModal('Detected — run all now?', 'Run', body)
    if (!ok) return
    for (const { task } of entries) runTask(task, { skipGenericConfirm: true })
  }

  async function runTask(task, opts = {}) {
    const extra = {}
    const prompts = task.prompts || []
    const confirmPrompt = prompts.find((p) => p.type === 'confirm')
    const secretPrompts = prompts.filter((p) => p.type !== 'confirm')
    if (confirmPrompt) {
      const ok = await confirmModal(confirmPrompt.label || `Run ${task.name}?`)
      if (!ok) return
      extra[confirmPrompt.key] = true
    }
    if (secretPrompts.length) {
      const vals = await fieldsModal(task.name, secretPrompts.map((p) => ({ label: p.label })))
      if (!vals) return
      secretPrompts.forEach((p, i) => { if (vals[i]) extra[p.key] = vals[i] })
    }
    if (!prompts.length && !task.uploads && !opts.skipGenericConfirm) {
      const ok = await confirmModal(`Run ${task.name}?`)
      if (!ok) return
    }
    const files = STATE.queues[task.name] ?? []
    if (task.uploads && !files.length) {
      toast('Drop files here first', 'warning')
      return
    }
    if (task.uploads) {
      STATE.uploading.set(task.name, 0)
      render()
      try {
        let done = 0
        for (const file of files) {
          const ok = await uploadFile(task, file, (frac) => {
            const pct = ((done + frac) / files.length) * 100
            STATE.uploading.set(task.name, pct)
            const fill = document.querySelector(`.task-card[data-task="${CSS.escape(task.name)}"] .upload-fill`)
            if (fill) fill.style.width = `${pct.toFixed(1)}%`
          })
          if (!ok) return
          done += 1
          STATE.uploading.set(task.name, (done / files.length) * 100)
        }
      } finally {
        STATE.uploading.delete(task.name)
        STATE.uploadAborts.delete(task.name)
        render()
      }
    }
    const res = await apiPost(`/api/run/${encodeURIComponent(task.name)}`, extra)
    if (res.error) { toast(res.error, 'warning'); return }
    if (task.uploads) delete STATE.queues[task.name]
    STATE.liveLogs.set(task.name, [])
    if (res.queued) toast(`${task.name} queued — another task sharing its destination is running`, 'warning')
    render()
  }

  async function cancelRun(taskName) {
    if (STATE.uploading.has(taskName)) {
      STATE.uploading.delete(taskName)
      STATE.uploadAborts.get(taskName)?.abort()
      STATE.uploadAborts.delete(taskName)
      render()
      toast('Upload cancelled', 'warning')
      return
    }
    const res = await apiPost('/api/cancel', { task: taskName })
    if (res.error) { toast(res.error, 'negative'); return }
    if (res.queued) toast('Removed from queue', 'warning')
    else toast('Stopping the task…', 'warning')
  }

  async function poll() {
    let activity = false
    const s = await api('/api/status')
    for (const r of s.runs ?? []) {
      activity = true
      const buf = STATE.liveLogs.get(r.task) ?? []
      buf.push(...(r.log ?? []))
      STATE.liveLogs.set(r.task, buf)
    }
    for (const d of s.done ?? []) {
      activity = true
      toast(`${d.task}: ${d.ok ? 'OK' : 'FAILED'} — ${d.summary.slice(0, 200)}`, d.ok ? 'positive' : 'negative')
      if (d.ok && d.paste) openPaste(d.task, d.summary)
    }
    if (activity) await loadTasks()
    updateOpenLog()
  }

  function updateOpenLog() {
    const ref = STATE.openLogRef
    if (!ref) return
    ref.pre.textContent = (STATE.liveLogs.get(ref.task) ?? []).join('\n')
    ref.pre.scrollTop = ref.pre.scrollHeight
  }

  function resultModal(title, text, buttons) {
    const pre = el('pre', { class: 'log-box', text })
    openModal({ title, body: pre, buttons })
  }

  async function openLog(task) {
    if (task.running) {
      const pre = el('pre', { class: 'log-box' })
      pre.textContent = (STATE.liveLogs.get(task.name) ?? []).join('\n')
      openModal({
        title: `${task.name} — live log`,
        body: pre,
        buttons: [{ label: 'Close', cls: 'btn-ghost', onClick: (o) => { o.hide(); STATE.openLogRef = null } }],
      })
      STATE.openLogRef = { task: task.name, pre }
      return
    }
    const res = await api(`/api/log/${encodeURIComponent(task.name)}`)
    resultModal(`${task.name} — log`, res.output || '(no log recorded yet)', [
      { label: 'Close', cls: 'btn-ghost', onClick: (o) => o.hide() },
    ])
  }

  function openPaste(name, output) {
    resultModal(`${name} — output to paste`, output, [
      {
        label: 'Copy',
        cls: 'btn-ghost',
        onClick: () => navigator.clipboard.writeText(output).then(() => toast('Copied to clipboard', 'positive')),
      },
      {
        label: 'Done',
        cls: 'btn-primary',
        onClick: async (o) => {
          const res = await apiPost(`/api/paste_done/${encodeURIComponent(name)}`)
          o.hide()
          if (res.error) { toast(res.error, 'negative'); return }
          if (!res.committed) { toast('No commit_dir configured for this task — nothing to commit', 'warning'); return }
          toast(`Committed ${res.dest || ''}`, 'positive')
        },
      },
    ])
  }

  // Boot
  $('#refreshButton').innerHTML = icons.refresh
  $('#refreshButton').addEventListener('click', loadTasks)
  initTheme($('#themeButton'))
  wireDropzone($('#global-dropzone'), $('#global-file'), handleGlobalFiles)
  loadTasks()
  setInterval(poll, 700)
})()
