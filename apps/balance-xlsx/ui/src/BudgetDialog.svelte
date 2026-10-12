<script>
  import { showToast } from '@dscpln/ui-kit'
  import { number } from './lib/money.js'
  import { requestJson } from './lib/request.js'

  let { data, onrefresh } = $props()

  let root = $state(null)
  let currency = $state(null)
  let monthlyBudget = $state('')
  let firstDayBias = $state('')
  let saving = $state(false)

  const validityError = $derived.by(() => {
    const budget = Number.parseFloat(monthlyBudget)
    const bias = Number.parseFloat(firstDayBias)
    if (!Number.isFinite(budget) || budget < 0) return 'Monthly budget must be 0 or greater.'
    if (!Number.isFinite(bias) || bias < 0) return 'First day bias must be 0 or greater.'
    if (bias > budget) return 'First day bias cannot be greater than the monthly budget.'
    return ''
  })

  export function show(currencyCode) {
    const entry = (data?.currencies || []).find((item) => item.code === currencyCode)
    currency = currencyCode
    monthlyBudget = String(entry ? number(entry.monthlyBudget) : 0)
    firstDayBias = String(entry ? number(entry.firstDayBias) : 0)
    root.showModal()
  }

  async function submit(event) {
    event.preventDefault()
    if (validityError) return
    saving = true
    try {
      await requestJson('/budget', {
        method: 'POST',
        body: JSON.stringify({
          monthlyBudget: Number.parseFloat(monthlyBudget),
          firstDayBias: Number.parseFloat(firstDayBias),
          currency,
        }),
      })
      root.close()
      showToast('Budget updated')
      onrefresh?.()
    } catch (e) {
      console.error(e)
      showToast('Could not save the budget', 'error')
    } finally {
      saving = false
    }
  }
</script>

<dialog bind:this={root} class="narrow-dialog">
  <article>
    <header class="card__header">
      <h2>Edit budget</h2>
      <span class="card__header-tools">
        <button class="outline secondary icon-button" type="button" aria-label="Close" onclick={() => root.close()}>&times;</button>
      </span>
    </header>

    <form id="budgetForm" novalidate onsubmit={submit}>
      <p class="hint">Editing the {currency} budget.</p>
      <div class="field">
        <span class="field__label">Monthly budget</span>
        <input type="number" step="0.01" min="0" inputmode="decimal" autocomplete="off" required bind:value={monthlyBudget} />
      </div>
      <div class="field">
        <span class="field__label">First day bias</span>
        <input type="number" step="0.01" min="0" inputmode="decimal" autocomplete="off" required bind:value={firstDayBias} />
      </div>
      <p class="hint">Extra amount assigned to the first day of the month.</p>
      {#if validityError}<p class="form-error">{validityError}</p>{/if}
    </form>

    <div class="dialog-actions">
      <button class="outline secondary" type="button" onclick={() => root.close()}>Cancel</button>
      <button type="submit" form="budgetForm" disabled={Boolean(validityError) || saving}>Save</button>
    </div>
  </article>
</dialog>
