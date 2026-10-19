import { useEffect, useState } from 'react'
import { RotateCcw, SlidersHorizontal } from 'lucide-react'
import { Breakable, formats, parseIso } from '@dscpln/ui-kit'
import { recurringKey } from '../lib/forecast-recurring.js'

const CADENCES = [
  ['', 'Auto'],
  ['weekly', 'Weekly'],
  ['biweekly', 'Every 2 weeks'],
  ['semimonthly', 'Twice a month'],
  ['monthly', 'Monthly'],
  ['quarterly', 'Quarterly'],
  ['annual', 'Annual'],
]

const dateLabel = (value) => {
  const date = value ? parseIso(value) : null
  return date ? formats.dayMonth.format(date) + ' ' + formats.year.format(date) : value
}

export default function ForecastRecurring({
  recurring,
  scenario,
  money,
  onAdjust,
  onRemoveAdjustment,
}) {
  const adjustments = scenario.recurringAdjustments || []
  const [openKeys, setOpenKeys] = useState(() => new Set(adjustments.map((adjustment) => recurringKey(adjustment))))
  useEffect(() => {
    setOpenKeys(new Set((scenario.recurringAdjustments || []).map((adjustment) => recurringKey(adjustment))))
    // Open only the adjusted items when switching scenarios; leave manual toggles alone.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenario.key])
  const adjustmentFor = (item) => adjustments.find((adjustment) =>
    adjustment.kind === item.kind &&
    adjustment.category === item.category &&
    recurringKey(adjustment) === item.key)
  const toggleOpen = (key) => {
    setOpenKeys((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  return (
    <section className="card forecast-recurring">
      <div className="card__header">
        <h2>Recurring items</h2>
        <span className="card__context">
          {recurring.detectionEnabled === false
            ? 'detection off'
            : `${recurring.items.length} detected`}
        </span>
      </div>
      {!recurring.detectionEnabled ? (
        <p className="muted">Recurring detection is off. All transactions are included in the category baseline.</p>
      ) : recurring.items.length === 0 ? (
        <p className="muted">No recurring items were detected. Add a category override or a one-time event if you know one is coming.</p>
      ) : (
        <>
          <p className="hint">
            These are scheduled from your transaction history. Uncheck an item to leave it out of the forecast entirely;
            adjust its amount, cadence or next date if the detector got it wrong.
          </p>
          <div className="forecast-recurring__list">
            {recurring.items.map((item) => {
              const adjustment = adjustmentFor(item)
              const included = adjustment ? adjustment.include !== false : item.include !== false
              const detectedAmount = Number.parseFloat(Number(item.detectedAmount ?? item.amount).toPrecision(12))
              const amountValue = adjustment?.amount ?? ''
              const cadenceValue = adjustment?.cadence || ''
              const nextDateValue = adjustment?.nextDate ?? ''
              const isOpen = openKeys.has(item.key)
              const controlsId = `recurring-controls-${item.key.replace(/[^a-zA-Z0-9_-]/g, '-')}`
              const replaced = item.suppressedByOverride
                ? 'Replaced by a category override'
                : item.suppressedByChange
                  ? `Replaced by a scheduled change from ${item.activeChange.from}`
                  : item.nextChange
                    ? `Replaced from ${item.nextChange.from}`
                    : ''
              return (
                <div className={`forecast-recurring__item${included ? '' : ' forecast-recurring__item--excluded'}`} key={item.key} data-recurring-key={item.key}>
                  <div className="forecast-recurring__head">
                    <label className="forecast-recurring__include" title={included ? 'Leave this item out of the forecast' : 'Include this item in the forecast'}>
                      <input
                        type="checkbox"
                        checked={included}
                        onChange={(event) => onAdjust(item, { include: event.target.checked })}
                        aria-label={`Include recurring ${item.label} in the forecast`}
                      />
                    </label>
                    <span className="forecast-recurring__label">
                      <span>{item.label}</span>
                      <span className="forecast-recurring__meta">{item.category} · {item.kind === 'income' ? 'in' : 'out'} · {item.cadenceLabel}</span>
                    </span>
                    <span className={`forecast-recurring__confidence ${item.confidenceClass}`} title={`Interval match, amount stability and recency; ${Math.round((item.confidence || 0) * 100)}% confidence`}>
                      {Math.round((item.confidence || 0) * 100)}%
                    </span>
                    <Breakable className="forecast-recurring__amount" text={item.amountText} />
                    <span className="forecast-recurring__head-actions">
                      <button
                        className="link-button forecast-recurring__adjust"
                        type="button"
                        aria-expanded={isOpen}
                        aria-controls={controlsId}
                        onClick={() => toggleOpen(item.key)}
                      >
                        <SlidersHorizontal size={14} strokeWidth={1.8} /> {isOpen ? 'Hide' : 'Adjust'}
                      </button>
                      {adjustment ? (
                        <button
                          className="outline secondary icon-button icon-button--small"
                          type="button"
                          title="Reset recurring item to auto"
                          aria-label={`Reset ${item.label}`}
                          onClick={() => onRemoveAdjustment(item)}
                        ><RotateCcw size={14} strokeWidth={1.8} /></button>
                      ) : null}
                    </span>
                  </div>
                  {isOpen ? (
                    <div className="forecast-recurring__controls" id={controlsId}>
                      <label className="field">
                        <span className="field__label">
                          Amount
                          {adjustment?.amount == null ? <span className="forecast-auto-badge">Auto</span> : null}
                        </span>
                        <input
                          type="number"
                          min="0"
                          step="any"
                          inputMode="decimal"
                          value={amountValue}
                          placeholder="Auto"
                          title={adjustment?.amount == null ? `Auto — ${money(detectedAmount, scenario.currency)}` : undefined}
                          onChange={(event) => onAdjust(item, { amount: event.target.value })}
                          data-recurring-amount={item.key}
                        />
                      </label>
                      <label className="field">
                        <span className="field__label">
                          Cadence
                          {!adjustment?.cadence ? <span className="forecast-auto-badge">Auto</span> : null}
                        </span>
                        <select value={cadenceValue} onChange={(event) => onAdjust(item, { cadence: event.target.value || null })} data-recurring-cadence={item.key}>
                          {CADENCES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                        </select>
                      </label>
                      <label className="field">
                        <span className="field__label">
                          Next date
                          {!adjustment?.nextDate ? <span className="forecast-auto-badge">Auto</span> : null}
                        </span>
                        <input
                          type="date"
                          value={nextDateValue}
                          onChange={(event) => onAdjust(item, { nextDate: event.target.value || null })}
                          data-recurring-next={item.key}
                          title={!adjustment?.nextDate && item.nextDate ? `Auto — ${dateLabel(item.nextDate)}` : undefined}
                        />
                        {!adjustment?.nextDate && item.nextDate ? <span className="field__hint">Auto — {dateLabel(item.nextDate)}</span> : null}
                      </label>
                      <span className="forecast-recurring__monthly">
                        <span className="muted">Monthly equivalent</span>
                        <strong>{item.monthlyEquivalentText}</strong>
                      </span>
                    </div>
                  ) : null}
                  {replaced ? <p className="forecast-recurring__replaced">{replaced}; edit the category baseline or scheduled change to change it.</p> : null}
                </div>
              )
            })}
          </div>
        </>
      )}
      {recurring.staleAdjustments.length > 0 ? (
        <div className="forecast-recurring__stale">
          <p className="form-warning">
            These saved adjustments no longer match a detected recurring item:
          </p>
          {recurring.staleAdjustments.map((adjustment, index) => (
            <div className="forecast-recurring__stale-row" key={`${adjustment.kind}-${adjustment.category}-${adjustment.details}-${index}`}>
              <span>{adjustment.kind} · {adjustment.category} · {adjustment.details || adjustment.label || 'unknown'}</span>
              <button className="link-button" type="button" onClick={() => onRemoveAdjustment(adjustment)}>Remove</button>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  )
}
