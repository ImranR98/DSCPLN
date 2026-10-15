import { X } from 'lucide-react'
import { DAY_NAMES } from '../../lib/view.js'
import Modal from '../Modal.jsx'

// The config editor: global settings up top, then one folder editor per
// configured folder (watched methods and snapshot copies).
export default function SettingsDialog({ draft, updateDraft, addFolder, saveSettings, onClose }) {
  const setFolder = (index, mutator) => {
    updateDraft((next) => {
      mutator(next.folders[index])
    })
  }

  return (
    <Modal onClose={onClose} data-testid="settings-dialog" className="wide-dialog">
      <article>
        <header className="card__header">
          <h2>Settings</h2>
          <span className="card__header-tools">
            <button className="outline secondary icon-button" aria-label="Close" onClick={onClose}>&times;</button>
          </span>
        </header>
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
        <div className="form-grid">
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
              {folder.snapshot ? (
                <div className="field field--wide">
                  <span className="field__label">Sources (one per line)</span>
                  <textarea rows="3" spellCheck="false" value={(folder.sources ?? []).join('\n')}
                    onChange={(event) => setFolder(index, (f) => { f.sources = event.target.value.split('\n').map((line) => line.trim()).filter(Boolean) })}></textarea>
                </div>
              ) : (
                <div className="field"><span className="field__label">Source</span><input value={folder.source} onChange={(event) => setFolder(index, (f) => { f.source = event.target.value })} /></div>
              )}
              <div className="field"><span className="field__label">Destination</span><input value={folder.destination} onChange={(event) => setFolder(index, (f) => { f.destination = event.target.value })} /></div>
              <div className="field"><span className="field__label">Method</span>
                <select value={folder.method} onChange={(event) => setFolder(index, (f) => { f.method = event.target.value })}>
                  {['standardize', 'snapchat', 'copy', 'voicenotes'].map((method) => <option value={method} key={method}>{method}</option>)}
                </select>
              </div>
              {folder.method === 'copy' ? (
                <div className="field">
                  <span className="field__label">Snapshot</span>
                  <label><input type="checkbox" checked={folder.snapshot === true}
                    onChange={(event) => setFolder(index, (f) => {
                      f.snapshot = event.target.checked
                      if (f.snapshot && !(f.sources ?? []).length && f.source) f.sources = [f.source]
                    })} /> Run on demand or on a schedule instead of watching</label>
                  <p className="hint">Copies whole entries from the sources each run (optionally one subdir); a remote runner node makes it a Job there.</p>
                </div>
              ) : null}
              {folder.snapshot ? (
                <>
                  <div className="field"><span className="field__label">Copy subdir (optional)</span><input value={folder.subdir ?? ''} placeholder="drive_c/users/steamuser" onChange={(event) => setFolder(index, (f) => { f.subdir = event.target.value })} /></div>
                  <div className="field"><span className="field__label">Name suffix (optional)</span><input value={folder.nameSuffix ?? ''} placeholder=" (Wine prefix home dir)" onChange={(event) => setFolder(index, (f) => { f.nameSuffix = event.target.value })} /></div>
                  <div className="field"><span className="field__label">Touch marker (optional)</span><input value={folder.touch ?? ''} placeholder="lastBackedUp.txt" onChange={(event) => setFolder(index, (f) => { f.touch = event.target.value })} /></div>
                  <div className="field">
                    <span className="field__label">Runner node</span>
                    <input value={folder.runner?.node ?? ''} placeholder="this server" onChange={(event) => setFolder(index, (f) => { f.runner = { node: event.target.value } })} />
                    <p className="hint">A Kubernetes node name (e.g. bigpc) to run the copy there; empty runs it on this server.</p>
                  </div>
                  <div className="field field--wide">
                    <span className="field__label">Command override (optional)</span>
                    <textarea rows="4" spellCheck="false" placeholder={'rsync -a "{{source}}/" "{{destination}}/"'}
                      value={folder.command ?? ''} onChange={(event) => setFolder(index, (f) => { f.command = event.target.value })}></textarea>
                    <p className="hint">Replaces the generated copy script. Tokens: {'{{source}}'}, {'{{destination}}'}, {'{{staging}}'}.</p>
                  </div>
                </>
              ) : null}
              <div className="field" hidden={folder.snapshot}><span className="field__label">Settle (s)</span><input type="number" value={folder.settleSeconds ?? 60} onChange={(event) => setFolder(index, (f) => { f.settleSeconds = event.target.value })} /></div>
              <div className="field" hidden={folder.snapshot}><span className="field__label">Group window (s)</span><input type="number" value={folder.groupWindowSeconds ?? 15} onChange={(event) => setFolder(index, (f) => { f.groupWindowSeconds = event.target.value })} /></div>
              <div className="field" hidden={folder.snapshot}><span className="field__label">File pattern</span><input value={folder.filePattern ?? ''} onChange={(event) => setFolder(index, (f) => { f.filePattern = event.target.value })} /></div>
            </div>
            <div className="form-grid field-grid--checks" hidden={folder.snapshot}>
              <label><input type="checkbox" checked={folder.recursive === true} onChange={(event) => setFolder(index, (f) => { f.recursive = event.target.checked })} /> Recursive (mirror subdirectories)</label>
              <label><input type="checkbox" checked={folder.includeHidden === true} onChange={(event) => setFolder(index, (f) => { f.includeHidden = event.target.checked })} /> Include hidden files</label>
              <label><input type="checkbox" checked={folder.cleanup !== false} onChange={(event) => setFolder(index, (f) => { f.cleanup = event.target.checked })} /> Allow cleanup of processed originals</label>
              <label><input type="checkbox" checked={folder.autoProcess === true} onChange={(event) => setFolder(index, (f) => { f.autoProcess = event.target.checked })} /> Prepare new files automatically (manual review)</label>
            </div>
            {folder.snapshot ? (
              <>
                <div className="form-grid">
                  <div className="field"><span className="field__label">Schedule</span>
                    <select value={folder.schedule?.enabled ? 'on' : 'off'}
                      onChange={(event) => setFolder(index, (f) => { f.schedule = { ...f.schedule, enabled: event.target.value === 'on' } })}>
                      <option value="off">manual</option>
                      <option value="on">scheduled</option>
                    </select>
                  </div>
                  <div className="field"><span className="field__label">At</span>
                    <input type="time" value={folder.schedule?.at ?? '03:00'} onChange={(event) => setFolder(index, (f) => { f.schedule = { ...f.schedule, at: event.target.value } })} />
                  </div>
                  <div className="field"><span className="field__label">Missed runs</span>
                    <select value={folder.schedule?.catchUp === false ? 'skip' : 'catchup'}
                      onChange={(event) => setFolder(index, (f) => { f.schedule = { ...f.schedule, catchUp: event.target.value === 'catchup' } })}>
                      <option value="catchup">run on start</option>
                      <option value="skip">skip</option>
                    </select>
                  </div>
                </div>
                <div className="form-grid field-grid--checks">
                  {DAY_NAMES.map((name, day) => (
                    <label key={name}>
                      <input type="checkbox" checked={(folder.schedule?.days ?? []).includes(day)}
                        onChange={(event) => setFolder(index, (f) => {
                          const days = new Set(f.schedule?.days ?? [])
                          if (event.target.checked) days.add(day)
                          else days.delete(day)
                          f.schedule = { ...f.schedule, days: [...days].sort() }
                        })} />
                      {name}
                    </label>
                  ))}
                  <p className="hint">No days selected = every day.</p>
                </div>
              </>
            ) : null}
            <div className="form-grid" hidden={folder.snapshot}>
              <div className="field"><span className="field__label">Placement</span>
                <select value={folder.placement ?? 'auto'} onChange={(event) => setFolder(index, (f) => { f.placement = event.target.value })}>
                  <option value="auto">auto</option><option value="manual">manual</option>
                </select>
              </div>
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
              <div className="field" hidden={folder.snapshot}><span className="field__label">Date pattern (voicenotes)</span><input value={folder.datePattern ?? ''} onChange={(event) => setFolder(index, (f) => { f.datePattern = event.target.value })} /></div>
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
      </article>
    </Modal>
  )
}
