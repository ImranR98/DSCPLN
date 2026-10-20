import { apiUrl, formatBytes } from '@dscpln/ui-kit'
import { Dialog } from '@dscpln/ui-kit'

const groupKey = (group) => group.file
  ? `${group.folder}\u0000file\u0000${group.file}`
  : `${group.folder}\u0000${group.chat}\u0000${group.date}`

function BulkActions({ groups, busy, bulkBusy, onApproveAll, onDeleteAll }) {
  const settling = groups.some((group) => group.settling)
  const disabled = settling || Boolean(busy) || Boolean(bulkBusy)
  const allFiles = groups.every((group) => group.file)
  const allGroups = groups.every((group) => !group.file)
  const approveLabel = allFiles ? 'Standardize & move all' : allGroups ? 'Merge & move all' : 'Approve all'
  const settleTitle = settling ? 'Wait for all items to settle first' : undefined

  return (
    <div className="folder-card__actions review-bulk-actions">
      <button
        data-testid="review-approve-all"
        disabled={disabled}
        title={settleTitle}
        onClick={() => onApproveAll(groups)}
      >
        {bulkBusy === 'approve' ? 'Working…' : `${approveLabel} (${groups.length})`}
      </button>
      <button
        className="outline secondary"
        data-testid="review-delete-all"
        disabled={disabled}
        title={settleTitle}
        onClick={() => onDeleteAll(groups)}
      >
        {bulkBusy === 'delete' ? 'Working…' : `Delete all (${groups.length})`}
      </button>
    </div>
  )
}

export default function ReviewDialog({
  entries,
  reviewFolders,
  reviewedAudio,
  busy,
  bulkBusy,
  onApproveReviewedAudio,
  onDeleteReviewedAudio,
  onApproveAllReviewedAudio,
  onDeleteAllReviewedAudio,
  onReviewAction,
  onReviewActionAll,
  onClose,
}) {
  return (
          <Dialog onClose={onClose} data-testid="review-dialog" className="wide-dialog" title="Review">
        <p className="hint">
          Reviewed audio is approved here: grouped folders merge and move same-day clips;
          per-file folders standardize and move each file. Delete moves sources to trash.
          Nothing is written or deleted until you choose.
        </p>

        {reviewedAudio.length ? (
          <section className="review-section">
            <h3>Reviewed audio</h3>
            <BulkActions
              groups={reviewedAudio}
              busy={busy}
              bulkBusy={bulkBusy}
              onApproveAll={onApproveAllReviewedAudio}
              onDeleteAll={onDeleteAllReviewedAudio}
            />
            <div className="review-groups">
              {reviewedAudio.map((group) => {
                const key = groupKey(group)
                const disabled = group.settling || Boolean(busy) || Boolean(bulkBusy)
                const label = group.file || `${group.chat || '(root)'} · ${group.date}`
                const files = group.files ?? (group.file ? [group.file] : [])
                const meta = group.file
                  ? `${formatBytes(group.bytes)}${group.settling ? ' · settling…' : ''}`
                  : `${group.count} clip${group.count === 1 ? '' : 's'} · ${formatBytes(group.bytes)}${group.destExists ? ' · destination merge exists' : ''}${group.settling ? ' · settling…' : ''}`
                return (
                  <div className="review-row" key={key} data-testid={`review-group-${group.folder}-${group.date || encodeURIComponent(group.file)}`}>
                    <div className="review-row__main">
                      <span className="checklist__main">{label}</span>
                      <span className="checklist__meta">{meta}</span>
                    </div>
                    <div className="review-audio">
                      {files.map((file) => (
                        <div className="review-audio__item" key={file}>
                          {files.length > 1 ? <span className="review-audio__label">{file.split('/').pop()}</span> : null}
                          <audio
                            controls
                            preload="none"
                            aria-label={`Listen to ${file.split('/').pop()}`}
                            src={apiUrl(`api/review/audio/${encodeURIComponent(group.folder)}/${encodeURIComponent(file)}`)}
                          ></audio>
                        </div>
                      ))}
                    </div>
                    <div className="review-row__actions">
                      <button
                        disabled={disabled}
                        onClick={() => onApproveReviewedAudio(group)}
                        title={group.destExists ? 'A merge already exists for this chat/day; delete or move it first' : undefined}
                      >
                        {busy === key ? 'Working…' : group.file ? 'Standardize & move' : 'Merge & move'}
                      </button>
                      <button
                        className="outline secondary"
                        disabled={disabled}
                        onClick={() => onDeleteReviewedAudio(group)}
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

        {!reviewedAudio.length && !entries.length ? (
          <p className="muted">Nothing awaiting review.</p>
        ) : null}

        <div className="dialog-actions">
          <button className="outline secondary" onClick={onClose}>Close</button>
        </div>
    </Dialog>
  )
}
