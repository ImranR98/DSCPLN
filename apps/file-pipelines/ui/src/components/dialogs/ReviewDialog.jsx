import { apiUrl, formatBytes } from '@dscpln/ui-kit'
import { reviewGroups } from '../../lib/view.js'
import Modal from '../Modal.jsx'

export default function ReviewDialog({
  entries,
  reviewFolders,
  selectedGroups,
  onToggleGroup,
  onProcessSelected,
  onReviewAction,
  onReviewActionAll,
  onClose,
}) {
  return (
    <Modal onClose={onClose} data-testid="review-dialog" className="wide-dialog">
      <article>
        <header className="card__header">
          <h2>Review</h2>
          <span className="card__header-tools">
            <button className="outline secondary icon-button" aria-label="Close" onClick={onClose}>&times;</button>
          </span>
        </header>
        <p className="hint">Manual folders prepare files here without writing to the destination. Place the ones you want to keep, or discard the rest — nothing is written until you place it.</p>
        {!reviewFolders.length ? (
          <p className="muted">Nothing awaiting review.</p>
        ) : null}
        {reviewFolders.map((folder) => {
          const parked = entries.filter((entry) => entry.folder === folder.name)
          const groups = folder.method === 'voicenotes' ? reviewGroups(folder) : []
          if (!parked.length && !groups.length) return null
          return (
            <section className="review-section" key={folder.name}>
              <h3>{folder.name}</h3>
              {groups.length ? (
                <>
                  <div className="review-groups">
                    {groups.map((group) => (
                      <label className="checklist__row" key={group.key}>
                        <input type="checkbox" checked={selectedGroups.has(group.key)} onChange={(event) => onToggleGroup(group.key, event.target.checked)} />
                        <span className="checklist__main">{group.chat || '(root)'} · {group.date} · {group.files.length} clip{group.files.length === 1 ? '' : 's'}</span>
                        <span className="checklist__meta">{formatBytes(group.bytes)}</span>
                      </label>
                    ))}
                  </div>
                  <div className="folder-card__actions">
                    <button onClick={() => onProcessSelected(folder)}>Process selected</button>
                  </div>
                </>
              ) : null}
              {parked.map((entry) => (
                <div className="review-row" key={entry.id}>
                  <div className="review-row__main">
                    <span className="checklist__main">{entry.destName}</span>
                    <span className="checklist__meta">
                      {entry.chat || '(root)'} · {entry.inputs.length} input{entry.inputs.length === 1 ? '' : 's'} · {formatBytes(entry.size)}{entry.missingInputs?.length ? ` · ${entry.missingInputs.length} source(s) gone` : ''}
                    </span>
                  </div>
                  <audio controls preload="none" src={apiUrl(`api/review/file/${encodeURIComponent(folder.name)}/${encodeURIComponent(entry.id)}`)}></audio>
                  <div className="review-row__actions">
                    <button onClick={() => onReviewAction(folder.name, entry.id, true)}>Place</button>
                    <button className="outline secondary" onClick={() => onReviewAction(folder.name, entry.id, false)}>Discard</button>
                  </div>
                </div>
              ))}
              {parked.length > 1 ? (
                <div className="folder-card__actions">
                  <button onClick={() => onReviewActionAll(folder.name, true)}>Place all ({parked.length})</button>
                  <button className="outline secondary" onClick={() => onReviewActionAll(folder.name, false)}>Discard all</button>
                </div>
              ) : null}
            </section>
          )
        })}
        <div className="dialog-actions">
          <button className="outline secondary" onClick={onClose}>Close</button>
        </div>
      </article>
    </Modal>
  )
}
