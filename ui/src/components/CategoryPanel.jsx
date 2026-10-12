import { Breakable } from '@dscpln/ui-kit'

// One "Spending/Earned by category" panel: the All/None controls and the
// checkbox rows that exclude categories from the KPIs.
export default function CategoryPanel({ title, list, onSetExcluded }) {
  if (!list) return null
  return (
    <>
      <div className="panel__head">
        <h3 className="panel__title">{title}</h3>
        <div className="panel__controls">
          <button className="link-button" type="button" onClick={() => onSetExcluded(list.categories, true)}>All</button>
          <button className="link-button" type="button" onClick={() => onSetExcluded(list.categories, false)}>None</button>
        </div>
      </div>
      <div className="category-list">
        {list.rows.map((row) => (
          <label className={`category-row${row.checked ? '' : ' category-row--excluded'}`} key={row.category}>
            <input
              type="checkbox"
              checked={row.checked}
              onChange={(event) => onSetExcluded([row.category], event.target.checked)}
            />
            <span className="category-dot" style={{ background: row.color }}></span>
            <span className="category-row__name">
              <span className="category-row__label">{row.category}</span>
              <span className="category-row__share">{row.share}</span>
            </span>
            <span className="category-row__amount-wrap">
              <Breakable className="category-row__amount" text={row.amountText} />
              {row.delta ? (
                <span className={`category-row__delta ${row.delta.className}`} title={row.delta.title}>{row.delta.text}</span>
              ) : null}
            </span>
            <span className="category-row__bar">
              <span className="category-row__bar-fill" style={{ width: `${row.barPercent}%`, background: row.color }}></span>
            </span>
          </label>
        ))}
      </div>
    </>
  )
}
