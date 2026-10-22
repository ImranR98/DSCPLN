import { useCallback, useMemo, useState } from 'react'
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

const PRESET_ORDER = ['vpn-only', 'traefik-off', 'srv0-tunnel-cut']

const PRESETS = {
  'vpn-only': {
    label: 'VPN-only',
    short: 'Block public ports',
    ports: [80, 8443],
    phrase: 'BLOCK PUBLIC',
    allowIndefinite: true,
    defaultDuration: 30 * 60,
    effect: 'Stops public HTTP and HTTPS access through vps0. TCP 443 remains available over VPN and LAN.',
    warning: 'If you are using the public path, this page will disconnect. Reconnect over VPN or LAN to undo it.',
  },
  'traefik-off': {
    label: 'Cut Traefik',
    short: 'Block all Traefik ingress',
    ports: [80, 443, 8443],
    phrase: 'CUT TRAEFIK',
    allowIndefinite: false,
    defaultDuration: 10 * 60,
    effect: 'Stops all Traefik ingress on srv0, including this page over VPN and LAN.',
    warning: 'You cannot undo this remotely. The timer is the only recovery path unless srv0 reboots.',
  },
  'srv0-tunnel-cut': {
    label: 'Cut srv0 tunnel',
    short: 'Block the public-exposure tunnel',
    ports: [51822],
    protocol: 'udp',
    phrase: 'CUT TUNNEL',
    allowIndefinite: false,
    defaultDuration: 10 * 60,
    effect: 'Blocks srv0 from reaching the vps0 public-exposure hub, which also carries the VPN endpoint.',
    warning: 'Public and VPN access to srv0 will stop. This page remains reachable only from the LAN until the timer expires.',
  },
}

const DURATIONS = [
  { value: '600', label: '10 minutes' },
  { value: '900', label: '15 minutes' },
  { value: '1800', label: '30 minutes' },
  { value: '3600', label: '1 hour' },
  { value: '21600', label: '6 hours' },
  { value: '43200', label: '12 hours' },
  { value: '86400', label: '24 hours' },
]

const portText = (ports = []) => ports.map((port) => `TCP ${port}`).join(', ')

function presetPortText(preset) {
  if (preset === 'srv0-tunnel-cut') return 'UDP 51822'
  return portText(PRESETS[preset].ports)
}

function activeLabel(status) {
  if (!status) return 'Waiting for blocker'
  const active = PRESET_ORDER.filter((id) => status.presets?.[id]?.active)
  if (!active.length) return 'All ports open'
  return active.map((id) => PRESETS[id].label).join(' + ')
}

function expiryText(presetStatus) {
  if (!presetStatus?.active) return ''
  if (!presetStatus.expiresAt) return 'Until cleared'
  return `Expires ${formatDateTime(presetStatus.expiresAt)}`
}

function remainingText(presetStatus) {
  if (!presetStatus?.active || !presetStatus.remainingSeconds) return ''
  return `${formatDuration(presetStatus.remainingSeconds)} remaining`
}

function presetState(status, id) {
  return status?.presets?.[id] ?? { active: false, ports: [], expiresAt: null, remainingSeconds: null }
}

