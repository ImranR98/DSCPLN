import { useCallback, useEffect, useMemo, useState } from 'react'
import { RefreshCw, ShieldAlert, ShieldCheck, TimerReset } from 'lucide-react'
import {
  AppHeader,
  Dialog,
  formatDateTime,
  formatDuration,
  getJson,
  postJson,
  showToast,
  ThemeToggle,
  Toasts,
  usePolling,
} from '@dscpln/ui-kit'
import './lockdown.css'

const DURATIONS = [
  { value: '600', label: '10 minutes' },
  { value: '900', label: '15 minutes' },
  { value: '1800', label: '30 minutes' },
  { value: '3600', label: '1 hour' },
  { value: '21600', label: '6 hours' },
  { value: '43200', label: '12 hours' },
  { value: '86400', label: '24 hours' },
]

const portText = (preset) => preset.ports.map((port) => `${preset.protocol.toUpperCase()} ${port}`).join(', ')

function activeLabel(status) {
  if (!status) return 'Waiting for port blocker'
  const presets = status.presets ?? []
  if (!presets.length) return 'No presets configured'
  const active = presets.filter((preset) => preset.active)
  if (!active.length) return 'All ports open'
  return active.map((preset) => preset.label).join(' + ')
}

function expiryText(preset) {
  if (!preset?.active) return ''
  if (!preset.expiresAt) return 'Until cleared'
  return `Expires ${formatDateTime(preset.expiresAt)}`
}

function remainingText(preset) {
  if (!preset?.active || !preset.remainingSeconds) return ''
  return `${formatDuration(preset.remainingSeconds)} remaining`
}

function PresetCard({ preset, duration, onDuration, onOpen, busy }) {
  return (
    <article className={`card lockdown-card${preset.active ? ' is-active' : ''}`} data-testid={`preset-${preset.id}`}>
      <div className="card__header">
        <h2>{preset.label}</h2>
        <span className={`status-tag ${preset.active ? 'status-tag--blocked' : ''}`} data-testid={`state-${preset.id}`}>
          {preset.active ? 'Active' : 'Open'}
        </span>
      </div>
      <p className="lockdown-card__lead">{preset.short}</p>
      <p className="muted lockdown-card__ports">{portText(preset)}</p>
      {preset.active ? (
        <div className="lockdown-card__active">
          <strong>{expiryText(preset)}</strong>
          <span className="muted">{remainingText(preset)}</span>
        </div>
      ) : (
        <p className="muted">{preset.effect}</p>
      )}
      <div className="lockdown-card__controls">
        <label>
          Duration
          <select value={duration} onChange={(event) => onDuration(event.target.value)} disabled={busy}>
            {preset.allowIndefinite ? <option value="indefinite">Until cleared</option> : null}
            {DURATIONS.map((entry) => (
              <option key={entry.value} value={entry.value}>{entry.label}</option>
            ))}
          </select>
        </label>
        <button
          className={preset.active ? 'outline secondary' : ''}
          type="button"
          disabled={busy}
          onClick={() => onOpen(preset)}
          data-testid={`open-${preset.id}`}
        >
          {preset.active ? 'Replace block' : 'Block'}
        </button>
      </div>
    </article>
  )
}

