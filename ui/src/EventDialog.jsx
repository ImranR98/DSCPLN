import { forwardRef, useId, useImperativeHandle, useRef, useState } from 'react'

const EventDialog = forwardRef(function EventDialog({ asOf, onSave }, ref) {
  const rootRef = useRef(null)
  const titleId = useId()
  const [editingIndex, setEditingIndex] = useState(null)
  const [date, setDate] = useState('')
  const [details, setDetails] = useState('')
  const [kind, setKind] = useState('expense')
  const [amount, setAmount] = useState('')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState('')

  useImperativeHandle(ref, () => ({
    showAdd() {
      setEditingIndex(null)
      setDate(asOf)
      setDetails('')
      setKind('expense')
      setAmount('')
      setNotes('')
      setError('')
      rootRef.current.showModal()
    },
    showEdit(event, index) {
      setEditingIndex(index)
      setDate(event.date)
      setDetails(event.details || '')
      setKind(event.kind || 'expense')
      setAmount(String(event.amount ?? ''))
      setNotes(event.notes || '')
      setError('')
      rootRef.current.showModal()
    },
  }))

  const submit = (event) => {
    event.preventDefault()
    const parsedAmount = Number.parseFloat(amount)
    if (!date) {
      setError('Choose a date.')
      return
    }
    if (!details.trim()) {
      setError('Add a short description.')
      return
    }
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setError('Amount must be greater than 0.')
      return
    }
    onSave({
      index: editingIndex,
      event: {
        date,
        details: details.trim(),
        kind,
        amount: parsedAmount,
        notes: notes.trim(),
      },
    })
    rootRef.current.close()
  }

  return (
    <dialog ref={rootRef} className="narrow-dialog forecast-dialog" aria-labelledby={titleId}>
      <article>
        <header className="card__header">
          <h2 id={titleId}>{editingIndex == null ? 'Add one-time event' : 'Edit one-time event'}</h2>
          <span className="card__header-tools">
            <button className="outline secondary icon-button" type="button" aria-label="Close" onClick={() => rootRef.current.close()}>&times;</button>
          </span>
        </header>
        <form id="forecastEventForm" noValidate onSubmit={submit}>
          <div className="native-fields">
            <label className="field">
              <span className="field__label">Date</span>
              <input data-testid="event-date" type="date" required value={date} onChange={(event) => setDate(event.target.value)} />
            </label>
            <label className="field">
              <span className="field__label">Kind</span>
              <select data-testid="event-kind" value={kind} onChange={(event) => setKind(event.target.value)}>
                <option value="expense">Expense</option>
                <option value="income">Income</option>
              </select>
            </label>
            <label className="field">
              <span className="field__label">Amount</span>
              <input
                data-testid="event-amount"
                type="number"
                min="0"
                step="any"
                inputMode="decimal"
                required
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
              />
            </label>
          </div>
          <label className="field">
            <span className="field__label">Details</span>
            <input data-testid="event-details" type="text" maxLength={200} required value={details} onChange={(event) => setDetails(event.target.value)} />
          </label>
          <label className="field">
            <span className="field__label">Notes <span className="label-optional">(optional)</span></span>
            <input data-testid="event-notes" type="text" maxLength={500} value={notes} onChange={(event) => setNotes(event.target.value)} />
          </label>
          {error ? <p className="form-error" role="alert">{error}</p> : null}
        </form>
        <div className="dialog-actions">
          <button className="outline secondary" type="button" onClick={() => rootRef.current.close()}>Cancel</button>
          <button type="submit" form="forecastEventForm">{editingIndex == null ? 'Add event' : 'Save event'}</button>
        </div>
      </article>
    </dialog>
  )
})

export default EventDialog
