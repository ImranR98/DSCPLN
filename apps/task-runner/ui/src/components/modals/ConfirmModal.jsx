import { Dialog } from '@dscpln/ui-kit'

export default function ConfirmModal({ props, close }) {
  const dismiss = () => {
    props.resolve(false)
    close()
  }
  return (
    <Dialog
      className="narrow-dialog"
      title={props.title}
      onClose={dismiss}
      actions={(
        <>
          <button className="outline secondary" onClick={dismiss}>Cancel</button>
          <button onClick={() => { props.resolve(true); close() }}>{props.submitLabel}</button>
        </>
      )}
    >
      {props.lines ? (
        <div className="modal-fields">
          {props.lines.map((line) => <span key={line}>{line}</span>)}
        </div>
      ) : null}
    </Dialog>
  )
}
