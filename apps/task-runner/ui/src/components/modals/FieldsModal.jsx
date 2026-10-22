import { useState } from 'react'
import { Dialog, Field } from '@dscpln/ui-kit'

// Secret prompts (e.g. pairing codes): one password input per field.
export default function FieldsModal({ props, close }) {
  const [values, setValues] = useState(() => props.fields.map((field) => field.value ?? ''))
  const dismiss = () => {
    props.resolve(null)
    close()
  }
  return (
    <Dialog
      title={props.title}
      onClose={dismiss}
      actions={(
        <>
          <button className="outline secondary" onClick={dismiss}>Cancel</button>
          <button onClick={() => { props.resolve(values); close() }}>{props.submitLabel}</button>
        </>
      )}
    >
      <div className="modal-fields">
        {props.fields.map((field, index) => (
          <Field key={field.label} label={field.label} htmlFor={`task-field-${index}`}>
            <input
              id={`task-field-${index}`}
              type={field.type === 'secret' ? 'password' : 'text'}
              autoComplete="off"
              value={values[index]}
              onChange={(event) => {
                const next = [...values]
                next[index] = event.target.value
                setValues(next)
              }}
            />
          </Field>
        ))}
      </div>
    </Dialog>
  )
}
