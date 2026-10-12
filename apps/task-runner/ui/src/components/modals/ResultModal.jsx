import { useRef } from 'react'
import { showToast, useModal } from '@dscpln/ui-kit'

const copyText = (text) => {
  navigator.clipboard
    .writeText(text)
    .then(() => showToast('Copied to clipboard'))
    .catch(() => showToast('Copy failed — select the text manually', 'error'))
}

// Shows a task's log (live or last run) or pasteable output with Copy/Done.
export default function ResultModal({ props, close, liveLogs }) {
  const ref = useRef(null)
  useModal(ref, close)
  return (
    <dialog ref={ref} className="wide-dialog">
      <article>
        <header className="card__header"><h2>{props.title}</h2></header>
        <pre className="log-box">{props.live ? (liveLogs[props.task] ?? []).join('\n') : props.text}</pre>
        <div className="dialog-actions">
          {props.paste ? (
            <>
              <button className="outline secondary" onClick={() => copyText(props.text)}>Copy</button>
              <button onClick={() => props.onDone(close)}>Done</button>
            </>
          ) : (
            <button className="outline secondary" onClick={close}>Close</button>
          )}
        </div>
      </article>
    </dialog>
  )
}
