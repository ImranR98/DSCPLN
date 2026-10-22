import { Dialog, showToast } from '@dscpln/ui-kit'

const copyText = (text) => {
  navigator.clipboard
    .writeText(text)
    .then(() => showToast('Copied to clipboard'))
    .catch(() => showToast('Copy failed — select the text manually', 'error'))
}

// Shows a task's log (live or last run) or pasteable output with Copy/Done.
export default function ResultModal({ props, close, liveLogs }) {
  return (
    <Dialog
      className="wide-dialog"
      title={props.title}
      onClose={close}
      actions={props.paste ? (
        <>
          <button className="outline secondary" onClick={() => copyText(props.text)}>Copy</button>
          <button onClick={() => props.onDone(close)}>Done</button>
        </>
      ) : (
        <button className="outline secondary" onClick={close}>Close</button>
      )}
    >
      <pre className="log-box">{props.live ? (liveLogs[props.task] ?? []).join('\n') : props.text}</pre>
    </Dialog>
  )
}
