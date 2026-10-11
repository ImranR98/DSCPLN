<script>
  import { onMount } from 'svelte'
  import { apiUrl, getJson, postJson } from '@dscpln/ui-kit'
  import { RefreshCw } from 'lucide-svelte'

  let groups = $state([])
  let tasks = $state([])
  let missingConfig = $state(false)
  let runs = $state({}) // taskName -> [lines]
  let queues = $state({}) // taskName -> File[]
  let uploading = $state({}) // taskName -> percent
  let toasts = $state([])
  let toastId = 0
  let dragging = $state(false)
  let pickerFiles = $state(null) // Files awaiting a channel choice

  let promptDialog = $state(null) // { task, fields, values, resolve }
  let pasteDialog = $state(null) // { task, output }

  function notify(message, tone = 'success') {
    const id = ++toastId
    toasts = [...toasts, { id, message, tone }]
    setTimeout(() => (toasts = toasts.filter((t) => t.id !== id)), 6000)
  }

  async function loadTasks() {
    try {
      const data = await getJson('api/tasks')
      groups = data.groups ?? []
      tasks = groups.flatMap((group) => group.tasks)
      missingConfig = Boolean(data.missing_config)
    } catch {
      // keep the last state
    }
  }

  async function pollStatus() {
    try {
      const data = await getJson('api/status')
      const next = { ...runs }
      for (const run of data.runs ?? []) {
        next[run.task] = [...(next[run.task] ?? []), ...run.log].slice(-500)
      }
      runs = next
      for (const done of data.done ?? []) {
        notify(`${done.task}: ${done.ok ? 'finished' : 'FAILED'} — ${done.summary}`, done.ok ? 'success' : 'error')
        delete queues[done.task]
        queues = { ...queues }
        if (done.paste) {
          const { output } = await getJson(`api/log/${encodeURIComponent(done.task)}`)
          pasteDialog = { task: done.task, output: output ?? '' }
        }
        loadTasks()
      }
    } catch {
      // transient poll failure
    }
  }

  function taskByName(name) {
    return tasks.find((t) => t.name === name)
  }

  async function runTask(task) {
    let payload = {}
    if (task.prompts?.length) {
      const values = await askPrompts(task)
      if (!values) return
      payload = values
    }
    try {
      await postJson(`api/run/${encodeURIComponent(task.name)}`, payload)
      notify(`${task.name}: started`)
      loadTasks()
    } catch (err) {
      notify(err.message, 'error')
    }
  }

  function askPrompts(task) {
    return new Promise((resolve) => {
      promptDialog = {
        task,
        values: Object.fromEntries((task.prompts ?? []).map((key) => [key, ''])),
        submit: () => {
          const values = { ...promptDialog.values }
          promptDialog = null
          resolve(values)
        },
        cancel: () => {
          promptDialog = null
          resolve(null)
        },
      }
    })
  }

  async function cancelRun(name) {
    try {
      await postJson('api/cancel', { task: name })
      notify(`${name}: cancelling…`)
    } catch (err) {
      notify(err.message, 'error')
    }
  }

  function addFiles(task, files) {
    queues = { ...queues, [task.name]: [...(queues[task.name] ?? []), ...files] }
  }

  async function routeFiles(files) {
    for (const file of files) {
      try {
        const { result } = await postJson(`api/detect?name=${encodeURIComponent(file.name)}`, {})
        if (result?.ambiguous?.length > 1) {
          pickerFiles = { files: [file, ...files.slice(files.indexOf(file) + 1)], choices: result.ambiguous }
          return
        }
        if (!result?.task) {
          notify(`${file.name}: no task accepts this file`, 'error')
          continue
        }
        addFiles(taskByName(result.task), [file])
        notify(`${file.name} → ${result.task}`)
      } catch (err) {
        notify(err.message, 'error')
      }
    }
  }

  function chooseChannel(taskName) {
    const files = pickerFiles?.files ?? []
    pickerFiles = null
    if (taskName) addFiles(taskByName(taskName), files)
  }

  function removeFile(task, file) {
    queues = { ...queues, [task.name]: (queues[task.name] ?? []).filter((f) => f !== file) }
  }

  function uploadOne(task, file) {
    return new Promise((resolve) => {
      const xhr = new XMLHttpRequest()
      xhr.open('POST', apiUrl(`api/upload/${encodeURIComponent(task.name)}?name=${encodeURIComponent(file.name)}`))
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) uploading = { ...uploading, [task.name]: Math.round((event.loaded / event.total) * 100) }
      }
      xhr.onload = () => {
        if (xhr.status >= 400) {
          let detail = `HTTP ${xhr.status}`
          try {
            detail = JSON.parse(xhr.responseText).detail ?? detail
          } catch {
            // keep the status text
          }
          notify(`${file.name}: ${detail}`, 'error')
          resolve(false)
        } else {
          resolve(true)
        }
      }
      xhr.onerror = () => resolve(false)
      xhr.send(file)
    })
  }

  async function uploadTask(task) {
    const files = queues[task.name] ?? []
    for (const file of files) {
      const ok = await uploadOne(task, file)
      if (!ok) return
      removeFile(task, file)
    }
    uploading = { ...uploading, [task.name]: 0 }
    notify(`${task.name}: upload complete`)
    loadTasks()
  }

  async function copyPaste() {
    try {
      await navigator.clipboard.writeText(pasteDialog.output)
      notify('Copied')
    } catch {
      notify('Copy failed — select the text manually', 'error')
    }
  }

  async function finishPaste() {
    try {
      await postJson(`api/paste_done/${encodeURIComponent(pasteDialog.task)}`, {})
      notify(`${pasteDialog.task}: committed`)
    } catch (err) {
      notify(err.message, 'error')
    }
    pasteDialog = null
  }

  onMount(() => {
    loadTasks()
    const status = setInterval(pollStatus, 1500)
    const list = setInterval(loadTasks, 5000)
    return () => {
      clearInterval(status)
      clearInterval(list)
    }
  })
