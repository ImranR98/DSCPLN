<script>
  import { onMount } from 'svelte'
  import {
    Boxes,
    Contact,
    DollarSign,
    MessageSquareText,
    Music,
    Play,
    RefreshCw,
    Wrench,
  } from 'lucide-svelte'
  import { apiUrl, formatDateTime, formatTime, getJson, humanAgo, ThemeToggle } from '@dscpln/ui-kit'
  import FunctionCard from './FunctionCard.svelte'

  const FUNCTIONS = [
    { path: 'balance', icon: DollarSign, name: 'Balance XLSX', description: 'Budget dashboard backed by the live workbook', kind: 'balance' },
    { path: 'media', icon: Play, name: 'Media Sync', description: 'Device media ingestion, review and cleanup', kind: 'media' },
    { path: 'watxt', icon: MessageSquareText, name: 'WhatsApp TXT', description: 'Browse, import and merge WhatsApp exports', kind: 'watxt' },
    { path: 'tasks', icon: Wrench, name: 'Task Runner', description: 'Config-driven backup and export workflows', kind: 'tasks' },
    { path: 'contacts', icon: Contact, name: 'Contacts + Calendar', description: 'Scheduled Nextcloud exports', kind: 'scheduled' },
    { path: 'compose', icon: Boxes, name: 'Infra Compose State', description: 'Scheduled Compose runtime-state backups', kind: 'scheduled' },
    { path: 'ytmusic', icon: Music, name: 'YTMusic Downloads', description: 'Scheduled YouTube Music library downloads', kind: 'scheduled' },
  ]

  const EMPTY = { loaded: false, online: true, detail: '', tone: '', next: '', nextTone: '', issue: false }

  let cards = $state(Object.fromEntries(FUNCTIONS.map((fn) => [fn.path, { ...EMPTY }])))
  let checkedAt = $state(null)
  let busy = $state(false)

  async function ping(fn) {
    try {
      const response = await fetch(apiUrl(`${fn.path}/api/health`), {
        signal: AbortSignal.timeout(5000),
      })
      return response.ok
    } catch {
      return false
    }
  }

  async function scheduledDetail(fn) {
    const state = await getJson(`${fn.path}/api/state`)
    const last = state.lastRun
    let detail = 'never run'
    let tone = ''
    let issue = false
    if (state.runMarker) {
      detail = 'running now'
      tone = 'ok'
    } else if (last) {
      detail = `last ${humanAgo(last.endedAt)} · ${last.ok ? 'OK' : 'Failed'}`
      tone = last.ok ? 'ok' : 'over'
      issue = !last.ok
    }
    let next = 'manual only'
    let nextTone = ''
    if (state.paused) {
      next = 'paused'
      nextTone = 'warn'
    } else if (Number.isFinite(state.nextRun)) {
      next = `next ${formatDateTime(state.nextRun)}`
      if (state.missed) {
        next += ` · ${state.missed} missed`
        nextTone = 'warn'
        issue = true
      }
    }
    return { detail, tone, next, nextTone, issue }
  }

  async function mediaDetail(fn) {
    const state = await getJson(`${fn.path}/api/state`)
    if (state.paused) return { detail: 'paused', tone: 'warn', issue: false }
    let active = 0
    let review = 0
    let errors = 0
    for (const folder of state.folders ?? []) {
      const counts = folder.counts ?? {}
      active += (counts.pending ?? 0) + (counts.queued ?? 0) + (counts.processing ?? 0)
      review += counts.review ?? 0
      errors += (counts.error ?? 0) + (counts.conflict ?? 0)
    }
    const parts = []
    if (active) parts.push(`${active} active`)
    if (review) parts.push(`${review} in review`)
    if (errors) parts.push(`${errors} errors`)
    return {
      detail: parts.join(' · ') || 'idle',
      tone: errors ? 'over' : review ? 'warn' : 'ok',
      issue: errors > 0,
    }
  }

  async function watxtDetail(fn) {
    const state = await getJson(`${fn.path}/api/state`)
    return {
      detail: `${state.conversations ?? 0} conversations · ${state.messages ?? 0} messages`,
      tone: '',
      issue: false,
    }
  }

  async function tasksDetail(fn) {
    const data = await getJson(`${fn.path}/api/tasks`)
    const tasks = (data.groups ?? []).flatMap((group) => group.tasks ?? [])
    const running = tasks.filter((task) => task.running).length
    const failing = tasks.filter((task) => task.state && task.state.ok === false && !task.running).length
    let detail = `${tasks.length} tasks`
    if (running) detail += ` · ${running} running`
    if (failing) detail += ` · ${failing} failing`
    return { detail, tone: failing ? 'over' : 'ok', issue: failing > 0 }
  }

  async function balanceDetail(fn) {
    const status = await getJson(`${fn.path}/status`)
    if (status.overBudget?.length) {
      return { detail: `${status.overBudget.join(', ')} over budget`, tone: 'over', issue: true }
    }
    return { detail: 'within budget', tone: 'ok', issue: false }
  }

  const DETAILS = {
    scheduled: scheduledDetail,
    media: mediaDetail,
    watxt: watxtDetail,
    tasks: tasksDetail,
    balance: balanceDetail,
  }

  async function refresh() {
    busy = true
    const next = {}
    await Promise.all(
      FUNCTIONS.map(async (fn) => {
        const online = await ping(fn)
        let card = { ...EMPTY, loaded: true, online }
        if (online) {
          try {
            card = { ...card, ...(await DETAILS[fn.kind](fn)) }
          } catch {
            // detail is best-effort; the card still links to the app
          }
        }
        next[fn.path] = card
      }),
    )
    cards = next
    checkedAt = Date.now()
    busy = false
  }

  const attention = $derived.by(() => {
    if (!checkedAt) return { text: '', tone: '' }
    let issues = 0
    for (const card of Object.values(cards)) {
      if (!card.online || card.issue) issues += 1
    }
    if (!issues) return { text: 'all good', tone: 'ok' }
    return { text: issues === 1 ? '1 needs attention' : `${issues} need attention`, tone: 'over' }
  })

  onMount(() => {
    refresh()
    const timer = setInterval(refresh, 60_000)
    return () => clearInterval(timer)
  })
</script>

<header class="app-header container">
  <div class="app-header__top">
    <h1>D<span class="accent">$</span>CPLN</h1>
    <div class="app-header__actions">
      <button class="outline secondary" type="button" aria-label="Refresh status" title="Refresh status"
        disabled={busy} onclick={refresh}>
        <RefreshCw size={16} />
      </button>
      <ThemeToggle />
    </div>
  </div>
  <p class="app-header__meta">
    <span>Every backup and sync workflow, one place.</span>
    <span>
      {#if attention.text}<strong class={`status-${attention.tone}`} data-testid="attention">{attention.text}</strong>{/if}
      {#if checkedAt}<small data-testid="checked">checked {formatTime(checkedAt)}</small>{/if}
    </span>
  </p>
</header>

<main class="container">
  <div class="card-grid">
    {#each FUNCTIONS as fn (fn.path)}
      <FunctionCard {fn} card={cards[fn.path]} />
    {/each}
  </div>
</main>
