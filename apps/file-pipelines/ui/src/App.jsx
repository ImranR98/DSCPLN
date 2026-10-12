import { useEffect, useRef, useState } from 'react'
import { CalendarDays, Import, Pause, Play, RefreshCw, Settings, FlaskConical, Wrench, X } from 'lucide-react'
import { apiUrl, formatBytes, formatDateTime, formatDuration, formatTime, getJson, postJson, putJson, showToast, ThemeToggle, Toasts, useModal } from '@dscpln/ui-kit'

const STATUS_RANK = { error: 0, conflict: 1, queued: 2, processing: 3, pending: 4, review: 5, done: 6, duplicate: 7, discarded: 8, cleaned: 9, ignored: 10 }
const METHOD_LABEL = { standardize: 'standardize', snapchat: 'snapchat', copy: 'copy', voicenotes: 'voicenotes' }
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const FILE_LIMIT = 300

const isSnapshot = (folder) => folder.method === 'copy' && folder.snapshot === true

function scheduleLabel(schedule) {
  if (!schedule?.enabled) return 'manual'
  const days = schedule.days?.length ? schedule.days.map((day) => DAY_NAMES[day]).join(', ') : 'every day'
  return `${days} at ${schedule.at}`
}

function Modal({ onClose, children, ...rest }) {
  const ref = useRef(null)
  useModal(ref, onClose)
  return (
    <dialog ref={ref} {...rest}>
      {children}
    </dialog>
  )
}

