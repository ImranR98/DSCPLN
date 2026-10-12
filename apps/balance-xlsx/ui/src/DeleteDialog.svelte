<script>
  import { showToast } from '@dscpln/ui-kit'
  import { requestJson } from './lib/request.js'

  let { money, onrefresh } = $props()

  let root = $state(null)
  let pending = $state(null)
  let description = $state('')
  let formError = $state('')
  let deleting = $state(false)

  export function show(transaction) {
    pending = transaction
    const amount = transaction.kind === 'income' ? transaction.moneyIn : transaction.expenses
    description = `${money(amount || 0, transaction.currency)} · ${transaction.details || 'No details'}`
    formError = ''
    root.showModal()
  }

  async function confirm() {
    if (!pending) return
    deleting = true
    try {
      await requestJson(`/transactions/${encodeURIComponent(pending.id)}`, { method: 'DELETE' })
      root.close()
      pending = null
      showToast('Transaction deleted')
      onrefresh?.()
    } catch (e) {
      if (e.status === 409) {
        root.close()
        pending = null
        showToast(e.message, 'error')
        onrefresh?.()
      } else {
        if (!e.status) {
          console.error(e)
        }
        formError = e.status ? e.message : 'Could not delete the transaction. Check the server logs.'
      }
    } finally {
      deleting = false
    }
  }
</script>

<dialog bind:this={root} class="narrow-dialog" onclose={() => (pending = null)}>
  <article>
    <header class="card__header">
      <h2>Delete transaction</h2>
      <span class="card__header-tools">
        <button class="outline secondary icon-button" type="button" aria-label="Close" onclick={() => root.close()}>&times;</button>
      </span>
    </header>

    <p class="muted">{description}</p>
    {#if formError}<p class="form-error">{formError}</p>{/if}

    <div class="dialog-actions">
      <button class="outline secondary" type="button" onclick={() => root.close()}>Cancel</button>
      <button class="danger" type="button" disabled={deleting} onclick={confirm}>Delete</button>
    </div>
  </article>
</dialog>
