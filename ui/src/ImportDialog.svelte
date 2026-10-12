<script>
  import { toIso, showToast } from '@dscpln/ui-kit'
  import { requestJson } from './lib/request.js'

  let { data, today, onrefresh } = $props()

  const IMPORTABLE_COLUMNS = ['Date', 'Details', 'Money In', 'Expenses', 'Currency', 'Type', 'Notes']

  let root = $state(null)
  let textarea = $state(null)
  let text = $state('')
  let formError = $state('')
  let pastWarning = $state('')
  let pastConfirmed = $state(false)
  let submitting = $state(false)

  const hint = $derived.by(() => {
    const columns = data?.transactionColumns?.length ? data.transactionColumns : IMPORTABLE_COLUMNS
    const extra = columns.filter((column) => !IMPORTABLE_COLUMNS.includes(column))
    return `One transaction per line, tab-separated, in this column order: ${columns.join(' · ')}. Fill either Money In or Expenses.` +
      (extra.length ? ` Leave ${extra.join(', ')} empty.` : '')
  })

  export function show() {
    text = ''
    formError = ''
    resetImportConfirmation()
    root.showModal()
    requestAnimationFrame(() => textarea?.focus())
  }

  function resetImportConfirmation() {
    pastConfirmed = false
    pastWarning = ''
  }

  // Counts pasted lines whose Date column is before the current month, so the
  // user can be warned before importing historical transactions.
  function pastDatedImportLines(value) {
    const columns = data?.transactionColumns
    const dateIndex = Math.max(0, (columns || ['Date']).indexOf('Date'))
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

  async function submit(event) {
    event.preventDefault()
    if (!text.trim()) {
      formError = 'Paste at least one transaction line.'
      return
    }
    const past = pastDatedImportLines(text)
    if (past.count > 0 && !pastConfirmed) {
      pastConfirmed = true
      pastWarning = `${past.count} ${past.count === 1 ? 'line is' : 'lines are'} dated before this month (earliest ${past.earliest}). ` +
        'Click "Import anyway" to confirm these are deliberate.'
      return
    }
    submitting = true
    try {
      const result = await requestJson('/transactions/import', {
        method: 'POST',
        body: JSON.stringify({ text }),
      })
      root.close()
      showToast(`Imported ${result.imported} ${result.imported === 1 ? 'transaction' : 'transactions'}`)
      onrefresh?.()
    } catch (e) {
      if (!e.status) {
        console.error(e)
      }
      formError = e.status ? e.message : 'Could not import transactions. Check the server logs.'
    } finally {
      submitting = false
    }
  }
</script>

<dialog bind:this={root} class="wide-dialog">
  <article>
    <header class="card__header">
      <h2>Import transactions</h2>
      <span class="card__header-tools">
        <button class="outline secondary icon-button" type="button" aria-label="Close" onclick={() => root.close()}>&times;</button>
      </span>
    </header>

    <form id="importForm" onsubmit={submit}>
      <p class="hint">{hint}</p>
      <div class="field">
        <span class="field__label">Transactions</span>
        <textarea
          bind:this={textarea}
          rows="14"
          spellcheck="false"
          autocapitalize="off"
          autocomplete="off"
          placeholder={"2026-09-08\tCASH Dividend\t29.77\t\tCAD\tDividend"}
          bind:value={text}
          oninput={() => {
            if (pastConfirmed) {
              resetImportConfirmation()
            }
          }}
        ></textarea>
      </div>
      {#if pastWarning}<p class="form-warning">{pastWarning}</p>{/if}
      {#if formError}<p class="form-error">{formError}</p>{/if}
    </form>

    <div class="dialog-actions">
      <button class="outline secondary" type="button" onclick={() => root.close()}>Cancel</button>
      <button type="submit" form="importForm" disabled={submitting}>{pastConfirmed ? 'Import anyway' : 'Import'}</button>
    </div>
  </article>
</dialog>
