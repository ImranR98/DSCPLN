import { useCallback, useEffect, useRef, useState } from 'react'
import { RefreshCw, X } from 'lucide-react'
import { getJson, postJson, showToast, ThemeToggle, Toasts, uploadFile as uploadFileRequest, useModal, usePolling } from '@dscpln/ui-kit'

/* The noVNC viewer is proxied under <basePath>/browser/; its WebSocket path
 * is relative to the viewer page, so it lands on <basePath>/browser/websockify
 * where the server bridges it to the Selenium sidecar. */
const browserSrc = './browser/?autoconnect=1&resize=scale&reconnect=1&path=websockify'

const formatElapsed = (seconds) => {
  const sec = Math.max(0, Math.floor(seconds))
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = String(sec % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`
}

function useDropzone(handler) {
  const nodeRef = useRef(null)
  const handlerRef = useRef(handler)
  handlerRef.current = handler

  useEffect(() => {
    const node = nodeRef.current
    if (!node) return undefined
    const onClick = () => node.querySelector('input[type=file]')?.click()
    const onDragOver = (event) => {
      event.preventDefault()
      node.classList.add('dragover')
    }
    const onDragLeave = () => node.classList.remove('dragover')
    const onDrop = (event) => {
      event.preventDefault()
      node.classList.remove('dragover')
      handlerRef.current(event.dataTransfer.files)
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
  }, [])

  return nodeRef
}

function ConfirmModal({ props, close }) {
  const ref = useRef(null)
  useModal(ref, () => {
    props.resolve(false)
    close()
  })
  return (
    <dialog ref={ref} className="narrow-dialog">
      <article>
        <header className="card__header"><h2>{props.title}</h2></header>
        {props.lines ? (
          <div className="modal-fields">
            {props.lines.map((line) => <span key={line}>{line}</span>)}
          </div>
        ) : null}
        <div className="dialog-actions">
          <button className="outline secondary" onClick={() => { props.resolve(false); close() }}>Cancel</button>
          <button onClick={() => { props.resolve(true); close() }}>{props.submitLabel}</button>
        </div>
      </article>
    </dialog>
  )
}

function FieldsModal({ props, close }) {
  const ref = useRef(null)
  const [values, setValues] = useState(() => props.fields.map((field) => field.value ?? ''))
  useModal(ref, () => {
    props.resolve(null)
    close()
  })
  return (
    <dialog ref={ref}>
      <article>
        <header className="card__header"><h2>{props.title}</h2></header>
        <div className="modal-fields">
          {props.fields.map((field, index) => (
            <div className="field" key={field.label}>
              <span className="field__label">{field.label}</span>
              <input
                type="password"
                autoComplete="off"
                value={values[index]}
                onChange={(event) => {
                  const next = [...values]
                  next[index] = event.target.value
                  setValues(next)
                }}
              />
            </div>
          ))}
        </div>
        <div className="dialog-actions">
          <button className="outline secondary" onClick={() => { props.resolve(null); close() }}>Cancel</button>
          <button onClick={() => { props.resolve(values); close() }}>{props.submitLabel}</button>
        </div>
      </article>
    </dialog>
  )
}

function PickerModal({ props, close }) {
  const ref = useRef(null)
  useModal(ref, () => {
    props.resolve(null)
    close()
  })
  return (
    <dialog ref={ref}>
      <article>
        <header className="card__header"><h2>{props.title}</h2></header>
        <div className="modal-fields">
          {props.options.map((option) => (
            <button className="outline secondary picker-option" key={option.name} onClick={() => { props.resolve(option); close() }}>{option.name}</button>
          ))}
        </div>
        <div className="dialog-actions">
          <button className="outline secondary" onClick={() => { props.resolve(null); close() }}>Cancel</button>
        </div>
      </article>
    </dialog>
  )
}

function ResultModal({ props, close, liveLogs }) {
  const ref = useRef(null)
  useModal(ref, close)
  return (
    <dialog ref={ref} className="wide-dialog">
      <article>
        <header className="card__header"><h2>{props.title}</h2></header>
        <pre className="log-box">{props.live ? (liveLogs[props.task] ?? []).join('\n') : props.text}</pre>
        <div className="dialog-actions">
          {props.paste ? (
            <>
              <button className="outline secondary" onClick={() => copyText(props.text)}>Copy</button>
              <button onClick={() => props.onDone(close)}>Done</button>
            </>
          ) : (
            <button className="outline secondary" onClick={close}>Close</button>
          )}
        </div>
      </article>
    </dialog>
  )
}

function copyText(text) {
  navigator.clipboard
    .writeText(text)
    .then(() => showToast('Copied to clipboard'))
    .catch(() => showToast('Copy failed — select the text manually', 'error'))
}

export default function App() {
  const [groups, setGroups] = useState([])
  const [tasks, setTasks] = useState([])
  const [missingConfig, setMissingConfig] = useState(false)
  const [queues, setQueues] = useState({})
  const [uploading, setUploading] = useState({})
  const [browserAvailable, setBrowserAvailable] = useState(false)
  const [openBrowsers, setOpenBrowsers] = useState({})
  const [liveLogs, setLiveLogs] = useState({})
  const [now, setNow] = useState(Date.now())
  const [modals, setModals] = useState([])

  const uploadAborts = useRef(new Map())
  const liveLogsRef = useRef(liveLogs)
  liveLogsRef.current = liveLogs

  const toast = (message, tone = 'success') => showToast(message, tone)

  const openModal = (kind, props, resolve) => {
    const id = crypto.randomUUID()
    setModals((current) => [...current, { id, kind, props, resolve }])
    return id
  }

  const closeModal = (id) => setModals((current) => current.filter((modal) => modal.id !== id))

  const confirmModal = (title, submitLabel = 'Run', lines = null) =>
    new Promise((resolve) => openModal('confirm', { title, submitLabel, lines, resolve }, resolve))

  const fieldsModal = (title, fields, submitLabel = 'Run') =>
    new Promise((resolve) => openModal('fields', { title, fields, submitLabel, resolve }, resolve))

  const pickerModal = (title, options) =>
    new Promise((resolve) => openModal('picker', { title, options, resolve }, resolve))

  const resultModal = (title, text, { live = false, paste = false, task = null, onDone = null } = {}) =>
    openModal('result', { title, text, live, paste, task, onDone }, null)

  const loadTasks = useCallback(async () => {
    try {
      const data = await getJson('api/tasks')
      const nextGroups = data.groups || []
      setGroups(nextGroups)
      setTasks(nextGroups.flatMap((group) => group.tasks))
      setMissingConfig(Boolean(data.missing_config))
      setBrowserAvailable(Boolean(data.browser))
    } catch {
      // keep the last state
    }
  }, [])

  const taskByName = (name) => tasks.find((task) => task.name === name)

  const queueFiles = (task, files) => {
    if (!task) return
    setQueues((current) => {
      const list = [...(current[task.name] ?? [])]
      for (const file of files) {
        const index = list.findIndex((queued) => queued.name === file.name)
        if (index !== -1) list.splice(index, 1)
        list.push(file)
      }
      return { ...current, [task.name]: list }
    })
  }

  const removeQueued = (task, file) => {
    setQueues((current) => ({
      ...current,
      [task.name]: (current[task.name] ?? []).filter((queued) => queued !== file),
    }))
  }

  const uploadFile = (task, file, onProgress) => {
    const request = uploadFileRequest(
      `api/upload/${encodeURIComponent(task.name)}?name=${encodeURIComponent(file.name)}`,
      file,
      { onProgress },
    )
    uploadAborts.current.set(task.name, request)
    return request
  }

  const runTask = async (task, options = {}) => {
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
      setUploading((current) => ({ ...current, [task.name]: 0 }))
      try {
        let done = 0
        for (const file of files) {
          try {
            await uploadFile(task, file, (fraction) => {
              setUploading((current) => ({ ...current, [task.name]: ((done + fraction) / files.length) * 100 }))
            })
          } catch (err) {
            if (err.message !== 'Upload cancelled') toast(err.message, 'error')
            return
          }
          done += 1
          setUploading((current) => ({ ...current, [task.name]: (done / files.length) * 100 }))
        }
      } finally {
        setUploading((current) => {
          const next = { ...current }
          delete next[task.name]
          return next
        })
        uploadAborts.current.delete(task.name)
      }
    }
    try {
      const result = await postJson(`api/run/${encodeURIComponent(task.name)}`, extra)
      if (task.uploads) {
        setQueues((current) => {
          const next = { ...current }
          delete next[task.name]
          return next
        })
      }
      setLiveLogs((current) => ({ ...current, [task.name]: [] }))
      if (task.browser && browserAvailable) {
        setOpenBrowsers((current) => ({ ...current, [task.name]: true }))
      }
      if (result?.queued) toast(`${task.name} queued — another task sharing its destination is running`, 'error')
      await loadTasks()
    } catch (err) {
      toast(err.message, 'error')
    }
  }

  const cancelRun = async (taskName) => {
    if (uploading[taskName] != null) {
      setUploading((current) => {
        const next = { ...current }
        delete next[taskName]
        return next
      })
      uploadAborts.current.get(taskName)?.abort()
      uploadAborts.current.delete(taskName)
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

  const handleGlobalFiles = async (fileList) => {
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

  const poll = useCallback(async () => {
    setNow(Date.now())
    let activity = false
    try {
      const status = await getJson('api/status')
      const logsToAppend = status.runs ?? []
      if (logsToAppend.length) {
        activity = true
        setLiveLogs((current) => {
          const next = { ...current }
          for (const run of logsToAppend) {
            next[run.task] = [...(next[run.task] ?? []), ...(run.log ?? [])].slice(-1000)
          }
          return next
        })
      }
      for (const done of status.done ?? []) {
        activity = true
        toast(`${done.task}: ${done.ok ? 'OK' : 'FAILED'} — ${done.summary.slice(0, 200)}`, done.ok ? 'success' : 'error')
        if (done.ok && done.paste) {
          getJson(`api/log/${encodeURIComponent(done.task)}`)
            .then(({ output }) => resultModal(`${done.task} — output to paste`, output ?? '', {
              paste: true,
              task: done.task,
              onDone: (close) => finishPaste(done.task, close),
            }))
            .catch(() => {})
        }
      }
      if (activity) await loadTasks()
    } catch {
      // transient poll failure
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadTasks])

  const finishPaste = async (task, close) => {
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

  const openLog = async (task) => {
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

  useEffect(() => {
    const total = Object.values(liveLogs).reduce((sum, lines) => sum + lines.length, 0)
    const pre = document.querySelector('dialog[open] .log-box')
    if (pre && total) pre.scrollTop = pre.scrollHeight
  }, [liveLogs])

  useEffect(() => {
    loadTasks()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadTasks])

  // Poll run status while the page is open (the poll callback is refreshed
  // internally, so this timer never restarts).
  usePolling(poll, 700, { runImmediately: false })

  const globalDropRef = useDropzone(handleGlobalFiles)

  return (
    <>
      <header className="app-header">
        <div className="app-header__top">
          <h1><a className="app-header__brand" href="/">D<span className="accent">$</span>CPLN</a> <span className="app-header__app">⋅ Task Runner</span></h1>
          <div className="app-header__actions">
            {missingConfig ? (
              <span className="alert-badge">Missing config.mjs — create it (see README.md for the schema)</span>
            ) : null}
            <button id="refreshButton" className="outline secondary icon-button" title="Refresh" aria-label="Refresh tasks" onClick={loadTasks}>
              <RefreshCw size={16} strokeWidth={1.8} />
            </button>
            <ThemeToggle />
          </div>
        </div>
        <div className="app-header__meta">
          <span className="muted">Config-driven local backups</span>
        </div>
      </header>

      <main className="page-wrap">
        <section className="card global-drop">
          <p className="hint">Drop an export file anywhere here — it is detected, you confirm, it runs.</p>
          <div className="dropzone-box" id="global-dropzone" tabIndex="0" ref={globalDropRef}>
            <span className="dropzone-note">Drop files here or click to browse</span>
            <input type="file" multiple hidden onChange={(event) => { handleGlobalFiles(event.target.files); event.target.value = '' }} />
          </div>
        </section>

        {groups.map((group) => (
          <div key={group.name}>
            <div className="category-header">
              <span className="category-title">{group.name}</span>
              <span className="category-count">{group.tasks.length} task{group.tasks.length === 1 ? '' : 's'}</span>
            </div>
            <div className="task-grid">
              {group.tasks.map((task) => (
                <TaskCard
                  key={task.name}
                  task={task}
                  now={now}
                  uploading={uploading}
                  queues={queues}
                  liveLogs={liveLogs}
                  browserAvailable={browserAvailable}
                  openBrowsers={openBrowsers}
                  onToggleBrowser={(name) => setOpenBrowsers((current) => ({ ...current, [name]: !current[name] }))}
                  onQueueFiles={queueFiles}
                  onRemoveQueued={removeQueued}
                  onRun={runTask}
                  onCancel={cancelRun}
                  onLog={openLog}
                />
              ))}
            </div>
          </div>
        ))}

        <p className="footer-note">Run state is stored per task in its destination folder (.backup-state-*.json); dropped files are held in the browser until you click Run.</p>
      </main>

      {modals.map((entry) => {
        const close = () => closeModal(entry.id)
        if (entry.kind === 'confirm') return <ConfirmModal key={entry.id} props={entry.props} close={close} />
        if (entry.kind === 'fields') return <FieldsModal key={entry.id} props={entry.props} close={close} />
        if (entry.kind === 'picker') return <PickerModal key={entry.id} props={entry.props} close={close} />
        return <ResultModal key={entry.id} props={entry.props} close={close} liveLogs={liveLogs} />
      })}

      <Toasts />
    </>
  )
}

function TaskCard({
  task,
  now,
  uploading,
  queues,
  liveLogs,
  browserAvailable,
  openBrowsers,
  onToggleBrowser,
  onQueueFiles,
  onRemoveQueued,
  onRun,
  onCancel,
  onLog,
}) {
  const dropRef = useDropzone((dropped) => onQueueFiles(task, dropped))
  const running = task.running
  const isUploading = uploading[task.name] != null
  const queued = task.queued
  const busy = running || isUploading || queued
  const files = queues[task.name] ?? []

  return (
    <section className="card task-card" data-task={task.name} data-testid={`task-${task.name}`}>
      <div className="card__header">
        <h2 className="card-title">{task.name}</h2>
        <span className={`pill pill--${running || isUploading ? 'running' : queued ? 'neutral' : (task.state ? task.pill : 'none') ?? 'none'}`}>
          {running ? (
            <>Running · {formatElapsed(now / 1000 - (task.started ?? now / 1000))}</>
          ) : isUploading ? (
            <>Uploading… {Math.round(uploading[task.name])}%</>
          ) : queued ? (
            'Queued…'
          ) : (
            task.state ? task.state.last_run_text : 'Never run'
          )}
        </span>
      </div>

      {running && task.live ? (
        <div className="card-live">{task.live}</div>
      ) : null}

      {isUploading ? (
        <div className="upload-bar"><div className="upload-fill" style={{ width: `${Math.round(uploading[task.name])}%` }}></div></div>
      ) : null}

      {!task.avail ? (
        <span className="alert-badge badge-unavail">{task.avail_reason}</span>
      ) : null}

      {task.uploads ? (
        <>
          <div className="dropzone-box" tabIndex="0" ref={dropRef}>
            <span className="dropzone-note">{task.note || 'Drop files here or click to browse'}</span>
            <input type="file" multiple hidden onChange={(event) => { onQueueFiles(task, event.target.files); event.target.value = '' }} />
          </div>
          {files.length ? (
            <div className="queue-list">
              {files.map((file) => (
                <div className="queue-item" key={file.name}>
                  <span className="queue-name">{file.name}</span>
                  <button className="outline secondary icon-button icon-button--small" title="Remove from queue" aria-label={`Remove ${file.name} from queue`} onClick={() => onRemoveQueued(task, file)}>
                    <X size={14} strokeWidth={1.8} />
                  </button>
                </div>
              ))}
            </div>
          ) : null}
        </>
      ) : task.note ? (
        <div className="card-note">{task.note}</div>
      ) : null}

      <div className="card-actions">
        {task.export_url ? (
          <a role="button" className="outline secondary" href={task.export_url} target="_blank" rel="noreferrer">Generate Export</a>
        ) : null}
        <button
          className={busy ? 'outline secondary' : ''}
          disabled={!busy && (!task.avail || (task.uploads && !files.length))}
          onClick={() => (busy ? onCancel(task.name) : onRun(task))}
        >{busy ? 'Stop' : 'Run'}</button>
        <button className="outline secondary" onClick={() => onLog(task)}>Log</button>
      </div>

      {task.browser && browserAvailable ? (
        <div className="browser-block">
          <div className="browser-actions">
            <button className="outline secondary" onClick={() => onToggleBrowser(task.name)}>
              {openBrowsers[task.name] ? 'Hide login browser' : 'Open login browser'}
            </button>
            <a className="browser-newtab" href={browserSrc} target="_blank" rel="noreferrer">New tab</a>
          </div>
          {openBrowsers[task.name] ? (
            <iframe className="browser-frame" title={`${task.name} login browser`} src={browserSrc}></iframe>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}