export default function App() {
  const [status, setStatus] = useState(null)
  const [statusError, setStatusError] = useState('')
  const [durations, setDurations] = useState({})
  const [action, setAction] = useState(null)
  const [phrase, setPhrase] = useState('')
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const next = await getJson('api/status')
      setStatus(next)
      setStatusError('')
    } catch (err) {
      setStatusError(err.message)
    }
  }, [])

  usePolling(refresh, 5_000)

  const presets = useMemo(() => status?.presets ?? [], [status])
  const active = presets.filter((preset) => preset.active)
  const pending = Object.keys(status?.pending ?? {})
  const tone = statusError ? 'over' : active.length ? 'warn' : 'ok'
  const meta = statusError ? 'Port blocker unavailable' : activeLabel(status)

  useEffect(() => {
    if (!presets.length) return
    setDurations((current) => {
      let changed = false
      const next = { ...current }
      for (const preset of presets) {
        if (next[preset.id] !== undefined) continue
        next[preset.id] = preset.allowIndefinite && preset.defaultDurationSeconds == null
          ? 'indefinite'
          : String(preset.defaultDurationSeconds ?? 600)
        changed = true
      }
      return changed ? next : current
    })
  }, [presets])

  const openAction = (preset) => {
    const raw = durations[preset.id] ?? (preset.allowIndefinite ? 'indefinite' : '600')
    setPhrase('')
    setAction({
      preset,
      durationSeconds: raw === 'indefinite' ? null : Number(raw),
    })
  }

  const openClear = () => {
    setPhrase('')
    setAction({ clear: true })
  }

  const closeAction = () => {
    if (!busy) {
      setAction(null)
      setPhrase('')
    }
  }

  const confirm = async () => {
    if (!action) return
    setBusy(true)
    try {
      if (action.clear) {
        await postJson('api/clear', { confirmation: phrase })
        showToast('All port blocks cleared')
      } else {
        await postJson('api/block', {
          preset: action.preset.id,
          durationSeconds: action.durationSeconds,
          confirmation: phrase,
        })
        showToast(
          action.preset.allowIndefinite && action.durationSeconds == null
            ? 'Indefinite block scheduled. Confirm you can still reach this page.'
            : 'Block scheduled. The page may disconnect; the timer is the recovery path.',
        )
      }
      setAction(null)
      setPhrase('')
      await refresh()
    } catch (err) {
      showToast(err.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const actionInfo = action?.clear
    ? {
        label: 'Clear all port blocks',
        effect: 'Removes every active block from the port blocker. Public access returns immediately.',
        warning: 'This only clears the port blocker. It does not undo any other change on the host.',
        confirmation: 'CLEAR',
        danger: false,
      }
    : action?.preset

  const actionExpiry = action?.clear
    ? 'Immediately'
    : action?.durationSeconds == null
      ? 'Until cleared'
      : formatDateTime(Date.now() + action.durationSeconds * 1000)

  return (
    <>
      <AppHeader
        name="Lockdown"
        meta={<span className={`status-tag status-tag--${tone === 'warn' ? 'blocked' : tone === 'over' ? 'interrupted' : 'ok'}`} data-testid="status">{meta}</span>}
        metaTools={status ? `checked ${formatDateTime(status.now)}` : null}
        actions={(
          <>
            <button className="outline secondary icon-button" type="button" title="Refresh" aria-label="Refresh" onClick={refresh}>
              <RefreshCw size={16} strokeWidth={1.8} />
            </button>
            <ThemeToggle />
          </>
        )}
      />

      <main>
        {statusError ? (
          <section className="card card--over" data-testid="blocker-error">
            <div className="card__header"><h2>Port blocker</h2></div>
            <p>{statusError}</p>
            <button className="outline" type="button" onClick={refresh}>Retry</button>
          </section>
        ) : null}

        <section className="card card--hero">
          <div className="card__header">
            <h2>Overview</h2>
            <span className="card__context">{status?.limits ? `${status.limits.minDurationSeconds / 60} min – ${status.limits.maxDurationSeconds / 3600} h timed` : ''}</span>
          </div>
          {presets.length ? (
            <div className="lockdown-tiles">
              {presets.map((preset) => (
                <div className="stat-tile" key={preset.id}>
                  <span className="stat-tile__label">{preset.label}</span>
                  <span className={`stat-tile__value${preset.active ? ' is-over' : ' is-ok'}`}>
                    {preset.active ? 'Blocked' : 'Open'}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="muted">No presets configured. Mount a Lockdown config in the deployment.</p>
          )}
          {active.length ? (
            <ul className="lockdown-active-list" data-testid="active-list">
              {active.map((preset) => (
                <li key={preset.id}>
                  <strong>{preset.label}</strong>
                  <span>{portText(preset)}</span>
                  <span>{expiryText(preset)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted" data-testid="no-active">No port blocks active.</p>
          )}
          {pending.length ? (
            <p className="muted">
              Applying: {pending.map((id) => presets.find((preset) => preset.id === id)?.label ?? id).join(', ')}
            </p>
          ) : null}
          {active.length ? (
            <div className="lockdown-actions">
              <button className="outline secondary" type="button" onClick={openClear} data-testid="open-clear">
                <TimerReset size={16} strokeWidth={1.8} /> Clear all blocks
              </button>
            </div>
          ) : null}
        </section>

        {presets.length ? (
          <div className="lockdown-grid">
            {presets.map((preset) => (
              <PresetCard
                key={preset.id}
                preset={preset}
                duration={durations[preset.id] ?? (preset.allowIndefinite ? 'indefinite' : '600')}
                onDuration={(value) => setDurations((current) => ({ ...current, [preset.id]: value }))}
                onOpen={openAction}
                busy={busy}
              />
            ))}
          </div>
        ) : null}

        <section className="card lockdown-note">
          <div className="card__header"><h2>What survives</h2></div>
          <p><ShieldAlert size={16} strokeWidth={1.8} /> A host reboot clears all blocks. A timed block also clears when its nftables timeout expires.</p>
          <p><ShieldCheck size={16} strokeWidth={1.8} /> Removing a block is possible while the control page is reachable. Some presets may not be undoable remotely.</p>
          <p className="muted">Presets, ports and descriptions come from the deployment config. The browser can only submit a configured preset ID.</p>
        </section>
      </main>

      {actionInfo ? (
        <Dialog
          title={action?.clear ? 'Clear all port blocks' : `Block ${actionInfo.label}`}
          onClose={closeAction}
          requestClose={closeAction}
          className="wide-dialog"
          actions={(
            <>
              <button className="outline secondary" type="button" onClick={closeAction} disabled={busy}>Cancel</button>
              <button
                className={!action?.clear && actionInfo.danger ? 'danger' : action?.clear ? 'outline secondary' : ''}
                type="button"
                onClick={confirm}
                disabled={busy || phrase !== actionInfo.confirmation}
                data-testid="confirm-action"
              >
                {busy ? 'Applying…' : action?.clear ? 'Clear blocks' : 'Apply block'}
              </button>
            </>
          )}
        >
          <p>{actionInfo.effect}</p>
          {!action?.clear ? (
            <ul className="lockdown-dialog-list">
              <li><strong>Ports:</strong> {portText(action.preset)}</li>
              <li><strong>Duration:</strong> {action.durationSeconds == null ? 'Until cleared' : formatDuration(action.durationSeconds)}</li>
              <li><strong>Expires:</strong> {actionExpiry}</li>
              <li><strong>Reboot:</strong> A host reboot clears this block immediately.</li>
            </ul>
          ) : null}
          {actionInfo.warning ? <p className="form-error">{actionInfo.warning}</p> : null}
          <p className="muted">
            The action is sent to the port blocker with a short delay so this response can return.
            Type <code>{actionInfo.confirmation}</code> to confirm.
          </p>
          <label>
            Confirmation
            <input
              autoFocus
              value={phrase}
              onChange={(event) => setPhrase(event.target.value)}
              placeholder={actionInfo.confirmation}
              data-testid="confirmation"
            />
          </label>
        </Dialog>
      ) : null}

      <Toasts />
    </>
  )
}
