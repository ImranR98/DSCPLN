import { useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ChartNoAxesColumn, LayoutDashboard, RefreshCw, RotateCcw, Save, Undo2, Wrench } from 'lucide-react'
import {
  formats,
  getJson,
  parseIso,
  putJson,
  showToast,
  ThemeToggle,
  Toasts,
} from '@dscpln/ui-kit'
import { moneyFor } from './lib/money.js'
import { recurringKey } from './lib/forecast-recurring.js'
import {
  attachScenarioDefaults,
  buildForecastModel,
  createScenario,
  resolveScenarioAsOf,
  scenarioPayload,
} from './lib/forecast-model.js'
import KpiGrid from './components/KpiGrid.jsx'
import ForecastChart from './components/ForecastChart.jsx'
import ForecastAssumptions from './components/ForecastAssumptions.jsx'
import ForecastBaseline from './components/ForecastBaseline.jsx'
import ForecastEvents from './components/ForecastEvents.jsx'
import ForecastRecurring from './components/ForecastRecurring.jsx'
import ForecastChanges from './components/ForecastChanges.jsx'
import ForecastQuality from './components/ForecastQuality.jsx'
import ForecastTable from './components/ForecastTable.jsx'
import EventDialog from './EventDialog.jsx'
import ChangeDialog from './ChangeDialog.jsx'
import ConfirmDialog from './ConfirmDialog.jsx'

const validateScenario = (scenario) => {
  const errors = []
  if (!String(scenario.name || '').trim()) errors.push('A scenario name is required.')
  if (String(scenario.name || '').length > 80) errors.push('The scenario name is too long.')
  if (scenario.asOf && !/^\d{4}-\d{2}-\d{2}$/.test(String(scenario.asOf))) {
    errors.push('The as-of date must be blank (today) or a valid date.')
  }
  if (!Number.isInteger(Number(scenario.horizonMonths)) || Number(scenario.horizonMonths) < 1 || Number(scenario.horizonMonths) > 120) {
    errors.push('The horizon must be between 1 and 120 months.')
  }
  if (!Number.isInteger(Number(scenario.baselineMonths)) || Number(scenario.baselineMonths) < 1 || Number(scenario.baselineMonths) > 24) {
    errors.push('The baseline window must be between 1 and 24 months.')
  }
  if (scenario.target?.date && !(Number(scenario.target?.amount) > 0)) {
    errors.push('Add a target amount before choosing a target date.')
  }
  if (Number(scenario.target?.amount) < 0) errors.push('The target amount cannot be negative.')
  if ((scenario.accounts || []).length > 20) errors.push('A scenario can have at most 20 accounts.')
  if ((scenario.accounts || []).some((account) => !String(account.name || '').trim())) {
    errors.push('Every account needs a name.')
  }
  if ((scenario.notes || '').length > 2000) errors.push('Scenario notes are too long.')
  return errors
}

const chooseScenario = (scenarios) => (
  scenarios.find((scenario) => scenario.name === 'Base plan' || scenario.sheetName === 'Scenario - Base plan') ||
  scenarios[0] ||
  null
)

const resetFields = (scenario, currency) => {
  const defaults = createScenario({ currency: currency || scenario?.currency || '' })
  return {
    ...defaults,
    sheetName: scenario?.sheetName || null,
    revision: Number.isInteger(scenario?.revision) ? scenario.revision : 0,
    updatedAt: scenario?.updatedAt || null,
    dirty: true,
  }
}

