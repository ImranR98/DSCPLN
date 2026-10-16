import { Breakable } from '@dscpln/ui-kit'

// One "Spending/Earned by category" panel: the All/None controls and the
// checkbox rows that exclude categories. The share/amount/delta/bar columns
// are optional, so the same panel doubles as a plain category picker.
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
              {row.share ? <span className="category-row__share">{row.share}</span> : null}
            </span>
            {row.amountText || row.delta ? (
              <span className="category-row__amount-wrap">
                {row.amountText ? (
                  <Breakable className="category-row__amount" text={row.amountText} />
                ) : null}
                {row.delta ? (
                  <span className={`category-row__delta ${row.delta.className}`} title={row.delta.title}>{row.delta.text}</span>
                ) : null}
              </span>
            ) : null}
            {row.barPercent != null ? (
              <span className="category-row__bar">
                <span className="category-row__bar-fill" style={{ width: `${row.barPercent}%`, background: row.color }}></span>
              </span>
            ) : null}
          </label>
        ))}
      </div>
    </>
  )
}
