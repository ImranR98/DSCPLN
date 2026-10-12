import { useRef } from 'react'
import { useModal } from '@dscpln/ui-kit'

// Asks which task a dropped file belongs to when the detection was ambiguous.
export default function PickerModal({ props, close }) {
  const ref = useRef(null)
  useModal(ref, () => {
    props.resolve(null)
    close()
  })
  return (
    <dialog ref={ref}>
      <article>
        <header className="card__header"><h2>{props.title}</h2></header>
        <div className="modal-fields">
          {props.options.map((option) => (
            <button className="outline secondary picker-option" key={option.name} onClick={() => { props.resolve(option); close() }}>{option.name}</button>
          ))}
        </div>
        <div className="dialog-actions">
          <button className="outline secondary" onClick={() => { props.resolve(null); close() }}>Cancel</button>
        </div>
      </article>
    </dialog>
  )
}
