import { useRef } from 'react'
import { useModal } from '@dscpln/ui-kit'

export default function ConfirmModal({ props, close }) {
  const ref = useRef(null)
  useModal(ref, () => {
    props.resolve(false)
    close()
  })
  return (
    <dialog ref={ref} className="narrow-dialog">
      <article>
        <header className="card__header"><h2>{props.title}</h2></header>
        {props.lines ? (
          <div className="modal-fields">
            {props.lines.map((line) => <span key={line}>{line}</span>)}
          </div>
        ) : null}
        <div className="dialog-actions">
          <button className="outline secondary" onClick={() => { props.resolve(false); close() }}>Cancel</button>
          <button onClick={() => { props.resolve(true); close() }}>{props.submitLabel}</button>
        </div>
      </article>
    </dialog>
  )
}
