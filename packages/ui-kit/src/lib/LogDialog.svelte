<script>
  import { apiUrl, getJson } from './api.js'

  let dialog = $state(null)
  let lines = $state([])
  let source = null

  export function show() {
    if (!dialog.open) dialog.showModal()
    load()
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
        if (event.type === 'line') lines = [...lines, event.line].slice(-500)
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

<dialog bind:this={dialog} onclose={stop}>
  <article>
    <header>
      <strong>Live log</strong>
      <button class="close" aria-label="Close" onclick={() => dialog.close()}>&times;</button>
    </header>
    {#if lines.length}
      <pre class="log">{lines.join('\n')}</pre>
    {:else}
      <p>No output yet.</p>
    {/if}
  </article>
</dialog>

<style>
  dialog article {
    width: min(70rem, 92vw);
  }
  header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .log {
    max-height: 60vh;
    overflow: auto;
  }
</style>
