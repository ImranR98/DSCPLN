import { forwardRef, useImperativeHandle, useRef, useState } from 'react'
import { showToast } from '@dscpln/ui-kit'
import { number } from './lib/money.js'
import { requestJson } from './lib/request.js'

const BudgetDialog = forwardRef(function BudgetDialog({ data, onrefresh }, ref) {
  const rootRef = useRef(null)
  const [currency, setCurrency] = useState(null)
  const [monthlyBudget, setMonthlyBudget] = useState('')
  const [firstDayBias, setFirstDayBias] = useState('')
  const [saving, setSaving] = useState(false)

  const budgetValue = Number.parseFloat(monthlyBudget)
  const biasValue = Number.parseFloat(firstDayBias)
  let validityError = ''
  if (!Number.isFinite(budgetValue) || budgetValue < 0) validityError = 'Monthly budget must be 0 or greater.'
  else if (!Number.isFinite(biasValue) || biasValue < 0) validityError = 'First day bias must be 0 or greater.'
  else if (biasValue > budgetValue) validityError = 'First day bias cannot be greater than the monthly budget.'

  useImperativeHandle(ref, () => ({
    show(currencyCode) {
      const entry = (data?.currencies || []).find((item) => item.code === currencyCode)
      setCurrency(currencyCode)
      setMonthlyBudget(String(entry ? number(entry.monthlyBudget) : 0))
      setFirstDayBias(String(entry ? number(entry.firstDayBias) : 0))
      rootRef.current.showModal()
    },
  }))

  const submit = async (event) => {
    event.preventDefault()
    if (validityError) return
    setSaving(true)
    try {
      await requestJson('/budget', {
        method: 'POST',
        body: JSON.stringify({
          monthlyBudget: Number.parseFloat(monthlyBudget),
          firstDayBias: Number.parseFloat(firstDayBias),
          currency,
        }),
      })
      rootRef.current.close()
      showToast('Budget updated')
      onrefresh?.()
    } catch (e) {
      console.error(e)
      showToast('Could not save the budget', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <dialog ref={rootRef} className="narrow-dialog">
      <article>
        <header className="card__header">
          <h2>Edit budget</h2>
          <span className="card__header-tools">
            <button className="outline secondary icon-button" type="button" aria-label="Close" onClick={() => rootRef.current.close()}>&times;</button>
          </span>
        </header>

        <form id="budgetForm" noValidate onSubmit={submit}>
          <p className="hint">Editing the {currency} budget.</p>
          <div className="field">
            <span className="field__label">Monthly budget</span>
            <input
              type="number"
              step="0.01"
              min="0"
              inputMode="decimal"
              autoComplete="off"
              required
              value={monthlyBudget}
              onChange={(event) => setMonthlyBudget(event.target.value)}
            />
          </div>
          <div className="field">
            <span className="field__label">First day bias</span>
            <input
              type="number"
              step="0.01"
              min="0"
              inputMode="decimal"
              autoComplete="off"
              required
              value={firstDayBias}
              onChange={(event) => setFirstDayBias(event.target.value)}
            />
          </div>
          <p className="hint">Extra amount assigned to the first day of the month.</p>
          {validityError ? <p className="form-error">{validityError}</p> : null}
        </form>

        <div className="dialog-actions">
          <button className="outline secondary" type="button" onClick={() => rootRef.current.close()}>Cancel</button>
          <button type="submit" form="budgetForm" disabled={Boolean(validityError) || saving}>Save</button>
        </div>
      </article>
    </dialog>
  )
})

export default BudgetDialog
