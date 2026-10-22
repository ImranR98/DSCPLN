import { Dialog } from '@dscpln/ui-kit'

export default function RestoreDialog({ dialog, onDirChange, onRestore, onClose }) {
  return (
          <Dialog onClose={onClose} className="narrow-dialog" title="Restore files">
        <p className="hint">Files with a recorded origin return to their original folder. Files without one are restored to the directory you enter here.</p>
        <div className="native-fields">
          <label className="native-field">
            <span className="field__label">Restore directory</span>
            <input type="text" placeholder="/path/to/folder" autoComplete="off" value={dialog.dir} onChange={(event) => onDirChange(event.target.value)} />
          </label>
        </div>
        {dialog.error ? <p className="form-error">{dialog.error}</p> : null}
        <div className="dialog-actions">
          <button className="outline secondary" onClick={onClose}>Cancel</button>
          <button onClick={onRestore}>Restore</button>
        </div>
    </Dialog>
  )
}
