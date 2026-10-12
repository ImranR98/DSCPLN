import { Breakable } from '@dscpln/ui-kit'

// "Spending changes"/"Earning changes": the biggest category moves vs the
// comparison period.
export default function MoversBlock({ block }) {
  return (
    <div className="movers__block">
      <h3 className="panel__title">{block.title}</h3>
      <div className="movers__grid">
        {[{ key: 'increases', heading: 'Increases', entries: block.increases, empty: 'None.' }, { key: 'decreases', heading: 'Decreases', entries: block.decreases, empty: 'None.' }].map((column) => (
          <div className="movers__column" key={column.key}>
            <h4 className="movers__heading">{column.heading}</h4>
            {column.entries.length === 0 ? (
              <p className="muted">{column.empty}</p>
            ) : (
              <ul className="movers__list">
                {column.entries.map((entry) => (
                  <li className="movers__item" key={entry.category}>
                    <span className="category-dot" style={{ background: entry.color }}></span>
                    <span className="movers__name">{entry.category}</span>
                    <Breakable className={`movers__amount ${entry.amountClass}`} text={entry.amountText} />
                    <span className="movers__pct muted">{entry.pctText}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
