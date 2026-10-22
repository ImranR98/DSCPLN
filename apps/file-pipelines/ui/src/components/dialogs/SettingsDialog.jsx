import { X } from 'lucide-react'
import { METHOD_LABEL } from '../../lib/view.js'
import { Dialog } from '@dscpln/ui-kit'

// The config editor: global settings up top, then one folder editor per
// configured folder.
export default function SettingsDialog({ draft, updateDraft, addFolder, saveSettings, onClose }) {
  const setFolder = (index, mutator) => {
    updateDraft((next) => {
      mutator(next.folders[index])
    })
  }

  return (
    <Dialog onClose={onClose} data-testid="settings-dialog" className="wide-dialog" title="Settings">
        <p className="hint">Changes are written back to the config file and applied immediately. The bind host and port are fixed at deploy time.</p>

        <div className="form-grid">
          <div className="field"><span className="field__label">Concurrency</span><input type="number" value={draft.concurrency} onChange={(event) => updateDraft((next) => { next.concurrency = event.target.value })} /></div>
          <div className="field"><span className="field__label">Trash retention (days)</span><input type="number" value={draft.trashRetentionDays} onChange={(event) => updateDraft((next) => { next.trashRetentionDays = event.target.value })} /></div>
          <div className="field"><span className="field__label">Default settle (s)</span><input type="number" value={draft.settleSeconds} onChange={(event) => updateDraft((next) => { next.settleSeconds = event.target.value })} /></div>
        </div>
        <div className="form-grid field-grid--checks">
          <label><input type="checkbox" checked={draft.notifySuccess !== false} onChange={(event) => updateDraft((next) => { next.notifySuccess = event.target.checked })} /> Notify when files are processed successfully</label>
        </div>
        <p className="hint">Notifications are sent through the portal&#39;s ntfy settings. Failures always notify; each folder can opt out of success notices below.</p>
        <div className="form-grid form-grid--paths">
          <div className="field"><span className="field__label">Staging directory</span><input value={draft.stagingDir} onChange={(event) => updateDraft((next) => { next.stagingDir = event.target.value })} /></div>
          <div className="field"><span className="field__label">Review directory</span><input value={draft.reviewDir} onChange={(event) => updateDraft((next) => { next.reviewDir = event.target.value })} /></div>
          <div className="field"><span className="field__label">Trash directory</span><input value={draft.trashDir} onChange={(event) => updateDraft((next) => { next.trashDir = event.target.value })} /></div>
        </div>

        <h3 className="settings-section">Folders</h3>
        {draft.folders.map((folder, index) => (
          <div className="folder-edit" key={index}>
            <div className="folder-edit__head">
              <h3>{folder.name || 'New folder'}</h3>
              <button className="outline secondary icon-button icon-button--small" title="Remove this folder" aria-label="Remove this folder"
                onClick={() => updateDraft((next) => { next.folders = next.folders.filter((_, i) => i !== index) })}>
                <X size={14} strokeWidth={1.8} />
              </button>
            </div>
            <div className="form-grid">
              <div className="field"><span className="field__label">Name</span><input value={folder.name} onChange={(event) => setFolder(index, (f) => { f.name = event.target.value })} /></div>
              <div className="field"><span className="field__label">Source</span><input value={folder.source} onChange={(event) => setFolder(index, (f) => { f.source = event.target.value })} /></div>
              <div className="field"><span className="field__label">Destination</span><input value={folder.destination} onChange={(event) => setFolder(index, (f) => { f.destination = event.target.value })} /></div>
              <div className="field"><span className="field__label">Method</span>
                <select value={folder.method} onChange={(event) => setFolder(index, (f) => { f.method = event.target.value })}>
                  {['standardize', 'snapchat', 'copy', 'reviewed-audio'].map((method) => <option value={method} key={method}>{METHOD_LABEL[method] ?? method}</option>)}
                </select>
              </div>
              <div className="field"><span className="field__label">Settle (s)</span><input type="number" value={folder.settleSeconds ?? 60} onChange={(event) => setFolder(index, (f) => { f.settleSeconds = event.target.value })} /></div>
              {folder.method === 'snapchat' ? (
                <div className="field"><span className="field__label">Group window (s)</span><input type="number" value={folder.groupWindowSeconds ?? 15} onChange={(event) => setFolder(index, (f) => { f.groupWindowSeconds = event.target.value })} /></div>
              ) : null}
              <div className="field"><span className="field__label">File pattern</span><input value={folder.filePattern ?? ''} onChange={(event) => setFolder(index, (f) => { f.filePattern = event.target.value })} /></div>
            </div>
            <div className="form-grid field-grid--checks">
              <label><input type="checkbox" checked={folder.recursive === true || folder.method === 'reviewed-audio'} disabled={folder.method === 'reviewed-audio'} onChange={(event) => setFolder(index, (f) => { f.recursive = event.target.checked })} /> Recursive (mirror subdirectories)</label>
              <label><input type="checkbox" checked={folder.includeHidden === true} onChange={(event) => setFolder(index, (f) => { f.includeHidden = event.target.checked })} /> Include hidden files</label>
              {folder.method !== 'reviewed-audio' ? (
                <>
                  <label><input type="checkbox" checked={folder.cleanup !== false} onChange={(event) => setFolder(index, (f) => { f.cleanup = event.target.checked })} /> Allow cleanup of processed originals</label>
                  <label><input type="checkbox" checked={folder.autoProcess === true} onChange={(event) => setFolder(index, (f) => { f.autoProcess = event.target.checked })} /> Prepare new files automatically (manual review)</label>
                </>
              ) : (
                <label><input type="checkbox" checked={folder.concat !== false} onChange={(event) => setFolder(index, (f) => { f.concat = event.target.checked })} /> Concatenate same-day clips (uncheck to standardize each file)</label>
              )}
            </div>
            <div className="form-grid">
              <div className="field" hidden={folder.method === 'reviewed-audio'}><span className="field__label">Placement</span>
                <select value={folder.placement ?? 'auto'} onChange={(event) => setFolder(index, (f) => { f.placement = event.target.value })}>
                  <option value="auto">auto</option><option value="manual">manual</option>
                </select>
              </div>
              {folder.method === 'reviewed-audio' ? (
                <p className="hint">Reviewed audio is always approved from the Review dialog: merge &amp; move grouped clips, or standardize &amp; move each file. Delete moves sources to trash.</p>
              ) : null}
              <div className="field"><span className="field__label">On change</span>
                <select value={folder.onChanged ?? 'overwrite'} onChange={(event) => setFolder(index, (f) => { f.onChanged = event.target.value })}>
                  <option value="overwrite">overwrite</option><option value="conflict">conflict</option>
                </select>
              </div>
              <div className="field"><span className="field__label">Notify on success</span>
                <select value={folder.notify ?? 'all'} onChange={(event) => setFolder(index, (f) => { f.notify = event.target.value })}>
                  <option value="all">all</option><option value="errors">errors</option>
                </select>
              </div>
              {folder.method === 'reviewed-audio' || folder.datePattern ? (
                <div className="field">
                  <span className="field__label">Date pattern (optional for reviewed audio)</span>
                  <input value={folder.datePattern ?? ''} placeholder="-(\d{8})- (leave blank to use file metadata)" onChange={(event) => setFolder(index, (f) => { f.datePattern = event.target.value })} />
                  <p className="hint">The pattern supplies the file date. When concatenation is on, clips are also grouped by chat/day; turn it off to standardize each file individually.</p>
                </div>
              ) : null}
            </div>
          </div>
        ))}
        <div className="folder-card__actions">
          <button className="outline secondary" onClick={addFolder}>Add folder</button>
        </div>

        <div className="dialog-actions">
          <button className="outline secondary" onClick={onClose}>Cancel</button>
          <button onClick={saveSettings}>Save</button>
        </div>
    </Dialog>
  )
}
