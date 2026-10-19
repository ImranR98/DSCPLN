import { forwardRef, useId, useImperativeHandle, useRef, useState } from 'react'

const INCOME_GROUP = 'Money In'
const CONVERSION_GROUP = 'Conversions'

const categoriesForKind = (categories, kind) => (categories || [])
  .filter((entry) => kind === 'income'
    ? entry.group === INCOME_GROUP || entry.group === CONVERSION_GROUP
    : entry.group !== INCOME_GROUP)
  .flatMap((entry) => entry.categories)

const ChangeDialog = forwardRef(function ChangeDialog({ categories, onSave }, ref) {
  const rootRef = useRef(null)
  const titleId = useId()
  const [editingIndex, setEditingIndex] = useState(null)
  const [from, setFrom] = useState('')
  const [kind, setKind] = useState('expense')
  const [category, setCategory] = useState('')
  const [amount, setAmount] = useState('')
  const [error, setError] = useState('')

  useImperativeHandle(ref, () => ({
    showAdd(defaultMonth) {
      setEditingIndex(null)
      setFrom(defaultMonth)
      setKind('expense')
      setCategory('')
      setAmount('')
      setError('')
      rootRef.current.showModal()
    },
    showEdit(change, index) {
      setEditingIndex(index)
      setFrom(change.from)
      setKind(change.kind)
      setCategory(change.category)
      setAmount(String(change.amount))
      setError('')
      rootRef.current.showModal()
    },
  }))

  const options = categoriesForKind(categories, kind)

  const changeKind = (nextKind) => {
    setKind(nextKind)
    if (!categoriesForKind(categories, nextKind).includes(category)) {
      setCategory('')
    }
  }

  const submit = (event) => {
    event.preventDefault()
    const parsedAmount = Number.parseFloat(amount)
    if (!/^\d{4}-\d{2}$/.test(from)) {
      setError('Choose a month.')
      return
    }
    if (!category) {
      setError('Choose a category.')
      return
    }
    if (!Number.isFinite(parsedAmount) || parsedAmount < 0) {
      setError('Amount must be 0 or greater.')
      return
    }
    onSave({
      index: editingIndex,
      change: { from, kind, category, amount: parsedAmount },
    })
    rootRef.current.close()
  }

  return (
    <dialog ref={rootRef} className="narrow-dialog forecast-dialog" aria-labelledby={titleId}>
      <article>
        <header className="card__header">
          <h2 id={titleId}>{editingIndex == null ? 'Add scheduled change' : 'Edit scheduled change'}</h2>
          <span className="card__header-tools">
            <button className="outline secondary icon-button" type="button" aria-label="Close" onClick={() => rootRef.current.close()}>&times;</button>
          </span>
        </header>
        <form id="forecastChangeForm" noValidate onSubmit={submit}>
          <div className="native-fields">
            <label className="field">
              <span className="field__label">From month</span>
              <input data-testid="change-from" type="month" required value={from} onChange={(event) => setFrom(event.target.value)} />
            </label>
            <label className="field">
              <span className="field__label">Kind</span>
              <select data-testid="change-kind" value={kind} onChange={(event) => changeKind(event.target.value)}>
                <option value="expense">Expense</option>
                <option value="income">Income</option>
              </select>
            </label>
            <label className="field">
              <span className="field__label">Category</span>
              <select data-testid="change-category" value={category} onChange={(event) => setCategory(event.target.value)} required>
                <option value="">Choose…</option>
                {options.map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
            </label>
            <label className="field">
              <span className="field__label">Monthly amount</span>
              <input
                data-testid="change-amount"
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
          <p className="hint">This replaces the category total from the first day of the selected month onward.</p>
          {error ? <p className="form-error" role="alert">{error}</p> : null}
        </form>
        <div className="dialog-actions">
          <button className="outline secondary" type="button" onClick={() => rootRef.current.close()}>Cancel</button>
          <button type="submit" form="forecastChangeForm">{editingIndex == null ? 'Add change' : 'Save change'}</button>
        </div>
      </article>
    </dialog>
  )
})

export default ChangeDialog
