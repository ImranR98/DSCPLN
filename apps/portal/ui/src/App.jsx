import { useEffect, useState } from 'react'
import {
  Boxes,
  Contact,
  DollarSign,
  MessageSquareText,
  Music,
  RefreshCw,
  Workflow,
  Wrench,
} from 'lucide-react'
import { formatDateTime, formatTime, getJson, humanAgo, ping, ThemeToggle } from '@dscpln/ui-kit'
import FunctionCard from './FunctionCard.jsx'

const FUNCTIONS = [
  { path: 'balance', icon: DollarSign, name: 'Balance XLSX', description: 'Budget dashboard backed by the live workbook', kind: 'balance' },
  { path: 'pipelines', icon: Workflow, name: 'File Pipelines', description: 'Scheduled folder pipelines: standardize, copy, archive', kind: 'pipelines' },
  { path: 'watxt', icon: MessageSquareText, name: 'WhatsApp TXT', description: 'Browse, import and merge WhatsApp exports', kind: 'watxt' },
  { path: 'tasks', icon: Wrench, name: 'Task Runner', description: 'Config-driven backup and export workflows', kind: 'tasks' },
  { path: 'contacts', icon: Contact, name: 'Contacts + Calendar', description: 'Scheduled Nextcloud exports', kind: 'scheduled' },
  { path: 'compose', icon: Boxes, name: 'Infra Compose State', description: 'Scheduled Compose runtime-state backups', kind: 'scheduled' },
  { path: 'ytmusic', icon: Music, name: 'YTMusic Downloads', description: 'Scheduled YouTube Music library downloads', kind: 'scheduled' },
]

const EMPTY = { loaded: false, online: true, detail: '', tone: '', next: '', nextTone: '', issue: false }

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

async function pipelinesDetail(fn) {
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
  pipelines: pipelinesDetail,
  watxt: watxtDetail,
  tasks: tasksDetail,
  balance: balanceDetail,
}

const emptyCards = () => Object.fromEntries(FUNCTIONS.map((fn) => [fn.path, { ...EMPTY }]))

export default function App() {
  const [cards, setCards] = useState(emptyCards)
  const [checkedAt, setCheckedAt] = useState(null)
  const [busy, setBusy] = useState(false)

  const refresh = async () => {
    setBusy(true)
    const next = {}
    await Promise.all(
      FUNCTIONS.map(async (fn) => {
        const online = await ping(`${fn.path}/api/health`)
        const previous = cards[fn.path]
        let card = { ...EMPTY, loaded: true, online }
        if (online) {
          try {
            card = { ...card, ...(await DETAILS[fn.kind](fn)) }
          } catch {
            // detail is best-effort; the card still links to the app
          }
        } else {
          // Keep the last known detail so an offline tile can explain itself.
          card = {
            ...card,
            detail: previous?.detail ?? '',
            tone: previous?.tone ?? '',
            next: previous?.next ?? '',
            nextTone: previous?.nextTone ?? '',
          }
        }
        next[fn.path] = card
      }),
    )
    setCards(next)
    setCheckedAt(Date.now())
    setBusy(false)
  }

  useEffect(() => {
    refresh()
    const timer = setInterval(refresh, 60_000)
    return () => clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <>
      <header className="app-header">
        <div className="app-header__top">
          <h1><a className="app-header__brand" href="/">D<span className="accent">$</span>CPLN</a></h1>
          <div className="app-header__actions">
            <button className="outline secondary icon-button" type="button" aria-label="Refresh status" title="Refresh status"
              disabled={busy} onClick={refresh}>
              <RefreshCw size={16} strokeWidth={1.8} />
            </button>
            <ThemeToggle />
          </div>
        </div>
        <div className="app-header__meta">
          <span className="muted">Every backup and sync workflow, one place.</span>
          <span className="app-header__meta-tools">
            {checkedAt ? <span className="muted" data-testid="checked">checked {formatTime(checkedAt)}</span> : null}
          </span>
        </div>
      </header>

      <main>
        <div className="portal-grid">
          {FUNCTIONS.map((fn) => (
            <FunctionCard key={fn.path} fn={fn} card={cards[fn.path]} />
          ))}
        </div>
      </main>
    </>
  )
}
