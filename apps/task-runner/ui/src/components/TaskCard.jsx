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

export default function TaskCard({
  task,
  now,
  uploading,
  queues,
  browserAvailable,
  openBrowsers,
  onToggleBrowser,
  onQueueFiles,
  onRemoveQueued,
  onRun,
  onCancel,
  onLog,
}) {
  const dropRef = useDropzone((dropped) => onQueueFiles(task, dropped))
  const running = task.running
  const isUploading = uploading[task.name] != null
  const queued = task.queued
  const busy = running || isUploading || queued
  const files = queues[task.name] ?? []

  return (
    <section className="card task-card" data-task={task.name} data-testid={`task-${task.name}`}>
      <div className="card__header">
        <h2 className="card-title">{task.name}</h2>
        <span className={`pill pill--${running || isUploading ? 'running' : queued ? 'neutral' : (task.state ? task.pill : 'none') ?? 'none'}`}>
          {running ? (
            <>Running · {formatElapsed(now / 1000 - (task.started ?? now / 1000))}</>
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

      {isUploading ? (
        <div className="upload-bar"><div className="upload-fill" style={{ width: `${Math.round(uploading[task.name])}%` }}></div></div>
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
        <button
          className={busy ? 'outline secondary' : ''}
          disabled={!busy && (!task.avail || (task.uploads && !files.length))}
          onClick={() => (busy ? onCancel(task.name) : onRun(task))}
        >{busy ? 'Stop' : 'Run'}</button>
        <button className="outline secondary" onClick={() => onLog(task)}>Log</button>
      </div>

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
