export default function ForecastTable({ rows, horizonMonths, balanceUnknown = false }) {
  return (
    <details className="card forecast-projection">
      <summary>
        <span>Monthly projection</span>
        <span className="muted">{horizonMonths} months</span>
      </summary>
      {balanceUnknown ? (
        <p className="hint">Starting balance is unknown; opening and closing figures assume $0.</p>
      ) : null}
      <div className="table-wrap">
        <table className="forecast-table" data-testid="forecast-projection-table">
          <thead>
            <tr>
              <th>Month</th>
              <th>Opening</th>
              <th>Income</th>
              <th>Expenses</th>
              <th>One-time</th>
              <th>Closing</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} className={row.targetReached ? 'forecast-table__target-row' : undefined}>
                <td>{row.label}{row.partial ? <span className="forecast-table__partial">partial</span> : null}</td>
                <td>{row.openingText}</td>
                <td className="is-in">{row.incomeText}</td>
                <td className="is-out">{row.expensesText}</td>
                <td className={row.oneTimeClass}>{row.oneTimeText}</td>
                <td className={row.closingNegative ? 'is-out' : ''}>{row.closingText}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  )
}
