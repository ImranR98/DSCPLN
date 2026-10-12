<script>
  import { onMount } from 'svelte'
  import {
    Activity,
    ListRestart,
    Pause,
    Play,
    RefreshCw,
    ScrollText,
    Settings,
  } from 'lucide-svelte'
  import { getJson, postJson, putJson, subscribe } from './api.js'
  import { formatDateTime, formatDuration, formatTime, humanAgo } from './format.js'
  import ThemeToggle from './ThemeToggle.svelte'
  import LogDialog from './LogDialog.svelte'
  import SettingsDialog from './SettingsDialog.svelte'
  import Toasts from './Toasts.svelte'
  import { showToast } from './toast.svelte.js'

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
  let interruptedAt = $state(null)
  let updatedAt = $state(null)
  let logDialog = $state(null)
  let settingsDialog = $state(null)

  const running = $derived(Boolean(state?.run?.running ?? state?.running))
  const paused = $derived(Boolean(config.paused))
  const status = $derived(running ? 'running' : interruptedAt ? 'interrupted' : paused ? 'paused' : 'live')
  const statusText = $derived(status)
  const last = $derived(state?.lastRun ?? null)
  const history = $derived(state?.history ?? [])

  const tiles = $derived.by(() => {
    if (!state) return []
    return [
      { label: 'Last run', value: last ? humanAgo(last.endedAt) : 'Never' },
      { label: 'Result', value: last ? (last.ok ? 'OK' : 'Failed') : '—', tone: last ? (last.ok ? 'ok' : 'over') : null },
      { label: 'Duration', value: last ? formatDuration(last.durationSec) : '—' },
      { label: 'Next run', value: state.nextRun ? formatDateTime(state.nextRun) : 'Manual' },
      state.missed ? { label: 'Missed', value: String(state.missed), tone: 'warn' } : null,
    ].filter(Boolean)
  })

  function renderState(next, { keepConfig = false } = {}) {
    if (!next) return
    state = next
    if (!keepConfig && next.config) config = next.config
    if (next.paused !== undefined) config = { ...config, paused: next.paused }
    const isRunning = Boolean(next.run?.running ?? next.running)
    interruptedAt = !isRunning && next.runMarker && (next.lastRun?.endedAt ?? 0) < next.runMarker.startedAt ? next.runMarker.startedAt : null
    updatedAt = Date.now()
  }

  async function refresh() {
    try {
      renderState(await getJson('api/state'))
    } catch {
      // keep the last known state
    }
  }

  async function runNow() {
    try {
      await postJson('api/run', {})
      showToast(`${name}: run started`)
      await refresh()
    } catch (err) {
      showToast(err.message, 'error')
    }
  }

  async function stop() {
    try {
      await postJson('api/cancel', {})
      showToast('Cancelling…')
    } catch (err) {
      showToast(err.message, 'error')
    }
  }

  async function togglePause() {
    try {
      await postJson('api/pause', { paused: !paused })
      showToast(paused ? 'Resumed' : 'Paused')
      await refresh()
    } catch (err) {
      showToast(err.message, 'error')
    }
  }

  async function saveConfig(next) {
    const saved = await putJson('api/config', next)
    config = saved
    if (state) state = { ...state, config: saved }
    onconfig?.(saved)
    await refresh()
    return saved
  }

  onMount(() => {
    refresh()
    const unsubscribe = subscribe('', (event) => {
      if (event.type === 'line' && logDialog) logDialog.append(event.line)
      else if (event.type === 'state' && event.state) renderState(event.state)
      else if (event.type === 'config' && event.config) config = event.config
      else if (event.type === 'update') refresh()
    }, { events: 'events' })
    const timer = setInterval(refresh, 15_000)
    return () => {
      unsubscribe()
      clearInterval(timer)
    }
  })
</script>

<header class="app-header" data-app={name}>
  <div class="app-header__top">
    <h1>
      <a class="app-header__brand" href="/">D<span class="accent">$</span>CPLN</a>
      <span class="app-header__app">· {name}</span>
    </h1>
    <div class="app-header__actions">
      <button class="outline secondary icon-button" type="button" title={paused ? 'Resume' : 'Pause'} aria-label="Pause/Resume" onclick={togglePause}>
        {#if paused}<Play size={16} strokeWidth={1.8} />{:else}<Pause size={16} strokeWidth={1.8} />{/if}
      </button>
      {@render actions?.()}
      <button class="outline secondary icon-button" type="button" title="Settings" aria-label="Settings" onclick={() => settingsDialog.show(config)}>
        <Settings size={16} strokeWidth={1.8} />
      </button>
      <button class="outline secondary icon-button" type="button" title="Refresh" aria-label="Refresh" onclick={refresh}>
        <RefreshCw size={16} strokeWidth={1.8} />
      </button>
      <ThemeToggle />
    </div>
  </div>
  <div class="app-header__meta">
    <span class={`status-tag status-tag--${status}`} data-testid="status"><span>{statusText}</span></span>
    <span class="app-header__meta-tools muted">{updatedAt ? `updated ${formatTime(updatedAt)}` : ''}</span>
  </div>
</header>

<main>
  <section class="card card--hero" id="overviewCard">
    <div class="card__header">
      <h2>Overview</h2>
      <span class="card__header-tools">
        <span class="card__context">{state?.nextRun ? `next ${formatDateTime(state.nextRun)}` : ''}</span>
      </span>
    </div>

    <div class="stat-tiles">
      {#each tiles as tile (tile.label)}
        <div class="stat-tile">
          <span class="stat-tile__label">{tile.label}</span>
          <span class={`stat-tile__value${tile.tone ? ` is-${tile.tone}` : ''}`}>{tile.value ?? '—'}</span>
        </div>
      {/each}
    </div>

    <div class="overview__actions">
      {#if running}
        <button class="danger" onclick={stop} data-testid="stop">Stop</button>
      {:else}
        <button onclick={runNow} data-testid="run-now">Run now</button>
      {/if}
      <button class="outline secondary" onclick={() => logDialog.show()} data-testid="show-log"><ScrollText size={16} strokeWidth={1.8} /> Log</button>
    </div>

    {#if last?.summary}<p class="muted">{last.summary}</p>{/if}

    <div class="run-history" hidden={!history.length}>
      {#if history.length}
        <h3>Recent runs</h3>
        <ul class="run-history__list">
          {#each history.slice(0, 10) as run (run.startedAt + ':' + run.endedAt)}
            <li class={run.ok ? 'is-ok' : 'is-fail'}>
              <span>{formatDateTime(run.endedAt)}</span>
              <span>{run.ok ? 'OK' : 'Failed'}</span>
              <span class="muted">{formatDuration(run.durationSec)}</span>
              <span class="run-history__summary">{run.summary ?? ''}</span>
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  </section>

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
<Toasts />

<style>
  .overview__actions button {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
  }
</style>
