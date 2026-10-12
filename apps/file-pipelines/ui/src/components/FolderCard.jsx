import { CalendarDays, Import, RefreshCw, Wrench } from 'lucide-react'
import { formatBytes, formatDateTime } from '@dscpln/ui-kit'
import { FILE_LIMIT, METHOD_LABEL, folderContext, folderStats, isSnapshot, scheduleLabel, sortedFiles } from '../lib/view.js'

export default function FolderCard({
  folder,
  run,
  dryRun,
  expanded,
  onToggleExpanded,
  onRunSnapshot,
  onProcessNow,
  onOpenReview,
  onOpenCleanup,
  onFileAction,
  onSetDate,
}) {
  const stats = folderStats(folder)
  const cardClass = `card folder-card folder-card--${folder.method}` +
    (folder.counts.conflict ? ' card--over' : !folder.counts.conflict && stats.issues ? ' card--warn' : '')
  const snapshot = isSnapshot(folder)

  return (
    <section className={cardClass}>
      <div className="card__header">
        <div className="folder-title">
          <h2>{folder.name}</h2>
          <span className="method-badge">{METHOD_LABEL[folder.method] ?? folder.method}</span>
          {!folder.exists ? <span className="status-tag status-tag--interrupted"><span>source unavailable</span></span> : null}
        </div>
        <span className="card__context">{folderContext(folder)}</span>
      </div>

      {snapshot ? (
        <>
          <p className="folder-paths">
            <code>{(folder.sources?.length ? folder.sources : [folder.source]).join(' · ')}</code>
            <span className="folder-paths__arrow">→</span>
            <code>{folder.destination}</code>
          </p>

          <div className="pipeline-meta">
            <div className="pipeline-meta__row">
              <span className="muted">Schedule</span>
              <span>{scheduleLabel(folder.schedule)}</span>
            </div>
            <div className="pipeline-meta__row">
              <span className="muted">Next run</span>
              <span>{run?.nextRun ? formatDateTime(run.nextRun) : '—'}</span>
            </div>
            <div className="pipeline-meta__row">
              <span className="muted">Last run</span>
              <span>
                {run?.running ? (
                  <span className="pill pill--running">running…</span>
                ) : run?.lastRunAt ? (
                  <>
                    <span className={`pill pill--${run.ok === false ? 'fail' : 'ok'}`}>{run.ok === false ? 'failed' : 'ok'}</span>
                    <span className="muted"> {formatDateTime(run.lastRunAt)}</span>
                  </>
                ) : (
                  <span className="muted">never</span>
                )}
              </span>
            </div>
            {run?.summary ? (
              <p className="muted pipeline-meta__summary">{run.summary}</p>
            ) : null}
          </div>

          <div className="folder-card__actions">
            <button disabled={run?.running || dryRun} onClick={onRunSnapshot}>
              {run?.running ? 'Running…' : 'Run copy'}
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="figure">
            <span className="figure__spend">{stats.pending}</span>
            <span className="figure__meta">
              <span className="figure__of">pending of</span>
              <span className="figure__budget">{stats.total} file{stats.total === 1 ? '' : 's'}</span>
            </span>
          </p>

          <div className="progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow={stats.percent}>
            <div className="progress__fill" style={{ width: `${stats.percent}%` }}></div>
          </div>

          <p className="pace">
            {folder.lastEventAt ? `last change ${formatDateTime(folder.lastEventAt)} · ` : ''}{stats.processed} processed{stats.ignored > 0 ? ` · ${stats.ignored} ignored` : ''}
          </p>

          <div className="stat-tiles">
            <div className="stat-tile"><span className="stat-tile__label">pending</span><span className="stat-tile__value">{stats.pending}</span></div>
            <div className="stat-tile"><span className="stat-tile__label">processing</span><span className="stat-tile__value">{stats.processing}</span></div>
            <div className="stat-tile"><span className="stat-tile__label">processed</span><span className="stat-tile__value">{stats.processed}</span></div>
            <div className="stat-tile"><span className="stat-tile__label">issues</span><span className={`stat-tile__value${stats.issues > 0 ? ' is-over' : ''}`}>{stats.issues}</span></div>
          </div>

          <p className="folder-paths">
            <code>{folder.source}</code>
            <span className="folder-paths__arrow">→</span>
            <code>{folder.destination}</code>
          </p>

          <div className="folder-card__actions">
            <button className="outline secondary" onClick={onProcessNow}>Process now</button>
            {folder.placement === 'manual' || stats.review > 0 ? (
              <button className={stats.review > 0 ? '' : 'outline secondary'} onClick={onOpenReview}>
                Review{stats.review > 0 ? ` (${stats.review})` : ''}
              </button>
            ) : null}
            {stats.processed > 0 && folder.cleanup !== false ? (
              <button onClick={onOpenCleanup}>Cleanup {stats.processed}</button>
            ) : null}
          </div>

          <details className="folder-details" open={expanded.has(folder.name)} onToggle={(event) => onToggleExpanded(event.target.open)}>
            <summary>Files · {folder.files.length}</summary>
            {!folder.files.length ? (
              <p className="muted files-empty">No files in this folder right now.</p>
            ) : (
              <>
                <ul className="files__list">
                  {sortedFiles(folder).map((file) => (
                    <li className={`file file--${file.status}`} key={file.name}>
                      <div className="file__main">
                        <span className="file__name">{file.name}</span>
                        {file.message || file.attempts || file.destName ? (
                          <span className="file__notes">
                            {[file.message, file.attempts ? `attempt ${file.attempts}` : null, file.destName ? `→ ${file.destName}` : null].filter(Boolean).join(' · ')}
                          </span>
                        ) : null}
                      </div>
                      <div className="file__meta">
                        <span className="file__size">{formatBytes(file.size)}</span>
                        <span className="file__date">{formatDateTime(file.mtimeMs)}</span>
                        <span className={`pill pill--${file.status === 'done' ? 'ok' : file.status === 'error' ? 'fail' : file.status === 'conflict' ? 'neutral' : 'running'}`}>{file.status}</span>
                      </div>
                      <div className="file__actions">
                        {file.status === 'error' || file.status === 'conflict' ? (
                          <button className="outline secondary icon-button icon-button--small" title="Retry" aria-label={`Retry ${file.name}`} onClick={() => onFileAction(file.name, 'retry')}>
                            <RefreshCw size={14} strokeWidth={1.8} />
                          </button>
                        ) : null}
                        {file.status === 'error' ? (
                          <>
                            <button className="outline secondary icon-button icon-button--small" title="Repair (ffmpeg remux)" aria-label={`Repair ${file.name}`} onClick={() => onFileAction(file.name, 'repair')}>
                              <Wrench size={14} strokeWidth={1.8} />
                            </button>
                            <button className="outline secondary icon-button icon-button--small" title="Set date and retry" aria-label={`Set date for ${file.name}`} onClick={() => onSetDate(file.name)}>
                              <CalendarDays size={14} strokeWidth={1.8} />
                            </button>
                          </>
                        ) : null}
                        {file.status === 'error' || file.status === 'conflict' || file.status === 'pending' ? (
                          <button className="outline secondary icon-button icon-button--small" title="Import as-is" aria-label={`Import ${file.name} as-is`} onClick={() => onFileAction(file.name, 'import')}>
                            <Import size={14} strokeWidth={1.8} />
                          </button>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ul>
                {folder.files.length > FILE_LIMIT ? (
                  <p className="muted files-empty">… and {folder.files.length - FILE_LIMIT} more file(s)</p>
                ) : null}
              </>
            )}
          </details>
        </>
      )}
    </section>
  )
}
