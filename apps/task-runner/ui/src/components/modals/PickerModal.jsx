import { Dialog } from '@dscpln/ui-kit'

// Asks which task a dropped file belongs to when the detection was ambiguous.
export default function PickerModal({ props, close }) {
  const dismiss = () => {
    props.resolve(null)
    close()
  }
  return (
    <Dialog
      title={props.title}
      onClose={dismiss}
      actions={<button className="outline secondary" onClick={dismiss}>Cancel</button>}
    >
      <div className="modal-fields">
        {props.options.map((option) => (
          <button className="outline secondary picker-option" key={option.name} onClick={() => { props.resolve(option); close() }}>{option.name}</button>
        ))}
      </div>
    </Dialog>
  )
}
