export default function HistoryCard({ hidden, rangeText, hostRef, tooltipRef }) {
  return (
    <section className="card" id="historyCard" aria-labelledby="historyHeading" hidden={hidden}>
      <div className="card__header">
        <h2 id="historyHeading">Last 12 months</h2>
        <span className="card__header-tools">
          <span className="card__context">{rangeText}</span>
          <span className="chart-legend">
            <span className="chart-legend__item">
              <span className="chart-legend__swatch"></span>Out
            </span>
            <span className="chart-legend__item">
              <span className="chart-legend__swatch chart-legend__swatch--in"></span>In
            </span>
          </span>
        </span>
      </div>
      <div ref={hostRef} className="chart-host"></div>
      <div ref={tooltipRef} className="chart-tooltip" hidden></div>
    </section>
  )
}
