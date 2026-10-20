import { useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ChartNoAxesColumn, LayoutDashboard, RefreshCw, Wrench } from 'lucide-react'
import {
  AppHeader,
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
import ForecastDrivers from './components/ForecastDrivers.jsx'
import ForecastAssumptions from './components/ForecastAssumptions.jsx'
import ForecastBaseline from './components/ForecastBaseline.jsx'
import ForecastEvents from './components/ForecastEvents.jsx'
import ForecastRecurring from './components/ForecastRecurring.jsx'
import ForecastChanges from './components/ForecastChanges.jsx'
import ForecastQuality from './components/ForecastQuality.jsx'
import ForecastTable from './components/ForecastTable.jsx'
import ForecastToolbar from './components/ForecastToolbar.jsx'
import ForecastSaveBar from './components/ForecastSaveBar.jsx'
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


const DRAFT_KEY = 'dscpln-balance-forecast-draft-v1'

const readDraft = () => {
  try {
    const raw = localStorage.getItem(DRAFT_KEY)
    if (!raw) return null
    const draft = JSON.parse(raw)
    return draft?.scenario ? draft : null
  } catch {
    return null
  }
}

const clearDraft = () => {
  try {
    localStorage.removeItem(DRAFT_KEY)
  } catch {
    // Ignore storage failures; the workbook remains the source of truth.
  }
}

export default function Forecasts() {
  const [reference, setReference] = useState(null)
  const [transactions, setTransactions] = useState([])
  const [scenario, setScenario] = useState(null)
  const [errors, setErrors] = useState([])
  const [validationErrors, setValidationErrors] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(null)
  const [saving, setSaving] = useState(false)
  const [lastSavedAt, setLastSavedAt] = useState(null)
  const [conflict, setConflict] = useState(null)
  const [recoveredDraft, setRecoveredDraft] = useState(null)

  const eventDialogRef = useRef(null)
  const changeDialogRef = useRef(null)
  const confirmRef = useRef(null)
  const saveHandlerRef = useRef(null)

  const currencies = useMemo(() => reference?.currencies || [], [reference])
  const primaryCurrency = currencies.find((entry) => entry.primary) || currencies[0] || null
  const hasChanges = Boolean(scenario?.dirty)
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

  useEffect(() => {
    if (!scenario?.dirty) return
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ scenario, savedAt: Date.now() }))
    } catch {
      // Draft recovery is best effort; saving the workbook is unaffected.
    }
  }, [scenario])

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
      const loaded = forecastResult.scenario ? attachScenarioDefaults(forecastResult.scenario) : null
      const pending = readDraft()
      const sameSheet = (pending?.scenario?.sheetName || null) === (loaded?.sheetName || null)
      const sameRevision = Number(pending?.scenario?.revision || 0) === Number(loaded?.revision || 0)
      if (pending && sameSheet && sameRevision) {
        setRecoveredDraft(pending)
      } else {
        if (pending) clearDraft()
        setRecoveredDraft(null)
      }
      const main = (referenceResult.currencies || []).find((entry) => entry.primary) ||
        (referenceResult.currencies || [])[0]
      setScenario(loaded || createScenario({ currency: main?.code || '' }))
      setErrors(forecastResult.errors || [])
      setValidationErrors([])
      setConflict(null)
      setLastSavedAt(loaded?.updatedAt ? Date.parse(loaded.updatedAt) || null : null)
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
    setRecoveredDraft(null)
    setScenario((current) => {
      if (!current) return current
      const update = typeof patch === 'function' ? patch(current) : patch
      return { ...current, ...update, dirty: true }
    })
  }

  const discard = () => {
    if (!hasChanges || saving) return
    confirmRef.current?.show({
      title: 'Discard unsaved changes',
      message: 'Discard all unsaved changes and reload from the workbook?',
      confirmLabel: 'Discard and reload',
      danger: true,
      onConfirm: () => {
        clearDraft()
        setRecoveredDraft(null)
        load()
      },
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
      onConfirm: () => {
        clearDraft()
        setRecoveredDraft(null)
        load()
      },
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
        setRecoveredDraft(null)
        setScenario(resetFields(scenario, primaryCurrency?.code))
        setValidationErrors([])
      },
    })
  }

  const performSave = async () => {
    if (!scenario) return
    setSaving(true)
    try {
      const result = await putJson('/forecast', { scenario: scenarioPayload(scenario) })
      const saved = result.scenario ? attachScenarioDefaults(result.scenario) : createScenario({
        currency: primaryCurrency?.code || scenario.currency || '',
      })
      clearDraft()
      setRecoveredDraft(null)
      setScenario({ ...saved, dirty: false })
      setErrors(result.errors || [])
      setValidationErrors([])
      setConflict(null)
      setLastSavedAt(saved.sheetName ? Date.now() : null)
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
    const problems = validateScenario(scenario)
    if (problems.length > 0) {
      setValidationErrors(problems)
      return
    }
    confirmRef.current?.show({
      title: 'Save forecast',
      message: `Save changes to ${scenario.name || 'Base plan'}? This rewrites the workbook; close it in Excel first.`,
      confirmLabel: 'Save',
      onConfirm: performSave,
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

  const restoreDraft = () => {
    if (!recoveredDraft?.scenario) return
    setScenario({ ...attachScenarioDefaults(recoveredDraft.scenario), dirty: true })
    setRecoveredDraft(null)
    setValidationErrors([])
  }

  const dismissDraft = () => {
    clearDraft()
    setRecoveredDraft(null)
  }

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
      <AppHeader
        name="Balance XLSX"
        meta="Forecasts"
        metaTools={<span className="muted">{headerMeta}{statusText ? ` · ${statusText}` : ''}</span>}
        actions={(
          <>
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
          </>
        )}
      />

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
            <ForecastToolbar
              scenario={scenario}
              statusText={statusText}
              hasChanges={hasChanges}
              saving={saving}
              onReset={resetScenario}
              onDiscard={discard}
              onSave={requestSave}
            />

            {recoveredDraft ? (
              <section className="card form-warning forecast-recovered">
                <div className="card__header"><h2>Unsaved draft found</h2></div>
                <p>
                  A local draft from {formats.dayMonth.format(new Date(recoveredDraft.savedAt))} at{' '}
                  {formats.time.format(new Date(recoveredDraft.savedAt))} was not saved to the workbook.
                </p>
                <div className="dialog-actions">
                  <button className="outline secondary" type="button" onClick={dismissDraft}>Dismiss draft</button>
                  <button type="button" onClick={restoreDraft}>Restore draft</button>
                </div>
              </section>
            ) : null}

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
                  </div>
                ))}
                <p className="hint">Fix or remove the invalid sheet in the workbook, then reload.</p>
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

                <ForecastDrivers forecast={activeModel.forecast} money={money} code={scenario.currency} />

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
        <ForecastSaveBar
          statusText={statusText}
          saving={saving}
          onReset={resetScenario}
          onDiscard={discard}
          onSave={requestSave}
        />
      ) : null}

      <EventDialog ref={eventDialogRef} asOf={effectiveAsOf} onSave={saveEvent} />
      <ChangeDialog ref={changeDialogRef} categories={reference?.categories || []} onSave={saveChange} />
      <ConfirmDialog ref={confirmRef} />
      <Toasts />
    </>
  )
}