export default function Forecasts() {
  const [reference, setReference] = useState(null)
  const [transactions, setTransactions] = useState([])
  const [scenario, setScenario] = useState(null)
  const [errors, setErrors] = useState([])
  const [validationErrors, setValidationErrors] = useState([])
  const [deletedSheets, setDeletedSheets] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(null)
  const [saving, setSaving] = useState(false)
  const [lastSavedAt, setLastSavedAt] = useState(null)
  const [conflict, setConflict] = useState(null)

  const eventDialogRef = useRef(null)
  const changeDialogRef = useRef(null)
  const confirmRef = useRef(null)
  const saveHandlerRef = useRef(null)

  const currencies = useMemo(() => reference?.currencies || [], [reference])
  const primaryCurrency = currencies.find((entry) => entry.primary) || currencies[0] || null
  const hasChanges = Boolean(scenario?.dirty) || deletedSheets.length > 0
  const effectiveAsOf = scenario ? resolveScenarioAsOf(scenario) : ''

  const fractionalCurrencies = useMemo(() => new Set(
    currencies.filter((entry) => entry.fractional).map((entry) => entry.code)), [currencies])
  const symbols = useMemo(() => new Map(
    currencies.filter((entry) => entry.symbol).map((entry) => [entry.code, entry.symbol])), [currencies])
  const money = useMemo(
    () => moneyFor((code) => fractionalCurrencies.has(code), (code) => symbols.get(code)),
    [fractionalCurrencies, symbols])

  const deferredScenario = useDeferredValue(scenario)
  const modelResult = useMemo(() => {
    if (!deferredScenario || !reference) return { model: null, error: null }
    try {
      return {
        model: buildForecastModel({
          scenario: deferredScenario,
          reference,
          transactions,
          money,
          paths: 400,
        }),
        error: null,
      }
    } catch (error) {
      return { model: null, error: error.message || 'Could not build this forecast.' }
    }
  }, [deferredScenario, reference, transactions, money])
  const activeModel = modelResult.model
  const modelError = modelResult.error

  useLayoutEffect(() => {
    document.body.classList.toggle('is-loading', loading)
  }, [loading])

  useEffect(() => {
    if (!hasChanges) return undefined
    const handler = (event) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [hasChanges])

  const load = async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const date = new Date()
      const dateIso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
      const [referenceResult, forecastResult] = await Promise.all([
        getJson(`/data?date=${dateIso}`),
        getJson('/forecast'),
      ])
      let transactionResult = { transactions: [] }
      const range = referenceResult.transactionRange
      if (range?.first && range?.last) {
        transactionResult = await getJson(`/transactions?start=${range.first}&end=${range.last}`)
      }
      setReference(referenceResult)
      setTransactions(transactionResult.transactions || [])
      const loaded = (forecastResult.scenarios || []).map(attachScenarioDefaults)
      const chosen = chooseScenario(loaded)
      const main = (referenceResult.currencies || []).find((entry) => entry.primary) ||
        (referenceResult.currencies || [])[0]
      setScenario(chosen || createScenario({ currency: main?.code || '' }))
      setErrors(forecastResult.errors || [])
      setValidationErrors([])
      setDeletedSheets([])
      setConflict(null)
      setLastSavedAt(chosen?.updatedAt ? Date.parse(chosen.updatedAt) || null : null)
    } catch (error) {
      console.error(error)
      setLoadError(error.message || 'Could not load forecasts. Check the server logs.')
      showToast('Could not load forecasts. Check the server logs.', 'error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const patchScenario = (patch) => {
    setValidationErrors([])
    setScenario((current) => {
      if (!current) return current
      const update = typeof patch === 'function' ? patch(current) : patch
      return { ...current, ...update, dirty: true }
    })
  }

  const addDeletedSheet = (sheetName) => {
    if (!sheetName) return
    setDeletedSheets((current) => current.some((entry) => entry.sheetName === sheetName) ? current : [
      ...current,
      { sheetName, revision: null },
    ])
  }

  const removeErrorSheet = (sheetName) => {
    confirmRef.current?.show({
      title: 'Delete invalid scenario sheet',
      message: `Delete the invalid scenario sheet "${sheetName}"? It will be removed from the workbook on Save.`,
      confirmLabel: 'Delete on save',
      danger: true,
      onConfirm: () => {
        addDeletedSheet(sheetName)
        setErrors((current) => current.filter((entry) => entry.sheetName !== sheetName))
      },
    })
  }

  const discard = () => {
    if (!hasChanges || saving) return
    confirmRef.current?.show({
      title: 'Discard unsaved changes',
      message: 'Discard all unsaved changes and reload from the workbook?',
      confirmLabel: 'Discard and reload',
      danger: true,
      onConfirm: load,
    })
  }

  const reload = () => {
    if (saving) return
    if (!hasChanges) {
      load()
      return
    }
    confirmRef.current?.show({
      title: 'Reload from workbook',
      message: 'Discard unsaved changes and reload from the workbook?',
      confirmLabel: 'Discard and reload',
      danger: true,
      onConfirm: load,
    })
  }

  const resetScenario = () => {
    if (!scenario) return
    confirmRef.current?.show({
      title: 'Reset Base plan',
      message: 'Reset Base plan to defaults? This clears accounts, target, overrides, recurring adjustments, scheduled changes, events, and notes. Nothing is written until you press Save.',
      confirmLabel: 'Reset',
      danger: true,
      onConfirm: () => {
        setScenario(resetFields(scenario, primaryCurrency?.code))
        setValidationErrors([])
      },
    })
  }

  const performSave = async (upserts, deletes) => {
    if (!scenario) return
    setSaving(true)
    try {
      const result = await putJson('/forecast', { upserts, deletes })
      const saved = (result.scenarios || []).map(attachScenarioDefaults)
      const chosen = chooseScenario(saved) || createScenario({
        currency: primaryCurrency?.code || scenario.currency || '',
      })
      setScenario({ ...chosen, dirty: false, sheetName: chosen.sheetName || null })
      setErrors(result.errors || [])
      setDeletedSheets([])
      setValidationErrors([])
      setConflict(null)
      setLastSavedAt(chosen.sheetName ? Date.now() : null)
      if (result.commitWarning) {
        showToast(`Saved, but the git commit failed: ${result.commitWarning}`, 'error')
      } else {
        showToast('Forecast saved')
      }
    } catch (error) {
      console.error(error)
      if (error.status === 409) {
        setConflict(error.message)
      } else {
        showToast(error.message || 'Could not save the forecast', 'error')
      }
    } finally {
      setSaving(false)
    }
  }

  const requestSave = () => {
    if (!hasChanges || saving || !scenario) return
    if (document.querySelector('dialog[open]')) return
    if (scenario.dirty) {
      const problems = validateScenario(scenario)
      if (problems.length > 0) {
        setValidationErrors(problems)
        return
      }
    }
    const upserts = scenario.dirty ? [scenarioPayload(scenario)] : []
    const deletes = [...deletedSheets]
    if (upserts.length === 0 && deletes.length === 0) return
    const details = [
      ...(scenario.dirty ? [scenario.name || 'Base plan'] : []),
      ...deletedSheets.map((entry) => `delete ${entry.sheetName}`),
    ].join(', ')
    confirmRef.current?.show({
      title: 'Save forecast',
      message: `Save ${details}? This rewrites the workbook; close it in Excel first.`,
      confirmLabel: 'Save',
      onConfirm: () => performSave(upserts, deletes),
    })
  }

  saveHandlerRef.current = requestSave

  useEffect(() => {
    const handler = (event) => {
      if ((event.metaKey || event.ctrlKey) && String(event.key).toLowerCase() === 's') {
        event.preventDefault()
        saveHandlerRef.current?.()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  const onAccountChange = (index, patch) => patchScenario((current) => ({
    accounts: current.accounts.map((account, position) => position === index ? { ...account, ...patch } : account),
  }))
  const onAddAccount = () => patchScenario((current) => ({
    accounts: [...current.accounts, { name: '', balance: 0, include: true }],
  }))
  const onRemoveAccount = (index) => patchScenario((current) => ({
    accounts: current.accounts.filter((_, position) => position !== index),
  }))
  const onTargetChange = (patch) => patchScenario((current) => ({
    target: { ...current.target, ...patch },
  }))

  const setOverride = (kind, category, value) => patchScenario((current) => {
    const next = {
      ...current.overrides,
      [kind]: { ...(current.overrides?.[kind] || {}) },
    }
    if (value === '') delete next[kind][category]
    else next[kind][category] = value
    return { overrides: next }
  })

  const toggleCategory = (category, include) => patchScenario((current) => {
    const excluded = new Set(current.excludedCategories || [])
    if (include) excluded.delete(category)
    else excluded.add(category)
    return { excludedCategories: [...excluded] }
  })

  const resetOverrides = () => patchScenario({ overrides: { income: {}, expense: {} } })

  const saveEvent = ({ index, event }) => patchScenario((current) => {
    const events = [...(current.events || [])]
    if (index == null) events.push(event)
    else events[index] = event
    return { events }
  })
  const removeEvent = (index) => patchScenario((current) => ({
    events: (current.events || []).filter((_, position) => position !== index),
  }))

  const adjustRecurring = (item, patch) => patchScenario((current) => {
    const adjustments = [...(current.recurringAdjustments || [])]
    const key = item.key || recurringKey(item)
    const index = adjustments.findIndex((adjustment) => recurringKey(adjustment) === key)
    const base = index >= 0 ? adjustments[index] : {
      kind: item.kind,
      category: item.category,
      details: item.detailsKey || item.details || item.label,
      label: item.label || '',
      include: true,
      amount: null,
      cadence: null,
      nextDate: null,
    }
    const next = { ...base, ...patch }
    if (next.amount === '' || next.amount == null) next.amount = null
    if (next.cadence === '') next.cadence = null
    if (next.nextDate === '') next.nextDate = null
    if (index >= 0) adjustments[index] = next
    else adjustments.push(next)
    return { recurringAdjustments: adjustments }
  })

  const removeRecurringAdjustment = (itemOrAdjustment) => patchScenario((current) => {
    const key = itemOrAdjustment.key || recurringKey(itemOrAdjustment)
    return {
      recurringAdjustments: (current.recurringAdjustments || [])
        .filter((adjustment) => recurringKey(adjustment) !== key),
    }
  })

  const saveChange = ({ index, change }) => patchScenario((current) => {
    const changes = [...(current.changes || [])]
    if (index == null) changes.push(change)
    else changes[index] = change
    return { changes }
  })
  const removeChange = (index) => patchScenario((current) => ({
    changes: (current.changes || []).filter((_, position) => position !== index),
  }))

  const statusText = saving ? 'Saving…'
    : hasChanges ? 'Unsaved changes'
      : lastSavedAt ? `Saved ${formats.time.format(new Date(lastSavedAt))}` : ''
  const asOfLabel = scenario?.asOf
    ? `${formats.dayMonth.format(parseIso(scenario.asOf))} ${formats.year.format(parseIso(scenario.asOf))}`
    : `Today · ${formats.dayMonth.format(parseIso(effectiveAsOf))} ${formats.year.format(parseIso(effectiveAsOf))}`
  const headerMeta = scenario
    ? [scenario.name, scenario.currency, asOfLabel].filter(Boolean).join(' · ')
    : ''

  return (
    <>
      <header className="app-header">
        <div className="app-header__top">
          <h1><a className="app-header__brand" href="/">D<span className="accent">$</span>CPLN <span className="app-header__app">⋅ Balance XLSX</span></a></h1>
          <div className="app-header__actions">
            <a role="button" className="outline secondary icon-button" href="./" title="Dashboard" aria-label="Dashboard">
              <LayoutDashboard size={16} strokeWidth={1.8} />
            </a>
            <a role="button" className="outline secondary icon-button" href="insights" title="Insights" aria-label="Insights">
              <ChartNoAxesColumn size={16} strokeWidth={1.8} />
            </a>
            <a role="button" className="outline secondary icon-button" href="settings" title="API settings" aria-label="API settings">
              <Wrench size={16} strokeWidth={1.8} />
            </a>
            <button className="outline secondary icon-button" title="Reload from workbook" aria-label="Reload from workbook" onClick={reload}>
              <RefreshCw size={16} strokeWidth={1.8} />
            </button>
            <ThemeToggle />
          </div>
        </div>
        <div className="app-header__meta">
          <span>Forecasts</span>
          <span className="app-header__meta-tools">
            <span className="muted">{headerMeta}{statusText ? ` · ${statusText}` : ''}</span>
          </span>
        </div>
      </header>

      <main className={`forecast-page${hasChanges ? ' forecast-page--dirty' : ''}`}>
        {loading ? (
          <section className="card"><p className="muted">Loading forecasts…</p></section>
        ) : loadError ? (
          <section className="card">
            <p className="form-error">{loadError}</p>
            <button className="outline secondary" type="button" onClick={load}>Retry</button>
          </section>
        ) : !reference ? (
          <section className="card"><p className="muted">Could not load the workbook data.</p></section>
        ) : (
          <>
            <section className="card forecast-toolbar" aria-label="Scenario controls">
              <div className="forecast-toolbar__row">
                <div className="forecast-toolbar__scenario">
                  <span className="field__label">Scenario</span>
                  <strong className="forecast-toolbar__name">{scenario?.name || 'Base plan'}</strong>
                </div>
                <div className="forecast-toolbar__save">
                  <span className={`forecast-save-status${hasChanges ? ' forecast-save-status--dirty' : ''}`} role="status" aria-live="polite">{statusText}</span>
                  <button className="outline secondary" type="button" data-testid="forecast-reset" disabled={saving} title="Reset Base plan to defaults" aria-label="Reset Base plan to defaults" onClick={resetScenario}>
                    <RotateCcw size={14} strokeWidth={1.8} /> <span className="forecast-label-wide">Reset defaults</span><span className="forecast-label-narrow">Reset</span>
                  </button>
                  <button className="outline secondary" type="button" disabled={!hasChanges || saving} title="Discard unsaved changes and reload the last saved version" aria-label="Discard unsaved changes and reload the last saved version" onClick={discard}>
                    <Undo2 size={14} strokeWidth={1.8} /> <span className="forecast-label-wide">Discard changes</span><span className="forecast-label-narrow">Discard</span>
                  </button>
                  <button type="button" data-testid="forecast-save" disabled={!hasChanges || saving} onClick={requestSave}><Save size={14} strokeWidth={1.8} /> {saving ? 'Saving…' : 'Save'}</button>
                </div>
              </div>
              {scenario && !scenario.sheetName ? (
                <p className="hint forecast-toolbar__draft">
                  {scenario.dirty
                    ? 'Local draft — press Save to create its scenario sheet.'
                    : 'Local draft — edit a field and press Save to create its scenario sheet.'}
                </p>
              ) : null}
            </section>

            {conflict ? (
              <section className="card form-warning forecast-conflict">
                <p>{conflict}</p>
                <div className="dialog-actions">
                  <button className="outline secondary" type="button" onClick={() => setConflict(null)}>Dismiss</button>
                  <button type="button" onClick={load}>Reload from workbook</button>
                </div>
              </section>
            ) : null}

            {validationErrors.length > 0 ? (
              <section className="card form-warning forecast-errors" role="alert">
                <div className="card__header"><h2>Check these fields</h2><button className="link-button" type="button" onClick={() => setValidationErrors([])}>Dismiss</button></div>
                <ul>
                  {validationErrors.map((message) => <li key={message}>{message}</li>)}
                </ul>
              </section>
            ) : null}

            {errors.length > 0 ? (
              <section className="card forecast-errors">
                <div className="card__header"><h2>Scenario sheet errors</h2></div>
                {errors.map((entry) => (
                  <div className="forecast-error" key={entry.sheetName}>
                    <div>
                      <strong>{entry.sheetName}</strong>
                      <p className="muted">{entry.error}</p>
                    </div>
                    <button className="outline secondary danger" type="button" onClick={() => removeErrorSheet(entry.sheetName)}>Delete sheet</button>
                  </div>
                ))}
              </section>
            ) : null}

            {modelError ? (
              <>
                <section className="card form-warning">
                  <p>{modelError}</p>
                  <p className="hint">Fix the highlighted assumptions below; the preview will recover automatically.</p>
                </section>
                <ForecastAssumptions
                  scenario={scenario}
                  currencies={currencies}
                  money={money}
                  onChange={patchScenario}
                  onAccountChange={onAccountChange}
                  onAddAccount={onAddAccount}
                  onRemoveAccount={onRemoveAccount}
                  onTargetChange={onTargetChange}
                />
              </>
            ) : activeModel && scenario ? (
              <>
                <div data-testid="forecast-kpis"><KpiGrid kpis={activeModel.kpis} /></div>

                <section className="card forecast-chart-card" data-testid="forecast-chart-card">
                  <div className="card__header">
                    <h2>Projection</h2>
                    <span className="card__header-tools">
                      <span className="card__context">{activeModel.forecast.horizonMonths} months · {activeModel.forecast.horizonEnd}</span>
                    </span>
                  </div>
                  <ForecastChart chart={activeModel.chart} money={money} />
                  {activeModel.forecast.uncertainty ? (
                    <p className="hint">The 80% range reflects historical variable income and spending. Recurring items and one-time events are treated as fixed.</p>
                  ) : null}
                  {activeModel.warnings.length > 0 ? (
                    <div className="forecast-warnings">
                      <ul>
                        {activeModel.warnings.map((warning) => <li key={warning}>{warning}</li>)}
                      </ul>
                    </div>
                  ) : null}
                </section>

                <div className="forecast-grid">
                  <ForecastAssumptions
                    scenario={scenario}
                    currencies={currencies}
                    money={money}
                    onChange={patchScenario}
                    onAccountChange={onAccountChange}
                    onAddAccount={onAddAccount}
                    onRemoveAccount={onRemoveAccount}
                    onTargetChange={onTargetChange}
                  />
                  <ForecastBaseline
                    model={activeModel}
                    scenario={scenario}
                    money={money}
                    onOverride={setOverride}
                    onToggleCategory={toggleCategory}
                    onResetOverrides={resetOverrides}
                  />
                </div>

                <ForecastRecurring
                  recurring={activeModel.recurring}
                  scenario={scenario}
                  money={money}
                  onAdjust={adjustRecurring}
                  onRemoveAdjustment={removeRecurringAdjustment}
                />

                <ForecastChanges
                  changes={scenario.changes}
                  money={money}
                  currency={scenario.currency}
                  horizonEnd={activeModel.forecast.horizonEnd}
                  onAdd={() => changeDialogRef.current.showAdd(effectiveAsOf.slice(0, 7))}
                  onEdit={(index) => changeDialogRef.current.showEdit(scenario.changes[index], index)}
                  onRemove={removeChange}
                />

                <ForecastEvents
                  scenario={activeModel.effectiveScenario}
                  money={money}
                  horizonEnd={activeModel.forecast.horizonEnd}
                  onAdd={() => eventDialogRef.current.showAdd()}
                  onEdit={(index) => eventDialogRef.current.showEdit(scenario.events[index], index)}
                  onRemove={removeEvent}
                />

                <ForecastTable
                  rows={activeModel.projectionRows}
                  horizonMonths={activeModel.forecast.horizonMonths}
                  balanceUnknown={activeModel.forecast.balanceUnknown}
                />

                <ForecastQuality quality={activeModel.modelQuality} />
              </>
            ) : (
              <section className="card"><p className="muted">Could not build the forecast.</p></section>
            )}
          </>
        )}
      </main>

      {hasChanges ? (
        <div className="forecast-savebar" role="region" aria-label="Unsaved forecast changes">
          <span className="forecast-savebar__status" role="status" aria-live="polite">{statusText || 'Unsaved changes'}</span>
          <div className="forecast-savebar__actions">
            <button className="outline secondary" type="button" data-testid="forecast-reset-sticky" disabled={saving} title="Reset Base plan to defaults" aria-label="Reset Base plan to defaults" onClick={resetScenario}>
              <span className="forecast-label-wide">Reset defaults</span><span className="forecast-label-narrow">Reset</span>
            </button>
            <button className="outline secondary" type="button" disabled={saving} title="Discard unsaved changes and reload the last saved version" aria-label="Discard unsaved changes and reload the last saved version" onClick={discard}>
              <span className="forecast-label-wide">Discard changes</span><span className="forecast-label-narrow">Discard</span>
            </button>
            <button type="button" disabled={saving} onClick={requestSave} data-testid="forecast-save-sticky"><Save size={14} strokeWidth={1.8} /> {saving ? 'Saving…' : 'Save'}</button>
          </div>
        </div>
      ) : null}

      <EventDialog ref={eventDialogRef} asOf={effectiveAsOf} onSave={saveEvent} />
      <ChangeDialog ref={changeDialogRef} categories={reference?.categories || []} onSave={saveChange} />
      <ConfirmDialog ref={confirmRef} />
      <Toasts />
    </>
  )
}
