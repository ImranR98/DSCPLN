<script>
  import { onMount } from 'svelte'
  import { Play, Pause, Settings, RefreshCw, FlaskConical } from 'lucide-svelte'
  import { apiUrl, formatBytes, formatDateTime, formatDuration, formatTime, getJson, postJson, putJson, ThemeToggle, LogDialog } from '@dscpln/ui-kit'

  const STATUS_VARIANT = {
    pending: 'secondary', queued: 'primary', processing: 'primary', review: 'primary',
    done: 'success', duplicate: 'secondary', error: 'danger', conflict: 'warning',
    discarded: 'secondary', ignored: 'secondary', cleaned: 'secondary',
  }
  const STATUS_RANK = { error: 0, conflict: 1, queued: 2, processing: 3, pending: 4, review: 5, done: 6, duplicate: 7, discarded: 8, cleaned: 9, ignored: 10 }
  const FILE_LIMIT = 300

  let state = $state(null)
  let toasts = $state([])
  let toastId = 0
  let confirmDialog = $state(null) // { title, text, confirmLabel, resolve }
  let reportDialog = $state(null) // { title, entries }
  let cleanupDialog = $state(null) // { folder, files, totalBytes, selected:Set }
  let setDateDialog = $state(null) // { folder, file, date, time, error }
  let restoreDialog = $state(null) // { items, dir, error }
  let reviewDialog = $state(null) // { entries, selectedGroups:Set }
  let settingsDraft = $state(null)
  let logDialog = $state(null)
  let trashDialog = $state(null)
  let expanded = $state(new Set())
  let trashSelection = $state(new Set())

  function notify(message, tone = 'success') {
    const id = ++toastId
    toasts = [...toasts, { id, message, tone }]
    setTimeout(() => (toasts = toasts.filter((t) => t.id !== id)), 6000)
  }

  async function refresh() {
    try {
      state = await getJson('api/state')
    } catch (err) {
      notify(`Could not load state: ${err.message}`, 'error')
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

  function sortedFiles(folder) {
    return [...folder.files]
      .sort((a, b) => {
        const rank = (STATUS_RANK[a.status] ?? 9) - (STATUS_RANK[b.status] ?? 9)
        return rank !== 0 ? rank : a.name.localeCompare(b.name)
      })
      .slice(0, FILE_LIMIT)
  }

  // ---------- actions ----------

  async function act(path, body = {}) {
    try {
      const result = await postJson(path, body)
      await refresh()
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

  function askConfirm(title, text, confirmLabel) {
    return new Promise((resolve) => {
      confirmDialog = { title, text, confirmLabel, resolve: (value) => { confirmDialog = null; resolve(value) } }
    })
  }

  // ---------- cleanup ----------

  async function openCleanup(folderName) {
    try {
      const preview = await getJson(`api/cleanup/${encodeURIComponent(folderName)}`)
      if (!preview.files.length) {
        notify('Nothing to clean up in this folder.', 'error')
        return
      }
      cleanupDialog = { folder: folderName, files: preview.files, totalBytes: preview.totalBytes, selected: new Set(preview.files.map((f) => f.name)) }
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
      const failed = results.filter((r) => !r.ok)
      notify(`Moved ${results.length - failed.length} file(s) to trash.`, failed.length ? 'error' : 'success')
      if (failed.length) reportDialog = { title: 'Cleanup finished with issues', entries: failed }
    } catch (err) {
      notify(`Cleanup failed: ${err.message}`, 'error')
    }
    refresh()
  }

  async function cleanupAll() {
    if (!(await askConfirm('Cleanup all folders', `Move ${totals.processed} processed original(s) to trash? Destination copies are verified first.`, 'Cleanup all'))) return
    try {
      await postJson('api/cleanup-all', {})
      notify('Cleanup finished.')
      refresh()
    } catch (err) {
      notify(`Cleanup failed: ${err.message}`, 'error')
    }
  }

  // ---------- review ----------

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
    if (!place && !(await askConfirm('Discard', 'Discard this parked item?', 'Discard'))) return
    await postJson(path, { folder, id })
    await openReview()
    refresh()
  }

  async function reviewActionAll(folder, place) {
    const path = place ? 'api/review/place-all' : 'api/review/discard-all'
    if (!place && !(await askConfirm('Discard all', `Discard every parked item in ${folder}?`, 'Discard all'))) return
    await postJson(path, { folder })
    await openReview()
    refresh()
  }

  // ---------- trash ----------

  async function openTrash() {
    try {
      const { entries } = await getJson('api/trash')
      trashSelection = new Set()
      trashDialog = { entries }
    } catch (err) {
      notify(err.message, 'error')
    }
  }

  async function restoreFiles(items, targetDir) {
    try {
      const { results } = await postJson('api/trash/restore', { files: items, targetDir: targetDir || null })
      const failed = results.filter((r) => !r.ok)
      notify(`Restored ${results.length - failed.length} file(s).`, failed.length ? 'error' : 'success')
      if (failed.length) reportDialog = { title: 'Restore finished with issues', entries: failed.map((f) => ({ name: f.name, reason: f.reason })) }
    } catch (err) {
      notify(err.message, 'error')
    }
    await openTrash()
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
    if (!(await askConfirm('Empty trash', 'Permanently delete every trashed file?', 'Empty trash'))) return
    await postJson('api/trash/empty', {})
    await openTrash()
  }

  // ---------- settings ----------

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

  onMount(() => {
    refresh()
    const timer = setInterval(refresh, 5000)
    return () => clearInterval(timer)
  })

  // Parked items appear asynchronously after processing; keep the review dialog
  // fresh while it is open.
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

<header class="app-header container">
  <div class="app-header__top">
    <h1>D<span class="accent">$</span>CPLN <span class="app-name">&middot; Media Sync</span></h1>
    <div class="app-header__actions">
      <span class={`status-tag ${state?.paused ? 'status-warn' : state?.dryRun ? '' : 'status-ok'}`}>
        {state?.paused ? 'paused' : state?.dryRun ? 'dry run' : 'live'}
      </span>
      <small>{totals.pending} pending · {totals.issues} issue{totals.issues === 1 ? '' : 's'}</small>
      <button class="outline secondary" title={state?.paused ? 'Resume processing' : 'Pause processing'}
        onclick={togglePaused}>{#if state?.paused}<Play size={16} />{:else}<Pause size={16} />{/if}</button>
      <button class="outline secondary" title="Toggle dry run" onclick={toggleDryRun}><FlaskConical size={16} /></button>
      <button class="outline secondary" title="Settings" onclick={openSettings}><Settings size={16} /></button>
      <button class="outline secondary" title="Refresh" onclick={refresh}><RefreshCw size={16} /></button>
      <ThemeToggle />
    </div>
  </div>
  <p class="app-header__meta"><small>{state ? `updated ${formatTime(Date.now())}` : ''}</small></p>
</header>

<main class="container">
  <article>
    <header><strong>Overview</strong><small>{state?.folders?.length ?? 0} folder(s) watched</small></header>
    <dl class="tiles">
      <div><dt>Pending</dt><dd>{totals.pending}</dd></div>
      <div><dt>Processing</dt><dd>{totals.processing}</dd></div>
      <div><dt>Processed</dt><dd>{totals.processed}</dd></div>
      <div><dt>Issues</dt><dd class={totals.issues ? 'status-over' : ''}>{totals.issues}</dd></div>
    </dl>
    <footer class="actions">
      <button class="secondary" onclick={openReview}>Review</button>
      <button class="secondary" onclick={openTrash}>Trash</button>
      <button class="secondary" onclick={() => logDialog.show()}>Activity log</button>
      <button disabled={!totals.processed} onclick={cleanupAll}>Cleanup all ({totals.processed})</button>
    </footer>
  </article>

  {#each state?.folders ?? [] as folder (folder.name)}
    {@const stats = folderStats(folder)}
    <article class:card-over={folder.counts.conflict} class:card-warn={!folder.counts.conflict && stats.issues}>
      <header>
        <span>
          <strong>{folder.name}</strong>
          <small> · {folder.method}</small>
          {#if !folder.exists}<small class="status-over"> · source unavailable</small>{/if}
        </span>
        <small>{folder.source} → {folder.destination}</small>
      </header>

      <p class="figure">
        <strong>{stats.pending}</strong> pending of {stats.total} file{stats.total === 1 ? '' : 's'}
        {#if folder.lastEventAt} · last change {formatDateTime(folder.lastEventAt)}{/if}
        · {stats.processed} processed{#if stats.ignored > 0} · {stats.ignored} ignored{/if}
      </p>
      <progress value={stats.percent} max="100"></progress>

      <dl class="tiles compact">
        <div><dt>pending</dt><dd>{stats.pending}</dd></div>
        <div><dt>processing</dt><dd>{stats.processing}</dd></div>
        <div><dt>processed</dt><dd>{stats.processed}</dd></div>
        <div><dt>issues</dt><dd class={stats.issues ? 'status-over' : ''}>{stats.issues}</dd></div>
      </dl>

      <footer class="actions">
        <button class="secondary" onclick={() => processNow(folder.name)}>Process now</button>
        {#if folder.placement === 'manual' || stats.review > 0}
          <button class={stats.review > 0 ? '' : 'secondary'} onclick={openReview}>
            Review{stats.review > 0 ? ` (${stats.review})` : ''}
          </button>
        {/if}
        {#if stats.processed > 0 && folder.cleanup !== false}
          <button onclick={() => openCleanup(folder.name)}>Cleanup {stats.processed}</button>
        {/if}
      </footer>

      <details open={expanded.has(folder.name)} ontoggle={(event) => {
        if (event.target.open) expanded.add(folder.name); else expanded.delete(folder.name)
        expanded = expanded
      }}>
        <summary>Files · {folder.files.length}</summary>
        {#if !folder.files.length}
          <p><small>No files in this folder right now.</small></p>
        {:else}
          <ul class="files">
            {#each sortedFiles(folder) as file (file.name)}
              <li>
                <span>
                  <code>{file.name}</code>
                  {#if file.message}<small> · {file.message}</small>{/if}
                  {#if file.attempts}<small> · attempt {file.attempts}</small>{/if}
                  {#if file.destName}<small> → {file.destName}</small>{/if}
                </span>
                <span class="file-meta">
                  <small>{formatBytes(file.size)} · {formatDateTime(file.mtimeMs)}</small>
                  <span class={`badge badge-${STATUS_VARIANT[file.status] ?? 'secondary'}`}>{file.status}</span>
                  {#if file.status === 'error' || file.status === 'conflict'}
                    <button class="secondary outline sm" onclick={() => fileAction(folder.name, file.name, 'retry')}>Retry</button>
                  {/if}
                  {#if file.status === 'error'}
                    <button class="secondary outline sm" onclick={() => fileAction(folder.name, file.name, 'repair')}>Repair</button>
                    <button class="secondary outline sm" onclick={() => (setDateDialog = { folder: folder.name, file: file.name, date: '', time: '00:00', error: '' })}>Set date</button>
                  {/if}
                  {#if ['error', 'conflict', 'pending'].includes(file.status)}
                    <button class="secondary outline sm" onclick={() => fileAction(folder.name, file.name, 'import')}>Import</button>
                  {/if}
                </span>
              </li>
            {/each}
          </ul>
          {#if folder.files.length > FILE_LIMIT}
            <p><small>… and {folder.files.length - FILE_LIMIT} more file(s)</small></p>
          {/if}
        {/if}
      </details>
    </article>
  {/each}

  {#if state && !state.folders.length}
    <article><p>No folders configured yet — open Settings to add one.</p></article>
  {/if}
</main>

<!-- cleanup -->
{#if cleanupDialog}
  <dialog open>
    <article>
      <header><strong>Cleanup {cleanupDialog.folder}</strong></header>
      <p><small>{cleanupDialog.files.length} processed file(s), {formatBytes(cleanupDialog.totalBytes)}. Each destination copy is verified before the original is moved to trash.</small></p>
      <label><input type="checkbox" checked={cleanupDialog.selected.size === cleanupDialog.files.length}
        onchange={(event) => (cleanupDialog.selected = event.target.checked ? new Set(cleanupDialog.files.map((f) => f.name)) : new Set())} /> Select all</label>
      {#each cleanupDialog.files as file (file.name)}
        <label>
          <input type="checkbox" checked={cleanupDialog.selected.has(file.name)}
            onchange={(event) => {
              if (event.target.checked) cleanupDialog.selected.add(file.name)
              else cleanupDialog.selected.delete(file.name)
              cleanupDialog = cleanupDialog
            }} />
          <code>{file.name}</code>{#if file.destName} <small>→ {file.destName}</small>{/if}
        </label>
      {/each}
      <footer>
        <button class="secondary" onclick={() => (cleanupDialog = null)}>Cancel</button>
        <button onclick={runCleanup}>Move to trash ({cleanupDialog.selected.size})</button>
      </footer>
    </article>
  </dialog>
{/if}

<!-- set date -->
{#if setDateDialog}
  <dialog open>
    <article>
      <header><strong>Set date — {setDateDialog.file}</strong></header>
      <label>Date <input type="date" value={setDateDialog.date} oninput={(e) => (setDateDialog.date = e.target.value)} /></label>
      <label>Time <input type="time" value={setDateDialog.time} oninput={(e) => (setDateDialog.time = e.target.value)} /></label>
      {#if setDateDialog.error}<p class="status-over">{setDateDialog.error}</p>{/if}
      <footer>
        <button class="secondary" onclick={() => (setDateDialog = null)}>Cancel</button>
        <button onclick={async () => {
          if (!setDateDialog.date) { setDateDialog.error = 'Pick a date first.'; return }
          const { folder, file, date, time } = setDateDialog
          setDateDialog = null
          await fileAction(folder, file, 'setDate', { date: `${date} ${time || '00:00'}` })
          notify(`Standardizing ${file} with the chosen date.`)
        }}>Standardize</button>
      </footer>
    </article>
  </dialog>
{/if}

<!-- restore -->
{#if restoreDialog}
  <dialog open>
    <article>
      <header><strong>Restore {restoreDialog.items.length} file(s)</strong></header>
      <label>Target directory <input value={restoreDialog.dir} placeholder="e.g. /source/Camera" oninput={(e) => (restoreDialog.dir = e.target.value)} /></label>
      {#if restoreDialog.error}<p class="status-over">{restoreDialog.error}</p>{/if}
      <footer>
        <button class="secondary" onclick={() => (restoreDialog = null)}>Cancel</button>
        <button onclick={async () => {
          if (!restoreDialog.dir.trim()) { restoreDialog.error = 'Enter a directory first.'; return }
          const { items, dir } = restoreDialog
          restoreDialog = null
          await restoreFiles(items, dir.trim())
        }}>Restore</button>
      </footer>
    </article>
  </dialog>
{/if}

<!-- review -->
{#if reviewDialog}
  <dialog open data-testid="review-dialog">
    <article class="wide">
      <header><strong>Review</strong></header>
      {#if !reviewFolders.length}
        <p><small>Nothing awaiting review.</small></p>
      {/if}
      {#each reviewFolders as folder (folder.name)}
        {@const parked = reviewDialog.entries.filter((entry) => entry.folder === folder.name)}
        {@const groups = folder.method === 'voicenotes' ? reviewGroups(folder) : []}
        {#if parked.length || groups.length}
          <section>
            <h3>{folder.name}</h3>
            {#if groups.length}
              <div class="review-groups">
                {#each groups as group (group.key)}
                  <label>
                    <input type="checkbox" checked={reviewDialog.selectedGroups.has(group.key)}
                      onchange={(e) => toggleGroup(group.key, e.target.checked)} />
                    <code>{group.chat || '(root)'} · {group.date}</code>
                    <small>{group.files.length} clip(s) · {formatBytes(group.bytes)}</small>
                  </label>
                {/each}
              </div>
              <button class="secondary" onclick={() => processSelectedGroups(folder)}>Process selected</button>
            {/if}
            {#each parked as entry (entry.id)}
              <div class="review-row">
                <div>
                  <code>{entry.destName}</code>
                  <small> · {entry.chat || '(root)'} · {entry.inputs.length} input(s) · {formatBytes(entry.size)}{entry.missingInputs?.length ? ` · ${entry.missingInputs.length} source(s) gone` : ''}</small>
                </div>
                <audio controls preload="none" src={apiUrl(`api/review/file/${encodeURIComponent(folder.name)}/${encodeURIComponent(entry.id)}`)}></audio>
                <div class="actions">
                  <button onclick={() => reviewAction(folder.name, entry.id, true)}>Place</button>
                  <button class="secondary" onclick={() => reviewAction(folder.name, entry.id, false)}>Discard</button>
                </div>
              </div>
            {/each}
            {#if parked.length > 1}
              <div class="actions">
                <button onclick={() => reviewActionAll(folder.name, true)}>Place all ({parked.length})</button>
                <button class="secondary" onclick={() => reviewActionAll(folder.name, false)}>Discard all</button>
              </div>
            {/if}
          </section>
        {/if}
      {/each}
      <footer><button class="secondary" onclick={() => (reviewDialog = null)}>Close</button></footer>
    </article>
  </dialog>
{/if}

<!-- trash -->
{#if trashDialog}
  <dialog open>
    <article class="wide">
      <header><strong>Trash</strong><small>keeping {state?.trashRetentionDays} days</small></header>
      {#if !trashDialog.entries.length}
        <p><small>Trash is empty.</small></p>
      {:else}
        <div class="actions">
          <button class="secondary" disabled={!trashSelection.size} onclick={restoreSelected}>Restore selected ({trashSelection.size})</button>
          <button class="secondary" onclick={emptyTrash}>Empty trash</button>
        </div>
        {#each trashDialog.entries as entry (entry.day)}
          <details>
            <summary>{entry.day} · {entry.count} file(s) · {formatBytes(entry.bytes)}</summary>
            {#each entry.files.slice(0, 300) as file (file.name)}
              {@const key = `${entry.day}/${file.name}`}
              <label>
                <input type="checkbox" checked={trashSelection.has(key)}
                  onchange={(event) => {
                    if (event.target.checked) trashSelection.add(key)
                    else trashSelection.delete(key)
                    trashSelection = trashSelection
                  }} />
                <code>{file.name}</code>
                <small> · {formatBytes(file.size)} · {file.folder ?? file.sourceDir ?? 'origin unknown'}</small>
              </label>
            {/each}
            {#if entry.count > 300}<p><small>… and {entry.count - 300} more</small></p>{/if}
          </details>
        {/each}
      {/if}
      <footer><button class="secondary" onclick={() => (trashDialog = null)}>Close</button></footer>
    </article>
  </dialog>
{/if}

<!-- settings -->
{#if settingsDraft}
  <dialog open data-testid="settings-dialog">
    <article class="wide">
      <header><strong>Settings</strong></header>
      <div class="form-grid">
        <label>Concurrency <input type="number" value={settingsDraft.concurrency} oninput={(e) => (settingsDraft.concurrency = e.target.value)} /></label>
        <label>Trash retention (days) <input type="number" value={settingsDraft.trashRetentionDays} oninput={(e) => (settingsDraft.trashRetentionDays = e.target.value)} /></label>
        <label>Default settle (s) <input type="number" value={settingsDraft.settleSeconds} oninput={(e) => (settingsDraft.settleSeconds = e.target.value)} /></label>
      </div>
      <div class="form-grid">
        <label>Staging directory <input value={settingsDraft.stagingDir} oninput={(e) => (settingsDraft.stagingDir = e.target.value)} /></label>
        <label>Review directory <input value={settingsDraft.reviewDir} oninput={(e) => (settingsDraft.reviewDir = e.target.value)} /></label>
        <label>Trash directory <input value={settingsDraft.trashDir} oninput={(e) => (settingsDraft.trashDir = e.target.value)} /></label>
      </div>
      <div class="form-grid">
        <label>ntfy URL <input value={settingsDraft.ntfy?.url ?? ''} oninput={(e) => (settingsDraft.ntfy.url = e.target.value)} /></label>
        <label>ntfy token <input type="password" value={settingsDraft.ntfy?.token ?? ''} oninput={(e) => (settingsDraft.ntfy.token = e.target.value)} /></label>
      </div>
      <label><input type="checkbox" checked={settingsDraft.ntfy?.notifySuccess !== false}
        onchange={(e) => (settingsDraft.ntfy.notifySuccess = e.target.checked)} /> Notify when files are processed successfully</label>
      <button class="secondary" onclick={sendTestNotification}>Send test notification</button>

      <h3>Folders</h3>
      {#each settingsDraft.folders as folder, index (index)}
        <fieldset>
          <legend>{folder.name || 'New folder'}</legend>
          <div class="form-grid">
            <label>Name <input value={folder.name} oninput={(e) => (folder.name = e.target.value)} /></label>
            <label>Source <input value={folder.source} oninput={(e) => (folder.source = e.target.value)} /></label>
            <label>Destination <input value={folder.destination} oninput={(e) => (folder.destination = e.target.value)} /></label>
            <label>Method
              <select value={folder.method} onchange={(e) => (folder.method = e.target.value)}>
                {#each ['standardize', 'snapchat', 'copy', 'voicenotes'] as method}<option value={method}>{method}</option>{/each}
              </select>
            </label>
            <label>Settle (s) <input type="number" value={folder.settleSeconds ?? 60} oninput={(e) => (folder.settleSeconds = e.target.value)} /></label>
            <label>Group window (s) <input type="number" value={folder.groupWindowSeconds ?? 15} oninput={(e) => (folder.groupWindowSeconds = e.target.value)} /></label>
            <label>File pattern <input value={folder.filePattern ?? ''} oninput={(e) => (folder.filePattern = e.target.value)} /></label>
            <label>Placement
              <select value={folder.placement ?? 'auto'} onchange={(e) => (folder.placement = e.target.value)}>
                <option value="auto">auto</option><option value="manual">manual</option>
              </select>
            </label>
            <label>On change
              <select value={folder.onChanged ?? 'overwrite'} onchange={(e) => (folder.onChanged = e.target.value)}>
                <option value="overwrite">overwrite</option><option value="conflict">conflict</option>
              </select>
            </label>
            <label>Notify on success
              <select value={folder.notify ?? 'all'} onchange={(e) => (folder.notify = e.target.value)}>
                <option value="all">all</option><option value="errors">errors</option>
              </select>
            </label>
            <label>Date pattern (voicenotes) <input value={folder.datePattern ?? ''} oninput={(e) => (folder.datePattern = e.target.value)} /></label>
          </div>
          <div class="checks">
            <label><input type="checkbox" checked={folder.recursive === true} onchange={(e) => (folder.recursive = e.target.checked)} /> Recursive</label>
            <label><input type="checkbox" checked={folder.includeHidden === true} onchange={(e) => (folder.includeHidden = e.target.checked)} /> Include hidden</label>
            <label><input type="checkbox" checked={folder.cleanup !== false} onchange={(e) => (folder.cleanup = e.target.checked)} /> Allow cleanup</label>
            <label><input type="checkbox" checked={folder.autoProcess === true} onchange={(e) => (folder.autoProcess = e.target.checked)} /> Auto-prepare (manual review)</label>
          </div>
          <button class="secondary outline sm" onclick={() => (settingsDraft.folders = settingsDraft.folders.filter((_, i) => i !== index))}>Remove folder</button>
        </fieldset>
      {/each}
      <button class="secondary" onclick={addFolder}>Add folder</button>

      <footer>
        <button class="secondary" onclick={() => (settingsDraft = null)}>Cancel</button>
        <button onclick={saveSettings}>Save</button>
      </footer>
    </article>
  </dialog>
{/if}

<!-- confirm -->
{#if confirmDialog}
  <dialog open data-testid="confirm-dialog">
    <article>
      <header><strong>{confirmDialog.title}</strong></header>
      <p>{confirmDialog.text}</p>
      <footer>
        <button class="secondary" onclick={() => confirmDialog.resolve(false)}>Cancel</button>
        <button onclick={() => confirmDialog.resolve(true)}>{confirmDialog.confirmLabel}</button>
      </footer>
    </article>
  </dialog>
{/if}

<!-- report -->
{#if reportDialog}
  <dialog open>
    <article>
      <header><strong>{reportDialog.title}</strong></header>
      {#each reportDialog.entries as entry (entry.name + entry.reason)}
        <div><code>{entry.name}</code> <small class="status-over">{entry.reason ?? ''}</small></div>
      {/each}
      <footer><button onclick={() => (reportDialog = null)}>Close</button></footer>
    </article>
  </dialog>
{/if}

<LogDialog bind:this={logDialog} />

<div class="toasts">
  {#each toasts as toast (toast.id)}
    <article class={toast.tone === 'error' ? 'error' : ''}>{toast.message}</article>
  {/each}
</div>

<style>
  .app-name {
    font-size: 0.7em;
    font-weight: 500;
    color: var(--pico-muted-color);
  }
  .tiles {
    display: flex;
    gap: 2rem;
    flex-wrap: wrap;
    margin: 0;
  }
  .tiles dt {
    font-size: 0.8rem;
    color: var(--pico-muted-color);
  }
  .tiles dd {
    margin: 0;
    font-weight: 600;
  }
  .tiles.compact {
    gap: 1.25rem;
    margin-block: 0.5rem;
  }
  .actions {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
    align-items: center;
  }
  .actions button {
    width: auto;
    margin: 0;
  }
  button.sm {
    padding: 0.1rem 0.5rem;
    font-size: 0.75rem;
  }
  .file-meta {
    display: flex;
    gap: 0.5rem;
    align-items: center;
    flex-wrap: wrap;
  }
  .files {
    list-style: none;
    padding: 0;
  }
  .files li {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    flex-wrap: wrap;
    border-bottom: 1px solid var(--pico-muted-border-color);
    padding-block: 0.35rem;
  }
  .badge {
    font-size: 0.7rem;
    padding: 0.05rem 0.5rem;
    border-radius: 1rem;
    background: var(--pico-secondary-background);
  }
  .badge-success { background: var(--pico-ins-color); color: white; }
  .badge-danger { background: var(--pico-del-color); color: white; }
  .badge-warning { background: var(--pico-mark-background-color); }
  .badge-primary { background: var(--pico-primary); color: var(--pico-primary-inverse); }
  dialog article {
    width: min(44rem, 94vw);
  }
  dialog article.wide {
    width: min(72rem, 94vw);
  }
  dialog footer {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
  }
  dialog header {
    margin-bottom: 0.5rem;
  }
  .wide h3 + .review-groups + button,
  .actions + details {
    margin-block: 0.5rem;
  }
  .review-groups label, dialog label {
    display: block;
    margin-block: 0.15rem;
  }
  .review-groups label {
    display: flex;
    gap: 0.5rem;
    align-items: center;
  }
  .review-row {
    border-top: 1px solid var(--pico-muted-border-color);
    padding-block: 0.5rem;
  }
  .form-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
    gap: 0.5rem;
  }
  .checks {
    display: flex;
    gap: 1rem;
    flex-wrap: wrap;
  }
  fieldset {
    margin-block: 0.75rem;
  }
  .card-over {
    border-color: var(--pico-del-color);
  }
  .card-warn {
    border-color: var(--pico-mark-background-color);
  }
  .toasts {
    position: fixed;
    right: 1rem;
    bottom: 1rem;
    display: grid;
    gap: 0.5rem;
    z-index: 10;
  }
  .toasts article {
    margin: 0;
    padding: 0.5rem 0.75rem;
  }
  .toasts .error {
    border-color: var(--pico-del-color);
  }
</style>
