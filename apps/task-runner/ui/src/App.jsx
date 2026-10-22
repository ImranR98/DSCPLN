import { useCallback, useEffect, useRef, useState } from 'react'
import { RefreshCw, SlidersHorizontal } from 'lucide-react'
import { AppHeader, Field, getJson, postJson, putJson, showToast, ThemeToggle, Toasts, uploadFile as uploadFileRequest, usePolling } from '@dscpln/ui-kit'
import { useDropzone } from './hooks/useDropzone.js'
import TaskCard from './components/TaskCard.jsx'
import AttributesModal from './components/AttributesModal.jsx'
import TaskSettingsModal from './components/TaskSettingsModal.jsx'
import ConfirmModal from './components/modals/ConfirmModal.jsx'
import FieldsModal from './components/modals/FieldsModal.jsx'
import PickerModal from './components/modals/PickerModal.jsx'
import ResultModal from './components/modals/ResultModal.jsx'

const UNASSIGNED = 'Unassigned'

function attributeValues(attribute, tasks) {
  const defined = attribute?.values ?? []
  const used = tasks.map((task) => task.attributes?.[attribute?.name]).filter(Boolean)
  return [...new Set([...defined, ...used])]
}

function groupTasks(tasks, groupBy, filterValue, attribute) {
  const visible = filterValue
    ? tasks.filter((task) => (task.attributes?.[groupBy] || UNASSIGNED) === filterValue)
    : tasks
  const buckets = new Map()
  for (const task of visible) {
    const value = task.attributes?.[groupBy] || UNASSIGNED
    if (!buckets.has(value)) buckets.set(value, [])
    buckets.get(value).push(task)
  }
  const order = [...(attribute?.values ?? []), UNASSIGNED]
  const ordered = order.filter((value) => buckets.has(value))
  for (const value of buckets.keys()) {
    if (!ordered.includes(value)) ordered.push(value)
  }
  return ordered.map((name) => ({ name, tasks: buckets.get(name) }))
}