</script>

<header class="app-header container">
  <div class="app-header__top">
    <h1>D<span class="accent">$</span>CPLN <span class="app-name">&middot; Task Runner</span></h1>
    <button class="outline secondary" id="refreshButton" title="Refresh tasks" aria-label="Refresh tasks"
      onclick={loadTasks}>
      <RefreshCw size={16} />
    </button>
  </div>
</header>

<main class="container">
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    id="global-dropzone"
    class:dragging
    class="dropzone"
    ondragover={(event) => { event.preventDefault(); dragging = true }}
    ondragleave={() => (dragging = false)}
    ondrop={(event) => {
      event.preventDefault()
      dragging = false
      routeFiles([...event.dataTransfer.files])
    }}
  >
    <small>Drop files anywhere here to route them to the matching task.</small>
  </div>

{#if missingConfig}
  <article class="warning">No task config found — create config.mjs (see README.md).</article>
{/if}

{#each groups as group (group.name)}
  <h2 class="group-title">{group.name} <small>{group.tasks.length} task(s)</small></h2>
  <div class="task-grid">
    {#each group.tasks as task (task.name)}
      {@const running = task.running}
      {@const queued = task.queued}
      {@const busy = running || queued || uploading[task.name] != null}
      {@const lines = runs[task.name] ?? []}
      <article class="task-card" data-testid={`task-${task.name}`}>
        <header>
          <strong>{task.name}</strong>
          <span class={running ? 'pill status-ok' : task.pill === 'ok' ? 'pill status-ok' : task.pill === 'neutral' ? 'pill' : 'pill status-over'}>
            {running ? 'Running' : uploading[task.name] != null ? `Uploading ${uploading[task.name]}%` : queued ? 'Queued' : (task.state?.last_run_text ?? 'Never run')}
          </span>
        </header>

        {#if running && task.live}<p class="live">{task.live}</p>{/if}
        {#if !task.avail}<p class="unavailable">{task.avail_reason}</p>{/if}

        {#if task.uploads}
          <div class="dropzone">
            <input type="file" multiple
              onchange={(event) => { addFiles(task, [...event.target.files]); event.target.value = '' }} />
            <small>{task.note || 'Choose files to queue'}</small>
          </div>
          {#if queues[task.name]?.length}
            <ul class="queue">
              {#each queues[task.name] as file (file.name)}
                <li>
                  <span>{file.name}</span>
                  <button class="secondary outline" onclick={() => removeFile(task, file)}>&times;</button>
                </li>
              {/each}
            </ul>
            <button class="secondary" onclick={() => uploadTask(task)}>Upload queued files</button>
          {/if}
        {:else if task.note}
          <p><small>{task.note}</small></p>
        {/if}

        <footer class="actions">
          {#if task.export_url}
            <a role="button" class="secondary" href={task.export_url} target="_blank" rel="noreferrer">Export</a>
          {/if}
          {#if busy}
            <button class="secondary" onclick={() => cancelRun(task.name)} disabled={!running}>Stop</button>
          {:else}
            <button onclick={() => runTask(task)}
              disabled={!task.avail || (task.uploads && !(queues[task.name]?.length))}>Run</button>
          {/if}
          <details>
            <summary>Log</summary>
            <pre class="log">{lines.length ? lines.join('\n') : 'No live output.'}</pre>
          </details>
        </footer>
      </article>
    {/each}
  </div>
{/each}

</main>

{#if promptDialog}
  <dialog open>
    <article>
      <header><strong>{promptDialog.task.name}</strong></header>
      {#each promptDialog.task.prompts as key (key)}
        <label>{key}
          <input type="password" autocomplete="off" value={promptDialog.values[key]}
            oninput={(event) => (promptDialog.values[key] = event.target.value)} />
        </label>
      {/each}
      <footer>
        <button class="secondary" onclick={promptDialog.cancel}>Cancel</button>
        <button onclick={promptDialog.submit}>Run</button>
      </footer>
    </article>
  </dialog>
{/if}

{#if pasteDialog}
  <dialog open>
    <article>
      <header><strong>{pasteDialog.task}: paste this into the destination</strong></header>
      <textarea rows="12" readonly value={pasteDialog.output}></textarea>
      <footer>
        <button class="secondary" onclick={copyPaste}>Copy</button>
        <button onclick={finishPaste}>Done</button>
      </footer>
    </article>
  </dialog>
{/if}

{#if pickerFiles}
  <dialog open>
    <article>
      <header><strong>Which task should receive these files?</strong></header>
      {#each pickerFiles.choices as choice (choice)}
        <button class="secondary" onclick={() => chooseChannel(choice)}>{choice}</button>
      {/each}
      <footer><button class="outline" onclick={() => chooseChannel(null)}>Cancel</button></footer>
    </article>
  </dialog>
{/if}

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
  .group-title {
    margin-top: 1.5rem;
  }
  .task-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(22rem, 1fr));
    gap: 1rem;
  }
  .task-card header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 0.5rem;
  }
  .pill {
    font-size: 0.75rem;
    padding: 0.1rem 0.5rem;
    border-radius: 1rem;
    background: var(--pico-secondary-background);
    white-space: nowrap;
  }
  .live {
    font-family: monospace;
    font-size: 0.8rem;
    overflow-wrap: anywhere;
  }
  .unavailable {
    color: var(--pico-del-color);
  }
  .queue {
    list-style: none;
    padding: 0;
  }
  .queue li {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 0.5rem;
  }
  .queue button {
    width: auto;
    margin: 0;
  }
  .actions {
    display: flex;
    gap: 0.5rem;
    align-items: center;
    flex-wrap: wrap;
  }
  .actions > button,
  .actions > a {
    width: auto;
    margin: 0;
  }
  details {
    flex-basis: 100%;
  }
  .log {
    max-height: 16rem;
    overflow: auto;
  }
  dialog article {
    width: min(40rem, 92vw);
  }
  dialog footer {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
  }
  dialog header {
    margin-bottom: 0.5rem;
  }
  .warning {
    border-color: var(--pico-del-color);
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
