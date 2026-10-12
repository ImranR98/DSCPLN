<script>
  import { tick } from 'svelte'
  import { parseIso, toIso, showToast } from '@dscpln/ui-kit'
  import { requestJson } from './lib/request.js'

  let { data, today, onrefresh } = $props()

  const INCOME_GROUP = 'Money In'
  const CONVERSION_GROUP = 'Conversions'

  let root = $state(null)
  let detailsInput = $state(null)
  let amountInput = $state(null)
  let menu = $state(null)

  let editing = $state(null)
  let kind = $state('expense')
  let amount = $state('')
  let details = $state('')
  let date = $state('')
  let category = $state('')
  let currency = $state('')
  let notes = $state('')
  let categoryTouched = $state(false)
  let categoryHint = $state('')
  let formError = $state('')
  let saving = $state(false)
  let suggestions = $state([])
  let suggestionIndex = $state(-1)

  let suggestionTimer = null
  let categorySequence = 0
  let detailsTimer = null
  let detailsSequence = 0

  const categoryGroups = $derived.by(() =>
    (data?.categories || []).filter((entry) =>
      kind === 'income'
        ? entry.group === INCOME_GROUP || entry.group === CONVERSION_GROUP
        : entry.group !== INCOME_GROUP))

  const allCategories = $derived(categoryGroups.flatMap((entry) => entry.categories))

  $effect(() => {
    if (category && !allCategories.includes(category)) {
      category = ''
    }
  })

  export function showAdd({ primaryCode }) {
    editing = null
    categoryTouched = false
    kind = 'expense'
    amount = ''
    details = ''
    notes = ''
    category = ''
    currency = primaryCode || ''
    date = toIso(today)
    categoryHint = ''
    formError = ''
    hideDetailsSuggestions()
    root.showModal()
    requestAnimationFrame(() => detailsInput?.focus())
  }

  export function showEdit(transaction) {
    editing = transaction
    categoryTouched = true
    kind = transaction.kind === 'income' ? 'income' : 'expense'
    amount = String(transaction.kind === 'income' ? transaction.moneyIn : transaction.expenses)
    details = transaction.details || ''
    const parsed = parseIso(transaction.date)
    date = parsed ? toIso(parsed) : toIso(today)
    category = transaction.category || ''
    currency = transaction.currency || ''
    notes = transaction.notes || ''
    categoryHint = ''
    formError = ''
    hideDetailsSuggestions()
    root.showModal()
    requestAnimationFrame(() => amountInput?.focus())
  }

  function hideDetailsSuggestions() {
    suggestions = []
    suggestionIndex = -1
  }

  function scheduleDetailsSuggestion() {
    window.clearTimeout(detailsTimer)
    detailsTimer = window.setTimeout(fetchDetailsSuggestions, 150)
  }

  async function fetchDetailsSuggestions() {
    const sequence = ++detailsSequence
    try {
      const params = new URLSearchParams({ q: details, kind })
      const result = await requestJson(`/details-suggestions?${params}`)
      if (sequence !== detailsSequence || !root?.open) {
        return
      }
      suggestions = result.suggestions || []
      suggestionIndex = -1
    } catch (e) {
      // Autocomplete is best-effort; ignore failures.
    }
  }

  function setActiveDetailsSuggestion(index) {
    suggestionIndex = index
    if (index >= 0) {
      tick().then(() => document.getElementById(`detailsSuggestion-${index}`)?.scrollIntoView({ block: 'nearest' }))
    }
  }

  function selectDetailsSuggestion(index) {
    const suggestion = suggestions[index]
    if (!suggestion) {
      return
    }
    details = suggestion.details
    if (!categoryTouched && suggestion.category) {
      if (allCategories.includes(suggestion.category)) {
        category = suggestion.category
      }
      categoryTouched = true
      categoryHint = ''
    }
    hideDetailsSuggestions()
    detailsInput?.focus()
  }

  function scheduleCategorySuggestion() {
    window.clearTimeout(suggestionTimer)
    suggestionTimer = window.setTimeout(fetchCategorySuggestions, 250)
  }

  async function fetchCategorySuggestions() {
    const sequence = ++categorySequence
    const query = details.trim()
    if (query.length < 3) {
      categoryHint = ''
      return
    }
    try {
      const result = await requestJson(`/category-suggestions?q=${encodeURIComponent(query)}&kind=${kind}`)
      if (sequence !== categorySequence) {
        return
      }
      const list = result.suggestions || []
      if (!list.length) {
        categoryHint = ''
        return
      }
      const top = list[0]
      if (result.confident && !categoryTouched) {
        category = top.category
        categoryHint = `Suggested: ${top.category} (${Math.round(top.score * 100)}% match)`
      } else {
        categoryHint = `Suggestions: ${list.slice(0, 3).map((item) => item.category).join(', ')}`
      }
    } catch (e) {
      console.error(e)
    }
  }

  function changeKind(value) {
    kind = value
    categoryTouched = false
    category = ''
    categoryHint = ''
    scheduleCategorySuggestion()
    if (suggestions.length) {
      scheduleDetailsSuggestion()
    }
  }

  function onDetailsInput() {
    if (!categoryTouched) {
      category = ''
    }
    scheduleCategorySuggestion()
    scheduleDetailsSuggestion()
  }

  function onDetailsKeydown(event) {
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

  function onDetailsBlur(event) {
    if (event.relatedTarget && menu?.contains(event.relatedTarget)) {
      return
    }
    window.setTimeout(() => {
      if (!menu?.contains(document.activeElement)) {
        hideDetailsSuggestions()
      }
    }, 120)
  }

  async function submit(event) {
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
    saving = true
    try {
      await requestJson(editing ? `/transactions/${encodeURIComponent(editing.id)}` : '/transactions', {
        method: editing ? 'PUT' : 'POST',
        body: JSON.stringify(payload),
      })
      root.close()
      showToast(editing ? 'Transaction updated' : 'Transaction added')
      onrefresh?.()
    } catch (e) {
      if (e.status === 409) {
        root.close()
        showToast(e.message, 'error')
        onrefresh?.()
      } else {
        if (!e.status) {
          console.error(e)
        }
        formError = e.status ? e.message : 'Could not save the transaction. Check the server logs.'
      }
    } finally {
      saving = false
    }
  }
</script>

<dialog bind:this={root} class="wide-dialog" onclose={hideDetailsSuggestions}>
  <article>
    <header class="card__header">
      <h2>{editing ? 'Edit transaction' : 'Add transaction'}</h2>
      <span class="card__header-tools">
        <button class="outline secondary icon-button" type="button" aria-label="Close" onclick={() => root.close()}>&times;</button>
      </span>
    </header>

    <form id="transactionForm" onsubmit={submit}>
      <div class="segmented" role="radiogroup" aria-label="Transaction kind">
        <label class="segmented__option">
          <input type="radio" name="kind" value="expense" checked={kind === 'expense'} onchange={() => changeKind('expense')} />
          <span>Expense</span>
        </label>
        <label class="segmented__option">
          <input type="radio" name="kind" value="income" checked={kind === 'income'} onchange={() => changeKind('income')} />
          <span>Income</span>
        </label>
      </div>

      <div class="field">
        <span class="field__label">Amount</span>
        <input
          bind:this={amountInput}
          type="number"
          step="any"
          min="0.000000000001"
          inputmode="decimal"
          autocomplete="off"
          required
          bind:value={amount}
        />
      </div>

      <div class="field">
        <span class="field__label">Details</span>
        <div class="autocomplete">
          <input
            bind:this={detailsInput}
            type="text"
            autocomplete="off"
            required
            role="combobox"
            aria-expanded={suggestions.length > 0}
            aria-activedescendant={suggestionIndex >= 0 ? `detailsSuggestion-${suggestionIndex}` : undefined}
            aria-controls="detailsSuggestions"
            bind:value={details}
            oninput={onDetailsInput}
            onfocus={scheduleDetailsSuggestion}
            onkeydown={onDetailsKeydown}
            onblur={onDetailsBlur}
          />
          {#if suggestions.length}
            <ul bind:this={menu} id="detailsSuggestions" class="autocomplete__menu" role="listbox" aria-label="Previously used details">
              {#each suggestions as suggestion, index (index)}
                <li
                  class="autocomplete__option{suggestionIndex === index ? ' is-active' : ''}"
                  id={`detailsSuggestion-${index}`}
                  role="option"
                  aria-selected={suggestionIndex === index ? 'true' : 'false'}
                  onmousedown={(event) => event.preventDefault()}
                  onclick={() => selectDetailsSuggestion(index)}
                >
                  <span class="autocomplete__option-details">{suggestion.details}</span>
                  <span class="autocomplete__option-category">{suggestion.category || ''}</span>
                </li>
              {/each}
            </ul>
          {/if}
        </div>
      </div>

      <div class="native-fields">
        <div class="native-field">
          <span class="field__label">Date</span>
          <input type="date" required bind:value={date} />
        </div>
        <div class="field">
          <span class="field__label">Category</span>
          <select
            required
            bind:value={category}
            onchange={() => {
              categoryTouched = true
              categoryHint = ''
            }}
          >
            <option value="" disabled>Select a category</option>
            {#each categoryGroups as group (group.group)}
              <optgroup label={group.group}>
                {#each group.categories as option (option)}<option value={option}>{option}</option>{/each}
              </optgroup>
            {/each}
          </select>
        </div>
        <div class="field">
          <span class="field__label">Currency</span>
          <select required bind:value={currency}>
            {#each data?.currencies || [] as entry (entry.code)}
              <option value={entry.code}>{entry.code}</option>
            {/each}
          </select>
        </div>
      </div>

      {#if categoryHint}<p class="hint">{categoryHint}</p>{/if}

      <div class="field">
        <span class="field__label">Notes (optional)</span>
        <input type="text" autocomplete="off" bind:value={notes} />
      </div>

      {#if formError}<p class="form-error">{formError}</p>{/if}
    </form>

    <div class="dialog-actions">
      <button class="outline secondary" type="button" onclick={() => root.close()}>Cancel</button>
      <button type="submit" form="transactionForm" disabled={saving}>Save</button>
    </div>
  </article>
</dialog>