export default function App() {
  const [tasks, setTasks] = useState([])
  const [missingConfig, setMissingConfig] = useState(false)
  const [queues, setQueues] = useState({})
  const [uploading, setUploading] = useState({})
  const [browserAvailable, setBrowserAvailable] = useState(false)
  const [openBrowsers, setOpenBrowsers] = useState({})
  const [liveLogs, setLiveLogs] = useState({})
  const [now, setNow] = useState(Date.now())
  const [modals, setModals] = useState([])
  const [settingsTask, setSettingsTask] = useState(null)
  const [attributes, setAttributes] = useState([])
  const [defaultGroupBy, setDefaultGroupBy] = useState('')
  const [groupBy, setGroupBy] = useState('')
  const [filterValue, setFilterValue] = useState('')
  const [attributesOpen, setAttributesOpen] = useState(false)

  const uploadAborts = useRef(new Map())

  const toast = (message, tone = 'success') => showToast(message, tone)

  /* ---------- modal helpers (promise-based) ---------- */

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

  /* ---------- task data ---------- */

  const loadTasks = useCallback(async () => {
    try {
      const data = await getJson('api/tasks')
      const nextGroups = data.groups || []
      const nextAttributes = data.attributes || []
      setTasks(data.tasks || nextGroups.flatMap((group) => group.tasks))
      setAttributes(nextAttributes)
      setDefaultGroupBy(data.default_group_by || '')
      setGroupBy((current) => (
        nextAttributes.some((attribute) => attribute.name === current)
          ? current
          : data.default_group_by || nextAttributes[0]?.name || 'Category'
      ))
      setMissingConfig(Boolean(data.missing_config))
      setBrowserAvailable(Boolean(data.browser))
    } catch {
      // keep the last state
    }
  }, [])

  const taskByName = (name) => tasks.find((task) => task.name === name)

  /* ---------- upload queue ---------- */

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

  /* ---------- running ---------- */

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
      const values = await fieldsModal(task.name, secretPrompts.map((prompt) => ({ label: prompt.label, type: prompt.type })))
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

  const runAction = async (task, action) => {
    const prompts = action.prompts || []
    const extra = {}
    const confirmPrompt = prompts.find((prompt) => prompt.type === 'confirm')
    const inputPrompts = prompts.filter((prompt) => prompt.type !== 'confirm')
    if (confirmPrompt) {
      const ok = await confirmModal(confirmPrompt.label || `${action.label}?`)
      if (!ok) return
      extra[confirmPrompt.key] = true
    }
    if (inputPrompts.length) {
      const values = await fieldsModal(
        `${task.name} — ${action.label}`,
        inputPrompts.map((prompt) => ({ label: prompt.label, type: prompt.type })),
      )
      if (!values) return
      inputPrompts.forEach((prompt, index) => {
        if (values[index]) extra[prompt.key] = values[index]
      })
      const missing = inputPrompts
        .filter((prompt) => (action.require || []).includes(prompt.key) && !extra[prompt.key])
        .map((prompt) => prompt.label)
      if (missing.length) {
        toast(`Missing required input: ${missing.join(', ')}`, 'error')
        return
      }
    }
    try {
      await postJson(`api/actions/${encodeURIComponent(task.name)}/${encodeURIComponent(action.key)}`, extra)
      setLiveLogs((current) => ({ ...current, [task.name]: [] }))
      toast(`${task.name} — ${action.label} started`)
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

  /* ---------- global dropzone ---------- */

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

  const globalDropRef = useDropzone(handleGlobalFiles)

  /* ---------- polling + logs ---------- */

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
        const label = done.action_label ? `${done.task} · ${done.action_label}` : done.task
        toast(`${label}: ${done.ok ? 'OK' : 'FAILED'} — ${done.summary.slice(0, 200)}`, done.ok ? 'success' : 'error')
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

  const saveSettings = async (task, settings) => {
    const saved = await putJson(`api/tasks/${encodeURIComponent(task.name)}/settings`, settings)
    setSettingsTask(null)
    toast('Task settings saved.')
    await loadTasks()
    return saved
  }

  const saveAttributes = async (settings) => {
    const saved = await putJson('api/attributes', settings)
    setAttributesOpen(false)
    toast('Attributes saved.')
    await loadTasks()
    return saved
  }

  useEffect(() => {
    const total = Object.values(liveLogs).reduce((sum, lines) => sum + lines.length, 0)
    const pre = document.querySelector('dialog[open] .log-box')
    if (pre && total) pre.scrollTop = pre.scrollHeight
  }, [liveLogs])

  useEffect(() => {
    loadTasks()
  }, [loadTasks])

  // Poll run status while the page is open (the poll callback is refreshed
  // internally, so this timer never restarts).
  usePolling(poll, 700, { runImmediately: false })

  const groupingAttribute = attributes.find((attribute) => attribute.name === groupBy)
  const filterValues = attributeValues(groupingAttribute, tasks)
  const activeFilter = filterValues.includes(filterValue) ? filterValue : ''
  const visibleGroups = groupTasks(tasks, groupBy, activeFilter, groupingAttribute)

  /* ---------- render ---------- */

  return (
    <>
      <AppHeader
        name="Task Runner"
        meta="Config-driven local backups"
        actions={(
          <>
            {missingConfig ? (
              <span className="alert-badge">Missing config.mjs — create it (see README.md for the schema)</span>
            ) : null}
            <button id="refreshButton" className="outline secondary icon-button" title="Refresh" aria-label="Refresh tasks" onClick={loadTasks}>
              <RefreshCw size={16} strokeWidth={1.8} />
            </button>
            <ThemeToggle />
          </>
        )}
      />

      <main className="page-wrap">
        <section className="card global-drop">
          <p className="hint">Drop an export file anywhere here — it is detected, you confirm, it runs.</p>
          <div className="dropzone-box" id="global-dropzone" tabIndex="0" ref={globalDropRef}>
            <span className="dropzone-note">Drop files here or click to browse</span>
            <input type="file" multiple hidden onChange={(event) => { handleGlobalFiles(event.target.files); event.target.value = '' }} />
          </div>
        </section>

        <section className="card task-toolbar">
          <div className="task-toolbar__row">
            <Field label="Group by" htmlFor="task-group-by" className="task-toolbar__field">
              <select
                id="task-group-by"
                data-testid="group-by"
                value={groupBy}
                onChange={(event) => {
                  setGroupBy(event.target.value)
                  setFilterValue('')
                }}
              >
                {attributes.map((attribute) => (
                  <option key={attribute.name} value={attribute.name}>{attribute.name}</option>
                ))}
              </select>
            </Field>
            <Field label="Show" htmlFor="task-filter-value" className="task-toolbar__field">
              <select
                id="task-filter-value"
                data-testid="filter-value"
                value={activeFilter}
                onChange={(event) => setFilterValue(event.target.value)}
              >
                <option value="">All {groupBy || 'tasks'}</option>
                {filterValues.map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
            </Field>
            <button
              className="outline secondary task-toolbar__manage"
              data-testid="manage-attributes"
              onClick={() => setAttributesOpen(true)}
            >
              <SlidersHorizontal size={16} strokeWidth={1.8} />
              Attributes
            </button>
          </div>
          <p className="hint">
            Grouped by {groupBy || 'task'}. Schedules and attributes are saved to task-meta.json in the config repo.
            {defaultGroupBy && defaultGroupBy !== groupBy ? ` Default: ${defaultGroupBy}.` : ''}
          </p>
        </section>

        {visibleGroups.map((group) => (
          <div key={group.name} data-testid={`group-${group.name}`}>
            <div className="category-header">
              <span className="category-title">{group.name}</span>
              <span className="category-count">{group.tasks.length} task{group.tasks.length === 1 ? '' : 's'}</span>
            </div>
            <div className="task-grid">
              {group.tasks.map((task) => (
                <TaskCard
                  key={task.name}
                  task={task}
                  attributes={attributes}
                  groupBy={groupBy}
                  now={now}
                  uploading={uploading}
                  queues={queues}
                  browserAvailable={browserAvailable}
                  openBrowsers={openBrowsers}
                  onToggleBrowser={(name) => setOpenBrowsers((current) => ({ ...current, [name]: !current[name] }))}
                  onQueueFiles={queueFiles}
                  onRemoveQueued={removeQueued}
                  onSettings={setSettingsTask}
                  onAction={runAction}
                  onRun={runTask}
                  onCancel={cancelRun}
                  onLog={openLog}
                />
              ))}
            </div>
          </div>
        ))}

        {!visibleGroups.length ? <p className="hint">No tasks match this filter.</p> : null}

        <p className="footer-note">Run state is stored in the gitignored .task-runner folder of the config repo; dropped files are held in the browser until you click Run.</p>
      </main>

      {settingsTask ? (
        <TaskSettingsModal
          task={settingsTask}
          attributes={attributes}
          onClose={() => setSettingsTask(null)}
          onSave={(settings) => saveSettings(settingsTask, settings)}
        />
      ) : null}

      {attributesOpen ? (
        <AttributesModal
          attributes={attributes}
          defaultGroupBy={defaultGroupBy || groupBy}
          onClose={() => setAttributesOpen(false)}
          onSave={saveAttributes}
        />
      ) : null}

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
