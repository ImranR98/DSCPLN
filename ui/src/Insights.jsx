import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { LayoutDashboard, TrendingUp, Wrench } from 'lucide-react'
import {
  AppHeader,
  formats,
  getJson,
  startOfDay,
  showToast,
  ThemeToggle,
  Toasts,
} from '@dscpln/ui-kit'
import * as IM from './lib/insights-math.js'
import { moneyFor } from './lib/money.js'
import { renderMonthly } from './lib/chart.js'
import { sortNewestFirst, formatCount } from './lib/transactions.js'
import { buildCompareNote, buildInsightsModel, defaultExcludedFor, elapsedOf } from './lib/insights-model.js'
import KpiGrid from './components/KpiGrid.jsx'
import CategoryPanel from './components/CategoryPanel.jsx'
import MoversBlock from './components/MoversBlock.jsx'
import ChartPanel from './components/ChartPanel.jsx'
import TransactionList from './TransactionList.jsx'

const COMPARISON_MODES = ['prev', 'yoy', 'avg3', 'avg6', 'avg12']

function currentMonthRange(date = new Date()) {
  return { start: IM.startOfMonth(date), end: IM.endOfMonth(date) }
}

function lastMonthRange() {
  const now = new Date()
  const firstOfThisMonth = IM.startOfMonth(now)
  const lastMonthDay = IM.addDays(firstOfThisMonth, -1)
  return { start: IM.startOfMonth(lastMonthDay), end: lastMonthDay }
}

function lastFullMonthsRange(count) {
  return IM.lastCompleteMonths(count, new Date())
}

function ytdRange() {
  const now = new Date()
  return { start: new Date(now.getFullYear(), 0, 1), end: now }
}

function formatDateRange(start, end) {
  return `${formats.dayMonth.format(start)} ${formats.year.format(start)} – ${formats.dayMonth.format(end)} ${formats.year.format(end)}`
}

function isFullMonth(window) {
  return IM.isWholeMonthsRange(window.start, window.end) &&
    window.start.getMonth() === window.end.getMonth() &&
    window.start.getFullYear() === window.end.getFullYear()
}

function stateFromUrl() {
  const params = new URLSearchParams(location.search)
  const start = IM.parseIsoDate(params.get('start'))
  const end = IM.parseIsoDate(params.get('end'))
  const mode = COMPARISON_MODES.includes(params.get('cmp')) ? params.get('cmp') : 'prev'
  return {
    range: start && end && start <= end ? { start, end } : null,
    comparison: mode,
  }
}

