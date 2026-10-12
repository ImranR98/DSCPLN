import Modal from '../Modal.jsx'

export default function SetDateDialog({ dialog, setField, onStandardize, onClose }) {
  return (
    <Modal onClose={onClose} className="narrow-dialog">
      <article>
        <header className="card__header">
          <h2>Set date</h2>
          <span className="card__header-tools">
            <button className="outline secondary icon-button" aria-label="Close" onClick={onClose}>&times;</button>
          </span>
        </header>
        <p className="hint">The copy will be standardized with this date and placed in the destination.</p>
        <div className="native-fields">
          <label className="native-field">
            <span className="field__label">Date</span>
            <input type="date" required value={dialog.date} onChange={(event) => setField({ date: event.target.value })} />
          </label>
          <label className="native-field">
            <span className="field__label">Time</span>
            <input type="time" value={dialog.time} onChange={(event) => setField({ time: event.target.value })} />
          </label>
        </div>
        {dialog.error ? <p className="form-error">{dialog.error}</p> : null}
        <div className="dialog-actions">
          <button className="outline secondary" onClick={onClose}>Cancel</button>
          <button onClick={onStandardize}>Standardize</button>
        </div>
      </article>
    </Modal>
  )
}
