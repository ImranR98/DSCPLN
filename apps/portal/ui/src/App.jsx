import { useEffect, useRef, useState } from 'react'
import {
  Boxes,
  DollarSign,
  MessageSquareText,
  RefreshCw,
  Settings,
  Workflow,
  Wrench,
} from 'lucide-react'
import {
  AppHeader,
  formatBytes,
  formatDateTime,
  formatNumber,
  formatTime,
  getJson,
  humanAgo,
  ping,
  postJson,
  putJson,
  SettingsDialog,
  ThemeToggle,
} from '@dscpln/ui-kit'
import FunctionCard from './FunctionCard.jsx'
import { taskBucket } from './taskBuckets.js'

const ICONS = {
  boxes: Boxes,
  dollar: DollarSign,
  message: MessageSquareText,
  workflow: Workflow,
  wrench: Wrench,
}

const DEFAULT_FUNCTIONS = [
  { path: 'balance', icon: 'dollar', name: 'Balance XLSX', description: 'Budget dashboard backed by the live workbook', kind: 'balance' },
  { path: 'pipelines', icon: 'workflow', name: 'File Pipelines', description: 'Scheduled folder pipelines: standardize, copy, archive', kind: 'pipelines' },
  { path: 'watxt', icon: 'message', name: 'WhatsApp TXT', description: 'Browse, import and merge WhatsApp exports', kind: 'watxt' },
  { path: 'tasks', icon: 'wrench', name: 'Task Runner', description: 'Scheduled and on-demand workflows', kind: 'tasks' },
]

const EMPTY = {
  loaded: false,
  online: true,
  issue: false,
  kicker: '',
  primary: { value: '—', label: '', tone: '' },
  progress: null,
  stats: [],
  footer: { text: '', tone: '' },
}

const asNumber = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback

const moneyText = (value, code, symbol = '') => {
  const amount = asNumber(value)
  const prefix = symbol || (code ? `${code} ` : '')
  const formatted = new Intl.NumberFormat(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Math.abs(amount))
  return `${amount < 0 ? '−' : ''}${prefix}${formatted}`
}

const stat = (label, value, tone = '') => ({ label, value: String(value), tone })

const SETTINGS_FIELDS = [
  {
    path: 'ntfy.url',
    label: 'ntfy URL',
    placeholder: 'http://ntfy.example:3000/<topic>',
    help: 'Every app sends its notifications through the portal; this URL and token are the only ones used to reach ntfy.',
  },
  {
    path: 'ntfy.token',
    label: 'ntfy token',
    type: 'password',
    help: 'Write-only: leave the masked value to keep the stored token.',
  },
]

async function scheduledDetail(fn) {
  const state = await getJson(`${fn.path}/api/state`)
  const last = state.lastRun
  let primary = { value: 'Never', label: 'last run', tone: '' }
  let issue = false
  if (state.runMarker) primary = { value: 'Running', label: 'now', tone: 'ok' }
  else if (last) {
    primary = { value: last.ok ? 'OK' : 'Failed', label: `last ${humanAgo(last.endedAt)}`, tone: last.ok ? 'ok' : 'over' }
    issue = !last.ok
  }
  const stats = [
    stat('Next', state.paused ? 'Paused' : Number.isFinite(state.nextRun) ? formatDateTime(state.nextRun) : 'Manual', state.paused ? 'warn' : ''),
    stat('Missed', state.missed ?? 0, state.missed ? 'warn' : ''),
    stat('Status', state.paused ? 'Paused' : 'Scheduled', state.paused ? 'warn' : 'ok'),
  ]
  return {
    issue,
    kicker: fn.name,
    primary,
    stats,
    footer: { text: state.paused ? 'Scheduled runs are paused' : 'Scheduled workflow', tone: state.paused ? 'warn' : '' },
  }
}

async function pipelinesDetail(fn) {
  const state = await getJson(`${fn.path}/api/state`)
  let active = 0
  let review = 0
  let errors = 0
  let lastEventAt = 0
  const folders = state.folders ?? []
  for (const folder of folders) {
    const counts = folder.counts ?? {}
    active += (counts.pending ?? 0) + (counts.queued ?? 0) + (counts.processing ?? 0)
    review += counts.review ?? 0
    errors += (counts.error ?? 0) + (counts.conflict ?? 0)
    lastEventAt = Math.max(lastEventAt, asNumber(folder.lastEventAt))
  }
  const paused = Boolean(state.paused)
  const dryRun = Boolean(state.dryRun)
  const footer = paused
    ? { text: 'Paused', tone: 'warn' }
    : dryRun
      ? { text: 'Dry run · no files are written', tone: 'warn' }
      : lastEventAt
        ? { text: `Last change ${humanAgo(lastEventAt)}`, tone: '' }
        : { text: 'Watching for changes', tone: '' }
  return {
    issue: errors > 0,
    kicker: `${folders.length} folder${folders.length === 1 ? '' : 's'}`,
    primary: {
      value: active ? formatNumber(active) : 'Idle',
      label: active ? 'in flight' : 'queue',
      tone: active ? 'ok' : '',
    },
    stats: [
      stat('Review', formatNumber(review), review ? 'warn' : ''),
      stat('Errors', formatNumber(errors), errors ? 'over' : ''),
      stat('Folders', formatNumber(folders.length)),
    ],
    footer,
  }
}