export default function Insights() {
  const [reference, setReference] = useState(null)
  const [transactions, setTransactions] = useState([])
  const [range, setRangeState] = useState(null)
  const [comparison, setComparison] = useState('prev')
  const [comparisonData, setComparisonData] = useState(null)
  const [excluded, setExcluded] = useState(new Map())
  const [error, setError] = useState('')
  const [historyHidden, setHistoryHidden] = useState(true)
  const [historyRange, setHistoryRange] = useState('')

  const fetchSequence = useRef(0)
  const monthInputRef = useRef(null)
  const historyHostRef = useRef(null)
  const historyTooltipRef = useRef(null)

  const fractionalCurrencies = new Set(
    (reference?.currencies || []).filter((entry) => entry.fractional).map((entry) => entry.code))
  const symbols = new Map(
    (reference?.currencies || []).filter((entry) => entry.symbol).map((entry) => [entry.code, entry.symbol]))
  const money = moneyFor((code) => fractionalCurrencies.has(code), (code) => symbols.get(code))
  const today = startOfDay(new Date())

  useLayoutEffect(() => {
    document.body.classList.toggle('is-loading', !reference)
  }, [reference])

  /* ---------- ranges ---------- */

  const allTimeRange = () => {
    const transactionRange = reference && reference.transactionRange
    if (!transactionRange || !transactionRange.first || !transactionRange.last) {
      return null
    }
    return { start: IM.parseIsoDate(transactionRange.first), end: IM.parseIsoDate(transactionRange.last) }
  }

  const QUICK_RANGES = {
    'this-month': currentMonthRange,
    'last-month': lastMonthRange,
    'last-3': () => lastFullMonthsRange(3),
    'last-6': () => lastFullMonthsRange(6),
    'last-12': () => lastFullMonthsRange(12),
    ytd: ytdRange,
    'all-time': allTimeRange,
  }

  const quickRange = (name) => (QUICK_RANGES[name] ? QUICK_RANGES[name]() : null)

  const chips = Object.keys(QUICK_RANGES).map((name) => {
    const preset = quickRange(name)
    const active = Boolean(preset) && Boolean(range) &&
      IM.toIsoDate(preset.start) === IM.toIsoDate(range.start) &&
      IM.toIsoDate(preset.end) === IM.toIsoDate(range.end)
    return { name, active }
  })

  const monthChipLabel = range && isFullMonth(range) ? formats.monthYear.format(range.start) : 'Pick a month'
  const rangeLabel = range ? formatDateRange(range.start, range.end) : ''
  const monthInputValue = range && isFullMonth(range)
    ? `${range.start.getFullYear()}-${String(range.start.getMonth() + 1).padStart(2, '0')}`
    : ''

  const compareNote = buildCompareNote(range, comparisonData, comparison)

  /* ---------- data ---------- */

  const updateExcluded = (code, categories, include) => {
    setExcluded((current) => {
      const next = new Map(current)
      const set = new Set(current.get(code) ?? defaultExcludedFor(reference))
      for (const category of categories) {
        if (include) set.delete(category)
        else set.add(category)
      }
      next.set(code, set)
      return next
    })
  }

  const fetchData = async ({ range: rangeArg = range, comparison: comparisonArg = comparison } = {}) => {
    const sequence = ++fetchSequence.current
    try {
      // Statistics use the elapsed part of the range, while the chart and
      // forecast use the selected range so they can show the full comparison
      // periods. Plans fetched without the per-currency data-age clamp cover a
      // superset of the windows used for display.
      const statsRange = elapsedOf(rangeArg)
      const chartRange = rangeArg
      const statsPlan = IM.comparisonPlan(comparisonArg, statsRange)
      const chartPlan = IM.comparisonPlan(comparisonArg, chartRange)
      let fetchStart = [...statsPlan.windows, ...chartPlan.windows].reduce((earliest, window) =>
        !earliest || window.start < earliest ? window.start : earliest, null)
      if (chartRange.start <= today && today <= chartRange.end) {
        const monthStart = IM.startOfMonth(today)
        if (!fetchStart || monthStart < fetchStart) {
          fetchStart = monthStart
        }
      }
      const params = new URLSearchParams({
        start: IM.toIsoDate(fetchStart || chartRange.start),
        end: IM.toIsoDate(chartRange.end),
      })
      const [referenceResult, transactionsResult] = await Promise.all([
        reference ? Promise.resolve(reference) : getJson('/data'),
        getJson(`/transactions?${params}`),
      ])
      if (sequence !== fetchSequence.current) {
        return
      }
      setReference(referenceResult)
      setTransactions(transactionsResult.transactions || [])
      const firstMonths = new Map((referenceResult.currencies || []).map((entry) => [
        entry.code,
        entry.firstMonth ? IM.parseIsoDate(entry.firstMonth) : null,
      ]))
      // The note and basis labels use the earliest month any currency has
      // data; each section clamps further to its own currency's first month.
      const earliest = [...firstMonths.values()].reduce((min, date) =>
        date && (!min || date < min) ? date : min, null)
      setComparisonData({
        statsRange,
        chartRange,
        earliest,
        firstMonths,
      })
      setError('')
    } catch (e) {
      if (sequence === fetchSequence.current) {
        console.error(e)
        setError('Could not load insights. Check the server logs.')
        showToast('Could not load insights')
      }
    }
  }

  /* ---------- page model ---------- */

  const model = buildInsightsModel({ reference, range, comparison, comparisonData, transactions, excluded, symbols, money })

  const rangeTxCount = model ? model.rangeTxs.length : 0
  const sortedRangeTxs = model ? sortNewestFirst(model.rangeTxs) : []

  useLayoutEffect(() => {
    if (!historyHostRef.current || !historyTooltipRef.current || !model || model.future || model.history.hidden || !model.history.months) {
      setHistoryHidden(true)
      return
    }
    const rendered = renderMonthly(historyHostRef.current, historyTooltipRef.current, {
      months: model.history.months,
      codes: model.history.codes,
      money,
      symbolFor: (code) => symbols.get(code),
    })
    setHistoryHidden(!rendered)
    setHistoryRange(model.history.rangeText)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model])

  useEffect(() => {
    const initial = stateFromUrl()
    const initialRange = initial.range || currentMonthRange()
    setComparison(initial.comparison)
    setRangeState(initialRange)
    syncUrl(initialRange, initial.comparison)
    fetchData({ range: initialRange, comparison: initial.comparison })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /* ---------- navigation ---------- */

  const syncUrl = (rangeValue = range, comparisonValue = comparison) => {
    const params = new URLSearchParams({
      start: IM.toIsoDate(rangeValue.start),
      end: IM.toIsoDate(rangeValue.end),
      cmp: comparisonValue,
    })
    history.replaceState(null, '', `${location.pathname}?${params}`)
  }

  function setRange(start, end, { fetch = true } = {}) {
    if (!start || !end || start > end) {
      return
    }
    setRangeState({ start, end })
    syncUrl({ start, end }, comparison)
    if (fetch) {
      fetchData({ range: { start, end } })
    }
  }

  function openMonthPicker() {
    const input = monthInputRef.current
    if (!input) return
    input.value = monthInputValue
    if (typeof input.showPicker === 'function') {
      try {
        input.showPicker()
        return
      } catch {
        // fall through to focus/click
      }
    }
    input.focus()
    input.click()
  }

  function onMonthPicked() {
    const match = /^(\d{4})-(\d{2})$/.exec(monthInputRef.current.value)
    if (!match) {
      return
    }
    const date = new Date(Number(match[1]), Number(match[2]) - 1, 1)
    const window = currentMonthRange(date)
    setRange(window.start, window.end)
  }

  function onStartChange(event) {
    const start = IM.parseIsoDate(event.target.value)
    if (!start) return
    const end = range.end
    setRange(start, end < start ? start : end)
  }

  function onEndChange(event) {
    const end = IM.parseIsoDate(event.target.value)
    if (!end) return
    const start = range.start
    setRange(end < start ? end : start, end)
  }

  function onComparisonChange(event) {
    const next = COMPARISON_MODES.includes(event.target.value) ? event.target.value : 'prev'
    setComparison(next)
    syncUrl(range, next)
    fetchData({ comparison: next })
  }

  /* ---------- render ---------- */

  return (
    <>
      <AppHeader
        className="app-header--stack-mobile"
        name="Balance XLSX"
        meta="Insights"
        metaTools={<span className="muted">{rangeLabel}</span>}
        actions={(
          <>
            <a role="button" className="outline secondary icon-button" href="./" title="Dashboard" aria-label="Dashboard">
              <LayoutDashboard size={16} strokeWidth={1.8} />
            </a>
            <a role="button" className="outline secondary icon-button" href="forecasts" title="Forecasts" aria-label="Forecasts">
              <TrendingUp size={16} strokeWidth={1.8} />
            </a>
            <a role="button" className="outline secondary icon-button" href="settings" title="API settings" aria-label="API settings">
              <Wrench size={16} strokeWidth={1.8} />
            </a>
            <ThemeToggle />
          </>
        )}
      />

      <main className="insights">
        <section className="card insights-filters" aria-label="Date range and comparison">
          <div className="filters">
            <label className="field">
              <span className="field__label">Start</span>
              <input type="date" required value={range ? IM.toIsoDate(range.start) : ''} onChange={onStartChange} />
            </label>
            <label className="field">
              <span className="field__label">End</span>
              <input type="date" required value={range ? IM.toIsoDate(range.end) : ''} onChange={onEndChange} />
            </label>
            <label className="field">
              <span className="field__label">Compare with</span>
              <select value={comparison} onChange={onComparisonChange}>
                <option value="prev">Previous period</option>
                <option value="yoy">Same period last year</option>
                <option value="avg3">Trailing 3-month average</option>
                <option value="avg6">Trailing 6-month average</option>
                <option value="avg12">Trailing 12-month average</option>
              </select>
            </label>
          </div>
          <div className="quick-ranges" role="group" aria-label="Quick ranges">
            <button className="chip" type="button" data-range="this-month" aria-pressed={chips.find((chip) => chip.name === 'this-month')?.active} onClick={() => { const w = quickRange('this-month'); if (w) setRange(w.start, w.end) }}>This month</button>
            <button className="chip" type="button" data-range="last-month" aria-pressed={chips.find((chip) => chip.name === 'last-month')?.active} onClick={() => { const w = quickRange('last-month'); if (w) setRange(w.start, w.end) }}>Last month</button>
            <button className="chip" type="button" onClick={openMonthPicker}>{monthChipLabel}</button>
            <button className="chip" type="button" data-range="last-3" aria-pressed={chips.find((chip) => chip.name === 'last-3')?.active} onClick={() => { const w = quickRange('last-3'); if (w) setRange(w.start, w.end) }}>Last 3 full months</button>
            <button className="chip" type="button" data-range="last-6" aria-pressed={chips.find((chip) => chip.name === 'last-6')?.active} onClick={() => { const w = quickRange('last-6'); if (w) setRange(w.start, w.end) }}>Last 6 full months</button>
            <button className="chip" type="button" data-range="last-12" aria-pressed={chips.find((chip) => chip.name === 'last-12')?.active} onClick={() => { const w = quickRange('last-12'); if (w) setRange(w.start, w.end) }}>Last 12 full months</button>
            <button className="chip" type="button" data-range="ytd" aria-pressed={chips.find((chip) => chip.name === 'ytd')?.active} onClick={() => { const w = quickRange('ytd'); if (w) setRange(w.start, w.end) }}>Year to date</button>
            <button className="chip" type="button" data-range="all-time" aria-pressed={chips.find((chip) => chip.name === 'all-time')?.active} onClick={() => { const w = quickRange('all-time'); if (w) setRange(w.start, w.end) }}>All time</button>
          </div>
          <input ref={monthInputRef} className="visually-hidden" type="month" tabIndex="-1" aria-hidden="true" onChange={onMonthPicked} />
          <p className="insights-note" title={compareNote.title}>{compareNote.text}</p>
        </section>

        <details className="card">
          <summary>
            <span>Transactions</span>
            <span className="muted">{rangeTxCount ? formatCount(rangeTxCount) : ''}</span>
          </summary>
          <TransactionList id="transactionsList" transactions={sortedRangeTxs} money={money} today={today} markFuture />
          <p className="muted" hidden={rangeTxCount > 0}>No transactions in this range.</p>
        </details>

        <section className="card" hidden={historyHidden}>
          <div className="card__header">
            <h2>Monthly totals</h2>
            <span className="card__header-tools">
              <span className="card__context">{historyRange}</span>
              <span className="chart-legend">
                <span className="chart-legend__item">
                  <span className="chart-legend__swatch"></span>Out
                </span>
                <span className="chart-legend__item">
                  <span className="chart-legend__swatch chart-legend__swatch--in"></span>In
                </span>
              </span>
            </span>
          </div>
          <div ref={historyHostRef} className="chart-host"></div>
          <div ref={historyTooltipRef} className="chart-tooltip" hidden></div>
        </section>

        <div id="insightsContent">
          {error ? (
            <section className="card">
              <p className="muted">{error}</p>
            </section>
          ) : !model ? (
            <section className="card">
              <p className="muted">Loading insights…</p>
            </section>
          ) : model.future ? (
            <section className="card">
              <p className="muted">This range is in the future. Statistics will appear once the period starts.</p>
            </section>
          ) : model.sections.length === 0 ? (
            <section className="card">
              <p className="muted">No transactions in this range.</p>
            </section>
          ) : (
            model.sections.map((section) => (
              <section className="card insights-section" key={section.code} data-currency={section.code} style={{ '--currency': section.color }}>
                <div className="insights-section__header">
                  <span className="currency-badge">
                    <span className="insights-section__code">{section.code}</span>
                  </span>
                  <span className="muted insights-section__meta" title={section.basisTitle}>{section.count} · {section.basisLabel}</span>
                </div>

                <KpiGrid kpis={section.kpis} />

                <div className="insights-grid">
                  <div className="insights-panel">
                    <CategoryPanel title="Spending by category" list={section.spending} onSetExcluded={(categories, include) => updateExcluded(section.code, categories, include)} />
                    <CategoryPanel title="Earned by category" list={section.earning} onSetExcluded={(categories, include) => updateExcluded(section.code, categories, include)} />
                  </div>

                  <div className="insights-panel">
                    <ChartPanel section={section} />
                  </div>
                </div>

                <div className="movers">
                  {!section.hasComparison ? (
                    <p className="muted">{section.noComparisonText}</p>
                  ) : (
                    section.movers.map((block) => <MoversBlock block={block} key={block.title} />)
                  )}
                </div>
              </section>
            ))
          )}
        </div>
      </main>

      <Toasts />
    </>
  )
}
