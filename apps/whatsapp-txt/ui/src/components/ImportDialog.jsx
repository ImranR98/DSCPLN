import { useEffect, useRef } from 'react'
import { Dialog } from '@dscpln/ui-kit'
import { formatSize } from '../lib/format.js'

// The import dialog hosts all of its own DOM behavior (showModal/close,
// backdrop click, Escape) and receives the import state + actions as props.
export default function ImportDialog({
  open,
  busy,
  imported,
  uploaded,
  files,
  status,
  statusError,
  result,
  onChooseFiles,
  onDiscard,
  onRun,
  onClose,
}) {
  const dialogRef = useRef(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    const element = dialogRef.current
    if (!element) return undefined
    const handleCancel = (event) => {
      event.preventDefault()
      onCloseRef.current?.()
    }
    element.addEventListener('cancel', handleCancel)
    return () => element.removeEventListener('cancel', handleCancel)
  }, [])

  useEffect(() => {
    const element = dialogRef.current
    if (!element) return
    if (open && !element.open) element.showModal()
    else if (!open && element.open) element.close()
  }, [open])

  return (
    <Dialog
      dialogRef={dialogRef}
      autoOpen={false}
      id="import-dialog"
      className="import-dialog"
      title="Import chat exports"
      onClose={onClose}
      requestClose={onClose}
      onClick={(event) => { if (event.target === dialogRef.current) onClose() }}
    >
        <p className="import-hint">Upload WhatsApp exports (<code>.zip</code> or <code>.txt</code>). They are merged with the conversations stored here; nothing changes until you press Import. Preview shows the plan without writing anything.</p>
        <div id="import-drop" className="import-drop"
          onDragOver={(event) => { event.preventDefault(); event.currentTarget.classList.add('import-drop--over') }}
          onDragLeave={(event) => event.currentTarget.classList.remove('import-drop--over')}
          onDrop={(event) => { event.preventDefault(); event.currentTarget.classList.remove('import-drop--over'); onChooseFiles(event.dataTransfer.files) }}
        >
          <input id="import-files" type="file" multiple accept=".zip,.txt,application/zip,text/plain" hidden
            onChange={(event) => { onChooseFiles(event.target.files); event.target.value = '' }} />
          <button type="button" id="import-browse" className="outline secondary" onClick={(event) => event.currentTarget.parentElement.querySelector('input').click()}>Choose files</button>
          <span className="import-drop__hint">or drop them here</span>
        </div>
        <ul id="import-list" className="import-list">
          {files.map((entry) => (
            <li className={`import-item import-item--${entry.state}`} key={entry.name}>
              <span className="import-item__name">{entry.name}</span>
              <span className="import-item__meta">
                {entry.state === 'done' ? `${formatSize(entry.size)} uploaded` : entry.state === 'error' ? (entry.error ?? 'failed') : entry.state}
              </span>
            </li>
          ))}
        </ul>
        <p id="import-status" className={`import-status${statusError ? ' import-status--error' : ''}`} hidden={!status}>{status}</p>
        <pre id="import-result" className="import-result" hidden={!result}>{result}</pre>
        <div className="import-actions">
          <button type="button" id="import-discard" className="outline secondary" hidden={!(files.length > 0 && !busy && !imported)} onClick={onDiscard}>Discard uploads</button>
          <span className="import-actions__spacer"></span>
          <button type="button" id="import-preview" className="outline secondary" disabled={!uploaded || busy || imported} onClick={() => onRun(true)}>Preview</button>
          <button type="button" id="import-run" disabled={!uploaded || busy || imported} onClick={() => onRun(false)}>Import</button>
          <button type="button" id="import-done" hidden={!imported} onClick={onClose}>Done</button>
        </div>
    </Dialog>
  )
}
