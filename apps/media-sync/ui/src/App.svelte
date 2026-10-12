<script>
  import { onMount } from 'svelte'
  import { CalendarDays, Import, Pause, Play, RefreshCw, Settings, FlaskConical, Wrench, X } from 'lucide-svelte'
  import { apiUrl, formatBytes, formatDateTime, formatDuration, formatTime, getJson, postJson, putJson, showToast, ThemeToggle, Toasts } from '@dscpln/ui-kit'

  const STATUS_RANK = { error: 0, conflict: 1, queued: 2, processing: 3, pending: 4, review: 5, done: 6, duplicate: 7, discarded: 8, cleaned: 9, ignored: 10 }
  const METHOD_LABEL = { standardize: 'standardize', snapchat: 'snapchat', copy: 'copy', voicenotes: 'voicenotes' }
  const FILE_LIMIT = 300

  let state = $state(null)
  let now = $state(Date.now())
  let confirmDialog = $state(null)
  let reportDialog = $state(null)
  let cleanupDialog = $state(null)
  let setDateDialog = $state(null)
  let restoreDialog = $state(null)
  let reviewDialog = $state(null)
  let settingsDraft = $state(null)
  let expanded = $state(new Set())
  let trash = $state({ entries: [], selectAll: false })
  let trashSelection = $state(new Set())
  let logLines = $state([])

  const notify = (message, tone = 'success') => showToast(message, tone)

  async function refresh() {
    try {
      state = await getJson('api/state')
    } catch (err) {
      notify(`Could not load state: ${err.message}`, 'error')
    }
  }

  async function refreshTrash() {
    try {
      const { entries } = await getJson('api/trash')
      trash = { entries, selectAll: false }
      trashSelection = new Set()
    } catch {
      // keep the last list
    }
  }

  async function refreshLog() {
    try {
      const { lines } = await getJson('api/log?limit=200')
      logLines = lines ?? []
    } catch {
      // keep the last log
    }
  }

  const totals = $derived.by(() => {
    const counters = { pending: 0, processing: 0, processed: 0, issues: 0 }
    for (const folder of state?.folders ?? []) {
      const counts = folder.counts ?? {}
      counters.pending += counts.pending ?? 0
      counters.processing += (counts.queued ?? 0) + (counts.processing ?? 0)
      counters.processed += (counts.done ?? 0) + (counts.duplicate ?? 0)
      counters.issues += (counts.error ?? 0) + (counts.conflict ?? 0)
    }
    return counters
  })

  const trashCount = $derived((trash.entries ?? []).reduce((sum, entry) => sum + (entry.count ?? 0), 0))
  const statusText = $derived(state?.paused ? 'paused' : state?.dryRun ? 'dry run' : 'live')
  const statusTone = $derived(state?.paused ? 'paused' : state?.dryRun ? 'dry' : 'live')

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

  async function act(path, body = {}) {
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
  const fileAction = (folder, file, action, extra = {}) => act(`api/actions/${encodeURIComponent(folder)}/${encodeURIComponent(file)}`, { action, ...extra })
  const togglePaused = () => act('api/pause', { paused: !state.paused })
  const toggleDryRun = () => act('api/dry-run', { dryRun: !state.dryRun })

  function askConfirm(title, text, confirmLabel, tone = 'danger') {
    return new Promise((resolve) => {
      confirmDialog = { title, text, confirmLabel, tone, resolve: (value) => { confirmDialog = null; resolve(value) } }
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
      cleanupDialog = { folder: folderName, files: preview.files, totalBytes: preview.totalBytes, selected: new Set(preview.files.map((file) => file.name)) }
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
    cleanupDialog = null
    try {
      const { results } = await postJson(`api/cleanup/${encodeURIComponent(folder)}`, { names })
      const failed = results.filter((result) => !result.ok)
      notify(`Moved ${results.length - failed.length} file(s) to trash.`, failed.length ? 'error' : 'success')
      if (failed.length) reportDialog = { entries: failed }
    } catch (err) {
      notify(`Cleanup failed: ${err.message}`, 'error')
    }
    refresh()
    refreshTrash()
  }

  async function cleanupAll() {
    if (!(await askConfirm('Confirm', `Move ${totals.processed} processed original(s) to trash? Destination copies are verified first.`, 'Cleanup all'))) return
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

  async function openReview() {
    try {
      const { entries } = await getJson('api/review')
      const selectedGroups = new Set()
      for (const folder of state?.folders ?? []) {
        if (folder.method === 'voicenotes') {
          for (const group of reviewGroups(folder)) selectedGroups.add(group.key)
        }
      }
      reviewDialog = { entries, selectedGroups }
    } catch (err) {
      notify(err.message, 'error')
    }
  }

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

  const reviewFolders = $derived(
    (state?.folders ?? []).filter((folder) => folder.placement === 'manual' || (folder.counts.review ?? 0) > 0),
  )

  function toggleGroup(key, checked) {
    if (checked) reviewDialog.selectedGroups.add(key)
    else reviewDialog.selectedGroups.delete(key)
    reviewDialog = reviewDialog
  }

  async function processSelectedGroups(folder) {
    const groups = reviewGroups(folder).filter((group) => reviewDialog.selectedGroups.has(group.key))
    if (!groups.length) {
      notify('No groups selected.', 'error')
      return
    }
    await processNow(folder.name, groups.flatMap((group) => group.files))
    const { entries } = await getJson('api/review')
    reviewDialog = { ...reviewDialog, entries }
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

  function trashKey(day, name) {
    return `${day}/${name}`
  }

  function toggleTrashSelection(key, checked) {
    if (checked) trashSelection.add(key)
    else trashSelection.delete(key)
    trashSelection = trashSelection
    trash = trash
  }

  function selectAllTrash(checked) {
    const keys = trash.entries.flatMap((entry) => entry.files.slice(0, 300).map((file) => trashKey(entry.day, file.name)))
    trashSelection = checked ? new Set(keys) : new Set()
    trash = { ...trash, selectAll: checked }
  }

  async function restoreFiles(items, targetDir) {
    try {
      const { results } = await postJson('api/trash/restore', { files: items, targetDir: targetDir || null })
      const failed = results.filter((result) => !result.ok)
      notify(`Restored ${results.length - failed.length} file(s).`, failed.length ? 'error' : 'success')
      if (failed.length) reportDialog = { entries: failed.map((file) => ({ name: file.name, reason: file.reason })) }
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
    restoreDialog = { items, dir: '', error: '' }
  }

  async function emptyTrash() {
    if (!(await askConfirm('Confirm', 'Permanently delete every trashed file?', 'Empty trash'))) return
    await postJson('api/trash/empty', {})
    await refreshTrash()
    refreshLog()
  }

  /* ---------- settings ---------- */

  function openSettings() {
    settingsDraft = structuredClone($state.snapshot(state.config))
  }

  function addFolder() {
    settingsDraft.folders = [...settingsDraft.folders, {
      name: '', source: '', destination: '', method: 'standardize', settleSeconds: 60,
      groupWindowSeconds: 15, placement: 'auto', onChanged: 'overwrite', notify: 'all',
    }]
  }

  async function saveSettings() {
    const config = $state.snapshot(settingsDraft)
    config.concurrency = Number(config.concurrency)
    config.trashRetentionDays = Number(config.trashRetentionDays)
    config.settleSeconds = Number(config.settleSeconds)
    for (const folder of config.folders) {
      folder.settleSeconds = Number(folder.settleSeconds)
      folder.groupWindowSeconds = Number(folder.groupWindowSeconds)
      folder.filePattern ||= null
      if (folder.method === 'voicenotes') folder.recursive = true
      if (folder.method === 'copy') folder.placement = 'auto'
    }
    try {
      await putJson('api/config', config)
      settingsDraft = null
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
    if (open) expanded.add(name)
    else expanded.delete(name)
    expanded = expanded
  }

  onMount(() => {
    refresh()
    refreshTrash()
    refreshLog()
    const timer = setInterval(() => {
      now = Date.now()
      refresh()
      refreshLog()
    }, 5000)
    return () => clearInterval(timer)
  })

  // Parked items appear asynchronously after processing; keep the review dialog fresh.
  $effect(() => {
    if (!reviewDialog) return
    const timer = setInterval(async () => {
      try {
        const { entries } = await getJson('api/review')
        if (reviewDialog) reviewDialog = { ...reviewDialog, entries }
      } catch {
        // keep the last list
      }
    }, 2000)
    return () => clearInterval(timer)
  })
</script>

<header class="app-header">
  <div class="app-header__top">
    <h1>D<span class="accent">$</span>CPLN <span class="app-header__app">⋅ Media Sync</span></h1>
    <div class="app-header__actions">
      <button class="outline secondary icon-button" title={state?.paused ? 'Resume processing' : 'Pause processing'} aria-label="Pause/Resume" onclick={togglePaused}>
        {#if state?.paused}<Play size={16} strokeWidth={1.8} />{:else}<Pause size={16} strokeWidth={1.8} />{/if}
      </button>
      <button class="outline secondary icon-button" title="Toggle dry-run mode" aria-label="Toggle dry-run mode" onclick={toggleDryRun}>
        <FlaskConical size={16} strokeWidth={1.8} />
      </button>
      <button class="outline secondary icon-button" title="Settings" aria-label="Settings" onclick={openSettings}>
        <Settings size={16} strokeWidth={1.8} />
      </button>
      <button class="outline secondary icon-button" title="Refresh" aria-label="Refresh" onclick={() => { refresh(); refreshTrash(); refreshLog() }}>
        <RefreshCw size={16} strokeWidth={1.8} />
      </button>
      <ThemeToggle />
    </div>
  </div>
  <div class="app-header__meta">
    <span class={`status-tag status-tag--${statusTone}`}><span>{statusText}</span></span>
    <span class="app-header__meta-tools">
      <span class="muted">{totals.pending} pending · {totals.issues} issue{totals.issues === 1 ? '' : 's'}</span>
      <span class="muted">{state ? `updated ${formatTime(now)}` : ''}</span>
    </span>
  </div>
</header>

<main>
  <section class="card card--hero" id="overviewCard" aria-labelledby="overviewHeading">
    <div class="card__header">
      <h2 id="overviewHeading">Overview</h2>
      <span class="card__header-tools">
        <span class="card__context">{state?.folders?.length ?? 0} folder{state?.folders?.length === 1 ? '' : 's'} watched</span>
      </span>
    </div>
    <div class="overview__grid">
      <div class="stat-tile">
        <span class="stat-tile__label">Pending</span>
        <span class="stat-tile__value">{totals.pending}</span>
      </div>
      <div class="stat-tile">
        <span class="stat-tile__label">Processing</span>
        <span class="stat-tile__value">{totals.processing}</span>
      </div>
      <div class="stat-tile">
        <span class="stat-tile__label">Processed</span>
        <span class="stat-tile__value">{totals.processed}</span>
      </div>
      <div class="stat-tile">
        <span class="stat-tile__label">Issues</span>
        <span class="stat-tile__value" class:is-over={totals.issues > 0}>{totals.issues}</span>
      </div>
      <div class="stat-tile">
        <span class="stat-tile__label">Trash</span>
        <span class="stat-tile__value">{trashCount}</span>
      </div>
    </div>
    <div class="overview__actions">
      <button class="outline secondary" onclick={openReview}>Review</button>
      <button disabled={!totals.processed} onclick={cleanupAll}>Cleanup all{totals.processed ? ` (${totals.processed})` : ''}</button>
    </div>
  </section>

  <div class="folder-grid">
    {#each state?.folders ?? [] as folder (folder.name)}
      {@const stats = folderStats(folder)}
      <section class="card folder-card" class:card--over={folder.counts.conflict} class:card--warn={!folder.counts.conflict && stats.issues}>
        <div class="card__header">
          <div class="folder-title">
            <h2>{folder.name}</h2>
            <span class="method-badge">{METHOD_LABEL[folder.method] ?? folder.method}</span>
            {#if !folder.exists}<span class="status-tag status-tag--interrupted"><span>source unavailable</span></span>{/if}
          </div>
          <span class="card__context">{folderContext(folder)}</span>
        </div>

        <p class="figure">
          <span class="figure__spend">{stats.pending}</span>
          <span class="figure__meta">
            <span class="figure__of">pending of</span>
            <span class="figure__budget">{stats.total} file{stats.total === 1 ? '' : 's'}</span>
          </span>
        </p>

        <div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow={stats.percent}>
          <div class="progress__fill" style={`width: ${stats.percent}%`}></div>
        </div>

        <p class="pace">
          {#if folder.lastEventAt}last change {formatDateTime(folder.lastEventAt)} · {/if}{stats.processed} processed{#if stats.ignored > 0} · {stats.ignored} ignored{/if}
        </p>

        <div class="stat-tiles">
          <div class="stat-tile"><span class="stat-tile__label">pending</span><span class="stat-tile__value">{stats.pending}</span></div>
          <div class="stat-tile"><span class="stat-tile__label">processing</span><span class="stat-tile__value">{stats.processing}</span></div>
          <div class="stat-tile"><span class="stat-tile__label">processed</span><span class="stat-tile__value">{stats.processed}</span></div>
          <div class="stat-tile"><span class="stat-tile__label">issues</span><span class="stat-tile__value" class:is-over={stats.issues > 0}>{stats.issues}</span></div>
        </div>

        <p class="folder-paths">
          <code>{folder.source}</code>
          <span class="folder-paths__arrow">→</span>
          <code>{folder.destination}</code>
        </p>

        <div class="folder-card__actions">
          <button class="outline secondary" onclick={() => processNow(folder.name)}>Process now</button>
          {#if folder.placement === 'manual' || stats.review > 0}
            <button class={stats.review > 0 ? '' : 'outline secondary'} onclick={openReview}>
              Review{stats.review > 0 ? ` (${stats.review})` : ''}
            </button>
          {/if}
          {#if stats.processed > 0 && folder.cleanup !== false}
            <button onclick={() => openCleanup(folder.name)}>Cleanup {stats.processed}</button>
          {/if}
        </div>

        <details open={expanded.has(folder.name)} ontoggle={(event) => toggleExpanded(folder.name, event.target.open)}>
          <summary>Files · {folder.files.length}</summary>
          {#if !folder.files.length}
            <p class="muted files-empty">No files in this folder right now.</p>
          {:else}
            <ul class="files__list">
              {#each sortedFiles(folder) as file (file.name)}
                <li class={`file file--${file.status}`}>
                  <div class="file__main">
                    <span class="file__name">{file.name}</span>
                    {#if file.message || file.attempts || file.destName}
                      <span class="file__notes">
                        {[file.message, file.attempts ? `attempt ${file.attempts}` : null, file.destName ? `→ ${file.destName}` : null].filter(Boolean).join(' · ')}
                      </span>
                    {/if}
                  </div>
                  <div class="file__meta">
                    <span class="file__size">{formatBytes(file.size)}</span>
                    <span class="file__date">{formatDateTime(file.mtimeMs)}</span>
                    <span class={`pill pill--${file.status === 'done' ? 'ok' : file.status === 'error' ? 'fail' : file.status === 'conflict' ? 'neutral' : 'running'}`}>{file.status}</span>
                  </div>
                  <div class="file__actions">
                    {#if file.status === 'error' || file.status === 'conflict'}
                      <button class="outline secondary icon-button icon-button--small" title="Retry" aria-label={`Retry ${file.name}`} onclick={() => fileAction(folder.name, file.name, 'retry')}>
                        <RefreshCw size={14} strokeWidth={1.8} />
                      </button>
                    {/if}
                    {#if file.status === 'error'}
                      <button class="outline secondary icon-button icon-button--small" title="Repair (ffmpeg remux)" aria-label={`Repair ${file.name}`} onclick={() => fileAction(folder.name, file.name, 'repair')}>
                        <Wrench size={14} strokeWidth={1.8} />
                      </button>
                      <button class="outline secondary icon-button icon-button--small" title="Set date and retry" aria-label={`Set date for ${file.name}`} onclick={() => (setDateDialog = { folder: folder.name, file: file.name, date: '', time: '00:00', error: '' })}>
                        <CalendarDays size={14} strokeWidth={1.8} />
                      </button>
                    {/if}
                    {#if file.status === 'error' || file.status === 'conflict' || file.status === 'pending'}
                      <button class="outline secondary icon-button icon-button--small" title="Import as-is" aria-label={`Import ${file.name} as-is`} onclick={() => fileAction(folder.name, file.name, 'import')}>
                        <Import size={14} strokeWidth={1.8} />
                      </button>
                    {/if}
                  </div>
                </li>
              {/each}
            </ul>
            {#if folder.files.length > FILE_LIMIT}
              <p class="muted files-empty">… and {folder.files.length - FILE_LIMIT} more file(s)</p>
            {/if}
          {/if}
        </details>
      </section>
    {/each}
    {#if state && !state.folders.length}
      <section class="card"><p class="muted">No folders configured yet — open Settings to add one.</p></section>
    {/if}
  </div>

  <div class="side-grid">
    <section class="card" id="trashCard" aria-labelledby="trashHeading">
      <div class="card__header">
        <h2 id="trashHeading">Trash</h2>
        <span class="card__header-tools">
          <span class="card__context">{trash.entries.length} day(s) · keeping {state?.trashRetentionDays} days</span>
          <button class="outline secondary icon-button" title="Refresh trash" aria-label="Refresh trash" onclick={refreshTrash}>
            <RefreshCw size={16} strokeWidth={1.8} />
          </button>
        </span>
      </div>
      {#if trash.entries.length}
        <label class="checklist__row">
          <input type="checkbox" checked={trash.selectAll} onchange={(event) => selectAllTrash(event.target.checked)} />
          <span class="checklist__main">Select all</span>
        </label>
        <div class="trash__list">
          {#each trash.entries as entry (entry.day)}
            <details>
              <summary>{entry.day} · {entry.count} file(s) · {formatBytes(entry.bytes)}</summary>
              {#each entry.files.slice(0, 300) as file (file.name)}
                {@const key = trashKey(entry.day, file.name)}
                <label class="checklist__row">
                  <input type="checkbox" checked={trashSelection.has(key)} onchange={(event) => toggleTrashSelection(key, event.target.checked)} />
                  <span class="checklist__main">{file.name}</span>
                  <span class="checklist__meta">{formatBytes(file.size)} · {file.folder ?? file.sourceDir ?? 'origin unknown'}</span>
                </label>
              {/each}
              {#if entry.count > 300}<p class="muted files-empty">… and {entry.count - 300} more</p>{/if}
            </details>
          {/each}
        </div>
      {:else}
        <p class="muted files-empty">Trash is empty.</p>
      {/if}
      <div class="trash-actions">
        {#if trashSelection.size}
          <button onclick={restoreSelected}>Restore selected ({trashSelection.size})</button>
        {/if}
        {#if trash.entries.length}
          <button class="danger" onclick={emptyTrash}>Empty trash</button>
        {/if}
      </div>
    </section>

    <section class="card" id="activityCard" aria-labelledby="activityHeading">
      <div class="card__header">
        <h2 id="activityHeading">Activity</h2>
        <span class="card__header-tools">
          <button class="outline secondary icon-button" title="Refresh log" aria-label="Refresh log" onclick={refreshLog}>
            <RefreshCw size={16} strokeWidth={1.8} />
          </button>
        </span>
      </div>
      <pre class="code-block activity-log">{logLines.join('\n') || 'No activity yet.'}</pre>
    </section>
  </div>
</main>

<!-- cleanup -->
{#if cleanupDialog}
  <dialog open class="wide-dialog">
    <article>
      <header class="card__header">
        <h2>Cleanup {cleanupDialog.folder}</h2>
        <span class="card__header-tools">
          <button class="outline secondary icon-button" aria-label="Close" onclick={() => (cleanupDialog = null)}>&times;</button>
        </span>
      </header>
      <p class="hint">{cleanupDialog.files.length} processed file(s), {formatBytes(cleanupDialog.totalBytes)}. Each destination copy is verified before the original is moved to trash.</p>
      <label class="checklist__row">
        <input type="checkbox" checked={cleanupDialog.selected.size === cleanupDialog.files.length}
          onchange={(event) => (cleanupDialog.selected = event.target.checked ? new Set(cleanupDialog.files.map((file) => file.name)) : new Set())} />
        <span class="checklist__main">Select all</span>
      </label>
      <div class="checklist">
        {#each cleanupDialog.files as file (file.name)}
          <label class="checklist__row">
            <input type="checkbox" checked={cleanupDialog.selected.has(file.name)}
              onchange={(event) => {
                if (event.target.checked) cleanupDialog.selected.add(file.name)
                else cleanupDialog.selected.delete(file.name)
                cleanupDialog = cleanupDialog
              }} />
            <span class="checklist__main">{file.name}</span>
            <span class="checklist__meta">{file.destName ? `→ ${file.destName}` : ''}</span>
          </label>
        {/each}
      </div>
      <div class="dialog-actions">
        <button class="outline secondary" onclick={() => (cleanupDialog = null)}>Cancel</button>
        <button class="danger" onclick={runCleanup}>Move to trash</button>
      </div>
    </article>
  </dialog>
{/if}

<!-- set date -->
{#if setDateDialog}
  <dialog open class="narrow-dialog">
    <article>
      <header class="card__header">
        <h2>Set date</h2>
        <span class="card__header-tools">
          <button class="outline secondary icon-button" aria-label="Close" onclick={() => (setDateDialog = null)}>&times;</button>
        </span>
      </header>
      <p class="hint">The copy will be standardized with this date and placed in the destination.</p>
      <div class="native-fields">
        <label class="native-field">
          <span class="field__label">Date</span>
          <input type="date" required value={setDateDialog.date} oninput={(event) => (setDateDialog.date = event.target.value)} />
        </label>
        <label class="native-field">
          <span class="field__label">Time</span>
          <input type="time" value={setDateDialog.time} oninput={(event) => (setDateDialog.time = event.target.value)} />
        </label>
      </div>
      {#if setDateDialog.error}<p class="form-error">{setDateDialog.error}</p>{/if}
      <div class="dialog-actions">
        <button class="outline secondary" onclick={() => (setDateDialog = null)}>Cancel</button>
        <button onclick={async () => {
          if (!setDateDialog.date) { setDateDialog.error = 'Pick a date first.'; return }
          const { folder, file, date, time } = setDateDialog
          setDateDialog = null
          await fileAction(folder, file, 'setDate', { date: `${date} ${time || '00:00'}` })
          notify(`Standardizing ${file} with the chosen date.`)
        }}>Standardize</button>
      </div>
    </article>
  </dialog>
{/if}

<!-- restore -->
{#if restoreDialog}
  <dialog open class="narrow-dialog">
    <article>
      <header class="card__header">
        <h2>Restore files</h2>
        <span class="card__header-tools">
          <button class="outline secondary icon-button" aria-label="Close" onclick={() => (restoreDialog = null)}>&times;</button>
        </span>
      </header>
      <p class="hint">Files with a recorded origin return to their original folder. Files without one are restored to the directory you enter here.</p>
      <div class="native-fields">
        <label class="native-field">
          <span class="field__label">Restore directory</span>
          <input type="text" placeholder="/path/to/folder" autocomplete="off" value={restoreDialog.dir} oninput={(event) => (restoreDialog.dir = event.target.value)} />
        </label>
      </div>
      {#if restoreDialog.error}<p class="form-error">{restoreDialog.error}</p>{/if}
      <div class="dialog-actions">
        <button class="outline secondary" onclick={() => (restoreDialog = null)}>Cancel</button>
        <button onclick={async () => {
          if (!restoreDialog.dir.trim()) { restoreDialog.error = 'Enter a directory first.'; return }
          const { items, dir } = restoreDialog
          restoreDialog = null
          await restoreFiles(items, dir.trim())
        }}>Restore</button>
      </div>
    </article>
  </dialog>
{/if}

<!-- review -->
{#if reviewDialog}
  <dialog open data-testid="review-dialog" class="wide-dialog">
    <article>
      <header class="card__header">
        <h2>Review</h2>
        <span class="card__header-tools">
          <button class="outline secondary icon-button" aria-label="Close" onclick={() => (reviewDialog = null)}>&times;</button>
        </span>
      </header>
      <p class="hint">Manual folders prepare files here without writing to the destination. Place the ones you want to keep, or discard the rest — nothing is written until you place it.</p>
      {#if !reviewFolders.length}
        <p class="muted">Nothing awaiting review.</p>
      {/if}
      {#each reviewFolders as folder (folder.name)}
        {@const parked = reviewDialog.entries.filter((entry) => entry.folder === folder.name)}
        {@const groups = folder.method === 'voicenotes' ? reviewGroups(folder) : []}
        {#if parked.length || groups.length}
          <section class="review-section">
            <h3>{folder.name}</h3>
            {#if groups.length}
              <div class="review-groups">
                {#each groups as group (group.key)}
                  <label class="checklist__row">
                    <input type="checkbox" checked={reviewDialog.selectedGroups.has(group.key)} onchange={(event) => toggleGroup(group.key, event.target.checked)} />
                    <span class="checklist__main">{group.chat || '(root)'} · {group.date} · {group.files.length} clip{group.files.length === 1 ? '' : 's'}</span>
                    <span class="checklist__meta">{formatBytes(group.bytes)}</span>
                  </label>
                {/each}
              </div>
              <div class="folder-card__actions">
                <button onclick={() => processSelectedGroups(folder)}>Process selected</button>
              </div>
            {/if}
            {#each parked as entry (entry.id)}
              <div class="review-row">
                <div class="review-row__main">
                  <span class="checklist__main">{entry.destName}</span>
                  <span class="checklist__meta">
                    {entry.chat || '(root)'} · {entry.inputs.length} input{entry.inputs.length === 1 ? '' : 's'} · {formatBytes(entry.size)}{entry.missingInputs?.length ? ` · ${entry.missingInputs.length} source(s) gone` : ''}
                  </span>
                </div>
                <audio controls preload="none" src={apiUrl(`api/review/file/${encodeURIComponent(folder.name)}/${encodeURIComponent(entry.id)}`)}></audio>
                <div class="review-row__actions">
                  <button onclick={() => reviewAction(folder.name, entry.id, true)}>Place</button>
                  <button class="outline secondary" onclick={() => reviewAction(folder.name, entry.id, false)}>Discard</button>
                </div>
              </div>
            {/each}
            {#if parked.length > 1}
              <div class="folder-card__actions">
                <button onclick={() => reviewActionAll(folder.name, true)}>Place all ({parked.length})</button>
                <button class="outline secondary" onclick={() => reviewActionAll(folder.name, false)}>Discard all</button>
              </div>
            {/if}
          </section>
        {/if}
      {/each}
      <div class="dialog-actions">
        <button class="outline secondary" onclick={() => (reviewDialog = null)}>Close</button>
      </div>
    </article>
  </dialog>
{/if}

<!-- settings -->
{#if settingsDraft}
  <dialog open data-testid="settings-dialog" class="wide-dialog">
    <article>
      <header class="card__header">
        <h2>Settings</h2>
        <span class="card__header-tools">
          <button class="outline secondary icon-button" aria-label="Close" onclick={() => (settingsDraft = null)}>&times;</button>
        </span>
      </header>
      <p class="hint">Changes are written back to the config file and applied immediately. The bind host and port are fixed at deploy time.</p>

      <div class="form-grid">
        <div class="field"><span class="field__label">Concurrency</span><input type="number" value={settingsDraft.concurrency} oninput={(event) => (settingsDraft.concurrency = event.target.value)} /></div>
        <div class="field"><span class="field__label">Trash retention (days)</span><input type="number" value={settingsDraft.trashRetentionDays} oninput={(event) => (settingsDraft.trashRetentionDays = event.target.value)} /></div>
        <div class="field"><span class="field__label">Default settle (s)</span><input type="number" value={settingsDraft.settleSeconds} oninput={(event) => (settingsDraft.settleSeconds = event.target.value)} /></div>
        <div class="field"><span class="field__label">ntfy URL</span><input value={settingsDraft.ntfy?.url ?? ''} oninput={(event) => (settingsDraft.ntfy.url = event.target.value)} /></div>
        <div class="field"><span class="field__label">ntfy token</span><input type="password" value={settingsDraft.ntfy?.token ?? ''} oninput={(event) => (settingsDraft.ntfy.token = event.target.value)} /></div>
      </div>
      <div class="form-grid field-grid--checks">
        <label><input type="checkbox" checked={settingsDraft.ntfy?.notifySuccess !== false} onchange={(event) => (settingsDraft.ntfy.notifySuccess = event.target.checked)} /> Notify when files are processed successfully</label>
      </div>
      <div class="form-grid">
        <div class="field"><span class="field__label">Staging directory</span><input value={settingsDraft.stagingDir} oninput={(event) => (settingsDraft.stagingDir = event.target.value)} /></div>
        <div class="field"><span class="field__label">Review directory</span><input value={settingsDraft.reviewDir} oninput={(event) => (settingsDraft.reviewDir = event.target.value)} /></div>
        <div class="field"><span class="field__label">Trash directory</span><input value={settingsDraft.trashDir} oninput={(event) => (settingsDraft.trashDir = event.target.value)} /></div>
      </div>
      <div class="form-grid">
        <div class="field field--wide">
          <button class="outline secondary" onclick={sendTestNotification}>Send test notification</button>
        </div>
      </div>

      <h3 class="settings-section">Folders</h3>
      {#each settingsDraft.folders as folder, index (index)}
        <div class="folder-edit">
          <div class="folder-edit__head">
            <h3>{folder.name || 'New folder'}</h3>
            <button class="outline secondary icon-button icon-button--small" title="Remove this folder" aria-label="Remove this folder"
              onclick={() => (settingsDraft.folders = settingsDraft.folders.filter((_, i) => i !== index))}>
              <X size={14} strokeWidth={1.8} />
            </button>
          </div>
          <div class="form-grid">
            <div class="field"><span class="field__label">Name</span><input value={folder.name} oninput={(event) => (folder.name = event.target.value)} /></div>
            <div class="field"><span class="field__label">Source</span><input value={folder.source} oninput={(event) => (folder.source = event.target.value)} /></div>
            <div class="field"><span class="field__label">Destination</span><input value={folder.destination} oninput={(event) => (folder.destination = event.target.value)} /></div>
            <div class="field"><span class="field__label">Method</span>
              <select value={folder.method} onchange={(event) => (folder.method = event.target.value)}>
                {#each ['standardize', 'snapchat', 'copy', 'voicenotes'] as method}<option value={method}>{method}</option>{/each}
              </select>
            </div>
            <div class="field"><span class="field__label">Settle (s)</span><input type="number" value={folder.settleSeconds ?? 60} oninput={(event) => (folder.settleSeconds = event.target.value)} /></div>
            <div class="field"><span class="field__label">Group window (s)</span><input type="number" value={folder.groupWindowSeconds ?? 15} oninput={(event) => (folder.groupWindowSeconds = event.target.value)} /></div>
            <div class="field"><span class="field__label">File pattern</span><input value={folder.filePattern ?? ''} oninput={(event) => (folder.filePattern = event.target.value)} /></div>
          </div>
          <div class="form-grid field-grid--checks">
            <label><input type="checkbox" checked={folder.recursive === true} onchange={(event) => (folder.recursive = event.target.checked)} /> Recursive (mirror subdirectories)</label>
            <label><input type="checkbox" checked={folder.includeHidden === true} onchange={(event) => (folder.includeHidden = event.target.checked)} /> Include hidden files</label>
            <label><input type="checkbox" checked={folder.cleanup !== false} onchange={(event) => (folder.cleanup = event.target.checked)} /> Allow cleanup of processed originals</label>
            <label><input type="checkbox" checked={folder.autoProcess === true} onchange={(event) => (folder.autoProcess = event.target.checked)} /> Prepare new files automatically (manual review)</label>
          </div>
          <div class="form-grid">
            <div class="field"><span class="field__label">Placement</span>
              <select value={folder.placement ?? 'auto'} onchange={(event) => (folder.placement = event.target.value)}>
                <option value="auto">auto</option><option value="manual">manual</option>
              </select>
            </div>
            <div class="field"><span class="field__label">On change</span>
              <select value={folder.onChanged ?? 'overwrite'} onchange={(event) => (folder.onChanged = event.target.value)}>
                <option value="overwrite">overwrite</option><option value="conflict">conflict</option>
              </select>
            </div>
            <div class="field"><span class="field__label">Notify on success</span>
              <select value={folder.notify ?? 'all'} onchange={(event) => (folder.notify = event.target.value)}>
                <option value="all">all</option><option value="errors">errors</option>
              </select>
            </div>
            <div class="field"><span class="field__label">Date pattern (voicenotes)</span><input value={folder.datePattern ?? ''} oninput={(event) => (folder.datePattern = event.target.value)} /></div>
          </div>
        </div>
      {/each}
      <div class="folder-card__actions">
        <button class="outline secondary" onclick={addFolder}>Add folder</button>
      </div>

      <div class="dialog-actions">
        <button class="outline secondary" onclick={() => (settingsDraft = null)}>Cancel</button>
        <button onclick={saveSettings}>Save</button>
      </div>
    </article>
  </dialog>
{/if}

<!-- confirm -->
{#if confirmDialog}
  <dialog open data-testid="confirm-dialog" class="narrow-dialog">
    <article>
      <header class="card__header"><h2>{confirmDialog.title}</h2></header>
      <p class="muted">{confirmDialog.text}</p>
      <div class="dialog-actions">
        <button class="outline secondary" onclick={() => confirmDialog.resolve(false)}>Cancel</button>
        <button class={confirmDialog.tone === 'danger' ? 'danger' : ''} onclick={() => confirmDialog.resolve(true)}>{confirmDialog.confirmLabel}</button>
      </div>
    </article>
  </dialog>
{/if}

<!-- report -->
{#if reportDialog}
  <dialog open class="wide-dialog">
    <article>
      <header class="card__header"><h2>Report</h2></header>
      <div class="checklist">
        {#each reportDialog.entries as entry (entry.name + (entry.reason ?? ''))}
          <div class="checklist__row">
            <span class="checklist__main">{entry.name}</span>
            <span class="checklist__meta"><span class="msg error">{entry.reason ?? ''}</span></span>
          </div>
        {/each}
      </div>
      <div class="dialog-actions">
        <button onclick={() => (reportDialog = null)}>Close</button>
      </div>
    </article>
  </dialog>
{/if}

<Toasts />