export default function App() {
  const [state, setState] = useState(null)
  const [now, setNow] = useState(Date.now())
  const [confirmDialog, setConfirmDialog] = useState(null)
  const [reportDialog, setReportDialog] = useState(null)
  const [cleanupDialog, setCleanupDialog] = useState(null)
  const [setDateDialog, setSetDateDialog] = useState(null)
  const [restoreDialog, setRestoreDialog] = useState(null)
  const [reviewDialog, setReviewDialog] = useState(null)
  const [settingsDraft, setSettingsDraft] = useState(null)
  const [expanded, setExpanded] = useState(new Set())
  const [trash, setTrash] = useState({ entries: [], selectAll: false })
  const [trashSelection, setTrashSelection] = useState(new Set())
  const [logLines, setLogLines] = useState([])

  const notify = (message, tone = 'success') => showToast(message, tone)

  const refresh = async () => {
    try {
      setState(await getJson('api/state'))
    } catch (err) {
      notify(`Could not load state: ${err.message}`, 'error')
    }
  }

  const refreshTrash = async () => {
    try {
      const { entries } = await getJson('api/trash')
      setTrash({ entries, selectAll: false })
      setTrashSelection(new Set())
    } catch {
      // keep the last list
    }
  }

  const refreshLog = async () => {
    try {
      const { lines } = await getJson('api/log?limit=200')
      setLogLines(lines ?? [])
    } catch {
      // keep the last log
    }
  }

  const totals = (() => {
    const counters = { pending: 0, processing: 0, processed: 0, cleanable: 0, issues: 0 }
    for (const folder of state?.folders ?? []) {
      const counts = folder.counts ?? {}
      counters.pending += counts.pending ?? 0
      counters.processing += (counts.queued ?? 0) + (counts.processing ?? 0)
      const processed = (counts.done ?? 0) + (counts.duplicate ?? 0)
      counters.processed += processed
      // Archives that opt out of cleanup (cleanup: false) can never be
      // cleaned; keep them out of the cleanup button's count.
      if (folder.cleanup !== false) counters.cleanable += processed
      counters.issues += (counts.error ?? 0) + (counts.conflict ?? 0)
    }
    return counters
  })()

  const trashCount = (trash.entries ?? []).reduce((sum, entry) => sum + (entry.count ?? 0), 0)
  const statusText = state?.paused ? 'paused' : state?.dryRun ? 'dry run' : 'live'
  const statusTone = state?.paused ? 'paused' : state?.dryRun ? 'dry' : 'live'

  function folderStats(folder) {
    const counts = folder.counts ?? {}
    const total = folder.files.length
    const ignored = counts.ignored ?? 0
    const processed = (counts.done ?? 0) + (counts.duplicate ?? 0)
    const considered = Math.max(1, total - ignored)
    return {
      total,
      pending: counts.pending ?? 0,
      processing: (counts.queued ?? 0) + (counts.processing ?? 0),
      processed,
      issues: (counts.error ?? 0) + (counts.conflict ?? 0),
      ignored,
      review: counts.review ?? 0,
      percent: Math.min(100, Math.round((processed / considered) * 100)),
    }
  }

  function folderContext(folder) {
    if (isSnapshot(folder)) {
      return ['snapshot copy', folder.runner?.node ? `node ${folder.runner.node}` : 'this server', scheduleLabel(folder.schedule)].join(' · ')
    }
    const parts = [`settle ${formatDuration(folder.settleSeconds)}`]
    if (folder.method === 'snapchat') parts.push(`window ${formatDuration(folder.groupWindowSeconds)}`)
    if (folder.method === 'copy') {
      parts.push(folder.recursive ? 'recursive mirror' : 'flat copy')
      parts.push(`on change: ${folder.onChanged}`)
    }
    if (folder.placement === 'manual') parts.push('review before placing')
    if (folder.filePattern) parts.push(folder.filePattern)
    return parts.join(' · ')
  }

  function sortedFiles(folder) {
    return [...folder.files]
      .sort((a, b) => {
        const rank = (STATUS_RANK[a.status] ?? 9) - (STATUS_RANK[b.status] ?? 9)
        return rank !== 0 ? rank : a.name.localeCompare(b.name)
      })
      .slice(0, FILE_LIMIT)
  }

  /* ---------- actions ---------- */

  const act = async (path, body = {}) => {
    try {
      const result = await postJson(path, body)
      await Promise.all([refresh(), refreshLog()])
      return result
    } catch (err) {
      notify(err.message, 'error')
      return null
    }
  }

  const processNow = (folder, files) => act(`api/process/${encodeURIComponent(folder)}`, files ? { files } : {})
  const runSnapshot = (folderName) => act(`api/snapshot/${encodeURIComponent(folderName)}`)
  const fileAction = (folder, file, action, extra = {}) => act(`api/actions/${encodeURIComponent(folder)}/${encodeURIComponent(file)}`, { action, ...extra })
  const togglePaused = () => act('api/pause', { paused: !state.paused })
  const toggleDryRun = () => act('api/dry-run', { dryRun: !state.dryRun })

  function askConfirm(title, text, confirmLabel, tone = 'danger') {
    return new Promise((resolve) => {
      setConfirmDialog({ title, text, confirmLabel, tone, resolve: (value) => { setConfirmDialog(null); resolve(value) } })
    })
  }

  /* ---------- cleanup ---------- */

  async function openCleanup(folderName) {
    try {
      const preview = await getJson(`api/cleanup/${encodeURIComponent(folderName)}`)
      if (!preview.files.length) {
        notify('Nothing to clean up in this folder.', 'error')
        return
      }
      setCleanupDialog({ folder: folderName, files: preview.files, totalBytes: preview.totalBytes, selected: new Set(preview.files.map((file) => file.name)) })
    } catch (err) {
      notify(err.message, 'error')
    }
  }

  async function runCleanup() {
    const names = [...cleanupDialog.selected]
    if (!names.length) {
      notify('No files selected.', 'error')
      return
    }
    const folder = cleanupDialog.folder
    setCleanupDialog(null)
    try {
      const { results } = await postJson(`api/cleanup/${encodeURIComponent(folder)}`, { names })
      const failed = results.filter((result) => !result.ok)
      notify(`Moved ${results.length - failed.length} file(s) to trash.`, failed.length ? 'error' : 'success')
      if (failed.length) setReportDialog({ entries: failed })
    } catch (err) {
      notify(`Cleanup failed: ${err.message}`, 'error')
    }
    refresh()
    refreshTrash()
  }

  async function cleanupAll() {
    if (!(await askConfirm('Confirm', `Move ${totals.cleanable} processed original(s) to trash? Destination copies are verified first.`, 'Cleanup all'))) return
    try {
      await postJson('api/cleanup-all', {})
      notify('Cleanup finished.')
      refresh()
      refreshTrash()
      refreshLog()
    } catch (err) {
      notify(`Cleanup failed: ${err.message}`, 'error')
    }
  }

  /* ---------- review ---------- */

  function reviewGroups(folder) {
    const groups = new Map()
    for (const file of folder.files) {
      if (file.status !== 'pending' && file.status !== 'error') continue
      const parts = file.name.split('/')
      const base = parts.pop()
      const chat = parts.join('/')
      let date = null
      if (folder.datePattern) {
        try {
          const match = new RegExp(folder.datePattern).exec(base)
          if (match) {
            const raw = match.slice(1).filter(Boolean).join('').replace(/\D+/g, '')
            if (/^\d{8}$/.test(raw)) date = raw
          }
        } catch {
          date = null
        }
      }
      if (!date) continue
      const key = `${folder.name}\u0000${chat}\u0000${date}`
      if (!groups.has(key)) groups.set(key, { key, chat, date, files: [], bytes: 0 })
      const group = groups.get(key)
      group.files.push(file.name)
      group.bytes += file.size || 0
    }
    return [...groups.values()].sort((a, b) => `${a.chat}${a.date}`.localeCompare(`${b.chat}${b.date}`))
  }

  const reviewFolders = (state?.folders ?? []).filter((folder) => folder.placement === 'manual' || (folder.counts.review ?? 0) > 0)

  async function openReview() {
    try {
      const { entries } = await getJson('api/review')
      const selectedGroups = new Set()
      for (const folder of state?.folders ?? []) {
        if (folder.method === 'voicenotes') {
          for (const group of reviewGroups(folder)) selectedGroups.add(group.key)
        }
      }
      setReviewDialog({ entries, selectedGroups })
    } catch (err) {
      notify(err.message, 'error')
    }
  }

  function toggleGroup(key, checked) {
    setReviewDialog((current) => {
      const next = new Set(current.selectedGroups)
      if (checked) next.add(key)
      else next.delete(key)
      return { ...current, selectedGroups: next }
    })
  }

  async function processSelectedGroups(folder) {
    const groups = reviewGroups(folder).filter((group) => reviewDialog.selectedGroups.has(group.key))
    if (!groups.length) {
      notify('No groups selected.', 'error')
      return
    }
    await processNow(folder.name, groups.flatMap((group) => group.files))
    const { entries } = await getJson('api/review')
    setReviewDialog((current) => ({ ...current, entries }))
  }

  async function reviewAction(folder, id, place) {
    const path = place ? 'api/review/place' : 'api/review/discard'
    if (!place && !(await askConfirm('Confirm', 'Discard this parked item?', 'Discard'))) return
    await postJson(path, { folder, id })
    await openReview()
    refresh()
  }

  async function reviewActionAll(folder, place) {
    const path = place ? 'api/review/place-all' : 'api/review/discard-all'
    if (!place && !(await askConfirm('Confirm', `Discard every parked item in ${folder}?`, 'Discard all'))) return
    await postJson(path, { folder })
    await openReview()
    refresh()
  }

  /* ---------- trash ---------- */

  const trashKey = (day, name) => `${day}/${name}`

  function toggleTrashSelection(key, checked) {
    setTrashSelection((current) => {
      const next = new Set(current)
      if (checked) next.add(key)
      else next.delete(key)
      return next
    })
  }

  function selectAllTrash(checked) {
    const keys = trash.entries.flatMap((entry) => entry.files.slice(0, 300).map((file) => trashKey(entry.day, file.name)))
    setTrashSelection(checked ? new Set(keys) : new Set())
    setTrash({ ...trash, selectAll: checked })
  }

  async function restoreFiles(items, targetDir) {
    try {
      const { results } = await postJson('api/trash/restore', { files: items, targetDir: targetDir || null })
      const failed = results.filter((result) => !result.ok)
      notify(`Restored ${results.length - failed.length} file(s).`, failed.length ? 'error' : 'success')
      if (failed.length) setReportDialog({ entries: failed.map((file) => ({ name: file.name, reason: file.reason })) })
    } catch (err) {
      notify(err.message, 'error')
    }
    await refreshTrash()
    refresh()
  }

  function restoreSelected() {
    const items = [...trashSelection].map((key) => {
      const [day, ...rest] = key.split('/')
      return { day, name: rest.join('/') }
    })
    if (!items.length) {
      notify('No files selected.', 'error')
      return
    }
    setRestoreDialog({ items, dir: '', error: '' })
  }

  async function emptyTrash() {
    if (!(await askConfirm('Confirm', 'Permanently delete every trashed file?', 'Empty trash'))) return
    await postJson('api/trash/empty', {})
    await refreshTrash()
    refreshLog()
  }

  /* ---------- settings ---------- */

  const updateDraft = (mutator) => {
    setSettingsDraft((current) => {
      const next = structuredClone(current)
      mutator(next)
      return next
    })
  }

  const openSettings = () => {
    setSettingsDraft(structuredClone(state.config))
  }

  const addFolder = () => {
    updateDraft((draft) => {
      draft.folders = [...draft.folders, {
        name: '', source: '', destination: '', method: 'standardize', settleSeconds: 60,
        groupWindowSeconds: 15, placement: 'auto', onChanged: 'overwrite', notify: 'all',
        snapshot: false, sources: [], subdir: '', nameSuffix: '', touch: '',
        command: '', runner: { node: '' }, schedule: { enabled: false, days: [], at: '03:00', catchUp: true },
      }]
    })
  }

  async function saveSettings() {
    const config = structuredClone(settingsDraft)
    config.concurrency = Number(config.concurrency)
    config.trashRetentionDays = Number(config.trashRetentionDays)
    config.settleSeconds = Number(config.settleSeconds)
    for (const folder of config.folders) {
      if (folder.method === 'copy' && folder.snapshot) {
        folder.sources = (Array.isArray(folder.sources) ? folder.sources : []).map((source) => String(source).trim()).filter(Boolean)
        folder.source = folder.sources[0] ?? ''
        folder.runner = { node: String(folder.runner?.node ?? '').trim() || null }
        folder.subdir = String(folder.subdir ?? '').trim() || null
        folder.nameSuffix = String(folder.nameSuffix ?? '')
        folder.touch = String(folder.touch ?? '').trim() || null
        folder.command = String(folder.command ?? '').trim() || null
        folder.cleanup = false
        continue
      }
      folder.settleSeconds = Number(folder.settleSeconds)
      folder.groupWindowSeconds = Number(folder.groupWindowSeconds)
      folder.filePattern ||= null
      if (folder.method === 'voicenotes') folder.recursive = true
      if (folder.method === 'copy') folder.placement = 'auto'
    }
    try {
      await putJson('api/config', config)
      setSettingsDraft(null)
      notify('Settings saved.')
      refresh()
    } catch (err) {
      notify(`Save failed: ${err.message}`, 'error')
    }
  }

  async function sendTestNotification() {
    try {
      await postJson('api/ntfy-test', { url: settingsDraft.ntfy?.url, token: settingsDraft.ntfy?.token })
      notify('Test notification sent.')
    } catch (err) {
      notify(err.message, 'error')
    }
  }

  function toggleExpanded(name, open) {
    setExpanded((current) => {
      const next = new Set(current)
      if (open) next.add(name)
      else next.delete(name)
      return next
    })
  }

  useEffect(() => {
    refresh()
    refreshTrash()
    refreshLog()
    const timer = setInterval(() => {
      setNow(Date.now())
      refresh()
      refreshLog()
    }, 5000)
    return () => clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Parked items appear asynchronously after processing; keep the review dialog fresh.
  useEffect(() => {
    if (!reviewDialog) return undefined
    const timer = setInterval(async () => {
      try {
        const { entries } = await getJson('api/review')
        setReviewDialog((current) => (current ? { ...current, entries } : current))
      } catch {
        // keep the last list
      }
    }, 2000)
    return () => clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Boolean(reviewDialog)])

  const runFor = (folder) => state?.runs?.[folder.name] ?? null

  return (
    <>
      <header className="app-header">
        <div className="app-header__top">
          <h1><a className="app-header__brand" href="/">D<span className="accent">$</span>CPLN</a> <span className="app-header__app">⋅ File Pipelines</span></h1>
          <div className="app-header__actions">
            <button className="outline secondary icon-button" title={state?.paused ? 'Resume processing' : 'Pause processing'} aria-label="Pause/Resume" onClick={togglePaused}>
              {state?.paused ? <Play size={16} strokeWidth={1.8} /> : <Pause size={16} strokeWidth={1.8} />}
            </button>
            <button className="outline secondary icon-button" title="Toggle dry-run mode" aria-label="Toggle dry-run mode" onClick={toggleDryRun}>
              <FlaskConical size={16} strokeWidth={1.8} />
            </button>
            <button className="outline secondary icon-button" title="Settings" aria-label="Settings" onClick={openSettings}>
              <Settings size={16} strokeWidth={1.8} />
            </button>
            <button className="outline secondary icon-button" title="Refresh" aria-label="Refresh" onClick={() => { refresh(); refreshTrash(); refreshLog() }}>
              <RefreshCw size={16} strokeWidth={1.8} />
            </button>
            <ThemeToggle />
          </div>
        </div>
        <div className="app-header__meta">
          <span className={`status-tag status-tag--${statusTone}`}><span>{statusText}</span></span>
          <span className="app-header__meta-tools">
            <span className="muted">{totals.pending} pending · {totals.issues} issue{totals.issues === 1 ? '' : 's'}</span>
            <span className="muted">{state ? `updated ${formatTime(now)}` : ''}</span>
          </span>
        </div>
      </header>

      <main>
        <section className="card card--hero" id="overviewCard" aria-labelledby="overviewHeading">
          <div className="card__header">
            <h2 id="overviewHeading">Overview</h2>
            <span className="card__header-tools">
              <span className="card__context">{state?.folders?.length ?? 0} folder{state?.folders?.length === 1 ? '' : 's'} watched</span>
            </span>
          </div>
          <div className="overview__grid">
            <div className="stat-tile">
              <span className="stat-tile__label">Pending</span>
              <span className="stat-tile__value">{totals.pending}</span>
            </div>
            <div className="stat-tile">
              <span className="stat-tile__label">Processing</span>
              <span className="stat-tile__value">{totals.processing}</span>
            </div>
            <div className="stat-tile">
              <span className="stat-tile__label">Processed</span>
              <span className="stat-tile__value">{totals.processed}</span>
            </div>
            <div className="stat-tile">
              <span className="stat-tile__label">Issues</span>
              <span className={`stat-tile__value${totals.issues > 0 ? ' is-over' : ''}`}>{totals.issues}</span>
            </div>
            <div className="stat-tile">
              <span className="stat-tile__label">Trash</span>
              <span className="stat-tile__value">{trashCount}</span>
            </div>
          </div>
          <div className="overview__actions">
            <button className="outline secondary" onClick={openReview}>Review</button>
            <button disabled={!totals.cleanable} onClick={cleanupAll}>Cleanup all{totals.cleanable ? ` (${totals.cleanable})` : ''}</button>
          </div>
        </section>

        <div className="folder-grid">
          {(state?.folders ?? []).map((folder) => {
            const stats = folderStats(folder)
            const run = runFor(folder)
            return (
              <section key={folder.name} className={`card folder-card folder-card--${folder.method}${folder.counts.conflict ? ' card--over' : !folder.counts.conflict && stats.issues ? ' card--warn' : ''}`}>
                <div className="card__header">
                  <div className="folder-title">
                    <h2>{folder.name}</h2>
                    <span className="method-badge">{METHOD_LABEL[folder.method] ?? folder.method}</span>
                    {!folder.exists ? <span className="status-tag status-tag--interrupted"><span>source unavailable</span></span> : null}
                  </div>
                  <span className="card__context">{folderContext(folder)}</span>
                </div>

                {isSnapshot(folder) ? (
                  <>
                    <p className="folder-paths">
                      <code>{(folder.sources?.length ? folder.sources : [folder.source]).join(' · ')}</code>
                      <span className="folder-paths__arrow">→</span>
                      <code>{folder.destination}</code>
                    </p>

                    <div className="pipeline-meta">
                      <div className="pipeline-meta__row">
                        <span className="muted">Schedule</span>
                        <span>{scheduleLabel(folder.schedule)}</span>
                      </div>
                      <div className="pipeline-meta__row">
                        <span className="muted">Next run</span>
                        <span>{run?.nextRun ? formatDateTime(run.nextRun) : '—'}</span>
                      </div>
                      <div className="pipeline-meta__row">
                        <span className="muted">Last run</span>
                        <span>
                          {run?.running ? (
                            <span className="pill pill--running">running…</span>
                          ) : run?.lastRunAt ? (
                            <>
                              <span className={`pill pill--${run.ok === false ? 'fail' : 'ok'}`}>{run.ok === false ? 'failed' : 'ok'}</span>
                              <span className="muted"> {formatDateTime(run.lastRunAt)}</span>
                            </>
                          ) : (
                            <span className="muted">never</span>
                          )}
                        </span>
                      </div>
                      {run?.summary ? (
                        <p className="muted pipeline-meta__summary">{run.summary}</p>
                      ) : null}
                    </div>

                    <div className="folder-card__actions">
                      <button disabled={run?.running || state?.dryRun} onClick={() => runSnapshot(folder.name)}>
                        {run?.running ? 'Running…' : 'Run copy'}
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="figure">
                      <span className="figure__spend">{stats.pending}</span>
                      <span className="figure__meta">
                        <span className="figure__of">pending of</span>
                        <span className="figure__budget">{stats.total} file{stats.total === 1 ? '' : 's'}</span>
                      </span>
                    </p>

                    <div className="progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow={stats.percent}>
                      <div className="progress__fill" style={{ width: `${stats.percent}%` }}></div>
                    </div>

                    <p className="pace">
                      {folder.lastEventAt ? `last change ${formatDateTime(folder.lastEventAt)} · ` : ''}{stats.processed} processed{stats.ignored > 0 ? ` · ${stats.ignored} ignored` : ''}
                    </p>

                    <div className="stat-tiles">
                      <div className="stat-tile"><span className="stat-tile__label">pending</span><span className="stat-tile__value">{stats.pending}</span></div>
                      <div className="stat-tile"><span className="stat-tile__label">processing</span><span className="stat-tile__value">{stats.processing}</span></div>
                      <div className="stat-tile"><span className="stat-tile__label">processed</span><span className="stat-tile__value">{stats.processed}</span></div>
                      <div className="stat-tile"><span className="stat-tile__label">issues</span><span className={`stat-tile__value${stats.issues > 0 ? ' is-over' : ''}`}>{stats.issues}</span></div>
                    </div>

                    <p className="folder-paths">
                      <code>{folder.source}</code>
                      <span className="folder-paths__arrow">→</span>
                      <code>{folder.destination}</code>
                    </p>

                    <div className="folder-card__actions">
                      <button className="outline secondary" onClick={() => processNow(folder.name)}>Process now</button>
                      {folder.placement === 'manual' || stats.review > 0 ? (
                        <button className={stats.review > 0 ? '' : 'outline secondary'} onClick={openReview}>
                          Review{stats.review > 0 ? ` (${stats.review})` : ''}
                        </button>
                      ) : null}
                      {stats.processed > 0 && folder.cleanup !== false ? (
                        <button onClick={() => openCleanup(folder.name)}>Cleanup {stats.processed}</button>
                      ) : null}
                    </div>

                    <details className="folder-details" open={expanded.has(folder.name)} onToggle={(event) => toggleExpanded(folder.name, event.target.open)}>
                      <summary>Files · {folder.files.length}</summary>
                      {!folder.files.length ? (
                        <p className="muted files-empty">No files in this folder right now.</p>
                      ) : (
                        <>
                          <ul className="files__list">
                            {sortedFiles(folder).map((file) => (
                              <li className={`file file--${file.status}`} key={file.name}>
                                <div className="file__main">
                                  <span className="file__name">{file.name}</span>
                                  {file.message || file.attempts || file.destName ? (
                                    <span className="file__notes">
                                      {[file.message, file.attempts ? `attempt ${file.attempts}` : null, file.destName ? `→ ${file.destName}` : null].filter(Boolean).join(' · ')}
                                    </span>
                                  ) : null}
                                </div>
                                <div className="file__meta">
                                  <span className="file__size">{formatBytes(file.size)}</span>
                                  <span className="file__date">{formatDateTime(file.mtimeMs)}</span>
                                  <span className={`pill pill--${file.status === 'done' ? 'ok' : file.status === 'error' ? 'fail' : file.status === 'conflict' ? 'neutral' : 'running'}`}>{file.status}</span>
                                </div>
                                <div className="file__actions">
                                  {file.status === 'error' || file.status === 'conflict' ? (
                                    <button className="outline secondary icon-button icon-button--small" title="Retry" aria-label={`Retry ${file.name}`} onClick={() => fileAction(folder.name, file.name, 'retry')}>
                                      <RefreshCw size={14} strokeWidth={1.8} />
                                    </button>
                                  ) : null}
                                  {file.status === 'error' ? (
                                    <>
                                      <button className="outline secondary icon-button icon-button--small" title="Repair (ffmpeg remux)" aria-label={`Repair ${file.name}`} onClick={() => fileAction(folder.name, file.name, 'repair')}>
                                        <Wrench size={14} strokeWidth={1.8} />
                                      </button>
                                      <button className="outline secondary icon-button icon-button--small" title="Set date and retry" aria-label={`Set date for ${file.name}`} onClick={() => setSetDateDialog({ folder: folder.name, file: file.name, date: '', time: '00:00', error: '' })}>
                                        <CalendarDays size={14} strokeWidth={1.8} />
                                      </button>
                                    </>
                                  ) : null}
                                  {file.status === 'error' || file.status === 'conflict' || file.status === 'pending' ? (
                                    <button className="outline secondary icon-button icon-button--small" title="Import as-is" aria-label={`Import ${file.name} as-is`} onClick={() => fileAction(folder.name, file.name, 'import')}>
                                      <Import size={14} strokeWidth={1.8} />
                                    </button>
                                  ) : null}
                                </div>
                              </li>
                            ))}
                          </ul>
                          {folder.files.length > FILE_LIMIT ? (
                            <p className="muted files-empty">… and {folder.files.length - FILE_LIMIT} more file(s)</p>
                          ) : null}
                        </>
                      )}
                    </details>
                  </>
                )}
              </section>
            )
          })}
          {state && !state.folders.length ? (
            <section className="card"><p className="muted">No folders configured yet — open Settings to add one.</p></section>
          ) : null}
        </div>

        <div className="side-grid">
          <section className="card" id="trashCard" aria-labelledby="trashHeading">
            <div className="card__header">
              <h2 id="trashHeading">Trash</h2>
              <span className="card__header-tools">
                <span className="card__context">{trash.entries.length} day(s) · keeping {state?.trashRetentionDays} days</span>
                <button className="outline secondary icon-button" title="Refresh trash" aria-label="Refresh trash" onClick={refreshTrash}>
                  <RefreshCw size={16} strokeWidth={1.8} />
                </button>
              </span>
            </div>
            {trash.entries.length ? (
              <>
                <label className="checklist__row">
                  <input type="checkbox" checked={trash.selectAll} onChange={(event) => selectAllTrash(event.target.checked)} />
                  <span className="checklist__main">Select all</span>
                </label>
                <div className="trash__list">
                  {trash.entries.map((entry) => (
                    <details key={entry.day}>
                      <summary>{entry.day} · {entry.count} file(s) · {formatBytes(entry.bytes)}</summary>
                      {entry.files.slice(0, 300).map((file) => {
                        const key = trashKey(entry.day, file.name)
                        return (
                          <label className="checklist__row" key={file.name}>
                            <input type="checkbox" checked={trashSelection.has(key)} onChange={(event) => toggleTrashSelection(key, event.target.checked)} />
                            <span className="checklist__main">{file.name}</span>
                            <span className="checklist__meta">{formatBytes(file.size)} · {file.folder ?? file.sourceDir ?? 'origin unknown'}</span>
                          </label>
                        )
                      })}
                      {entry.count > 300 ? <p className="muted files-empty">… and {entry.count - 300} more</p> : null}
                    </details>
                  ))}
                </div>
              </>
            ) : (
              <p className="muted files-empty">Trash is empty.</p>
            )}
            <div className="trash-actions">
              {trashSelection.size ? (
                <button onClick={restoreSelected}>Restore selected ({trashSelection.size})</button>
              ) : null}
              {trash.entries.length ? (
                <button className="danger" onClick={emptyTrash}>Empty trash</button>
              ) : null}
            </div>
          </section>

          <section className="card" id="activityCard" aria-labelledby="activityHeading">
            <div className="card__header">
              <h2 id="activityHeading">Activity</h2>
              <span className="card__header-tools">
                <button className="outline secondary icon-button" title="Refresh log" aria-label="Refresh log" onClick={refreshLog}>
                  <RefreshCw size={16} strokeWidth={1.8} />
                </button>
              </span>
            </div>
            <pre className="code-block activity-log">{logLines.join('\n') || 'No activity yet.'}</pre>
          </section>
        </div>
      </main>

      {cleanupDialog ? (
        <Modal onClose={() => setCleanupDialog(null)} className="wide-dialog">
          <article>
            <header className="card__header">
              <h2>Cleanup {cleanupDialog.folder}</h2>
              <span className="card__header-tools">
                <button className="outline secondary icon-button" aria-label="Close" onClick={() => setCleanupDialog(null)}>&times;</button>
              </span>
            </header>
            <p className="hint">{cleanupDialog.files.length} processed file(s), {formatBytes(cleanupDialog.totalBytes)}. Each destination copy is verified before the original is moved to trash.</p>
            <label className="checklist__row">
              <input type="checkbox" checked={cleanupDialog.selected.size === cleanupDialog.files.length}
                onChange={(event) => setCleanupDialog((current) => ({ ...current, selected: event.target.checked ? new Set(current.files.map((file) => file.name)) : new Set() }))} />
              <span className="checklist__main">Select all</span>
            </label>
            <div className="checklist">
              {cleanupDialog.files.map((file) => (
                <label className="checklist__row" key={file.name}>
                  <input type="checkbox" checked={cleanupDialog.selected.has(file.name)}
                    onChange={(event) => setCleanupDialog((current) => {
                      const next = new Set(current.selected)
                      if (event.target.checked) next.add(file.name)
                      else next.delete(file.name)
                      return { ...current, selected: next }
                    })} />
                  <span className="checklist__main">{file.name}</span>
                  <span className="checklist__meta">{file.destName ? `→ ${file.destName}` : ''}</span>
                </label>
              ))}
            </div>
            <div className="dialog-actions">
              <button className="outline secondary" onClick={() => setCleanupDialog(null)}>Cancel</button>
              <button className="danger" onClick={runCleanup}>Move to trash</button>
            </div>
          </article>
        </Modal>
      ) : null}

      {setDateDialog ? (
        <Modal onClose={() => setSetDateDialog(null)} className="narrow-dialog">
          <article>
            <header className="card__header">
              <h2>Set date</h2>
              <span className="card__header-tools">
                <button className="outline secondary icon-button" aria-label="Close" onClick={() => setSetDateDialog(null)}>&times;</button>
              </span>
            </header>
            <p className="hint">The copy will be standardized with this date and placed in the destination.</p>
            <div className="native-fields">
              <label className="native-field">
                <span className="field__label">Date</span>
                <input type="date" required value={setDateDialog.date} onChange={(event) => setSetDateDialog((current) => ({ ...current, date: event.target.value }))} />
              </label>
              <label className="native-field">
                <span className="field__label">Time</span>
                <input type="time" value={setDateDialog.time} onChange={(event) => setSetDateDialog((current) => ({ ...current, time: event.target.value }))} />
              </label>
            </div>
            {setDateDialog.error ? <p className="form-error">{setDateDialog.error}</p> : null}
            <div className="dialog-actions">
              <button className="outline secondary" onClick={() => setSetDateDialog(null)}>Cancel</button>
              <button onClick={async () => {
                if (!setDateDialog.date) { setSetDateDialog((current) => ({ ...current, error: 'Pick a date first.' })); return }
                const { folder, file, date, time } = setDateDialog
                setSetDateDialog(null)
                await fileAction(folder, file, 'setDate', { date: `${date} ${time || '00:00'}` })
                notify(`Standardizing ${file} with the chosen date.`)
              }}>Standardize</button>
            </div>
          </article>
        </Modal>
      ) : null}

      {restoreDialog ? (
        <Modal onClose={() => setRestoreDialog(null)} className="narrow-dialog">
          <article>
            <header className="card__header">
              <h2>Restore files</h2>
              <span className="card__header-tools">
                <button className="outline secondary icon-button" aria-label="Close" onClick={() => setRestoreDialog(null)}>&times;</button>
              </span>
            </header>
            <p className="hint">Files with a recorded origin return to their original folder. Files without one are restored to the directory you enter here.</p>
            <div className="native-fields">
              <label className="native-field">
                <span className="field__label">Restore directory</span>
                <input type="text" placeholder="/path/to/folder" autoComplete="off" value={restoreDialog.dir} onChange={(event) => setRestoreDialog((current) => ({ ...current, dir: event.target.value }))} />
              </label>
            </div>
            {restoreDialog.error ? <p className="form-error">{restoreDialog.error}</p> : null}
            <div className="dialog-actions">
              <button className="outline secondary" onClick={() => setRestoreDialog(null)}>Cancel</button>
              <button onClick={async () => {
                if (!restoreDialog.dir.trim()) { setRestoreDialog((current) => ({ ...current, error: 'Enter a directory first.' })); return }
                const { items, dir } = restoreDialog
                setRestoreDialog(null)
                await restoreFiles(items, dir.trim())
              }}>Restore</button>
            </div>
          </article>
        </Modal>
      ) : null}

      {reviewDialog ? (
        <Modal onClose={() => setReviewDialog(null)} data-testid="review-dialog" className="wide-dialog">
          <article>
            <header className="card__header">
              <h2>Review</h2>
              <span className="card__header-tools">
                <button className="outline secondary icon-button" aria-label="Close" onClick={() => setReviewDialog(null)}>&times;</button>
              </span>
            </header>
            <p className="hint">Manual folders prepare files here without writing to the destination. Place the ones you want to keep, or discard the rest — nothing is written until you place it.</p>
            {!reviewFolders.length ? (
              <p className="muted">Nothing awaiting review.</p>
            ) : null}
            {reviewFolders.map((folder) => {
              const parked = reviewDialog.entries.filter((entry) => entry.folder === folder.name)
              const groups = folder.method === 'voicenotes' ? reviewGroups(folder) : []
              if (!parked.length && !groups.length) return null
              return (
                <section className="review-section" key={folder.name}>
                  <h3>{folder.name}</h3>
                  {groups.length ? (
                    <>
                      <div className="review-groups">
                        {groups.map((group) => (
                          <label className="checklist__row" key={group.key}>
                            <input type="checkbox" checked={reviewDialog.selectedGroups.has(group.key)} onChange={(event) => toggleGroup(group.key, event.target.checked)} />
                            <span className="checklist__main">{group.chat || '(root)'} · {group.date} · {group.files.length} clip{group.files.length === 1 ? '' : 's'}</span>
                            <span className="checklist__meta">{formatBytes(group.bytes)}</span>
                          </label>
                        ))}
                      </div>
                      <div className="folder-card__actions">
                        <button onClick={() => processSelectedGroups(folder)}>Process selected</button>
                      </div>
                    </>
                  ) : null}
                  {parked.map((entry) => (
                    <div className="review-row" key={entry.id}>
                      <div className="review-row__main">
                        <span className="checklist__main">{entry.destName}</span>
                        <span className="checklist__meta">
                          {entry.chat || '(root)'} · {entry.inputs.length} input{entry.inputs.length === 1 ? '' : 's'} · {formatBytes(entry.size)}{entry.missingInputs?.length ? ` · ${entry.missingInputs.length} source(s) gone` : ''}
                        </span>
                      </div>
                      <audio controls preload="none" src={apiUrl(`api/review/file/${encodeURIComponent(folder.name)}/${encodeURIComponent(entry.id)}`)}></audio>
                      <div className="review-row__actions">
                        <button onClick={() => reviewAction(folder.name, entry.id, true)}>Place</button>
                        <button className="outline secondary" onClick={() => reviewAction(folder.name, entry.id, false)}>Discard</button>
                      </div>
                    </div>
                  ))}
                  {parked.length > 1 ? (
                    <div className="folder-card__actions">
                      <button onClick={() => reviewActionAll(folder.name, true)}>Place all ({parked.length})</button>
                      <button className="outline secondary" onClick={() => reviewActionAll(folder.name, false)}>Discard all</button>
                    </div>
                  ) : null}
                </section>
              )
            })}
            <div className="dialog-actions">
              <button className="outline secondary" onClick={() => setReviewDialog(null)}>Close</button>
            </div>
          </article>
        </Modal>
      ) : null}

      {settingsDraft ? (
        <Modal onClose={() => setSettingsDraft(null)} data-testid="settings-dialog" className="wide-dialog">
          <article>
            <header className="card__header">
              <h2>Settings</h2>
              <span className="card__header-tools">
                <button className="outline secondary icon-button" aria-label="Close" onClick={() => setSettingsDraft(null)}>&times;</button>
              </span>
            </header>
            <p className="hint">Changes are written back to the config file and applied immediately. The bind host and port are fixed at deploy time.</p>

            <div className="form-grid">
              <div className="field"><span className="field__label">Concurrency</span><input type="number" value={settingsDraft.concurrency} onChange={(event) => updateDraft((draft) => { draft.concurrency = event.target.value })} /></div>
              <div className="field"><span className="field__label">Trash retention (days)</span><input type="number" value={settingsDraft.trashRetentionDays} onChange={(event) => updateDraft((draft) => { draft.trashRetentionDays = event.target.value })} /></div>
              <div className="field"><span className="field__label">Default settle (s)</span><input type="number" value={settingsDraft.settleSeconds} onChange={(event) => updateDraft((draft) => { draft.settleSeconds = event.target.value })} /></div>
              <div className="field"><span className="field__label">ntfy URL</span><input value={settingsDraft.ntfy?.url ?? ''} onChange={(event) => updateDraft((draft) => { draft.ntfy.url = event.target.value })} /></div>
              <div className="field"><span className="field__label">ntfy token</span><input type="password" value={settingsDraft.ntfy?.token ?? ''} onChange={(event) => updateDraft((draft) => { draft.ntfy.token = event.target.value })} /></div>
            </div>
            <div className="form-grid field-grid--checks">
              <label><input type="checkbox" checked={settingsDraft.ntfy?.notifySuccess !== false} onChange={(event) => updateDraft((draft) => { draft.ntfy.notifySuccess = event.target.checked })} /> Notify when files are processed successfully</label>
            </div>
            <div className="form-grid">
              <div className="field"><span className="field__label">Staging directory</span><input value={settingsDraft.stagingDir} onChange={(event) => updateDraft((draft) => { draft.stagingDir = event.target.value })} /></div>
              <div className="field"><span className="field__label">Review directory</span><input value={settingsDraft.reviewDir} onChange={(event) => updateDraft((draft) => { draft.reviewDir = event.target.value })} /></div>
              <div className="field"><span className="field__label">Trash directory</span><input value={settingsDraft.trashDir} onChange={(event) => updateDraft((draft) => { draft.trashDir = event.target.value })} /></div>
            </div>
            <div className="form-grid">
              <div className="field field--wide">
                <button className="outline secondary" onClick={sendTestNotification}>Send test notification</button>
              </div>
            </div>

            <h3 className="settings-section">Folders</h3>
            {settingsDraft.folders.map((folder, index) => (
              <div className="folder-edit" key={index}>
                <div className="folder-edit__head">
                  <h3>{folder.name || 'New folder'}</h3>
                  <button className="outline secondary icon-button icon-button--small" title="Remove this folder" aria-label="Remove this folder"
                    onClick={() => updateDraft((draft) => { draft.folders = draft.folders.filter((_, i) => i !== index) })}>
                    <X size={14} strokeWidth={1.8} />
                  </button>
                </div>
                <div className="form-grid">
                  <div className="field"><span className="field__label">Name</span><input value={folder.name} onChange={(event) => updateDraft((draft) => { draft.folders[index].name = event.target.value })} /></div>
                  {folder.snapshot ? (
                    <div className="field field--wide">
                      <span className="field__label">Sources (one per line)</span>
                      <textarea rows="3" spellCheck="false" value={(folder.sources ?? []).join('\n')}
                        onChange={(event) => updateDraft((draft) => { draft.folders[index].sources = event.target.value.split('\n').map((line) => line.trim()).filter(Boolean) })}></textarea>
                    </div>
                  ) : (
                    <div className="field"><span className="field__label">Source</span><input value={folder.source} onChange={(event) => updateDraft((draft) => { draft.folders[index].source = event.target.value })} /></div>
                  )}
                  <div className="field"><span className="field__label">Destination</span><input value={folder.destination} onChange={(event) => updateDraft((draft) => { draft.folders[index].destination = event.target.value })} /></div>
                  <div className="field"><span className="field__label">Method</span>
                    <select value={folder.method} onChange={(event) => updateDraft((draft) => { draft.folders[index].method = event.target.value })}>
                      {['standardize', 'snapchat', 'copy', 'voicenotes'].map((method) => <option value={method} key={method}>{method}</option>)}
                    </select>
                  </div>
                  {folder.method === 'copy' ? (
                    <div className="field">
                      <span className="field__label">Snapshot</span>
                      <label><input type="checkbox" checked={folder.snapshot === true}
                        onChange={(event) => updateDraft((draft) => {
                          draft.folders[index].snapshot = event.target.checked
                          if (draft.folders[index].snapshot && !(draft.folders[index].sources ?? []).length && draft.folders[index].source) {
                            draft.folders[index].sources = [draft.folders[index].source]
                          }
                        })} /> Run on demand or on a schedule instead of watching</label>
                      <p className="hint">Copies whole entries from the sources each run (optionally one subdir); a remote runner node makes it a Job there.</p>
                    </div>
                  ) : null}
                  {folder.snapshot ? (
                    <>
                      <div className="field"><span className="field__label">Copy subdir (optional)</span><input value={folder.subdir ?? ''} placeholder="drive_c/users/steamuser" onChange={(event) => updateDraft((draft) => { draft.folders[index].subdir = event.target.value })} /></div>
                      <div className="field"><span className="field__label">Name suffix (optional)</span><input value={folder.nameSuffix ?? ''} placeholder=" (Wine prefix home dir)" onChange={(event) => updateDraft((draft) => { draft.folders[index].nameSuffix = event.target.value })} /></div>
                      <div className="field"><span className="field__label">Touch marker (optional)</span><input value={folder.touch ?? ''} placeholder="lastBackedUp.txt" onChange={(event) => updateDraft((draft) => { draft.folders[index].touch = event.target.value })} /></div>
                      <div className="field">
                        <span className="field__label">Runner node</span>
                        <input value={folder.runner?.node ?? ''} placeholder="this server" onChange={(event) => updateDraft((draft) => { draft.folders[index].runner = { node: event.target.value } })} />
                        <p className="hint">A Kubernetes node name (e.g. bigpc) to run the copy there; empty runs it on this server.</p>
                      </div>
                      <div className="field field--wide">
                        <span className="field__label">Command override (optional)</span>
                        <textarea rows="4" spellCheck="false" placeholder={'rsync -a "{{source}}/" "{{destination}}/"'}
                          value={folder.command ?? ''} onChange={(event) => updateDraft((draft) => { draft.folders[index].command = event.target.value })}></textarea>
                        <p className="hint">Replaces the generated copy script. Tokens: {'{{source}}'}, {'{{destination}}'}, {'{{staging}}'}.</p>
                      </div>
                    </>
                  ) : null}
                  <div className="field" hidden={folder.snapshot}><span className="field__label">Settle (s)</span><input type="number" value={folder.settleSeconds ?? 60} onChange={(event) => updateDraft((draft) => { draft.folders[index].settleSeconds = event.target.value })} /></div>
                  <div className="field" hidden={folder.snapshot}><span className="field__label">Group window (s)</span><input type="number" value={folder.groupWindowSeconds ?? 15} onChange={(event) => updateDraft((draft) => { draft.folders[index].groupWindowSeconds = event.target.value })} /></div>
                  <div className="field" hidden={folder.snapshot}><span className="field__label">File pattern</span><input value={folder.filePattern ?? ''} onChange={(event) => updateDraft((draft) => { draft.folders[index].filePattern = event.target.value })} /></div>
                </div>
                <div className="form-grid field-grid--checks" hidden={folder.snapshot}>
                  <label><input type="checkbox" checked={folder.recursive === true} onChange={(event) => updateDraft((draft) => { draft.folders[index].recursive = event.target.checked })} /> Recursive (mirror subdirectories)</label>
                  <label><input type="checkbox" checked={folder.includeHidden === true} onChange={(event) => updateDraft((draft) => { draft.folders[index].includeHidden = event.target.checked })} /> Include hidden files</label>
                  <label><input type="checkbox" checked={folder.cleanup !== false} onChange={(event) => updateDraft((draft) => { draft.folders[index].cleanup = event.target.checked })} /> Allow cleanup of processed originals</label>
                  <label><input type="checkbox" checked={folder.autoProcess === true} onChange={(event) => updateDraft((draft) => { draft.folders[index].autoProcess = event.target.checked })} /> Prepare new files automatically (manual review)</label>
                </div>
                {folder.snapshot ? (
                  <>
                    <div className="form-grid">
                      <div className="field"><span className="field__label">Schedule</span>
                        <select value={folder.schedule?.enabled ? 'on' : 'off'}
                          onChange={(event) => updateDraft((draft) => { draft.folders[index].schedule = { ...draft.folders[index].schedule, enabled: event.target.value === 'on' } })}>
                          <option value="off">manual</option>
                          <option value="on">scheduled</option>
                        </select>
                      </div>
                      <div className="field"><span className="field__label">At</span>
                        <input type="time" value={folder.schedule?.at ?? '03:00'} onChange={(event) => updateDraft((draft) => { draft.folders[index].schedule = { ...draft.folders[index].schedule, at: event.target.value } })} />
                      </div>
                      <div className="field"><span className="field__label">Missed runs</span>
                        <select value={folder.schedule?.catchUp === false ? 'skip' : 'catchup'}
                          onChange={(event) => updateDraft((draft) => { draft.folders[index].schedule = { ...draft.folders[index].schedule, catchUp: event.target.value === 'catchup' } })}>
                          <option value="catchup">run on start</option>
                          <option value="skip">skip</option>
                        </select>
                      </div>
                    </div>
                    <div className="form-grid field-grid--checks">
                      {DAY_NAMES.map((name, day) => (
                        <label key={name}>
                          <input type="checkbox" checked={(folder.schedule?.days ?? []).includes(day)}
                            onChange={(event) => updateDraft((draft) => {
                              const days = new Set(draft.folders[index].schedule?.days ?? [])
                              if (event.target.checked) days.add(day)
                              else days.delete(day)
                              draft.folders[index].schedule = { ...draft.folders[index].schedule, days: [...days].sort() }
                            })} />
                          {name}
                        </label>
                      ))}
                      <p className="hint">No days selected = every day.</p>
                    </div>
                  </>
                ) : null}
                <div className="form-grid" hidden={folder.snapshot}>
                  <div className="field"><span className="field__label">Placement</span>
                    <select value={folder.placement ?? 'auto'} onChange={(event) => updateDraft((draft) => { draft.folders[index].placement = event.target.value })}>
                      <option value="auto">auto</option><option value="manual">manual</option>
                    </select>
                  </div>
                  <div className="field"><span className="field__label">On change</span>
                    <select value={folder.onChanged ?? 'overwrite'} onChange={(event) => updateDraft((draft) => { draft.folders[index].onChanged = event.target.value })}>
                      <option value="overwrite">overwrite</option><option value="conflict">conflict</option>
                    </select>
                  </div>
                  <div className="field"><span className="field__label">Notify on success</span>
                    <select value={folder.notify ?? 'all'} onChange={(event) => updateDraft((draft) => { draft.folders[index].notify = event.target.value })}>
                      <option value="all">all</option><option value="errors">errors</option>
                    </select>
                  </div>
                  <div className="field" hidden={folder.snapshot}><span className="field__label">Date pattern (voicenotes)</span><input value={folder.datePattern ?? ''} onChange={(event) => updateDraft((draft) => { draft.folders[index].datePattern = event.target.value })} /></div>
                </div>
              </div>
            ))}
            <div className="folder-card__actions">
              <button className="outline secondary" onClick={addFolder}>Add folder</button>
            </div>

            <div className="dialog-actions">
              <button className="outline secondary" onClick={() => setSettingsDraft(null)}>Cancel</button>
              <button onClick={saveSettings}>Save</button>
            </div>
          </article>
        </Modal>
      ) : null}

      {confirmDialog ? (
        <Modal onClose={() => { confirmDialog.resolve(false) }} data-testid="confirm-dialog" className="narrow-dialog">
          <article>
            <header className="card__header"><h2>{confirmDialog.title}</h2></header>
            <p className="muted">{confirmDialog.text}</p>
            <div className="dialog-actions">
              <button className="outline secondary" onClick={() => confirmDialog.resolve(false)}>Cancel</button>
              <button className={confirmDialog.tone === 'danger' ? 'danger' : ''} onClick={() => confirmDialog.resolve(true)}>{confirmDialog.confirmLabel}</button>
            </div>
          </article>
        </Modal>
      ) : null}

      {reportDialog ? (
        <Modal onClose={() => setReportDialog(null)} className="wide-dialog">
          <article>
            <header className="card__header"><h2>Report</h2></header>
            <div className="checklist">
              {reportDialog.entries.map((entry) => (
                <div className="checklist__row" key={entry.name + (entry.reason ?? '')}>
                  <span className="checklist__main">{entry.name}</span>
                  <span className="checklist__meta"><span className="msg error">{entry.reason ?? ''}</span></span>
                </div>
              ))}
            </div>
            <div className="dialog-actions">
              <button onClick={() => setReportDialog(null)}>Close</button>
            </div>
          </article>
        </Modal>
      ) : null}

      <Toasts />
    </>
  )
}
