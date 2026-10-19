import { Trash2 } from 'lucide-react'

const BASELINE_LABELS = {
  auto: 'Auto',
  simple: 'Simple',
  robust: 'Robust',
}

export default function ForecastAssumptions({
  scenario,
  currencies,
  money,
  onChange,
  onAccountChange,
  onAddAccount,
  onRemoveAccount,
  onTargetChange,
}) {
  const currency = currencies.find((entry) => entry.code === scenario.currency)
  const targetAmountError = scenario.target?.amount != null && scenario.target?.amount !== '' && Number(scenario.target.amount) < 0
  const targetDateError = Boolean(scenario.target?.date) && !(Number(scenario.target?.amount) > 0)
  const accountNameError = (scenario.accounts || []).some((account) => !account.name.trim())
  const modelSummary = [
    BASELINE_LABELS[scenario.baselineMethod] || 'Auto',
    scenario.recurringDetection !== false ? 'recurring detection on' : 'recurring detection off',
    scenario.uncertainty !== false ? 'uncertainty on' : 'uncertainty off',
  ].join(' · ')

  return (
    <section className="card forecast-settings">
      <div className="card__header">
        <h2>Assumptions</h2>
        <span className="card__context">{currency ? currency.code : scenario.currency}</span>
      </div>

      <div className="filters">
        <label className="field">
          <span className="field__label">Currency</span>
          <select data-testid="forecast-currency" value={scenario.currency} onChange={(event) => onChange({ currency: event.target.value })}>
            {currencies.map((entry) => <option key={entry.code} value={entry.code}>{entry.code}</option>)}
          </select>
        </label>
        <label className="field">
          <span className="field__label">As of <span className="label-optional">(today if blank)</span></span>
          <input
            data-testid="forecast-asof"
            type="date"
            value={scenario.asOf || ''}
            onChange={(event) => onChange({ asOf: event.target.value })}
          />
          <span className="field__hint">Leave blank to use today.</span>
        </label>
        <label className="field">
          <span className="field__label">Horizon (months)</span>
          <input
            data-testid="forecast-horizon"
            type="number"
            min="1"
            max="120"
            inputMode="numeric"
            value={scenario.horizonMonths}
            onChange={(event) => {
              const value = Number.parseInt(event.target.value, 10)
              onChange({ horizonMonths: Number.isFinite(value) ? Math.min(120, Math.max(1, value)) : 1 })
            }}
          />
          <span className="field__hint">1–120 months</span>
        </label>
        <label className="field">
          <span className="field__label">Baseline window</span>
          <select
            data-testid="forecast-baseline-months"
            value={scenario.baselineMonths}
            onChange={(event) => onChange({ baselineMonths: Number.parseInt(event.target.value, 10) })}
          >
            {[3, 6, 12, 24].map((months) => <option key={months} value={months}>Last {months} months</option>)}
            {[3, 6, 12, 24].includes(scenario.baselineMonths) ? null : (
              <option value={scenario.baselineMonths}>Last {scenario.baselineMonths} months</option>
            )}
          </select>
        </label>
      </div>

      <details className="forecast-advanced">
        <summary>
          <span>Advanced model</span>
          <span className="muted">{modelSummary}</span>
        </summary>
        <div className="forecast-subsection">
          <div className="filters forecast-model-fields">
            <label className="field">
              <span className="field__label">Baseline method</span>
              <select
                data-testid="forecast-baseline-method"
                value={scenario.baselineMethod || 'auto'}
                onChange={(event) => onChange({ baselineMethod: event.target.value })}
              >
                <option value="auto">Auto</option>
                <option value="simple">Simple</option>
                <option value="robust">Robust</option>
              </select>
            </label>
            <label className="checkbox-inline forecast-model-toggle">
              <input
                data-testid="forecast-recurring-detection"
                type="checkbox"
                checked={scenario.recurringDetection !== false}
                onChange={(event) => onChange({ recurringDetection: event.target.checked })}
              />
              <span>Detect recurring items</span>
            </label>
            <label className="checkbox-inline forecast-model-toggle">
              <input
                data-testid="forecast-uncertainty"
                type="checkbox"
                checked={scenario.uncertainty !== false}
                onChange={(event) => onChange({ uncertainty: event.target.checked })}
              />
              <span>Show uncertainty</span>
            </label>
          </div>
          <p className="hint">
            Auto chooses the baseline method from a rolling backtest. Turning recurring detection off folds
            recurring history into the variable baseline; turning uncertainty off hides the 80% range.
          </p>
        </div>
      </details>

      <div className="forecast-subsection">
        <div className="card__header">
          <h3 className="panel__title">Target balance</h3>
        </div>
        <div className="filters">
          <label className="field">
            <span className="field__label">Label</span>
            <input data-testid="forecast-target-label" value={scenario.target?.label || ''} maxLength={80} onChange={(event) => onTargetChange({ label: event.target.value })} />
          </label>
          <label className="field">
            <span className="field__label">Amount</span>
            <input
              data-testid="forecast-target-amount"
              type="number"
              min="0"
              step="any"
              inputMode="decimal"
              placeholder="No target"
              aria-invalid={targetDateError || targetAmountError}
              value={scenario.target?.amount ?? ''}
              onChange={(event) => onTargetChange({ amount: event.target.value === '' ? null : event.target.value })}
            />
            {targetAmountError ? <span className="form-error">The target amount cannot be negative.</span> : null}
          </label>
          <label className="field">
            <span className="field__label">Target date <span className="label-optional">(optional)</span></span>
            <input
              data-testid="forecast-target-date"
              type="date"
              aria-invalid={targetDateError}
              value={scenario.target?.date || ''}
              onChange={(event) => onTargetChange({ date: event.target.value || null })}
            />
            {targetDateError ? <span className="form-error">Add a target amount before choosing a date.</span> : null}
          </label>
        </div>
      </div>

      <div className="forecast-subsection">
        <div className="panel__head">
          <h3 className="panel__title">Accounts</h3>
          <span className="muted">
            {(() => {
              const total = (scenario.accounts || [])
                .filter((account) => account.include !== false)
                .reduce((sum, account) => sum + Number(account.balance || 0), 0)
              return total === 0 ? 'Unknown' : money(total, scenario.currency)
            })()}
          </span>
        </div>
        <div className="forecast-accounts">
          <div className="forecast-account-row forecast-account-row--header" aria-hidden="true">
            <span>Account</span>
            <span>Balance</span>
            <span>Include</span>
            <span></span>
          </div>
          {(scenario.accounts || []).map((account, index) => (
            <div className={`forecast-account-row${account.name.trim() ? '' : ' forecast-account-row--invalid'}`} key={index}>
              <input
                aria-label={`Account ${index + 1} name`}
                data-testid={`account-name-${index}`}
                placeholder="Account name"
                required
                maxLength={80}
                aria-invalid={!account.name.trim()}
                value={account.name}
                onChange={(event) => onAccountChange(index, { name: event.target.value })}
              />
              <input
                aria-label={`Account ${index + 1} balance`}
                data-testid={`account-balance-${index}`}
                type="number"
                step="any"
                inputMode="decimal"
                value={account.balance}
                onChange={(event) => onAccountChange(index, { balance: event.target.value })}
              />
              <label className="checkbox-inline">
                <input
                  data-testid={`account-include-${index}`}
                  type="checkbox"
                  checked={account.include !== false}
                  onChange={(event) => onAccountChange(index, { include: event.target.checked })}
                />
                <span className="visually-hidden">Include {account.name}</span>
              </label>
              <button
                className="outline secondary icon-button icon-button--small icon-button--danger"
                type="button"
                title="Remove account"
                aria-label={`Remove account ${account.name || index + 1}`}
                onClick={() => onRemoveAccount(index)}
              ><Trash2 size={14} strokeWidth={1.8} /></button>
            </div>
          ))}
        </div>
        <button className="outline secondary" type="button" disabled={(scenario.accounts || []).length >= 20} onClick={onAddAccount}>Add account</button>
        <p className="hint">
          A starting balance of 0 is treated as unknown: the projection shows cash flow relative to $0.
          Add your real account balances for absolute numbers.
        </p>
        {accountNameError ? <p className="form-error">Every account needs a name before you can save.</p> : null}
      </div>

      <label className="field forecast-notes">
        <span className="field__label">Notes</span>
        <textarea rows="3" maxLength={2000} value={scenario.notes || ''} onChange={(event) => onChange({ notes: event.target.value })} />
      </label>
    </section>
  )
}
