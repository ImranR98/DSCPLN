import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { apiUrl, getJson } from './api.js'

const LogDialog = forwardRef(function LogDialog(_props, ref) {
  const dialogRef = useRef(null)
  const [lines, setLines] = useState([])
  const sourceRef = useRef(null)

  const stop = () => {
    sourceRef.current?.close()
    sourceRef.current = null
  }

  const append = (line) => {
    setLines((current) => [...current, line].slice(-1000))
  }

  const load = async () => {
    try {
      setLines((await getJson('api/log?limit=500')).lines ?? [])
    } catch {
      setLines([])
    }
    stop()
    const source = new EventSource(apiUrl('api/events'))
    source.onmessage = (message) => {
      try {
        const event = JSON.parse(message.data)
        if (event.type === 'line') append(event.line)
      } catch {
        // ignore malformed frames
      }
    }
    source.onerror = () => stop()
    sourceRef.current = source
  }

  useImperativeHandle(ref, () => ({
    show() {
      if (!dialogRef.current.open) dialogRef.current.showModal()
      load()
    },
    append,
  }))

  useEffect(() => {
    const element = dialogRef.current
    const handleClose = () => stop()
    element?.addEventListener('close', handleClose)
    return () => {
      element?.removeEventListener('close', handleClose)
      stop()
    }
  }, [])

  return (
    <dialog ref={dialogRef} className="wide-dialog">
      <article>
        <header className="card__header">
          <h2>Log</h2>
          <span className="card__header-tools">
            <button className="outline secondary icon-button" aria-label="Close" onClick={() => dialogRef.current.close()}>&times;</button>
          </span>
        </header>
        <pre className="code-block log-dialog__output">{lines.length ? lines.join('\n') : 'No output yet.'}</pre>
        <div className="dialog-actions">
          <button onClick={() => dialogRef.current.close()}>Close</button>
        </div>
      </article>
    </dialog>
  )
})

export default LogDialog
