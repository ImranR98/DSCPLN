import { forwardRef, useImperativeHandle, useRef, useState } from 'react'
import { toIso, showToast } from '@dscpln/ui-kit'
import { requestJson } from './lib/request.js'

const IMPORTABLE_COLUMNS = ['Date', 'Details', 'Money In', 'Expenses', 'Currency', 'Type', 'Notes']

const ImportDialog = forwardRef(function ImportDialog({ data, today, onrefresh }, ref) {
  const rootRef = useRef(null)
  const textareaRef = useRef(null)
  const [text, setText] = useState('')
  const [formError, setFormError] = useState('')
  const [pastWarning, setPastWarning] = useState('')
  const [pastConfirmed, setPastConfirmed] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const columns = data?.transactionColumns?.length ? data.transactionColumns : IMPORTABLE_COLUMNS
  const extra = columns.filter((column) => !IMPORTABLE_COLUMNS.includes(column))
  const hint = `One transaction per line, tab-separated, in this column order: ${columns.join(' · ')}. Fill either Money In or Expenses.` +
    (extra.length ? ` Leave ${extra.join(', ')} empty.` : '')

  useImperativeHandle(ref, () => ({
    show() {
      setText('')
      setFormError('')
      resetImportConfirmation()
      rootRef.current.showModal()
      requestAnimationFrame(() => textareaRef.current?.focus())
    },
  }))

  const resetImportConfirmation = () => {
    setPastConfirmed(false)
    setPastWarning('')
  }

  // Counts pasted lines whose Date column is before the current month, so the
  // user can be warned before importing historical transactions.
  const pastDatedImportLines = (value) => {
    const dateIndex = Math.max(0, (data?.transactionColumns || ['Date']).indexOf('Date'))
    const monthStart = toIso(new Date(today.getFullYear(), today.getMonth(), 1))
    let count = 0
    let earliest = null
    for (const line of value.split(/\r?\n/)) {
      if (line.trim() === '') {
        continue
      }
      const column = (line.split('\t')[dateIndex] || '').trim()
      if (!/^\d{4}-\d{2}-\d{2}$/.test(column) || column >= monthStart) {
        continue
      }
      count += 1
      if (!earliest || column < earliest) {
        earliest = column
      }
    }
    return { count, earliest }
  }

  const submit = async (event) => {
    event.preventDefault()
    if (!text.trim()) {
      setFormError('Paste at least one transaction line.')
      return
    }
    const past = pastDatedImportLines(text)
    if (past.count > 0 && !pastConfirmed) {
      setPastConfirmed(true)
      setPastWarning(`${past.count} ${past.count === 1 ? 'line is' : 'lines are'} dated before this month (earliest ${past.earliest}). ` +
        'Click "Import anyway" to confirm these are deliberate.')
      return
    }
    setSubmitting(true)
    try {
      const result = await requestJson('/transactions/import', {
        method: 'POST',
        body: JSON.stringify({ text }),
      })
      rootRef.current.close()
      showToast(`Imported ${result.imported} ${result.imported === 1 ? 'transaction' : 'transactions'}`)
      onrefresh?.()
    } catch (e) {
      if (!e.status) {
        console.error(e)
      }
      setFormError(e.status ? e.message : 'Could not import transactions. Check the server logs.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <dialog ref={rootRef} className="wide-dialog">
      <article>
        <header className="card__header">
          <h2>Import transactions</h2>
          <span className="card__header-tools">
            <button className="outline secondary icon-button" type="button" aria-label="Close" onClick={() => rootRef.current.close()}>&times;</button>
          </span>
        </header>

        <form id="importForm" onSubmit={submit}>
          <p className="hint">{hint}</p>
          <div className="field">
            <span className="field__label">Transactions</span>
            <textarea
              ref={textareaRef}
              rows="14"
              spellCheck="false"
              autoCapitalize="off"
              autoComplete="off"
              placeholder={'2026-09-08\tCASH Dividend\t29.77\t\tCAD\tDividend'}
              value={text}
              onChange={(event) => {
                setText(event.target.value)
                if (pastConfirmed) {
                  resetImportConfirmation()
                }
              }}
            ></textarea>
          </div>
          {pastWarning ? <p className="form-warning">{pastWarning}</p> : null}
          {formError ? <p className="form-error">{formError}</p> : null}
        </form>

        <div className="dialog-actions">
          <button className="outline secondary" type="button" onClick={() => rootRef.current.close()}>Cancel</button>
          <button type="submit" form="importForm" disabled={submitting}>{pastConfirmed ? 'Import anyway' : 'Import'}</button>
        </div>
      </article>
    </dialog>
  )
})

export default ImportDialog
