import { Dialog } from '@dscpln/ui-kit'
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { getJson, parseIso, postJson, putJson, toIso, showToast } from '@dscpln/ui-kit'


const INCOME_GROUP = 'Money In'
const CONVERSION_GROUP = 'Conversions'

const TransactionDialog = forwardRef(function TransactionDialog({ data, today, onrefresh }, ref) {
  const rootRef = useRef(null)
  const detailsInputRef = useRef(null)
  const amountInputRef = useRef(null)
  const menuRef = useRef(null)

  const [editing, setEditing] = useState(null)
  const [kind, setKind] = useState('expense')
  const [amount, setAmount] = useState('')
  const [details, setDetails] = useState('')
  const [date, setDate] = useState('')
  const [category, setCategory] = useState('')
  const [currency, setCurrency] = useState('')
  const [notes, setNotes] = useState('')
  const [categoryTouched, setCategoryTouched] = useState(false)
  const [categoryHint, setCategoryHint] = useState('')
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)
  const [suggestions, setSuggestions] = useState([])
  const [suggestionIndex, setSuggestionIndex] = useState(-1)

  const suggestionTimer = useRef(null)
  const categorySequence = useRef(0)
  const detailsTimer = useRef(null)
  const detailsSequence = useRef(0)

  const categoryGroups = (data?.categories || []).filter((entry) =>
    kind === 'income'
      ? entry.group === INCOME_GROUP || entry.group === CONVERSION_GROUP
      : entry.group !== INCOME_GROUP)
  const allCategories = categoryGroups.flatMap((entry) => entry.categories)
  const allCategoriesKey = allCategories.join('\n')

  useEffect(() => {
    if (category && !allCategories.includes(category)) {
      setCategory('')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category, allCategoriesKey])

  useImperativeHandle(ref, () => ({
    showAdd({ primaryCode }) {
      setEditing(null)
      setCategoryTouched(false)
      setKind('expense')
      setAmount('')
      setDetails('')
      setNotes('')
      setCategory('')
      setCurrency(primaryCode || '')
      setDate(toIso(today))
      setCategoryHint('')
      setFormError('')
      hideDetailsSuggestions()
      rootRef.current.showModal()
      requestAnimationFrame(() => detailsInputRef.current?.focus())
    },
    showEdit(transaction) {
      setEditing(transaction)
      setCategoryTouched(true)
      setKind(transaction.kind === 'income' ? 'income' : 'expense')
      setAmount(String(transaction.kind === 'income' ? transaction.moneyIn : transaction.expenses))
      setDetails(transaction.details || '')
      const parsed = parseIso(transaction.date)
      setDate(parsed ? toIso(parsed) : toIso(today))
      setCategory(transaction.category || '')
      setCurrency(transaction.currency || '')
      setNotes(transaction.notes || '')
      setCategoryHint('')
      setFormError('')
      hideDetailsSuggestions()
      rootRef.current.showModal()
      requestAnimationFrame(() => amountInputRef.current?.focus())
    },
  }))

  const hideDetailsSuggestions = () => {
    setSuggestions([])
    setSuggestionIndex(-1)
  }

  const scheduleDetailsSuggestion = (query = details, kindValue = kind) => {
    window.clearTimeout(detailsTimer.current)
    detailsTimer.current = window.setTimeout(() => fetchDetailsSuggestions(query, kindValue), 150)
  }

  const fetchDetailsSuggestions = async (query, kindValue) => {
    const sequence = ++detailsSequence.current
    try {
      const params = new URLSearchParams({ q: query, kind: kindValue })
      const result = await getJson(`/details-suggestions?${params}`)
      if (sequence !== detailsSequence.current || !rootRef.current?.open) {
        return
      }
      setSuggestions(result.suggestions || [])
      setSuggestionIndex(-1)
    } catch (e) {
      // Autocomplete is best-effort; ignore failures.
    }
  }

  const setActiveDetailsSuggestion = (index) => {
    setSuggestionIndex(index)
    if (index >= 0) {
      requestAnimationFrame(() =>
        document.getElementById(`detailsSuggestion-${index}`)?.scrollIntoView({ block: 'nearest' }))
    }
  }

  const selectDetailsSuggestion = (index) => {
    const suggestion = suggestions[index]
    if (!suggestion) {
      return
    }
    setDetails(suggestion.details)
    if (!categoryTouched && suggestion.category) {
      if (allCategories.includes(suggestion.category)) {
        setCategory(suggestion.category)
      }
      setCategoryTouched(true)
      setCategoryHint('')
    }
    hideDetailsSuggestions()
    detailsInputRef.current?.focus()
  }

  const scheduleCategorySuggestion = (query = details, kindValue = kind) => {
    window.clearTimeout(suggestionTimer.current)
    suggestionTimer.current = window.setTimeout(() => fetchCategorySuggestions(query.trim(), kindValue), 250)
  }

  const fetchCategorySuggestions = async (query, kindValue) => {
    const sequence = ++categorySequence.current
    if (query.length < 3) {
      setCategoryHint('')
      return
    }
    try {
      const result = await getJson(`/category-suggestions?q=${encodeURIComponent(query)}&kind=${kindValue}`)
      if (sequence !== categorySequence.current) {
        return
      }
      const list = result.suggestions || []
      if (!list.length) {
        setCategoryHint('')
        return
      }
      const top = list[0]
      if (result.confident && !categoryTouched) {
        setCategory(top.category)
        setCategoryHint(`Suggested: ${top.category} (${Math.round(top.score * 100)}% match)`)
      } else {
        setCategoryHint(`Suggestions: ${list.slice(0, 3).map((item) => item.category).join(', ')}`)
      }
    } catch (e) {
      console.error(e)
    }
  }

  const changeKind = (value) => {
    setKind(value)
    setCategoryTouched(false)
    setCategory('')
    setCategoryHint('')
    scheduleCategorySuggestion(details, value)
    if (suggestions.length) {
      scheduleDetailsSuggestion(details, value)
    }
  }

  const onDetailsInput = (event) => {
    const next = event.target.value
    setDetails(next)
    if (!categoryTouched) {
      setCategory('')
    }
    scheduleCategorySuggestion(next, kind)
    scheduleDetailsSuggestion(next, kind)
  }

  const onDetailsKeydown = (event) => {
    if (event.key === 'Escape') {
      if (suggestions.length) {
        event.preventDefault()
        hideDetailsSuggestions()
      }
      return
    }
    if (!suggestions.length) {
      return
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveDetailsSuggestion(Math.min(suggestionIndex + 1, suggestions.length - 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveDetailsSuggestion(Math.max(suggestionIndex - 1, 0))
    } else if (event.key === 'Enter' && suggestionIndex >= 0) {
      event.preventDefault()
      selectDetailsSuggestion(suggestionIndex)
    }
  }

  const onDetailsBlur = (event) => {
    if (event.relatedTarget && menuRef.current?.contains(event.relatedTarget)) {
      return
    }
    window.setTimeout(() => {
      if (!menuRef.current?.contains(document.activeElement)) {
        hideDetailsSuggestions()
      }
    }, 120)
  }

  const submit = async (event) => {
    event.preventDefault()
    const payload = {
      kind,
      amount: Number.parseFloat(amount),
      details,
      date,
      category,
      currency,
      notes,
    }
    setSaving(true)
    try {
      if (editing) {
        await putJson(`/transactions/${encodeURIComponent(editing.id)}`, payload)
      } else {
        await postJson('/transactions', payload)
      }
      rootRef.current.close()
      showToast(editing ? 'Transaction updated' : 'Transaction added')
      onrefresh?.()
    } catch (e) {
      if (e.status === 409) {
        rootRef.current.close()
        showToast(e.message, 'error')
        onrefresh?.()
      } else {
        if (!e.status) {
          console.error(e)
        }
        setFormError(e.status ? e.message : 'Could not save the transaction. Check the server logs.')
      }
    } finally {
      setSaving(false)
    }
  }

  useEffect(() => {
    const element = rootRef.current
    if (!element) return undefined
    element.addEventListener('close', hideDetailsSuggestions)
    return () => element.removeEventListener('close', hideDetailsSuggestions)
  }, [])

  return (
    <Dialog dialogRef={rootRef} autoOpen={false} className="wide-dialog" title={editing ? 'Edit transaction' : 'Add transaction'}>

        <form id="transactionForm" onSubmit={submit}>
          <div className="segmented" role="radiogroup" aria-label="Transaction kind">
            <label className="segmented__option">
              <input type="radio" name="kind" value="expense" checked={kind === 'expense'} onChange={() => changeKind('expense')} />
              <span>Expense</span>
            </label>
            <label className="segmented__option">
              <input type="radio" name="kind" value="income" checked={kind === 'income'} onChange={() => changeKind('income')} />
              <span>Income</span>
            </label>
          </div>

          <div className="field">
            <span className="field__label">Amount</span>
            <input
              ref={amountInputRef}
              type="number"
              step="any"
              min="0.000000000001"
              inputMode="decimal"
              autoComplete="off"
              required
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
            />
          </div>

          <div className="field">
            <span className="field__label">Details</span>
            <div className="autocomplete">
              <input
                ref={detailsInputRef}
                type="text"
                autoComplete="off"
                required
                role="combobox"
                aria-expanded={suggestions.length > 0}
                aria-activedescendant={suggestionIndex >= 0 ? `detailsSuggestion-${suggestionIndex}` : undefined}
                aria-controls="detailsSuggestions"
                value={details}
                onChange={onDetailsInput}
                onFocus={() => scheduleDetailsSuggestion(details, kind)}
                onKeyDown={onDetailsKeydown}
                onBlur={onDetailsBlur}
              />
              {suggestions.length ? (
                <ul ref={menuRef} id="detailsSuggestions" className="autocomplete__menu" role="listbox" aria-label="Previously used details">
                  {suggestions.map((suggestion, index) => (
                    <li
                      key={index}
                      className={`autocomplete__option${suggestionIndex === index ? ' is-active' : ''}`}
                      id={`detailsSuggestion-${index}`}
                      role="option"
                      aria-selected={suggestionIndex === index ? 'true' : 'false'}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => selectDetailsSuggestion(index)}
                    >
                      <span className="autocomplete__option-details">{suggestion.details}</span>
                      <span className="autocomplete__option-category">{suggestion.category || ''}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </div>

          <div className="native-fields">
            <div className="native-field">
              <span className="field__label">Date</span>
              <input type="date" required value={date} onChange={(event) => setDate(event.target.value)} />
            </div>
            <div className="field">
              <span className="field__label">Category</span>
              <select
                required
                value={category}
                onChange={(event) => {
                  setCategory(event.target.value)
                  setCategoryTouched(true)
                  setCategoryHint('')
                }}
              >
                <option value="" disabled>Select a category</option>
                {categoryGroups.map((group) => (
                  <optgroup key={group.group} label={group.group}>
                    {group.categories.map((option) => <option key={option} value={option}>{option}</option>)}
                  </optgroup>
                ))}
              </select>
            </div>
            <div className="field">
              <span className="field__label">Currency</span>
              <select required value={currency} onChange={(event) => setCurrency(event.target.value)}>
                {(data?.currencies || []).map((entry) => (
                  <option key={entry.code} value={entry.code}>{entry.code}</option>
                ))}
              </select>
            </div>
          </div>

          {categoryHint ? <p className="hint">{categoryHint}</p> : null}

          <div className="field">
            <span className="field__label">Notes (optional)</span>
            <input type="text" autoComplete="off" value={notes} onChange={(event) => setNotes(event.target.value)} />
          </div>

          {formError ? <p className="form-error">{formError}</p> : null}
        </form>

        <div className="dialog-actions">
          <button className="outline secondary" type="button" onClick={() => rootRef.current.close()}>Cancel</button>
          <button type="submit" form="transactionForm" disabled={saving}>Save</button>
        </div>
    </Dialog>
  )
})

export default TransactionDialog
