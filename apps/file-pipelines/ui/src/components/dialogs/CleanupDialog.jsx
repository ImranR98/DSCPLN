import { formatBytes } from '@dscpln/ui-kit'
import { Dialog } from '@dscpln/ui-kit'

export default function CleanupDialog({ dialog, onSelectAll, onToggle, onMove, onClose }) {
  const { folder, files, totalBytes, selected } = dialog
  return (
    <Dialog onClose={onClose} className="wide-dialog" title={`Cleanup ${folder}`}>
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
    </Dialog>
  )
}