async function watxtDetail(fn) {
  const state = await getJson(`${fn.path}/api/state`)
  const skipped = Array.isArray(state.skipped) ? state.skipped.length : asNumber(state.skipped)
  const indexed = state.indexedAt ? `Indexed ${humanAgo(Date.parse(state.indexedAt))}` : 'Not indexed yet'
  return {
    issue: false,
    kicker: state.watching ? 'Watching for exports' : 'Indexed library',
    primary: { value: formatNumber(state.conversations ?? 0), label: 'conversations', tone: 'ok' },
    stats: [
      stat('Messages', formatNumber(state.messages ?? 0)),
      stat('Size', state.bytes == null ? '—' : formatBytes(state.bytes)),
      stat('Skipped', formatNumber(skipped), skipped ? 'warn' : ''),
    ],
    footer: { text: indexed, tone: state.watching ? 'ok' : '' },
  }
}

async function tasksDetail(fn) {
  const data = await getJson(`${fn.path}/api/tasks`)
  const tasks = (data.groups ?? []).flatMap((group) => group.tasks ?? [])
  const scheduled = tasks.filter((task) => task.schedule?.enabled)
  const counts = { stale: 0, recent: 0, errors: 0 }
  for (const task of tasks) counts[taskBucket(task)] += 1
  const stale = counts.stale
  const recent = counts.recent
  const errors = counts.errors
  const next = scheduled
    .filter((task) => Number.isFinite(task.next_run))
    .sort((a, b) => a.next_run - b.next_run)[0] ?? null
  return {
    issue: errors > 0,
    kicker: `${tasks.length} task${tasks.length === 1 ? '' : 's'}`,
    primary: { value: formatNumber(scheduled.length), label: 'scheduled', tone: scheduled.length ? 'ok' : '' },
    stats: [
      stat('Stale', formatNumber(stale), stale ? 'warn' : ''),
      stat('Recent', formatNumber(recent), recent ? 'ok' : ''),
      stat('Errors', formatNumber(errors), errors ? 'over' : ''),
    ],
    footer: next
      ? { text: `Next: ${next.name} · ${formatDateTime(next.next_run)}`, tone: '' }
      : { text: 'No active schedules', tone: '' },
  }
}

async function balanceDetail(fn) {
  const status = await getJson(`${fn.path}/status`)
  const summary = status.summary
  if (!summary) {
    const over = status.overBudget ?? []
    return {
      issue: false,
      kicker: 'Budget overview',
      primary: { value: '—', label: 'summary unavailable', tone: '' },
      stats: [{ label: 'Over budget', value: over.join(', ') || 'None', tone: over.length ? 'over' : '' }],
      footer: { text: over.length ? 'Open Balance to review the budget' : 'Within budget', tone: over.length ? 'over' : 'ok' },
    }
  }
  const budget = asNumber(summary.budget)
  const spend = asNumber(summary.spend)
  const left = summary.left == null ? null : asNumber(summary.left)
  const hasBudget = budget > 0 && left != null
  const pct = hasBudget ? Math.min(100, (spend / budget) * 100) : null
  const over = Boolean(summary.overBudget)
  const tone = over ? 'over' : 'ok'
  const code = summary.code || ''
  const symbol = summary.symbol || ''
  const stats = hasBudget
    ? [
        stat('Budget', moneyText(budget, code, symbol)),
        stat('Left', moneyText(left, code, symbol), left < 0 ? 'over' : ''),
        stat('Transactions', formatNumber(summary.transactions ?? 0)),
      ]
    : [
        stat('Transactions', formatNumber(summary.transactions ?? 0)),
        stat('Currencies', formatNumber(summary.currencies ?? 0)),
        stat('Budget', 'Not set', 'warn'),
      ]
  return {
    issue: false,
    kicker: [summary.period, code].filter(Boolean).join(' · '),
    primary: { value: moneyText(spend, code, symbol), label: hasBudget ? 'spent this month' : 'spent', tone },
    progress: pct == null ? null : { pct, tone: over ? 'over' : 'ok' },
    stats,
    footer: over
      ? { text: `Over budget by ${moneyText(Math.abs(left ?? 0), code, symbol)}`, tone: 'over' }
      : hasBudget
        ? { text: `${moneyText(left, code, symbol)} left this month`, tone: 'ok' }
        : { text: 'No budget set', tone: 'warn' },
  }
}

const DETAILS = {
  scheduled: scheduledDetail,
  pipelines: pipelinesDetail,
  watxt: watxtDetail,
  tasks: tasksDetail,
  balance: balanceDetail,
}

