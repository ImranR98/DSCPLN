import { Breakable } from '@dscpln/ui-kit'
import CumulativeChart from '../CumulativeChart.jsx'

// The cumulative spent/earned chart with its series legend and the 30-day
// forecast rows.
export default function ChartPanel({ section }) {
  return (
    <>
      <h3 className="panel__title">Cumulative spent &amp; earned</h3>
      <CumulativeChart data={section.chartData} />
      <div className="series-legend">
        {section.legend.map((item) => (
          <span className={`series-legend__item${item.baseline ? ' series-legend__item--baseline' : ''}`} key={item.label}>
            <span className={`series-legend__swatch${item.baseline ? ' series-legend__swatch--line' : ''}`} style={{ background: item.color }}></span>
            {item.label}
          </span>
        ))}
      </div>
      <div className="forecast">
        {section.forecast.length === 0 ? (
          <p className="muted">Not enough data to forecast this range.</p>
        ) : (
          section.forecast.map((row) => (
            <div className="forecast__row" key={row.label}>
              <span>{row.label}</span>
              <Breakable as="strong" title={row.title} text={row.value} />
            </div>
          ))
        )}
      </div>
    </>
  )
}