function PresetCard({ id, preset, state, duration, onDuration, onOpen, busy }) {
  const active = Boolean(state.active)
  return (
    <article className={`card lockdown-card${active ? ' is-active' : ''}`} data-testid={`preset-${id}`}>
      <div className="card__header">
        <h2>{preset.label}</h2>
        <span className={`status-tag ${active ? 'status-tag--paused' : ''}`} data-testid={`state-${id}`}>
          {active ? 'Active' : 'Open'}
        </span>
      </div>
      <p className="lockdown-card__lead">{preset.short}</p>
      <p className="muted lockdown-card__ports">{presetPortText(id)}</p>
      {active ? (
        <div className="lockdown-card__active">
          <strong>{expiryText(state)}</strong>
          <span className="muted">{remainingText(state)}</span>
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
          className={active ? 'outline secondary' : 'warning'}
          type="button"
          disabled={busy}
          onClick={() => onOpen(id)}
          data-testid={`open-${id}`}
        >
          {active ? 'Replace block' : 'Block'}
        </button>
      </div>
    </article>
  )
}

export default function App() {
  const [status, setStatus] = useState(null)
  const [statusError, setStatusError] = useState('')
  const [durations, setDurations] = useState(() => Object.fromEntries(
    PRESET_ORDER.map((id) => [id, String(PRESETS[id].defaultDuration)]),
  ))
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

  const active = useMemo(
    () => PRESET_ORDER.filter((id) => presetState(status, id).active),
    [status],
  )
  const pending = useMemo(
    () => Object.keys(status?.pending ?? {}),
    [status],
  )
  const tone = statusError ? 'over' : active.length ? 'warn' : 'ok'
  const meta = statusError ? 'Port blocker unavailable' : activeLabel(status)

  const openAction = (id) => {
    const raw = durations[id]
    setPhrase('')
    setAction({
      preset: id,
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
          preset: action.preset,
          durationSeconds: action.durationSeconds,
          confirmation: phrase,
        })
        showToast(
          action.preset === 'vpn-only'
            ? 'Public port block scheduled. Use VPN or LAN if this page disconnects.'
            : 'Block scheduled. The page will disconnect; the timer will restore access.',
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
        effect: 'Removes every active block from the srv0 port blocker. Public access returns immediately.',
        warning: 'This only clears the port blocker. It does not undo any other change on the host.',
        phrase: 'CLEAR',
      }
    : action
      ? PRESETS[action.preset]
      : null

  const actionExpiry = action?.clear
    ? 'Immediately'
    : action?.durationSeconds == null
      ? 'Until cleared'
      : formatDateTime(Date.now() + action.durationSeconds * 1000)

  return (
    <>
      <AppHeader
        name="Lockdown"
        meta={<span className={`status-tag status-tag--${tone === 'warn' ? 'paused' : tone === 'over' ? 'interrupted' : 'ok'}`} data-testid="status">{meta}</span>}
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
        <section className="card card--warn lockdown-banner" data-testid="reboot-warning">
          <strong>Port blocks do not survive a srv0 reboot.</strong>
          <span className="muted"> A reboot clears the nftables rules. The UI confirms this before every action.</span>
        </section>

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
          <div className="stat-tiles">
            <div className="stat-tile">
              <span className="stat-tile__label">Public path</span>
              <span className={`stat-tile__value${active.includes('vpn-only') || active.includes('traefik-off') ? ' is-over' : ' is-ok'}`}>
                {active.includes('vpn-only') || active.includes('traefik-off') ? 'Blocked' : 'Open'}
              </span>
            </div>
            <div className="stat-tile">
              <span className="stat-tile__label">Traefik 443</span>
              <span className={`stat-tile__value${active.includes('traefik-off') ? ' is-over' : ' is-ok'}`}>
                {active.includes('traefik-off') ? 'Blocked' : 'Open'}
              </span>
            </div>
            <div className="stat-tile">
              <span className="stat-tile__label">srv0 tunnel</span>
              <span className={`stat-tile__value${active.includes('srv0-tunnel-cut') ? ' is-over' : ' is-ok'}`}>
                {active.includes('srv0-tunnel-cut') ? 'Cut' : 'Open'}
              </span>
            </div>
          </div>
          {active.length ? (
            <ul className="lockdown-active-list" data-testid="active-list">
              {active.map((id) => {
                const state = presetState(status, id)
                return (
                  <li key={id}>
                    <strong>{PRESETS[id].label}</strong>
                    <span>{presetPortText(id)}</span>
                    <span>{expiryText(state)}</span>
                  </li>
                )
              })}
            </ul>
          ) : (
            <p className="muted" data-testid="no-active">No port blocks active.</p>
          )}
          {pending.length ? <p className="muted">Applying: {pending.map((id) => PRESETS[id].label).join(', ')}</p> : null}
          <div className="lockdown-actions">
            <button className="outline secondary" type="button" onClick={openClear} disabled={!active.length} data-testid="open-clear">
              <TimerReset size={16} strokeWidth={1.8} /> Clear all blocks
            </button>
          </div>
        </section>

        <div className="lockdown-grid">
          {PRESET_ORDER.map((id) => (
            <PresetCard
              key={id}
              id={id}
              preset={PRESETS[id]}
              state={presetState(status, id)}
              duration={durations[id]}
              onDuration={(value) => setDurations((current) => ({ ...current, [id]: value }))}
              onOpen={openAction}
              busy={busy}
            />
          ))}
        </div>

        <section className="card lockdown-note">
          <div className="card__header"><h2>What survives</h2></div>
          <p><ShieldAlert size={16} strokeWidth={1.8} /> A srv0 reboot clears all blocks. A timed block also clears when its nftables timeout expires.</p>
          <p><ShieldCheck size={16} strokeWidth={1.8} /> Removing a block is possible while 443 is reachable. Cut Traefik and srv0 tunnel blocks can only be undone by their timer or a reboot.</p>
          <p className="muted">Traefik host ports: TCP 80, 443 and 8443. The public path uses 8443; VPN/LAN uses 443.</p>
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
                className={action?.clear ? 'outline secondary' : 'danger'}
                type="button"
                onClick={confirm}
                disabled={busy || phrase !== actionInfo.phrase}
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
              <li><strong>Ports:</strong> {presetPortText(action.preset)}</li>
              <li><strong>Duration:</strong> {action.durationSeconds == null ? 'Until cleared' : formatDuration(action.durationSeconds)}</li>
              <li><strong>Expires:</strong> {actionExpiry}</li>
              <li><strong>Access:</strong> {actionInfo.warning}</li>
              <li><strong>Reboot:</strong> A srv0 reboot clears this block immediately.</li>
            </ul>
          ) : null}
          <p className="form-error">{actionInfo.warning}</p>
          <p className="muted">
            The action is sent to the port blocker with a short delay so this response can return.
            Type <code>{actionInfo.phrase}</code> to confirm.
          </p>
          <label>
            Confirmation
            <input
              autoFocus
              value={phrase}
              onChange={(event) => setPhrase(event.target.value)}
              placeholder={actionInfo.phrase}
              data-testid="confirmation"
            />
          </label>
        </Dialog>
      ) : null}

      <Toasts />
    </>
  )
}
