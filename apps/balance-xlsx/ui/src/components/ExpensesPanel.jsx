import TransactionList from '../TransactionList.jsx'

// The "This month" side panel: import/add actions, the transaction list and
// the empty hint.
export default function ExpensesPanel({
  expenses,
  expensesMeta,
  money,
  today,
  writable,
  onImport,
  onAdd,
  onEdit,
  onDelete,
}) {
  return (
    <details className="card" id="expensesCard" open>
      <summary>
        <span>This month</span>
        <span className="muted">{expensesMeta}</span>
      </summary>
      <div className="expenses__actions">
        <button className="outline secondary" hidden={!writable} onClick={onImport}>Import</button>
        <button hidden={!writable} onClick={onAdd}>Add transaction</button>
      </div>
      <TransactionList
        id="expensesList"
        transactions={expenses}
        money={money}
        today={today}
        writable={writable}
        markFuture
        onedit={onEdit}
        ondelete={onDelete}
      />
      <p className="muted" hidden={expenses.length > 0}>No transactions recorded this month.</p>
    </details>
  )
}
