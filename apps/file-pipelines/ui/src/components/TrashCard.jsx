import { RefreshCw } from 'lucide-react'
import { formatBytes } from '@dscpln/ui-kit'

export default function TrashCard({
  trash,
  trashSelection,
  retentionDays,
  onRefresh,
  onSelectAll,
  onToggleSelection,
  onRestoreSelected,
  onEmptyTrash,
}) {
  return (
    <section className="card" id="trashCard" aria-labelledby="trashHeading">
      <div className="card__header">
        <h2 id="trashHeading">Trash</h2>
        <span className="card__header-tools">
          <span className="card__context">{trash.entries.length} day(s) · keeping {retentionDays} days</span>
          <button className="outline secondary icon-button" title="Refresh trash" aria-label="Refresh trash" onClick={onRefresh}>
            <RefreshCw size={16} strokeWidth={1.8} />
          </button>
        </span>
      </div>
      {trash.entries.length ? (
        <>
          <label className="checklist__row">
            <input type="checkbox" checked={trash.selectAll} onChange={(event) => onSelectAll(event.target.checked)} />
            <span className="checklist__main">Select all</span>
          </label>
          <div className="trash__list">
            {trash.entries.map((entry) => (
              <details key={entry.day}>
                <summary>{entry.day} · {entry.count} file(s) · {formatBytes(entry.bytes)}</summary>
                {entry.files.slice(0, 300).map((file) => {
                  const key = `${entry.day}/${file.name}`
                  return (
                    <label className="checklist__row" key={file.name}>
                      <input type="checkbox" checked={trashSelection.has(key)} onChange={(event) => onToggleSelection(key, event.target.checked)} />
                      <span className="checklist__main">{file.name}</span>
                      <span className="checklist__meta">{formatBytes(file.size)} · {file.folder ?? file.sourceDir ?? 'origin unknown'}</span>
                    </label>
                  )
                })}
                {entry.count > 300 ? <p className="muted files-empty">… and {entry.count - 300} more</p> : null}
              </details>
            ))}
          </div>
        </>
      ) : (
        <p className="muted files-empty">Trash is empty.</p>
      )}
      <div className="trash-actions">
        {trashSelection.size ? (
          <button onClick={onRestoreSelected}>Restore selected ({trashSelection.size})</button>
        ) : null}
        {trash.entries.length ? (
          <button className="danger" onClick={onEmptyTrash}>Empty trash</button>
        ) : null}
      </div>
    </section>
  )
}
