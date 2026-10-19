import { apiUrl, formatBytes } from '@dscpln/ui-kit'
import Modal from '../Modal.jsx'

const groupKey = (group) => group.file
  ? `${group.folder}\u0000file\u0000${group.file}`
  : `${group.folder}\u0000${group.chat}\u0000${group.date}`

export default function ReviewDialog({
  entries,
  reviewFolders,
  voicenotes,
  busy,
  onApproveVoiceNote,
  onDeleteVoiceNote,
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
        <p className="hint">
          Voicenotes are approved per chat/day: merge and move the group, or move its clips to trash.
          Nothing is written or deleted until you choose.
        </p>

        {voicenotes.length ? (
          <section className="review-section">
            <h3>Voice notes</h3>
            <div className="review-groups">
              {voicenotes.map((group) => {
                const key = groupKey(group)
                const disabled = group.settling || busy === key
                const label = group.file || `${group.chat || '(root)'} · ${group.date}`
                const meta = group.file
                  ? `${formatBytes(group.bytes)}${group.settling ? ' · settling…' : ''}`
                  : `${group.count} clip${group.count === 1 ? '' : 's'} · ${formatBytes(group.bytes)}${group.destExists ? ' · destination merge exists' : ''}${group.settling ? ' · settling…' : ''}`
                return (
                  <div className="review-row" key={key} data-testid={`voice-group-${group.folder}-${group.date || encodeURIComponent(group.file)}`}>
                    <div className="review-row__main">
                      <span className="checklist__main">{label}</span>
                      <span className="checklist__meta">{meta}</span>
                    </div>
                    <div className="review-row__actions">
                      <button
                        disabled={disabled}
                        onClick={() => onApproveVoiceNote(group)}
                        title={group.destExists ? 'A merge already exists for this chat/day; delete or move it first' : undefined}
                      >
                        {busy === key ? 'Working…' : group.file ? 'Standardize & move' : 'Merge & move'}
                      </button>
                      <button
                        className="outline secondary"
                        disabled={disabled}
                        onClick={() => onDeleteVoiceNote(group)}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          </section>
        ) : null}

        {reviewFolders.map((folder) => {
          const parked = entries.filter((entry) => entry.folder === folder.name)
          if (!parked.length) return null
          return (
            <section className="review-section" key={folder.name}>
              <h3>{folder.name}</h3>
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

        {!voicenotes.length && !entries.length ? (
          <p className="muted">Nothing awaiting review.</p>
        ) : null}

        <div className="dialog-actions">
          <button className="outline secondary" onClick={onClose}>Close</button>
        </div>
      </article>
    </Modal>
  )
}
