import { formatBytes } from '@dscpln/ui-kit'
import Modal from '../Modal.jsx'

export default function CleanupDialog({ dialog, onSelectAll, onToggle, onMove, onClose }) {
  const { folder, files, totalBytes, selected } = dialog
  return (
    <Modal onClose={onClose} className="wide-dialog">
      <article>
        <header className="card__header">
          <h2>Cleanup {folder}</h2>
          <span className="card__header-tools">
            <button className="outline secondary icon-button" aria-label="Close" onClick={onClose}>&times;</button>
          </span>
        </header>
        <p className="hint">{files.length} processed file(s), {formatBytes(totalBytes)}. Each destination copy is verified before the original is moved to trash.</p>
        <label className="checklist__row">
          <input type="checkbox" checked={selected.size === files.length} onChange={(event) => onSelectAll(event.target.checked)} />
          <span className="checklist__main">Select all</span>
        </label>
        <div className="checklist">
          {files.map((file) => (
            <label className="checklist__row" key={file.name}>
              <input type="checkbox" checked={selected.has(file.name)} onChange={(event) => onToggle(file.name, event.target.checked)} />
              <span className="checklist__main">{file.name}</span>
              <span className="checklist__meta">{file.destName ? `→ ${file.destName}` : ''}</span>
            </label>
          ))}
        </div>
        <div className="dialog-actions">
          <button className="outline secondary" onClick={onClose}>Cancel</button>
          <button className="danger" onClick={onMove}>Move to trash</button>
        </div>
      </article>
    </Modal>
  )
}
