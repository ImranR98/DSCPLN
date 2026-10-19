import { Pencil, Plus, Trash2 } from 'lucide-react'
import { Breakable, formats, parseIso } from '@dscpln/ui-kit'

const eventDate = (value) => {
  const date = parseIso(value)
  return date ? `${formats.dayMonth.format(date)} ${formats.year.format(date)}` : value
}

export default function ForecastEvents({ scenario, money, horizonEnd, onAdd, onEdit, onRemove }) {
  const code = scenario.currency
  const events = (scenario.events || [])
    .map((event, index) => ({ ...event, _index: index }))
    .sort((a, b) => (a.date === b.date ? 0 : a.date < b.date ? -1 : 1))
  const future = events.filter((event) => event.date >= scenario.asOf)
  const inHorizon = horizonEnd ? future.filter((event) => event.date <= horizonEnd) : future
  const beyond = horizonEnd ? future.filter((event) => event.date > horizonEnd) : []
  const net = inHorizon.reduce((sum, event) => sum + (event.kind === 'income' ? event.amount : -event.amount), 0)

  return (
    <section className="card forecast-events">
      <div className="card__header">
        <h2>One-time events</h2>
        <span className="card__header-tools">
          <span className="card__context">
            {inHorizon.length} in horizon · {net >= 0 ? '+' : ''}{money(net, code)}
            {beyond.length ? ` · ${beyond.length} later` : ''}
          </span>
          <button className="outline secondary" type="button" onClick={onAdd}><Plus size={14} strokeWidth={1.8} /> Add event</button>
        </span>
      </div>
      {events.length === 0 ? (
        <p className="muted">No one-time events yet. Add a known future expense or income and it will appear on its date.</p>
      ) : (
        <div className="forecast-events__list">
          {events.map((event) => {
            const past = event.date < scenario.asOf
            const later = horizonEnd ? event.date > horizonEnd : false
            return (
              <div className={`forecast-event${past ? ' forecast-event--past' : ''}${later ? ' forecast-event--later' : ''}`} key={`${event.date}-${event.details}-${event._index}`}>
                <span className="forecast-event__date">{eventDate(event.date)}</span>
                <span className="forecast-event__main">
                  <span className="forecast-event__details">{event.details}</span>
                  {event.notes ? <span className="forecast-event__notes">{event.notes}</span> : null}
                  {later ? <span className="forecast-event__horizon">beyond chart horizon</span> : null}
                </span>
                <span className={`forecast-event__kind forecast-event__kind--${event.kind}`}>{event.kind === 'income' ? 'in' : 'out'}</span>
                <Breakable className={`forecast-event__amount ${event.kind === 'income' ? 'is-in' : 'is-out'}`} text={`${event.kind === 'income' ? '+' : '−'}${money(event.amount, code)}`} />
                <span className="forecast-event__actions">
                  <button className="outline secondary icon-button icon-button--small" type="button" title="Edit event" aria-label={`Edit ${event.details}`} onClick={() => onEdit(event._index)}>
                    <Pencil size={14} strokeWidth={1.8} />
                  </button>
                  <button className="outline secondary icon-button icon-button--small icon-button--danger" type="button" title="Delete event" aria-label={`Delete ${event.details}`} onClick={() => onRemove(event._index)}>
                    <Trash2 size={14} strokeWidth={1.8} />
                  </button>
                </span>
              </div>
            )
          })}
        </div>
      )}
      {beyond.length ? (
        <p className="hint">Events beyond the chart horizon still feed the long-run target and runway calculations.</p>
      ) : null}
    </section>
  )
}
