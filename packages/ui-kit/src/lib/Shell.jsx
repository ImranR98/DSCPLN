import { useCallback, useEffect, useRef, useState } from 'react'
import { Pause, Play, RefreshCw, ScrollText, Settings } from 'lucide-react'
import { getJson, postJson, putJson, subscribe } from './api.js'
import { formatDateTime, formatDuration, formatTime, humanAgo } from './format.js'
import ThemeToggle from './ThemeToggle.jsx'
import LogDialog from './LogDialog.jsx'
import SettingsDialog from './SettingsDialog.jsx'
import Toasts from './Toasts.jsx'
import { showToast } from './toast.js'

export default function Shell({
  name,
  fields = [],
  schedule = true,
  settingsNotice = null,
  actions = null,
  settingsExtra = null,
  onconfig = null,
  children,
}) {
  const [state, setState] = useState(null)
  const [config, setConfig] = useState({})
  const [interruptedAt, setInterruptedAt] = useState(null)
  const [updatedAt, setUpdatedAt] = useState(null)
  const logDialogRef = useRef(null)
  const settingsDialogRef = useRef(null)

  const running = Boolean(state?.run?.running ?? state?.running)
  const paused = Boolean(config.paused)
  const status = running ? 'running' : interruptedAt ? 'interrupted' : paused ? 'paused' : 'live'
  const statusText = status
  const last = state?.lastRun ?? null
  const history = state?.history ?? []

  const tiles = state
    ? [
        { label: 'Last run', value: last ? humanAgo(last.endedAt) : 'Never' },
        { label: 'Result', value: last ? (last.ok ? 'OK' : 'Failed') : '—', tone: last ? (last.ok ? 'ok' : 'over') : null },
        { label: 'Duration', value: last ? formatDuration(last.durationSec) : '—' },
        { label: 'Next run', value: state.nextRun ? formatDateTime(state.nextRun) : 'Manual' },
        state.missed ? { label: 'Missed', value: String(state.missed), tone: 'warn' } : null,
      ].filter(Boolean)
    : []

  const renderState = useCallback((next, { keepConfig = false } = {}) => {
    if (!next) return
    setState(next)
    if (!keepConfig && next.config) setConfig(next.config)
    if (next.paused !== undefined) setConfig((current) => ({ ...current, paused: next.paused }))
    const isRunning = Boolean(next.run?.running ?? next.running)
    setInterruptedAt(
      !isRunning && next.runMarker && (next.lastRun?.endedAt ?? 0) < next.runMarker.startedAt ? next.runMarker.startedAt : null,
    )
    setUpdatedAt(Date.now())
  }, [])

  const refresh = useCallback(async () => {
    try {
      renderState(await getJson('api/state'))
    } catch {
      // keep the last known state
    }
  }, [renderState])

  const runNow = async () => {
    try {
      await postJson('api/run', {})
      showToast(`${name}: run started`)
      await refresh()
    } catch (err) {
      showToast(err.message, 'error')
    }
  }

  const cancel = async () => {
    try {
      await postJson('api/cancel', {})
      showToast('Cancelling…')
    } catch (err) {
      showToast(err.message, 'error')
    }
  }

  const togglePause = async () => {
    try {
      await postJson('api/pause', { paused: !paused })
      showToast(paused ? 'Resumed' : 'Paused')
      await refresh()
    } catch (err) {
      showToast(err.message, 'error')
    }
  }

  const saveConfig = async (next) => {
    const saved = await putJson('api/config', next)
    setConfig(saved)
    setState((current) => (current ? { ...current, config: saved } : current))
    onconfig?.(saved)
    await refresh()
    return saved
  }

  useEffect(() => {
    refresh()
    const unsubscribe = subscribe(
      '',
      (event) => {
        if (event.type === 'line') logDialogRef.current?.append(event.line)
        else if (event.type === 'state' && event.state) renderState(event.state)
        else if (event.type === 'config' && event.config) setConfig(event.config)
        else if (event.type === 'update') refresh()
      },
      { events: 'events' },
    )
    const timer = setInterval(refresh, 15_000)
    return () => {
      unsubscribe()
      clearInterval(timer)
    }
  }, [refresh, renderState])

  return (
    <>
      <header className="app-header" data-app={name}>
        <div className="app-header__top">
          <h1>
            <a className="app-header__brand" href="/">D<span className="accent">$</span>CPLN</a>{' '}
            <span className="app-header__app">· {name}</span>
          </h1>
          <div className="app-header__actions">
            <button
              className="outline secondary icon-button"
              type="button"
              title={paused ? 'Resume' : 'Pause'}
              aria-label="Pause/Resume"
              onClick={togglePause}
            >
              {paused ? <Play size={16} strokeWidth={1.8} /> : <Pause size={16} strokeWidth={1.8} />}
            </button>
            {typeof actions === 'function' ? actions() : actions}
            <button
              className="outline secondary icon-button"
              type="button"
              title="Settings"
              aria-label="Settings"
              onClick={() => settingsDialogRef.current.show(config)}
            >
              <Settings size={16} strokeWidth={1.8} />
            </button>
            <button className="outline secondary icon-button" type="button" title="Refresh" aria-label="Refresh" onClick={refresh}>
              <RefreshCw size={16} strokeWidth={1.8} />
            </button>
            <ThemeToggle />
          </div>
        </div>
        <div className="app-header__meta">
          <span className={`status-tag status-tag--${status}`} data-testid="status"><span>{statusText}</span></span>
          <span className="app-header__meta-tools muted">{updatedAt ? `updated ${formatTime(updatedAt)}` : ''}</span>
        </div>
      </header>

      <main>
        <section className="card card--hero" id="overviewCard">
          <div className="card__header">
            <h2>Overview</h2>
            <span className="card__header-tools">
              <span className="card__context">{state?.nextRun ? `next ${formatDateTime(state.nextRun)}` : ''}</span>
            </span>
          </div>

          <div className="stat-tiles">
            {tiles.map((tile) => (
              <div className="stat-tile" key={tile.label}>
                <span className="stat-tile__label">{tile.label}</span>
                <span className={`stat-tile__value${tile.tone ? ` is-${tile.tone}` : ''}`}>{tile.value ?? '—'}</span>
              </div>
            ))}
          </div>

          <div className="overview__actions">
            {running ? (
              <button className="danger" onClick={cancel} data-testid="stop">Stop</button>
            ) : (
              <button onClick={runNow} data-testid="run-now">Run now</button>
            )}
            <button className="outline secondary" onClick={() => logDialogRef.current.show()} data-testid="show-log">
              <ScrollText size={16} strokeWidth={1.8} /> Log
            </button>
          </div>

          {last?.summary ? <p className="muted">{last.summary}</p> : null}

          <div className="run-history" hidden={!history.length}>
            {history.length ? (
              <>
                <h3>Recent runs</h3>
                <ul className="run-history__list">
                  {history.slice(0, 10).map((run) => (
                    <li key={`${run.startedAt}:${run.endedAt}`} className={run.ok ? 'is-ok' : 'is-fail'}>
                      <span>{formatDateTime(run.endedAt)}</span>
                      <span>{run.ok ? 'OK' : 'Failed'}</span>
                      <span className="muted">{formatDuration(run.durationSec)}</span>
                      <span className="run-history__summary">{run.summary ?? ''}</span>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </div>
        </section>

        {typeof children === 'function' ? children() : children}
      </main>

      <LogDialog ref={logDialogRef} />
      <SettingsDialog
        ref={settingsDialogRef}
        fields={fields}
        schedule={schedule}
        notice={settingsNotice}
        onsave={saveConfig}
        extra={settingsExtra}
      />
      <Toasts />
    </>
  )
}
