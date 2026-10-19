import { useMemo, useState } from 'react'
import { Breakable } from '@dscpln/ui-kit'

export default function ForecastBaseline({ model, money, scenario, onOverride, onToggleCategory, onResetOverrides }) {
  const { baselineGroups, baselineMonthly, forecast } = model
  const baseline = forecast.baseline
  const code = baseline.currency
  const [filter, setFilter] = useState('')
  const [overridesOnly, setOverridesOnly] = useState(false)
  const [openGroups, setOpenGroups] = useState({})
  const excluded = new Set(scenario?.excludedCategories || [])
  const hasOverrides = Object.keys(scenario?.overrides?.income || {}).length > 0 ||
    Object.keys(scenario?.overrides?.expense || {}).length > 0
  const filtering = Boolean(filter.trim() || overridesOnly)
  const query = filter.trim().toLowerCase()

  const groups = useMemo(() => baselineGroups.map((group) => {
    const allRows = group.rows
    const incomeTotal = allRows.filter((row) => row.include && row.kind === 'income').reduce((sum, row) => sum + row.effective, 0)
    const expenseTotal = allRows.filter((row) => row.include && row.kind === 'expense').reduce((sum, row) => sum + row.effective, 0)
    const total = group.group === 'Conversions' ? incomeTotal - expenseTotal : incomeTotal + expenseTotal
    const rows = allRows.filter((row) => {
      if (overridesOnly && row.override == null) return false
      if (!query) return true
      return row.category.toLowerCase().includes(query) || row.method.toLowerCase().includes(query)
    })
    return { ...group, rows, total, overrides: allRows.filter((row) => row.override != null).length }
  }).filter((group) => group.rows.length > 0), [baselineGroups, overridesOnly, query])

  const toggleGroup = (group, event) => {
    setOpenGroups((current) => ({ ...current, [group]: event.currentTarget.open }))
  }

  return (
    <section className="card forecast-baseline">
      <div className="card__header">
        <h2>Category baseline</h2>
        <span className="card__header-tools">
          <span className="card__context">
            {baseline.monthCount > 0
              ? `${baseline.monthCount} complete month${baseline.monthCount === 1 ? '' : 's'}`
              : 'No complete months'}
          </span>
          {hasOverrides ? <button className="link-button" type="button" onClick={onResetOverrides}>Reset overrides</button> : null}
        </span>
      </div>
      <p className="hint">
        Auto = variable estimate + recurring monthly equivalent; the badge shows how the variable part was estimated.
        An override replaces the category total, including recurring items. Uncheck a category to leave it out.
      </p>

      <div className="forecast-baseline__tools">
        <label className="field forecast-baseline__search">
          <span className="visually-hidden">Filter categories</span>
          <input
            type="search"
            value={filter}
            placeholder="Filter categories"
            onChange={(event) => setFilter(event.target.value)}
          />
        </label>
        <label className="checkbox-inline">
          <input
            type="checkbox"
            checked={overridesOnly}
            onChange={(event) => setOverridesOnly(event.target.checked)}
          />
          <span>Overrides only</span>
        </label>
      </div>

      {baselineMonthly.length > 0 ? (
        <details className="forecast-baseline__months">
          <summary>Months used</summary>
          <div className="table-wrap">
            <table className="forecast-table">
              <thead>
                <tr><th>Month</th><th>In</th><th>Out</th><th>Net</th></tr>
              </thead>
              <tbody>
                {baselineMonthly.map((month) => (
                  <tr key={month.key}>
                    <td>{month.label}</td>
                    <td>{month.incomeText}</td>
                    <td>{month.expensesText}</td>
                    <td className={month.netClass}>{month.netText}</td>
                  </tr>
                ))}
                <tr className="forecast-table__total">
                  <td>Effective</td>
                  <td>{money(baseline.income, code)}</td>
                  <td>{money(baseline.expenses, code)}</td>
                  <td className={baseline.net > 0 ? 'is-in' : baseline.net < 0 ? 'is-out' : ''}>{money(baseline.net, code)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </details>
      ) : (
        <p className="muted">No complete months are available for this currency and window.</p>
      )}

      <div className="forecast-baseline__groups">
        {groups.map((group) => (
          <details
            className="forecast-baseline__group"
            key={group.group}
            open={filtering ? true : Boolean(openGroups[group.group])}
            onToggle={(event) => toggleGroup(group.group, event)}
          >
            <summary>
              <span>{group.group}{group.overrides ? <span className="forecast-baseline__count">{group.overrides} override{group.overrides === 1 ? '' : 's'}</span> : null}</span>
              <span className="muted">{money(group.total, code)} {group.group === 'Conversions' ? 'net' : ''} / month</span>
            </summary>
            <div className="forecast-baseline__rows">
              {group.rows.map((row) => {
                const included = !excluded.has(row.category)
                const overrideValue = scenario?.overrides?.[row.kind]?.[row.category]
                return (
                  <div className={`forecast-baseline__row${included ? '' : ' forecast-baseline__row--excluded'}`} key={`${row.kind}-${row.category}`}>
                  <label className="forecast-baseline__include">
                    <input
                      type="checkbox"
                      checked={included}
                      onChange={(event) => onToggleCategory(row.category, event.target.checked)}
                      aria-label={`Include ${row.category}`}
                    />
                  </label>
                  <span className="forecast-baseline__name">
                    <span className="forecast-baseline__title">
                      <span>{row.category}</span>
                      <span className={`forecast-baseline__kind forecast-baseline__kind--${row.kind}`}>{row.kind === 'income' ? 'in' : 'out'}</span>
                    </span>
                    <span className="forecast-baseline__method" title={[
                      `${row.method} · ${row.activeMonths}/${row.monthCount} active months`,
                      row.recurringText ? `Recurring monthly equivalent ${row.recurringText}` : '',
                      row.outlierText ? `Large months: ${row.outlierText}` : '',
                    ].filter(Boolean).join(' · ')}>
                      <span className="forecast-baseline__method-label">{row.method}</span>
                      <span className={`forecast-baseline__confidence ${row.confidenceClass}`}>{row.confidence}</span>
                      {row.outlierText ? <span className="forecast-baseline__outlier" title={`Large months: ${row.outlierText}`}>outlier</span> : null}
                    </span>
                  </span>
                  <label className="forecast-baseline__override">
                    <span className="visually-hidden">{row.category} monthly override</span>
                    <input
                      type="number"
                      min="0"
                      step="any"
                      inputMode="decimal"
                      placeholder={row.autoText}
                      value={overrideValue ?? ''}
                      onChange={(event) => onOverride(row.kind, row.category, event.target.value)}
                      data-category={row.category}
                      data-kind={row.kind}
                    />
                  </label>
                  <span className="forecast-baseline__effective-wrap">
                    <Breakable className="forecast-baseline__effective" text={row.effectiveText} />
                    {overrideValue != null ? (
                      <button
                        className="link-button forecast-baseline__clear"
                        type="button"
                        title={`Clear override and use auto ${row.autoText}`}
                        onClick={() => onOverride(row.kind, row.category, '')}
                      >Auto</button>
                    ) : null}
                  </span>
                  </div>
                )
              })}
            </div>
          </details>
        ))}
      </div>
      {groups.length === 0 ? <p className="muted">{query ? 'No categories match this filter.' : overridesOnly ? 'No category overrides yet.' : 'No categories are configured in the Constants sheet.'}</p> : null}
    </section>
  )
}
