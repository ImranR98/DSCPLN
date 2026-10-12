import { useRef, useState } from 'react'
import { useModal } from '@dscpln/ui-kit'

// Secret prompts (e.g. pairing codes): one password input per field.
export default function FieldsModal({ props, close }) {
  const ref = useRef(null)
  const [values, setValues] = useState(() => props.fields.map((field) => field.value ?? ''))
  useModal(ref, () => {
    props.resolve(null)
    close()
  })
  return (
    <dialog ref={ref}>
      <article>
        <header className="card__header"><h2>{props.title}</h2></header>
        <div className="modal-fields">
          {props.fields.map((field, index) => (
            <div className="field" key={field.label}>
              <span className="field__label">{field.label}</span>
              <input
                type="password"
                autoComplete="off"
                value={values[index]}
                onChange={(event) => {
                  const next = [...values]
                  next[index] = event.target.value
                  setValues(next)
                }}
              />
            </div>
          ))}
        </div>
        <div className="dialog-actions">
          <button className="outline secondary" onClick={() => { props.resolve(null); close() }}>Cancel</button>
          <button onClick={() => { props.resolve(values); close() }}>{props.submitLabel}</button>
        </div>
      </article>
    </dialog>
  )
}