const withIcons = (list) => list.map((fn) => ({ ...fn, icon: ICONS[fn.icon] ?? Boxes }))
const emptyCards = (list = DEFAULT_FUNCTIONS) => Object.fromEntries(list.map((fn) => [fn.path, { ...EMPTY }]))

export default function App() {
  const [functions, setFunctions] = useState(() => withIcons(DEFAULT_FUNCTIONS))
  const [cards, setCards] = useState(() => emptyCards())
  const cardsRef = useRef(cards)
  cardsRef.current = cards
  const [checkedAt, setCheckedAt] = useState(null)
  const [busy, setBusy] = useState(false)
  const settingsRef = useRef(null)
  const [testing, setTesting] = useState(false)
  const [testStatus, setTestStatus] = useState(null)

  const openSettings = async () => {
    const config = await getJson('api/config')
    setTestStatus(null)
    settingsRef.current?.show(config)
  }

  const saveSettings = async (draft) => {
    await putJson('api/config', draft)
  }

  const testNotification = async (draft) => {
    setTesting(true)
    setTestStatus(null)
    try {
      await postJson('api/notify/test', { url: draft.ntfy?.url ?? '', token: draft.ntfy?.token ?? '' })
      setTestStatus({ tone: 'ok', text: 'Test notification sent.' })
    } catch (err) {
      setTestStatus({ tone: 'error', text: err.message })
    } finally {
      setTesting(false)
    }
  }

  const settingsExtra = ({ draft }) => (
    <section className="settings-section">
      <h3>Test</h3>
      <div className="ntfy-test">
        <button
          className="outline"
          type="button"
          disabled={testing}
          data-testid="notify-test"
          onClick={() => testNotification(draft)}
        >
          {testing ? 'Sending…' : 'Send test notification'}
        </button>
      </div>
      {testStatus ? (
        <p className={testStatus.tone === 'error' ? 'form-error' : 'hint'} data-testid="notify-test-status">
          {testStatus.text}
        </p>
      ) : null}
    </section>
  )

  const refresh = async (list = functions) => {
    setBusy(true)
    const next = {}
    await Promise.all(
      list.map(async (fn) => {
        const online = await ping(`${fn.path}/api/health`)
        const previous = cardsRef.current[fn.path]
        let card = { ...EMPTY, loaded: true, online }
        if (online) {
          try {
            card = { ...card, ...(await (DETAILS[fn.kind] ?? scheduledDetail)(fn)) }
          } catch {
            card = { ...card, footer: { text: 'Summary unavailable', tone: 'warn' } }
          }
        } else {
          // Keep the last known summary so an offline tile can explain itself.
          card = { ...EMPTY, ...(previous ?? {}), loaded: true, online: false, issue: true }
        }
        next[fn.path] = card
      }),
    )
    cardsRef.current = next
    setCards(next)
    setCheckedAt(Date.now())
    setBusy(false)
  }

  useEffect(() => {
    let cancelled = false
    let currentList = withIcons(DEFAULT_FUNCTIONS)
    const loadFunctions = async () => {
      let list = DEFAULT_FUNCTIONS
      try {
        const data = await getJson('api/functions')
        if (Array.isArray(data.functions) && data.functions.length) list = data.functions
      } catch {
        // Keep the built-in list when the portal has no config yet.
      }
      if (cancelled) return
      currentList = withIcons(list)
      setFunctions(currentList)
      setCards(emptyCards(currentList))
      refresh(currentList)
    }
    loadFunctions()
    const timer = setInterval(() => refresh(currentList), 60_000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const attention = Object.values(cards).filter((card) => card.loaded && (!card.online || card.issue)).length

  return (
    <>
      <AppHeader
        meta="Every backup and sync workflow, one place."
        metaTools={(
          <>
            <span className={`portal-attention ${attention ? 'is-over' : 'is-ok'}`} data-testid="attention">
              {checkedAt ? (attention ? `${attention} need attention` : 'all healthy') : 'checking…'}
            </span>
            {checkedAt ? <span className="muted" data-testid="checked">checked {formatTime(checkedAt)}</span> : null}
          </>
        )}
        actions={(
          <>
            <button className="outline secondary icon-button" type="button" aria-label="Notification settings" title="Notification settings"
              onClick={openSettings} data-testid="settings-open">
              <Settings size={16} strokeWidth={1.8} />
            </button>
            <button className="outline secondary icon-button" type="button" aria-label="Refresh status" title="Refresh status"
              disabled={busy} onClick={refresh}>
              <RefreshCw size={16} strokeWidth={1.8} />
            </button>
            <ThemeToggle />
          </>
        )}
      />

      <main>
        <div className="portal-grid">
          {functions.map((fn) => (
            <FunctionCard key={fn.path} fn={fn} card={cards[fn.path]} />
          ))}
        </div>
      </main>

      <SettingsDialog
        ref={settingsRef}
        fields={SETTINGS_FIELDS}
        schedule={false}
        notice="Notifications for every app are sent through the portal to the ntfy topic configured here."
        onsave={saveSettings}
        extra={settingsExtra}
      />
    </>
  )
}
