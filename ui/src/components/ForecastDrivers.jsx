const average = (months, field) => (
  months.reduce((sum, month) => sum + Number(month[field] || 0), 0) / Math.max(1, months.length)
)

const signedMoney = (money, value, code) => `${value > 0 ? '+' : ''}${money(value, code)}`

export default function ForecastDrivers({ forecast, money, code }) {
  const months = forecast.months
  const recurringIncome = average(months, 'recurringIncome')
  const recurringExpenses = average(months, 'recurringExpenses')
  const otherIncome = average(months, 'variableIncome') + average(months, 'fixedIncome')
  const otherExpenses = average(months, 'variableExpenses') + average(months, 'fixedExpenses')
  const oneTime = months.reduce((sum, month) => sum + Number(month.oneTime || 0), 0)
  const included = forecast.baseline.rows.filter((row) => row.include && row.effective > 0)
  const largest = (kind) => included
    .filter((row) => row.kind === kind)
    .sort((a, b) => b.effective - a.effective)
    .slice(0, 4)
  const expenses = largest('expense')
  const income = largest('income')

  return (
    <details className="card forecast-drivers">
      <summary>
        <span>Forecast drivers</span>
        <span className="muted">{signedMoney(money, forecast.monthlyNet, code)} net / month</span>
      </summary>
      <p className="hint">Average monthly composition over the {months.length} projection months. One-time events are shown separately.</p>
      <div className="forecast-drivers__grid">
        <section>
          <h3>Income</h3>
          <dl>
            <div><dt>Recurring</dt><dd>{money(recurringIncome, code)}</dd></div>
            <div><dt>Variable + changes</dt><dd>{money(otherIncome, code)}</dd></div>
          </dl>
        </section>
        <section>
          <h3>Expenses</h3>
          <dl>
            <div><dt>Recurring</dt><dd>{money(recurringExpenses, code)}</dd></div>
            <div><dt>Variable + changes</dt><dd>{money(otherExpenses, code)}</dd></div>
          </dl>
        </section>
        <section>
          <h3>One-time events</h3>
          <p className="forecast-drivers__one-time">{signedMoney(money, oneTime, code)} over the horizon</p>
        </section>
      </div>
      <div className="forecast-drivers__categories">
        <p><strong>Largest income</strong>{income.length ? income.map((row) => `${row.category} ${money(row.effective, code)}`).join(' · ') : 'None'}</p>
        <p><strong>Largest expenses</strong>{expenses.length ? expenses.map((row) => `${row.category} ${money(row.effective, code)}`).join(' · ') : 'None'}</p>
      </div>
    </details>
  )
}
