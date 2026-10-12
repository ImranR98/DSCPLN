import { SquarePen, Trash2 } from 'lucide-react'
import { Breakable, parseIso } from '@dscpln/ui-kit'
import { currencyColor } from './lib/money.js'
import { dateLabel } from './lib/transactions.js'

export default function TransactionList({
  transactions = [],
  money,
  today = null,
  writable = false,
  markFuture = false,
  onedit = null,
  ondelete = null,
  id = null,
}) {
  const rowDate = (transaction) => parseIso(transaction.date)
  const amountText = (transaction) =>
    `${transaction.kind === 'income' ? '+' : ''}${money(
      (transaction.kind === 'income' ? transaction.moneyIn : transaction.expenses) || 0,
      transaction.currency,
    )}`

  return (
    <ul className="expenses__list" id={id} hidden={transactions.length === 0}>
      {transactions.map((transaction, index) => {
        const date = rowDate(transaction)
        const isFuture = Boolean(date && markFuture && today && date > today)
        const color = currencyColor(transaction.currency)
        return (
          <li
            key={transaction.id ?? index}
            className={`expense${transaction.kind === 'income' ? ' expense--income' : ''}${isFuture ? ' expense--future' : ''}`}
            title={isFuture ? 'Dated in the future' : undefined}
            style={color ? { '--currency': color } : undefined}
          >
            <span className="expense__main">
              <span className="expense__desc">
                {transaction.details || '—'}
                {transaction.notes ? <span className="expense__notes">{transaction.notes}</span> : null}
              </span>
              <span className="expense__meta">
                {date && today ? <span className="expense__date">{dateLabel(date, today)}</span> : null}
                {transaction.currency ? <span className="expense__currency">{transaction.currency}</span> : null}
                <span className="expense__category">{transaction.category || ''}</span>
              </span>
            </span>
            {writable ? (
              <span className="expense__actions">
                <button
                  className="outline secondary icon-button icon-button--small"
                  title="Edit"
                  aria-label={`Edit ${transaction.details || 'transaction'}`}
                  onClick={() => onedit?.(transaction)}
                ><SquarePen size={16} strokeWidth={1.8} /></button>
                <button
                  className="outline secondary icon-button icon-button--small icon-button--danger"
                  title="Delete"
                  aria-label={`Delete ${transaction.details || 'transaction'}`}
                  onClick={() => ondelete?.(transaction)}
                ><Trash2 size={16} strokeWidth={1.8} /></button>
              </span>
            ) : null}
            {money ? (
              <Breakable
                className={`expense__amount${transaction.kind === 'income' ? ' expense__amount--in' : ''}`}
                text={amountText(transaction)}
              />
            ) : null}
          </li>
        )
      })}
    </ul>
  )
}
