<script>
  import { SquarePen, Trash2 } from 'lucide-svelte'
  import { breakable, parseIso } from '@dscpln/ui-kit'
  import { currencyColor } from './lib/money.js'
  import { dateLabel } from './lib/transactions.js'

  let {
    transactions = [],
    money,
    today = null,
    writable = false,
    markFuture = false,
    onedit = null,
    ondelete = null,
    id = null,
  } = $props()

  const rowDate = (transaction) => parseIso(transaction.date)
  const amountText = (transaction) =>
    `${transaction.kind === 'income' ? '+' : ''}${money(
      (transaction.kind === 'income' ? transaction.moneyIn : transaction.expenses) || 0,
      transaction.currency,
    )}`
</script>

<ul class="expenses__list" {id} hidden={transactions.length === 0}>
  {#each transactions as transaction, index (transaction.id ?? index)}
    {@const date = rowDate(transaction)}
    {@const isFuture = Boolean(date && markFuture && today && date > today)}
    <li
      class="expense{transaction.kind === 'income' ? ' expense--income' : ''}{isFuture ? ' expense--future' : ''}"
      title={isFuture ? 'Dated in the future' : undefined}
      style={currencyColor(transaction.currency) ? `--currency: ${currencyColor(transaction.currency)}` : undefined}
    >
      <span class="expense__main">
        <span class="expense__desc">
          {transaction.details || '—'}
          {#if transaction.notes}<span class="expense__notes">{transaction.notes}</span>{/if}
        </span>
        <span class="expense__meta">
          {#if date && today}<span class="expense__date">{dateLabel(date, today)}</span>{/if}
          {#if transaction.currency}<span class="expense__currency">{transaction.currency}</span>{/if}
          <span class="expense__category">{transaction.category || ''}</span>
        </span>
      </span>
      {#if writable}
        <span class="expense__actions">
          <button
            class="outline secondary icon-button icon-button--small"
            title="Edit"
            aria-label={`Edit ${transaction.details || 'transaction'}`}
            onclick={() => onedit?.(transaction)}
          ><SquarePen size={16} strokeWidth={1.8} /></button>
          <button
            class="outline secondary icon-button icon-button--small icon-button--danger"
            title="Delete"
            aria-label={`Delete ${transaction.details || 'transaction'}`}
            onclick={() => ondelete?.(transaction)}
          ><Trash2 size={16} strokeWidth={1.8} /></button>
        </span>
      {/if}
      {#if money}
        <span class="expense__amount{transaction.kind === 'income' ? ' expense__amount--in' : ''}" use:breakable={amountText(transaction)}></span>
      {/if}
    </li>
  {/each}
</ul>
