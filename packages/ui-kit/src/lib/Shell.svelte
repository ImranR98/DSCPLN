<script>
  import { onMount } from 'svelte'
  import { Settings, Square, Play, ScrollText, RefreshCw } from 'lucide-svelte'
  import { getJson, postJson, putJson, subscribe } from './api.js'
  import { formatDateTime, formatDuration, humanAgo } from './format.js'
  import ThemeToggle from './ThemeToggle.svelte'
  import LogDialog from './LogDialog.svelte'
  import SettingsDialog from './SettingsDialog.svelte'

  let {
    name,
    fields = [],
    schedule = true,
    settingsNotice = null,
    actions = null,
    settingsExtra = null,
    onconfig = null,
    children,
  } = $props()

  let state = $state(null)
  let config = $state({})
  let saveError = $state('')
  let logDialog = $state(null)
  let settingsDialog = $state(null)

  const running = $derived(Boolean(state?.runMarker))
  const paused = $derived(Boolean(config.paused))
  const status = $derived(running ? 'running' : paused ? 'paused' : 'live')
  const last = $derived(state?.lastRun ?? null)

  async function refresh() {
    try {
      const data = await getJson('api/state')
      state = data
      config = data.config ?? config
    } catch {
      // keep the last known state
    }
  }

  async function runNow() {
    try {
      await postJson('api/run', {})
      await refresh()
    } catch (err) {
      saveError = err.message
    }
  }

  async function stop() {
    try {
      await postJson('api/cancel', {})
    } catch {
      // the run may already be gone
    }
  }

  async function togglePause() {
    await postJson('api/pause', { paused: !paused })
    await refresh()
  }

  async function saveConfig(next) {
    const saved = await putJson('api/config', next)
    config = saved
    state = state ? { ...state, config: saved } : state
    onconfig?.(saved)
  }

  onMount(() => {
    refresh()
    const unsubscribe = subscribe('', (event) => {
      if (event.type === 'state' && event.state) state = { ...state, ...event.state }
      if (event.type === 'config' && event.config) config = event.config
    }, { events: 'events' })
    const timer = setInterval(refresh, 15_000)
    return () => {
      unsubscribe()
      clearInterval(timer)
    }
  })
</script>

<header class="app-header container">
  <div class="app-header__top">
    <h1>D<span class="accent">$</span>CPLN <span class="app-name">&middot; {name}</span></h1>
    <div class="app-header__actions">
      <span class={`status-tag status-${status}`} data-testid="status">{status}</span>
      <button class="outline secondary" type="button" title="Pause/Resume" aria-label="Pause/Resume" onclick={togglePause}>
        {#if paused}<Play size={16} />{:else}<Square size={16} />{/if}
      </button>
      {@render actions?.()}
      <button class="outline secondary" type="button" title="Settings" aria-label="Settings" onclick={() => settingsDialog.show(config)}>
        <Settings size={16} />
      </button>
      <button class="outline secondary" type="button" title="Refresh" aria-label="Refresh" onclick={refresh}>
        <RefreshCw size={16} />
      </button>
      <ThemeToggle />
    </div>
  </div>
</header>

<main class="container">
  <article class="overview">
    <header>
      <strong>Overview</strong>
      {#if state?.nextRun}<small>next {formatDateTime(state.nextRun)}</small>
      {:else if schedule}<small>manual</small>{/if}
    </header>
    <dl class="tiles">
      <div><dt>Last run</dt><dd>{last ? humanAgo(last.endedAt) : 'Never'}</dd></div>
      <div><dt>Result</dt><dd class={last ? (last.ok ? 'status-ok' : 'status-over') : ''}>{last ? (last.ok ? 'OK' : 'Failed') : '—'}</dd></div>
      <div><dt>Duration</dt><dd>{last ? formatDuration(last.durationSec) : '—'}</dd></div>
      <div><dt>Next run</dt><dd>{state?.nextRun ? formatDateTime(state.nextRun) : 'Manual'}</dd></div>
      {#if state?.missed}<div><dt>Missed</dt><dd class="status-warn">{state.missed}</dd></div>{/if}
    </dl>
    <footer class="overview-actions">
      {#if !running}
        <button onclick={runNow} data-testid="run-now">Run now</button>
      {:else}
        <button class="secondary" onclick={stop} data-testid="stop">Stop</button>
      {/if}
      <button class="secondary" onclick={() => logDialog.show()} data-testid="show-log">Log</button>
    </footer>
    {#if last?.summary}<p><small>{last.summary}</small></p>{/if}
    {#if saveError}<p class="error">{saveError}</p>{/if}
  </article>

  {@render children?.()}
</main>

<LogDialog bind:this={logDialog} />
<SettingsDialog
  bind:this={settingsDialog}
  {fields}
  {schedule}
  notice={settingsNotice}
  onsave={saveConfig}
  extra={settingsExtra}
/>

<style>
  .app-name {
    font-size: 0.7em;
    font-weight: 500;
    color: var(--pico-muted-color);
  }
  .status-tag {
    font-size: 0.75rem;
    padding: 0.15rem 0.5rem;
    border-radius: 1rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    background: var(--pico-secondary-background);
    color: var(--pico-secondary-inverse);
  }
  .status-running {
    background: var(--pico-primary);
    color: var(--pico-primary-inverse);
    animation: pulse 1.2s ease-in-out infinite;
  }
  .status-paused {
    background: var(--pico-mark-background-color);
    color: var(--pico-color);
  }
  @keyframes pulse {
    50% {
      opacity: 0.6;
    }
  }
  .overview header {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
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
  .overview-actions {
    display: flex;
    gap: 0.5rem;
  }
  .overview-actions button {
    width: auto;
    margin: 0;
  }
  .error {
    color: var(--pico-del-color);
  }
</style>
