import { Pencil, Plus, Trash2 } from 'lucide-react'
import { Breakable, formats } from '@dscpln/ui-kit'

const monthLabel = (value) => {
  if (!/^\d{4}-\d{2}$/.test(String(value || ''))) return value
  const [year, month] = value.split('-').map(Number)
  return formats.monthYear.format(new Date(year, month - 1, 1))
}

export default function ForecastChanges({ changes, money, currency, horizonEnd, onAdd, onEdit, onRemove }) {
  const sorted = [...(changes || [])].map((change, index) => ({ ...change, _index: index }))
    .sort((a, b) => (a.from === b.from ? 0 : a.from < b.from ? -1 : 1))
  const horizonMonth = horizonEnd ? horizonEnd.slice(0, 7) : null
  const laterCount = horizonMonth ? sorted.filter((change) => change.from > horizonMonth).length : 0

  return (
    <section className="card forecast-changes">
      <div className="card__header">
        <h2>Scheduled changes</h2>
        <span className="card__header-tools">
          <span className="card__context">{sorted.length} change{sorted.length === 1 ? '' : 's'}{laterCount ? ` · ${laterCount} later` : ''}</span>
          <button className="outline secondary" type="button" onClick={onAdd}><Plus size={14} strokeWidth={1.8} /> Add change</button>
        </span>
      </div>
      {sorted.length === 0 ? (
        <p className="muted">Add a known future change, such as a rent increase or a new salary, and it will replace the category total from that month onward.</p>
      ) : (
        <div className="forecast-changes__list">
          {sorted.map((change) => {
            const later = Boolean(horizonMonth && change.from > horizonMonth)
            return (
              <div className={`forecast-change${later ? ' forecast-change--later' : ''}`} key={`${change.from}-${change.kind}-${change.category}-${change._index}`}>
                <span className="forecast-change__from">{monthLabel(change.from)}</span>
                <span className="forecast-change__category">
                  {change.category}
                  <span className={`forecast-baseline__kind forecast-baseline__kind--${change.kind}`}>{change.kind === 'income' ? 'in' : 'out'}</span>
                  {later ? <span className="forecast-change__horizon">beyond chart horizon</span> : null}
                </span>
                <Breakable className={`forecast-change__amount ${change.kind === 'income' ? 'is-in' : 'is-out'}`} text={`${money(change.amount, currency)} / month`} />
                <span className="forecast-change__actions">
                  <button className="outline secondary icon-button icon-button--small" type="button" title="Edit change" aria-label={`Edit ${change.category} change`} onClick={() => onEdit(change._index)}>
                    <Pencil size={14} strokeWidth={1.8} />
                  </button>
                  <button className="outline secondary icon-button icon-button--small icon-button--danger" type="button" title="Delete change" aria-label={`Delete ${change.category} change`} onClick={() => onRemove(change._index)}>
                    <Trash2 size={14} strokeWidth={1.8} />
                  </button>
                </span>
              </div>
            )
          })}
        </div>
      )}
      {laterCount ? <p className="hint">Changes beyond the chart horizon still feed the long-run target and runway calculations.</p> : null}
    </section>
  )
}
