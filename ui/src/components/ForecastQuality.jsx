export default function ForecastQuality({ quality }) {
  if (!quality) {
    return (
      <section className="card forecast-quality">
        <div className="card__header"><h2>Model quality</h2></div>
        <p className="muted">Not enough complete months to backtest the variable baseline.</p>
      </section>
    )
  }
  return (
    <details className="card forecast-quality">
      <summary>
        <span>Model quality</span>
        <span className="muted">{quality.months}-month backtest</span>
      </summary>
      <p className="hint">
        Rolling backtest of the variable layer (recurring items excluded). Auto uses Robust only when it beats Simple by a meaningful margin.
      </p>
      <div className="forecast-quality__grid">
        <div className={`forecast-quality__option${quality.chosen === 'simple' ? ' forecast-quality__option--chosen' : ''}`}>
          <span className="forecast-quality__label">Simple average</span>
          <strong>MAE {quality.simpleMaeText}</strong>
          <span className="muted">bias {quality.simpleBiasText}</span>
        </div>
        <div className={`forecast-quality__option${quality.chosen === 'robust' ? ' forecast-quality__option--chosen' : ''}`}>
          <span className="forecast-quality__label">Robust model</span>
          <strong>MAE {quality.robustMaeText}</strong>
          <span className="muted">bias {quality.robustBiasText}</span>
        </div>
      </div>
      <div className="table-wrap">
        <table className="forecast-table">
          <thead>
            <tr><th>Month</th><th>Actual in</th><th>Actual out</th><th>Model in</th><th>Model out</th></tr>
          </thead>
          <tbody>
            {quality.rows.map((row) => (
              <tr key={row.key}>
                <td>{row.label}</td>
                <td>{row.actualIncomeText}</td>
                <td>{row.actualExpensesText}</td>
                <td>{row.chosenIncomeText}</td>
                <td>{row.chosenExpensesText}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  )
}
