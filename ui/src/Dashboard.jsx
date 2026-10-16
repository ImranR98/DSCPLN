import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ChartNoAxesColumn, RefreshCw, SlidersHorizontal, Wrench } from 'lucide-react'
import { formats, getJson, postJson, startOfDay, toIso, showToast, ThemeToggle, Toasts } from '@dscpln/ui-kit'
import { moneyFor } from './lib/money.js'
import { renderMonthly } from './lib/chart.js'
import { sortNewestFirst, formatCount } from './lib/transactions.js'
import { buildCurrencyCards, buildHero } from './lib/dashboard-model.js'
import CurrencyCards from './components/CurrencyCards.jsx'
import ExpensesPanel from './components/ExpensesPanel.jsx'
import HeroCard from './components/HeroCard.jsx'
import HistoryCard from './components/HistoryCard.jsx'
import BudgetDialog from './BudgetDialog.jsx'
import CategoriesDialog from './CategoriesDialog.jsx'
import TransactionDialog from './TransactionDialog.jsx'
import ImportDialog from './ImportDialog.jsx'
import DeleteDialog from './DeleteDialog.jsx'

const REFRESH_STALE_MS = 60 * 1000

export default function Dashboard() {
  const [data, setData] = useState(null)
  const [today, setToday] = useState(startOfDay(new Date()))
  const [lastFetchAt, setLastFetchAt] = useState(0)
  const [spinning, setSpinning] = useState(false)
  const [historyHidden, setHistoryHidden] = useState(true)
  const [historyRange, setHistoryRange] = useState('')
  const [excluded, setExcluded] = useState(null)

  const historyHostRef = useRef(null)
  const historyTooltipRef = useRef(null)
  const budgetDialogRef = useRef(null)
  const categoriesDialogRef = useRef(null)
  const transactionDialogRef = useRef(null)
  const importDialogRef = useRef(null)
  const deleteDialogRef = useRef(null)
  const fetchSequence = useRef(0)
  const excludedRef = useRef(null)

  /* ---------- derived ---------- */

  const fractionalCurrencies = new Set(
    (data?.currencies || []).filter((entry) => entry.fractional).map((entry) => entry.code))
  const symbols = new Map(
    (data?.currencies || []).filter((entry) => entry.symbol).map((entry) => [entry.code, entry.symbol]))
  const symbolFor = (code) => symbols.get(code)
  const money = moneyFor((code) => Boolean(code) && fractionalCurrencies.has(code), symbolFor)

  const primary = (data?.currencies || []).find((currency) => currency.primary) || (data?.currencies || [])[0] || null
  const writable = data?.writable !== false

  const hero = buildHero(data, today, money)
  const currencyCards = buildCurrencyCards(data, money)
  const expenses = sortNewestFirst(data?.transactions || [])
  const expensesMeta = expenses.length ? formatCount(expenses.length) : ''

  const contextLabel = `Today · ${formats.weekday.format(today)}`
  const updatedLabel = lastFetchAt ? `Updated ${formats.time.format(new Date(lastFetchAt))}` : ''
  const excludedCount = excluded ? excluded.size : 0

  useLayoutEffect(() => {
    document.body.classList.toggle('is-loading', !data)
  }, [data])

  /* ---------- data ---------- */

  const fetchData = async (excludedOverride) => {
    const sequence = ++fetchSequence.current
    setToday(startOfDay(new Date()))
    try {
      const active = excludedOverride !== undefined ? excludedOverride : excludedRef.current
      const params = new URLSearchParams({ date: toIso(startOfDay(new Date())) })
      if (active !== null) {
        for (const category of active) {
          params.append('exclude', category)
        }
      }
      const result = await getJson(`/data?${params}`)
      if (sequence !== fetchSequence.current) return
      // The first response carries the workbook defaults; later fetches send
      // the current selection explicitly.
      if (excludedRef.current === null) {
        const initial = new Set(result.defaultExcludedCategories || [])
        excludedRef.current = initial
        setExcluded(initial)
      }
      setData(result)
      setLastFetchAt(Date.now())
    } catch (e) {
      if (sequence === fetchSequence.current) {
        console.error(e)
        showToast('Could not load data. Check the server logs.', 'error')
      }
    }
  }

  const applyExcluded = (next) => {
    excludedRef.current = next
    setExcluded(new Set(next))
    fetchData(next)
  }

  const toggleCategories = (categories, include) => {
    const next = new Set(excludedRef.current || [])
    for (const category of categories) {
      if (include) next.delete(category)
      else next.add(category)
    }
    applyExcluded(next)
  }

  const resetCategories = () => applyExcluded(new Set(data?.defaultExcludedCategories || []))

  const saveDefaults = async () => {
    await postJson('/excluded-defaults', { categories: [...(excludedRef.current || [])] })
    await fetchData()
  }

  const refreshNow = () => {
    setSpinning(true)
    window.setTimeout(() => setSpinning(false), 600)
    fetchData()
  }

  useLayoutEffect(() => {
    if (!historyHostRef.current || !historyTooltipRef.current || !data) return
    const history = data.history || []
    const codes = (data.currencies || []).map((currency) => currency.code)
    const rendered = renderMonthly(historyHostRef.current, historyTooltipRef.current, {
      months: history,
      codes,
      money,
      symbolFor,
    })
    setHistoryHidden(!rendered)
    if (!rendered) {
      setHistoryRange('')
      return
    }
    const first = history[0]
    const last = history[history.length - 1]
    setHistoryRange(formats.monthYear.format(new Date(first.year, first.month - 1, 1)) + ' – ' +
      formats.monthYear.format(new Date(last.year, last.month - 1, 1)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data])

  useEffect(() => {
    fetchData()
    const onVisibility = () => {
      if (document.visibilityState === 'visible' && Date.now() - lastFetchAt > REFRESH_STALE_MS) {
        fetchData()
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /* ---------- render ---------- */

  return (
    <>
      <header className="app-header">
        <div className="app-header__top">
          <h1><a className="app-header__brand" href="/">D<span className="accent">$</span>CPLN</a> <span className="app-header__app">⋅ Balance XLSX</span></h1>
          <div className="app-header__actions">
            <a role="button" className="outline secondary icon-button" href="insights" title="Insights" aria-label="Insights">
              <ChartNoAxesColumn size={16} strokeWidth={1.8} />
            </a>
            <a role="button" className="outline secondary icon-button" href="settings" title="API settings" aria-label="API settings">
              <Wrench size={16} strokeWidth={1.8} />
            </a>
            <button className="outline secondary icon-button" title="Counted categories" aria-label="Counted categories" disabled={!data} onClick={() => categoriesDialogRef.current.show()}>
              <SlidersHorizontal size={16} strokeWidth={1.8} />
            </button>
            <button className={`outline secondary icon-button${spinning ? ' is-spinning' : ''}`} title="Refresh" aria-label="Refresh data" onClick={refreshNow}>
              <RefreshCw size={16} strokeWidth={1.8} />
            </button>
            <ThemeToggle />
          </div>
        </div>
        <div className="app-header__meta">
          <span>{contextLabel}</span>
          <span className="app-header__meta-tools">
            <span className="muted">{[updatedLabel, excludedCount ? `${excludedCount} not counted` : ''].filter(Boolean).join(' · ')}</span>
          </span>
        </div>
      </header>

      <main className="layout">
        <div className="layout__main">
          <HeroCard
            hero={hero}
            canEditBudget={Boolean(data)}
            onEditBudget={() => primary && budgetDialogRef.current.show(primary.code)}
          />
          <CurrencyCards cards={currencyCards} onEditBudget={(code) => budgetDialogRef.current.show(code)} />
          <HistoryCard hidden={historyHidden} rangeText={historyRange} hostRef={historyHostRef} tooltipRef={historyTooltipRef} />
        </div>

        <div className="layout__side">
          <ExpensesPanel
            expenses={expenses}
            expensesMeta={expensesMeta}
            money={money}
            today={today}
            writable={writable}
            onImport={() => importDialogRef.current.show()}
            onAdd={() => transactionDialogRef.current.showAdd({ primaryCode: primary ? primary.code : '' })}
            onEdit={(transaction) => transactionDialogRef.current.showEdit(transaction)}
            onDelete={(transaction) => deleteDialogRef.current.show(transaction)}
          />
        </div>
      </main>

      <BudgetDialog ref={budgetDialogRef} data={data} onrefresh={() => fetchData()} />
      <CategoriesDialog
        ref={categoriesDialogRef}
        data={data}
        excluded={excluded || new Set()}
        defaults={data?.defaultExcludedCategories}
        onToggle={toggleCategories}
        onReset={resetCategories}
        onSave={saveDefaults}
      />
      <TransactionDialog ref={transactionDialogRef} data={data} today={today} onrefresh={() => fetchData()} />
      <ImportDialog ref={importDialogRef} data={data} today={today} onrefresh={() => fetchData()} />
      <DeleteDialog ref={deleteDialogRef} money={money} onrefresh={() => fetchData()} />

      <Toasts />
    </>
  )
}
