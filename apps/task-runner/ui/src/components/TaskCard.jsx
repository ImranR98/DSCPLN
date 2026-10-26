import { X } from 'lucide-react'
import { useDropzone } from '../hooks/useDropzone.js'

const formatElapsed = (seconds) => {
  const sec = Math.max(0, Math.floor(seconds))
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = String(sec % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`
}

const browserSrc = './browser/?autoconnect=1&resize=scale&reconnect=1&path=websockify'

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const scheduleText = (schedule) => {
  const days = schedule?.days?.length ? schedule.days.map((day) => DAY_NAMES[day] ?? day).join(', ') : 'daily'
  return `${days} at ${schedule?.at ?? '—'}`
}

export default function TaskCard({
  task,
  attributes,
  groupBy,
  now,
  preparing = {},
  uploading,
  queues,
  browserAvailable,
  openBrowsers,
  onToggleBrowser,
  onQueueFiles,
  onRemoveQueued,
  onSettings,
  onAction,
  onRun,
  onCancel,
  onLog,
}) {
  const chips = (attributes ?? [])
    .filter((attribute) => attribute.name !== groupBy)
    .map((attribute) => ({ name: attribute.name, value: task.attributes?.[attribute.name] }))
    .filter((chip) => chip.value)
  const dropRef = useDropzone((dropped) => onQueueFiles(task, dropped))
  const running = task.running
  const isPreparing = preparing[task.name] != null
  const isUploading = uploading[task.name] != null
  const queued = task.queued
  const busy = running || isPreparing || isUploading || queued
  const files = queues[task.name] ?? []
  const uploadPercent = isPreparing ? preparing[task.name] : uploading[task.name]

  return (
    <section className="card task-card" data-task={task.name} data-testid={`task-${task.name}`}>
      <div className="card__header">
        <h2 className="card-title">{task.name}</h2>
        <span className={`pill pill--${running || isPreparing || isUploading ? 'running' : queued ? 'neutral' : (task.state ? task.pill : 'none') ?? 'none'}`}>
          {running ? (
            <>Running · {formatElapsed(now / 1000 - (task.started ?? now / 1000))}</>
          ) : isPreparing ? (
            <>Pruning… {Math.round(preparing[task.name])}%</>
          ) : isUploading ? (
            <>Uploading… {Math.round(uploading[task.name])}%</>
          ) : queued ? (
            'Queued…'
          ) : (
            task.state ? task.state.last_run_text : 'Never run'
          )}
        </span>
      </div>

      {running && task.live ? (
        <div className="card-live">{task.live}</div>
      ) : null}

      {chips.length ? (
        <div className="attribute-chips">
          {chips.map((chip) => (
            <span className="attribute-chip" key={chip.name} data-attribute={chip.name}>
              <span className="attribute-chip__name">{chip.name}</span>
              <span>{chip.value}</span>
            </span>
          ))}
        </div>
      ) : null}

      {task.schedule?.enabled ? (
        <div className="card-note">
          Scheduled {scheduleText(task.schedule)}
          {task.next_run ? ` · next ${new Date(task.next_run).toLocaleString()}` : ''}
          {task.schedule_missed ? ` · ${task.schedule_missed} missed` : ''}
        </div>
      ) : null}

      {isPreparing || isUploading ? (
        <div className="upload-bar"><div className="upload-fill" style={{ width: `${Math.round(uploadPercent)}%` }}></div></div>
      ) : null}

      {!task.avail ? (
        <span className="alert-badge badge-unavail">{task.avail_reason}</span>
      ) : null}

      {task.uploads ? (
        <>
          <div className="dropzone-box" tabIndex="0" ref={dropRef}>
            <span className="dropzone-note">{task.note || 'Drop files here or click to browse'}</span>
            <input type="file" multiple hidden onChange={(event) => { onQueueFiles(task, event.target.files); event.target.value = '' }} />
          </div>
          {files.length ? (
            <div className="queue-list">
              {files.map((file) => (
                <div className="queue-item" key={file.name}>
                  <span className="queue-name">{file.name}</span>
                  <button className="outline secondary icon-button icon-button--small" title="Remove from queue" aria-label={`Remove ${file.name} from queue`} onClick={() => onRemoveQueued(task, file)}>
                    <X size={14} strokeWidth={1.8} />
                  </button>
                </div>
              ))}
            </div>
          ) : null}
        </>
      ) : task.note ? (
        <div className="card-note">{task.note}</div>
      ) : null}

      <div className="card-actions">
        {task.export_url ? (
          <a role="button" className="outline secondary" href={task.export_url} target="_blank" rel="noreferrer">Generate Export</a>
        ) : null}
        {(task.schedulable || attributes?.length) ? (
          <button className="outline secondary" onClick={() => onSettings(task)}>
            Settings
          </button>
        ) : null}
        {(task.actions ?? []).map((action) => (
          <button
            key={action.key}
            className="outline secondary"
            disabled={busy}
            onClick={() => onAction(task, action)}
          >{action.label}</button>
        ))}
        <button
          className={busy ? 'outline secondary' : ''}
          disabled={!busy && (!task.avail || (task.uploads && !files.length))}
          onClick={() => (busy ? onCancel(task.name) : onRun(task))}
        >{busy ? 'Stop' : 'Run'}</button>
        <button className="outline secondary" onClick={() => onLog(task)}>Log</button>
      </div>

      {(task.actions ?? []).some((action) => action.state) ? (
        <div className="action-status-list">
          {(task.actions ?? []).filter((action) => action.state).map((action) => (
            <div
              key={action.key}
              className={`action-status action-status--${action.state.ok ? 'ok' : 'fail'}`}
              title={action.state.summary}
            >
              <span className="action-status__label">{action.label}:</span>
              <span className="action-status__summary">{action.state.summary || action.state.last_run_text}</span>
              <span className="action-status__time">{action.state.last_run_text.split(' · ').at(-1)}</span>
            </div>
          ))}
        </div>
      ) : null}

      {task.browser && browserAvailable ? (
        <div className="browser-block">
          <div className="browser-actions">
            <button className="outline secondary" onClick={() => onToggleBrowser(task.name)}>
              {openBrowsers[task.name] ? 'Hide login browser' : 'Open login browser'}
            </button>
            <a className="browser-newtab" href={browserSrc} target="_blank" rel="noreferrer">New tab</a>
          </div>
          {openBrowsers[task.name] ? (
            <iframe className="browser-frame" title={`${task.name} login browser`} src={browserSrc}></iframe>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}
