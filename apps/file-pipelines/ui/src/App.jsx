import { useEffect, useState } from 'react'
import { FlaskConical, Pause, Play, RefreshCw, Settings } from 'lucide-react'
import { formatTime, getJson, postJson, putJson, showToast, ThemeToggle, Toasts, usePolling } from '@dscpln/ui-kit'
import ActivityCard from './components/ActivityCard.jsx'
import FolderCard from './components/FolderCard.jsx'
import OverviewCard from './components/OverviewCard.jsx'
import TrashCard from './components/TrashCard.jsx'
import CleanupDialog from './components/dialogs/CleanupDialog.jsx'
import ConfirmDialog from './components/dialogs/ConfirmDialog.jsx'
import ReportDialog from './components/dialogs/ReportDialog.jsx'
import RestoreDialog from './components/dialogs/RestoreDialog.jsx'
import ReviewDialog from './components/dialogs/ReviewDialog.jsx'
import SetDateDialog from './components/dialogs/SetDateDialog.jsx'
import SettingsDialog from './components/dialogs/SettingsDialog.jsx'

export default function App() {
  const [state, setState] = useState(null)
  const [now, setNow] = useState(Date.now())
  const [trash, setTrash] = useState({ entries: [], selectAll: false })
  const [trashSelection, setTrashSelection] = useState(new Set())
  const [logLines, setLogLines] = useState([])
  const [expanded, setExpanded] = useState(new Set())

  const [confirmDialog, setConfirmDialog] = useState(null)
  const [reportDialog, setReportDialog] = useState(null)
  const [cleanupDialog, setCleanupDialog] = useState(null)
  const [setDateDialog, setSetDateDialog] = useState(null)
  const [restoreDialog, setRestoreDialog] = useState(null)
  const [reviewDialog, setReviewDialog] = useState(null)
  const [reviewBusy, setReviewBusy] = useState('')
  const [settingsDraft, setSettingsDraft] = useState(null)

  const notify = (message, tone = 'success') => showToast(message, tone)

  /* ---------- data ---------- */

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

  useEffect(() => {
    refresh()
    refreshTrash()
    refreshLog()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Live stats: refresh the state and activity log every five seconds.
  usePolling(() => {
    setNow(Date.now())
    refresh()
    refreshLog()
  }, 5000, { runImmediately: false })

  // Parked items appear asynchronously after processing; keep the review dialog fresh.
  const reviewOpen = Boolean(reviewDialog)
  usePolling(async () => {
    const { entries } = await getJson('api/review')
    setReviewDialog((current) => (current ? { ...current, entries } : current))
  }, 2000, { enabled: reviewOpen, runImmediately: false })

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

  const processNow = (folderName, files) => act(`api/process/${encodeURIComponent(folderName)}`, files ? { files } : {})
  const runSnapshot = (folderName) => act(`api/snapshot/${encodeURIComponent(folderName)}`)
  const fileAction = (folder, file, action, extra = {}) => act(`api/actions/${encodeURIComponent(folder)}/${encodeURIComponent(file)}`, { action, ...extra })
  const togglePaused = () => act('api/pause', { paused: !state.paused })
  const toggleDryRun = () => act('api/dry-run', { dryRun: !state.dryRun })

  const askConfirm = (title, text, confirmLabel, tone = 'danger') =>
    new Promise((resolve) => {
      setConfirmDialog({ title, text, confirmLabel, tone, resolve: (value) => { setConfirmDialog(null); resolve(value) } })
    })

  /* ---------- cleanup ---------- */

  const openCleanup = async (folderName) => {
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

  const runCleanup = async () => {
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

  const cleanupAll = async () => {
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

  const reviewFolders = (state?.folders ?? []).filter((folder) => folder.method === 'voicenotes' ? (folder.counts.review ?? 0) > 0 : (folder.placement === 'manual' || (folder.counts.review ?? 0) > 0))

  const openReview = async () => {
    try {
      const { entries, voicenotes } = await getJson('api/review')
      setReviewDialog({ entries, voicenotes })
    } catch (err) {
      notify(err.message, 'error')
    }
  }

  const approveVoiceNote = async (group) => {
    const key = `${group.folder}\u0000${group.chat}\u0000${group.date}`
    setReviewBusy(key)
    try {
      const result = await postJson('api/review/voicenotes/approve', {
        folder: group.folder,
        chat: group.chat,
        date: group.date,
      })
      notify(result?.alreadyPlaced ? 'Already merged; source clips moved to trash.' : 'Merged and moved to the destination.')
      await openReview()
      refresh()
      refreshTrash()
    } catch (err) {
      notify(`Approve failed: ${err.message}`, 'error')
    } finally {
      setReviewBusy('')
    }
  }

  const deleteVoiceNote = async (group) => {
    const label = `${group.chat || '(root)'} / ${group.date}`
    if (!(await askConfirm('Confirm', `Move ${group.count} voice note clip(s) for ${label} to trash?`, 'Delete'))) return
    const key = `${group.folder}\u0000${group.chat}\u0000${group.date}`
    setReviewBusy(key)
    try {
      await postJson('api/review/voicenotes/delete', {
        folder: group.folder,
        chat: group.chat,
        date: group.date,
      })
      notify('Voice note clips moved to trash.')
      await openReview()
      refresh()
      refreshTrash()
    } catch (err) {
      notify(`Delete failed: ${err.message}`, 'error')
    } finally {
      setReviewBusy('')
    }
  }

  const reviewAction = async (folder, id, place) => {
    const path = place ? 'api/review/place' : 'api/review/discard'
    if (!place && !(await askConfirm('Confirm', 'Discard this parked item?', 'Discard'))) return
    await postJson(path, { folder, id })
    await openReview()
    refresh()
  }

  const reviewActionAll = async (folder, place) => {
    const path = place ? 'api/review/place-all' : 'api/review/discard-all'
    if (!place && !(await askConfirm('Confirm', `Discard every parked item in ${folder}?`, 'Discard all'))) return
    await postJson(path, { folder })
    await openReview()
    refresh()
  }

  /* ---------- trash ---------- */

  const toggleTrashSelection = (key, checked) => {
    setTrashSelection((current) => {
      const next = new Set(current)
      if (checked) next.add(key)
      else next.delete(key)
      return next
    })
  }

  const selectAllTrash = (checked) => {
    const keys = trash.entries.flatMap((entry) => entry.files.slice(0, 300).map((file) => `${entry.day}/${file.name}`))
    setTrashSelection(checked ? new Set(keys) : new Set())
    setTrash({ ...trash, selectAll: checked })
  }

  const restoreFiles = async (items, targetDir) => {
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

  const restoreSelected = () => {
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

  const emptyTrash = async () => {
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

  const openSettings = () => setSettingsDraft(structuredClone(state.config))

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

  const saveSettings = async () => {
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

  /* ---------- render ---------- */
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
        <OverviewCard
          folderCount={state?.folders?.length ?? 0}
          totals={totals}
          trashCount={trashCount}
          onReview={openReview}
          onCleanupAll={cleanupAll}
        />

        <div className="folder-grid">
          {(state?.folders ?? []).map((folder) => (
            <FolderCard
              key={folder.name}
              folder={folder}
              run={state?.runs?.[folder.name] ?? null}
              dryRun={state?.dryRun}
              expanded={expanded}
              onToggleExpanded={(open) => {
                setExpanded((current) => {
                  const next = new Set(current)
                  if (open) next.add(folder.name)
                  else next.delete(folder.name)
                  return next
                })
              }}
              onRunSnapshot={() => runSnapshot(folder.name)}
              onProcessNow={() => processNow(folder.name)}
              onOpenReview={openReview}
              onOpenCleanup={() => openCleanup(folder.name)}
              onFileAction={(file, action) => fileAction(folder.name, file, action)}
              onSetDate={(file) => setSetDateDialog({ folder: folder.name, file, date: '', time: '00:00', error: '' })}
            />
          ))}
          {state && !state.folders.length ? (
            <section className="card"><p className="muted">No folders configured yet — open Settings to add one.</p></section>
          ) : null}
        </div>

        <div className="side-grid">
          <TrashCard
            trash={trash}
            trashSelection={trashSelection}
            retentionDays={state?.trashRetentionDays}
            onRefresh={refreshTrash}
            onSelectAll={selectAllTrash}
            onToggleSelection={toggleTrashSelection}
            onRestoreSelected={restoreSelected}
            onEmptyTrash={emptyTrash}
          />
          <ActivityCard logLines={logLines} onRefresh={refreshLog} />
        </div>
      </main>

      {cleanupDialog ? (
        <CleanupDialog
          dialog={cleanupDialog}
          onClose={() => setCleanupDialog(null)}
          onSelectAll={(checked) => setCleanupDialog((current) => ({ ...current, selected: checked ? new Set(current.files.map((file) => file.name)) : new Set() }))}
          onToggle={(name, checked) => setCleanupDialog((current) => {
            const next = new Set(current.selected)
            if (checked) next.add(name)
            else next.delete(name)
            return { ...current, selected: next }
          })}
          onMove={runCleanup}
        />
      ) : null}

      {setDateDialog ? (
        <SetDateDialog
          dialog={setDateDialog}
          onClose={() => setSetDateDialog(null)}
          setField={(patch) => setSetDateDialog((current) => ({ ...current, ...patch }))}
          onStandardize={async () => {
            if (!setDateDialog.date) {
              setSetDateDialog((current) => ({ ...current, error: 'Pick a date first.' }))
              return
            }
            const { folder, file, date, time } = setDateDialog
            setSetDateDialog(null)
            await fileAction(folder, file, 'setDate', { date: `${date} ${time || '00:00'}` })
            notify(`Standardizing ${file} with the chosen date.`)
          }}
        />
      ) : null}

      {restoreDialog ? (
        <RestoreDialog
          dialog={restoreDialog}
          onClose={() => setRestoreDialog(null)}
          onDirChange={(dir) => setRestoreDialog((current) => ({ ...current, dir }))}
          onRestore={async () => {
            if (!restoreDialog.dir.trim()) {
              setRestoreDialog((current) => ({ ...current, error: 'Enter a directory first.' }))
              return
            }
            const { items, dir } = restoreDialog
            setRestoreDialog(null)
            await restoreFiles(items, dir.trim())
          }}
        />
      ) : null}

      {reviewDialog ? (
        <ReviewDialog
          entries={reviewDialog.entries}
          reviewFolders={reviewFolders}
          voicenotes={reviewDialog.voicenotes ?? []}
          busy={reviewBusy}
          onApproveVoiceNote={approveVoiceNote}
          onDeleteVoiceNote={deleteVoiceNote}
          onReviewAction={reviewAction}
          onReviewActionAll={reviewActionAll}
          onClose={() => setReviewDialog(null)}
        />
      ) : null}

      {settingsDraft ? (
        <SettingsDialog
          draft={settingsDraft}
          updateDraft={updateDraft}
          addFolder={addFolder}
          saveSettings={saveSettings}
          onClose={() => setSettingsDraft(null)}
        />
      ) : null}

      {confirmDialog ? (
        <ConfirmDialog
          title={confirmDialog.title}
          text={confirmDialog.text}
          confirmLabel={confirmDialog.confirmLabel}
          tone={confirmDialog.tone}
          onResolve={(value) => confirmDialog.resolve(value)}
          onClose={() => confirmDialog.resolve(false)}
        />
      ) : null}

      {reportDialog ? <ReportDialog entries={reportDialog.entries} onClose={() => setReportDialog(null)} /> : null}

      <Toasts />
    </>
  )
}
