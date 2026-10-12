<script>
  import { onMount } from 'svelte'
  import { RefreshCw, X } from 'lucide-svelte'
  import { apiUrl, getJson, modal, postJson, showToast, ThemeToggle, Toasts } from '@dscpln/ui-kit'

  let groups = $state([])
  let tasks = $state([])
  let missingConfig = $state(false)
  let queues = $state({})
  let uploading = $state({})
  let liveLogs = $state({})
  let now = $state(Date.now())
  let globalDragging = $state(false)

  let modals = $state([]) // { id, kind, props, resolve }

  const toast = (message, tone = 'success') => showToast(message, tone)

  function openModal(kind, props, resolve) {
    const id = crypto.randomUUID()
    modals = [...modals, { id, kind, props, resolve }]
    return id
  }

  const closeModal = (id) => (modals = modals.filter((modal) => modal.id !== id))

  function confirmModal(title, submitLabel = 'Run', lines = null) {
    return new Promise((resolve) => openModal('confirm', { title, submitLabel, lines, resolve }, resolve))
  }

  function fieldsModal(title, fields, submitLabel = 'Run') {
    return new Promise((resolve) => openModal('fields', { title, fields, submitLabel, resolve }, resolve))
  }

  function pickerModal(title, options) {
    return new Promise((resolve) => openModal('picker', { title, options, resolve }, resolve))
  }

  function resultModal(title, text, { live = false, paste = false } = {}) {
    openModal('result', { title, text, live, paste }, null)
  }

  const formatElapsed = (seconds) => {
    const sec = Math.max(0, Math.floor(seconds))
    const h = Math.floor(sec / 3600)
    const m = Math.floor((sec % 3600) / 60)
    const s = String(sec % 60).padStart(2, '0')
    return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`
  }

  async function loadTasks() {
    try {
      const data = await getJson('api/tasks')
      groups = data.groups || []
      tasks = groups.flatMap((group) => group.tasks)
      missingConfig = Boolean(data.missing_config)
    } catch {
      // keep the last state
    }
  }

  const taskByName = (name) => tasks.find((task) => task.name === name)

  function queueFiles(task, files) {
    if (!task) return
    const list = [...(queues[task.name] ?? [])]
    for (const file of files) {
      const index = list.findIndex((queued) => queued.name === file.name)
      if (index !== -1) list.splice(index, 1)
      list.push(file)
    }
    queues = { ...queues, [task.name]: list }
  }

  function removeQueued(task, file) {
    queues = { ...queues, [task.name]: (queues[task.name] ?? []).filter((queued) => queued !== file) }
  }

  function uploadFile(task, file, onProgress) {
    return new Promise((resolve) => {
      const xhr = new XMLHttpRequest()
      xhr.open('POST', apiUrl(`api/upload/${encodeURIComponent(task.name)}?name=${encodeURIComponent(file.name)}`))
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable && event.total > 0) onProgress(event.loaded / event.total)
      }
      xhr.onload = () => {
        let data = {}
        try {
          data = JSON.parse(xhr.responseText || '{}')
        } catch {
          // ignore
        }
        if (xhr.status >= 400) {
          toast(data.detail || `HTTP ${xhr.status}`, 'error')
          resolve(false)
        } else {
          resolve(true)
        }
      }
      xhr.onabort = () => resolve(false)
      xhr.onerror = () => {
        toast(`Upload of ${file.name} failed`, 'error')
        resolve(false)
      }
      uploadAborts.set(task.name, xhr)
      xhr.send(file)
    })
  }

  const uploadAborts = new Map()

  async function runTask(task, options = {}) {
    const extra = {}
    const prompts = task.prompts || []
    const confirmPrompt = prompts.find((prompt) => prompt.type === 'confirm')
    const secretPrompts = prompts.filter((prompt) => prompt.type !== 'confirm')
    if (confirmPrompt) {
      const ok = await confirmModal(confirmPrompt.label || `Run ${task.name}?`)
      if (!ok) return
      extra[confirmPrompt.key] = true
    }
    if (secretPrompts.length) {
      const values = await fieldsModal(task.name, secretPrompts.map((prompt) => ({ label: prompt.label })))
      if (!values) return
      secretPrompts.forEach((prompt, index) => {
        if (values[index]) extra[prompt.key] = values[index]
      })
    }
    if (!prompts.length && !task.uploads && !options.skipGenericConfirm) {
      const ok = await confirmModal(`Run ${task.name}?`)
      if (!ok) return
    }
    const files = queues[task.name] ?? []
    if (task.uploads && !files.length) {
      toast('Drop files here first', 'error')
      return
    }
    if (task.uploads) {
      uploading = { ...uploading, [task.name]: 0 }
      try {
        let done = 0
        for (const file of files) {
          const ok = await uploadFile(task, file, (fraction) => {
            uploading = { ...uploading, [task.name]: ((done + fraction) / files.length) * 100 }
          })
          if (!ok) return
          done += 1
          uploading = { ...uploading, [task.name]: (done / files.length) * 100 }
        }
      } finally {
        const nextUploading = { ...uploading }
        delete nextUploading[task.name]
        uploading = nextUploading
        uploadAborts.delete(task.name)
      }
    }
    try {
      const result = await postJson(`api/run/${encodeURIComponent(task.name)}`, extra)
      if (task.uploads) {
        const nextQueues = { ...queues }
        delete nextQueues[task.name]
        queues = nextQueues
      }
      liveLogs = { ...liveLogs, [task.name]: [] }
      if (result?.queued) toast(`${task.name} queued — another task sharing its destination is running`, 'error')
      await loadTasks()
    } catch (err) {
      toast(err.message, 'error')
    }
  }

  async function cancelRun(taskName) {
    if (uploading[taskName] != null) {
      const nextUploading = { ...uploading }
      delete nextUploading[taskName]
      uploading = nextUploading
      uploadAborts.get(taskName)?.abort()
      uploadAborts.delete(taskName)
      toast('Upload cancelled', 'error')
      return
    }
    try {
      const result = await postJson('api/cancel', { task: taskName })
      if (result?.queued) toast('Removed from queue', 'error')
      else toast('Stopping the task…', 'error')
    } catch (err) {
      toast(err.message, 'error')
    }
  }

  async function handleGlobalFiles(fileList) {
    const byTask = new Map()
    for (const file of Array.from(fileList)) {
      try {
        const { result } = await postJson(`api/detect?name=${encodeURIComponent(file.name)}`, {})
        if (!result) {
          toast(`No task matches ${file.name} — drop it onto the matching card instead`, 'error')
          continue
        }
        let taskName = result.task
        if (result.ambiguous.length > 1) {
          const options = result.ambiguous.map((name) => taskByName(name)).filter(Boolean)
          const picked = await pickerModal(`Which task is ${file.name} for?`, options)
          if (!picked) continue
          taskName = picked.name
        }
        const task = taskByName(taskName)
        if (!task) continue
        if (!byTask.has(task.name)) byTask.set(task.name, { task, files: [] })
        byTask.get(task.name).files.push(file)
      } catch (err) {
        toast(err.message, 'error')
      }
    }
    const entries = [...byTask.values()]
    if (!entries.length) return
    for (const { task, files } of entries) queueFiles(task, files)
    const ok = await confirmModal(
      'Detected — run all now?',
      'Run',
      entries.map(({ task, files }) => `${task.name} (${files.length} file${files.length > 1 ? 's' : ''})`),
    )
    if (!ok) return
    for (const { task } of entries) runTask(task, { skipGenericConfirm: true })
  }

  async function poll() {
    now = Date.now()
    let activity = false
    try {
      const status = await getJson('api/status')
      const nextLogs = { ...liveLogs }
      for (const run of status.runs ?? []) {
        activity = true
        nextLogs[run.task] = [...(nextLogs[run.task] ?? []), ...(run.log ?? [])].slice(-1000)
      }
      for (const done of status.done ?? []) {
        activity = true
        toast(`${done.task}: ${done.ok ? 'OK' : 'FAILED'} — ${done.summary.slice(0, 200)}`, done.ok ? 'success' : 'error')
        if (done.ok && done.paste) {
          getJson(`api/log/${encodeURIComponent(done.task)}`)
            .then(({ output }) => resultModal(`${done.task} — output to paste`, output ?? '', { paste: true, task: done.task }))
            .catch(() => {})
        }
      }
      liveLogs = nextLogs
      if (activity) await loadTasks()
    } catch {
      // transient poll failure
    }
  }

  async function openLog(task) {
    if (task.running) {
      resultModal(`${task.name} — live log`, (liveLogs[task.name] ?? []).join('\n'), { live: true, task: task.name })
      return
    }
    try {
      const { output } = await getJson(`api/log/${encodeURIComponent(task.name)}`)
      resultModal(`${task.name} — log`, output || '(no log recorded yet)')
    } catch (err) {
      toast(err.message, 'error')
    }
  }

  async function finishPaste(task, close) {
    try {
      const result = await postJson(`api/paste_done/${encodeURIComponent(task)}`, {})
      close()
      if (!result.committed) {
        toast('No commit_dir configured for this task — nothing to commit', 'error')
        return
      }
      toast(`Committed ${result.dest || ''}`)
    } catch (err) {
      toast(err.message, 'error')
    }
  }

  function copyText(text, close) {
    navigator.clipboard
      .writeText(text)
      .then(() => {
        toast('Copied to clipboard')
        close?.()
      })
      .catch(() => toast('Copy failed — select the text manually', 'error'))
  }

  function wireDropzone(node, handler) {
    const onClick = () => node.querySelector('input[type=file]')?.click()
    const onDragOver = (event) => {
      event.preventDefault()
      node.classList.add('dragover')
    }
    const onDragLeave = () => node.classList.remove('dragover')
    const onDrop = (event) => {
      event.preventDefault()
      node.classList.remove('dragover')
      handler(event.dataTransfer.files)
    }
    node.addEventListener('click', onClick)
    node.addEventListener('dragover', onDragOver)
    node.addEventListener('dragleave', onDragLeave)
    node.addEventListener('drop', onDrop)
    return () => {
      node.removeEventListener('click', onClick)
      node.removeEventListener('dragover', onDragOver)
      node.removeEventListener('dragleave', onDragLeave)
      node.removeEventListener('drop', onDrop)
    }
  }

  $effect(() => {
    const total = Object.values(liveLogs).reduce((sum, lines) => sum + lines.length, 0)
    const pre = document.querySelector('dialog[open] .log-box')
    if (pre && total) pre.scrollTop = pre.scrollHeight
  })

  onMount(() => {
    loadTasks()
    const timer = setInterval(poll, 700)
    return () => clearInterval(timer)
  })
</script>

<header class="app-header">
  <div class="app-header__top">
    <h1><a class="app-header__brand" href="/">D<span class="accent">$</span>CPLN</a> <span class="app-header__app">⋅ Task Runner</span></h1>
    <div class="app-header__actions">
      {#if missingConfig}
        <span class="alert-badge">Missing config.mjs — create it (see README.md for the schema)</span>
      {/if}
      <button id="refreshButton" class="outline secondary icon-button" title="Refresh" aria-label="Refresh tasks" onclick={loadTasks}>
        <RefreshCw size={16} strokeWidth={1.8} />
      </button>
      <ThemeToggle />
    </div>
  </div>
  <div class="app-header__meta">
    <span class="muted">Config-driven local backups</span>
  </div>
</header>

<main class="page-wrap">
  <section class="card global-drop">
    <p class="hint">Drop an export file anywhere here — it is detected, you confirm, it runs.</p>
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="dropzone-box" id="global-dropzone" tabindex="0" use:wireDropzone={handleGlobalFiles}>
      <span class="dropzone-note">Drop files here or click to browse</span>
      <input type="file" multiple hidden onchange={(event) => { handleGlobalFiles(event.target.files); event.target.value = '' }} />
    </div>
  </section>

  {#each groups as group (group.name)}
    <div class="category-header">
      <span class="category-title">{group.name}</span>
      <span class="category-count">{group.tasks.length} task{group.tasks.length === 1 ? '' : 's'}</span>
    </div>
    <div class="task-grid">
      {#each group.tasks as task (task.name)}
        {@const running = task.running}
        {@const isUploading = uploading[task.name] != null}
        {@const queued = task.queued}
        {@const busy = running || isUploading || queued}
        {@const files = queues[task.name] ?? []}
        <section class="card task-card" data-task={task.name} data-testid={`task-${task.name}`}>
          <div class="card__header">
            <h2 class="card-title">{task.name}</h2>
            <span class={`pill pill--${running || isUploading ? 'running' : queued ? 'neutral' : (task.state ? task.pill : 'none') ?? 'none'}`}>
              {#if running}
                Running · {formatElapsed(now / 1000 - (task.started ?? now / 1000))}
              {:else if isUploading}
                Uploading… {Math.round(uploading[task.name])}%
              {:else if queued}
                Queued…
              {:else}
                {task.state ? task.state.last_run_text : 'Never run'}
              {/if}
            </span>
          </div>

          {#if running && task.live}
            <div class="card-live">{task.live}</div>
          {/if}

          {#if isUploading}
            <div class="upload-bar"><div class="upload-fill" style={`width: ${Math.round(uploading[task.name])}%`}></div></div>
          {/if}

          {#if !task.avail}
            <span class="alert-badge badge-unavail">{task.avail_reason}</span>
          {/if}

          {#if task.uploads}
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div class="dropzone-box" tabindex="0" use:wireDropzone={(dropped) => queueFiles(task, dropped)}>
              <span class="dropzone-note">{task.note || 'Drop files here or click to browse'}</span>
              <input type="file" multiple hidden onchange={(event) => { queueFiles(task, event.target.files); event.target.value = '' }} />
            </div>
            {#if files.length}
              <div class="queue-list">
                {#each files as file (file.name)}
                  <div class="queue-item">
                    <span class="queue-name">{file.name}</span>
                    <button class="outline secondary icon-button icon-button--small" title="Remove from queue" aria-label={`Remove ${file.name} from queue`} onclick={() => removeQueued(task, file)}>
                      <X size={14} strokeWidth={1.8} />
                    </button>
                  </div>
                {/each}
              </div>
            {/if}
          {:else if task.note}
            <div class="card-note">{task.note}</div>
          {/if}

          <div class="card-actions">
            {#if task.export_url}
              <a role="button" class="outline secondary" href={task.export_url} target="_blank" rel="noreferrer">Generate Export</a>
            {/if}
            <button
              class={busy ? 'outline secondary' : ''}
              disabled={!busy && (!task.avail || (task.uploads && !files.length))}
              onclick={() => (busy ? cancelRun(task.name) : runTask(task))}
            >{busy ? 'Stop' : 'Run'}</button>
            <button class="outline secondary" onclick={() => openLog(task)}>Log</button>
          </div>
        </section>
      {/each}
    </div>
  {/each}

  <p class="footer-note">Run state is stored per task in its destination folder (.backup-state-*.json); dropped files are held in the browser until you click Run.</p>
</main>

{#each modals as entry (entry.id)}
  {#if entry.kind === 'confirm'}
    <dialog use:modal={() => { entry.props.resolve(false); closeModal(entry.id) }} class="narrow-dialog">
      <article>
        <header class="card__header"><h2>{entry.props.title}</h2></header>
        {#if entry.props.lines}
          <div class="modal-fields">
            {#each entry.props.lines as line (line)}<span>{line}</span>{/each}
          </div>
        {/if}
        <div class="dialog-actions">
          <button class="outline secondary" onclick={() => { entry.props.resolve(false); closeModal(entry.id) }}>Cancel</button>
          <button onclick={() => { entry.props.resolve(true); closeModal(entry.id) }}>{entry.props.submitLabel}</button>
        </div>
      </article>
    </dialog>
  {:else if entry.kind === 'fields'}
    <dialog use:modal={() => { entry.props.resolve(null); closeModal(entry.id) }}>
      <article>
        <header class="card__header"><h2>{entry.props.title}</h2></header>
        <div class="modal-fields">
          {#each entry.props.fields as field, index (field.label)}
            <div class="field">
              <span class="field__label">{field.label}</span>
              <input type="password" autocomplete="off" bind:value={entry.props.fields[index].value} />
            </div>
          {/each}
        </div>
        <div class="dialog-actions">
          <button class="outline secondary" onclick={() => { entry.props.resolve(null); closeModal(entry.id) }}>Cancel</button>
          <button onclick={() => { entry.props.resolve(entry.props.fields.map((field) => field.value ?? '')); closeModal(entry.id) }}>{entry.props.submitLabel}</button>
        </div>
      </article>
    </dialog>
  {:else if entry.kind === 'picker'}
    <dialog use:modal={() => { entry.props.resolve(null); closeModal(entry.id) }}>
      <article>
        <header class="card__header"><h2>{entry.props.title}</h2></header>
        <div class="modal-fields">
          {#each entry.props.options as option (option.name)}
            <button class="outline secondary picker-option" onclick={() => { entry.props.resolve(option); closeModal(entry.id) }}>{option.name}</button>
          {/each}
        </div>
        <div class="dialog-actions">
          <button class="outline secondary" onclick={() => { entry.props.resolve(null); closeModal(entry.id) }}>Cancel</button>
        </div>
      </article>
    </dialog>
  {:else}
    <dialog use:modal={() => closeModal(entry.id)} class="wide-dialog">
      <article>
        <header class="card__header"><h2>{entry.props.title}</h2></header>
        <pre class="log-box">{entry.props.live ? (liveLogs[entry.props.task] ?? []).join('\n') : entry.props.text}</pre>
        <div class="dialog-actions">
          {#if entry.props.paste}
            <button class="outline secondary" onclick={() => copyText(entry.props.text)}>Copy</button>
            <button onclick={() => finishPaste(entry.props.task, () => closeModal(entry.id))}>Done</button>
          {:else}
            <button class="outline secondary" onclick={() => closeModal(entry.id)}>Close</button>
          {/if}
        </div>
      </article>
    </dialog>
  {/if}
{/each}

<Toasts />
