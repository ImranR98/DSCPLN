<script>
  import { apiUrl, getJson } from './api.js'

  let dialog = $state(null)
  let lines = $state([])
  let source = null

  export function show() {
    if (!dialog.open) dialog.showModal()
    load()
  }

  export function append(line) {
    lines = [...lines, line].slice(-1000)
  }

  async function load() {
    try {
      lines = (await getJson('api/log?limit=500')).lines ?? []
    } catch {
      lines = []
    }
    stop()
    source = new EventSource(apiUrl('api/events'))
    source.onmessage = (message) => {
      try {
        const event = JSON.parse(message.data)
        if (event.type === 'line') append(event.line)
      } catch {
        // ignore malformed frames
      }
    }
    source.onerror = () => stop()
  }

  function stop() {
    source?.close()
    source = null
  }
</script>

<dialog bind:this={dialog} class="wide-dialog" onclose={stop}>
  <article>
    <header class="card__header">
      <h2>Log</h2>
      <span class="card__header-tools">
        <button class="outline secondary icon-button" aria-label="Close" onclick={() => dialog.close()}>&times;</button>
      </span>
    </header>
    <pre class="code-block log-dialog__output">{lines.length ? lines.join('\n') : 'No output yet.'}</pre>
    <div class="dialog-actions">
      <button onclick={() => dialog.close()}>Close</button>
    </div>
  </article>
</dialog>
