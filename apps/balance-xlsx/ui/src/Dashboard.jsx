import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ChartNoAxesColumn, RefreshCw, SquarePen, Wrench } from 'lucide-react'
import {
  formats,
  getJson,
  startOfDay,
  toIso,
  Breakable,
  showToast,
  ThemeToggle,
  Toasts,
} from '@dscpln/ui-kit'
import { moneyFor, number, clean, currencyColor } from './lib/money.js'
import { renderMonthly } from './lib/chart.js'
import { sortNewestFirst, formatCount } from './lib/transactions.js'

import TransactionList from './TransactionList.jsx'
import BudgetDialog from './BudgetDialog.jsx'
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

  const historyHostRef = useRef(null)
  const historyTooltipRef = useRef(null)
  const budgetDialogRef = useRef(null)
  const transactionDialogRef = useRef(null)
  const importDialogRef = useRef(null)
  const deleteDialogRef = useRef(null)
  const fetchSequence = useRef(0)

  const fractionalCurrencies = new Set(
    (data?.currencies || []).filter((entry) => entry.fractional).map((entry) => entry.code))
  const symbols = new Map(
    (data?.currencies || []).filter((entry) => entry.symbol).map((entry) => [entry.code, entry.symbol]))
  const symbolFor = (code) => symbols.get(code)
  const money = moneyFor((code) => Boolean(code) && fractionalCurrencies.has(code), symbolFor)

  const primary = (data?.currencies || []).find((currency) => currency.primary) || (data?.currencies || [])[0] || null
  const writable = data?.writable !== false

  const contextLabel = `Today · ${formats.weekday.format(today)}`
  const updatedLabel = lastFetchAt ? `Updated ${formats.time.format(new Date(lastFetchAt))}` : ''

  useLayoutEffect(() => {
    document.body.classList.toggle('is-loading', !data)
  }, [data])

  const fetchData = async ({ silent = false } = {}) => {
    const sequence = ++fetchSequence.current
    setToday(startOfDay(new Date()))
    try {
      const params = new URLSearchParams({ date: toIso(startOfDay(new Date())) })
      const result = await getJson(`/data?${params}`)
      if (sequence !== fetchSequence.current) return
      setData(result)
      setLastFetchAt(Date.now())
    } catch (e) {
      if (sequence === fetchSequence.current) {
        console.error(e)
        showToast('Could not load data. Check the server logs.', 'error')
      }
    }
  }

  const refreshNow = () => {
    setSpinning(true)
    window.setTimeout(() => setSpinning(false), 600)
    fetchData({ silent: true })
  }

  const cardState = (spent, budget) => {
    if (budget <= 0) return 'card--none'
    if (spent >= budget) return 'card--over'
    if (spent / budget >= 0.8) return 'card--warn'
    return 'card--ok'
  }

  const hero = (() => {
    const currency = primary
    const value = (key) => number(currency && currency[key])
    const budget = value('monthlyBudget')
    const spent = value('monthsSpend')
    const code = currency ? currency.code : null
    const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate()
    const day = today.getDate()
    const daysLeft = Math.max(1, daysInMonth - day + 1)
    const remaining = budget - spent
    const expected = value('monthsExpectedSpend') || budget * (day / daysInMonth)

    const pct = budget > 0 ? Math.min((spent / budget) * 100, 100) : 0
    const paceFraction = budget > 0 ? Math.min(1, Math.max(0, expected / budget)) : 0
    const paceDelta = expected - spent

    // Last month and the trailing average are shown through the same day of
    // month as today, so all three figure columns are directly comparable; the
    // full-month figures stay in each cell's tooltip.
    const months = Math.max(0, Math.round(value('trailingMonths')))
    const previousMonthDate = new Date(today.getFullYear(), today.getMonth() - 1, 1)
    const daysInPreviousMonth = new Date(previousMonthDate.getFullYear(), previousMonthDate.getMonth() + 1, 0).getDate()
    const previousThrough = Math.min(day, daysInPreviousMonth)
    const monthToDate = day < daysInMonth
    const pick = (full, toDate) => (monthToDate ? toDate : full)
    const throughLabel = (through) => `days 1–${through}`
    const previousName = formats.monthName.format(previousMonthDate)

    const convertedThis = { out: value('monthsConvertedOut'), in: value('monthsConvertedIn') }
    const convertedPrev = {
      out: pick(value('previousMonthsConvertedOut'), value('previousMonthsConvertedOutToDate')),
      in: pick(value('previousMonthsConvertedIn'), value('previousMonthsConvertedInToDate')),
    }
    const convertedAvg = {
      out: pick(value('trailingConvertedOutAverage'), value('trailingConvertedOutAverageToDate')),
      in: pick(value('trailingConvertedInAverage'), value('trailingConvertedInAverageToDate')),
    }
    const convertedPrevFull = { out: value('previousMonthsConvertedOut'), in: value('previousMonthsConvertedIn') }
    const convertedAvgFull = { out: value('trailingConvertedOutAverage'), in: value('trailingConvertedInAverage') }
    const convertedText = (totals) => {
      const net = clean(totals.in - totals.out)
      return `${net > 0 ? '+' : net < 0 ? '−' : ''}${money(Math.abs(net), code)}`
    }
    const convertedTitle = (totals) => `out ${money(totals.out, code)} · in ${money(totals.in, code)}`
    const convertedCell = (totals, full, fullLabel, available = true) => ({
      text: available ? convertedText(totals) : '—',
      title: available
        ? [full && fullLabel ? `${fullLabel}: ${convertedTitle(full)}` : '', convertedTitle(totals)].filter(Boolean).join('\n')
        : '',
    })
    const convThis = convertedCell(convertedThis)
    const convPrev = convertedCell(convertedPrev, convertedPrevFull, `${previousName} full month`, months > 0)
    const convAvg = convertedCell(convertedAvg, convertedAvgFull, `${months}-month average (full months)`, months > 0)
    const hasConversions = [convertedThis, convertedPrev, convertedAvg, convertedPrevFull, convertedAvgFull]
      .some((totals) => totals.out > 0 || totals.in > 0)

    return {
      code,
      heading: currency ? currency.code : 'Main',
      accent: currencyColor(code),
      monthName: formats.monthName.format(today),
      spendText: money(spent, code),
      budgetText: budget > 0 ? money(budget, code) : 'no budget',
      remainingText: budget <= 0 ? '—' : money(remaining, code),
      dailyText: budget <= 0 ? '—' : money(remaining >= 0 ? remaining / daysLeft : 0, code),
      remainingOver: budget > 0 && remaining < 0,
      daysLeft,
      spentThis: money(spent, code),
      thisHeader: monthToDate ? `This month (${throughLabel(day)})` : 'This month',
      prevHeader: monthToDate ? `Last month (${throughLabel(previousThrough)})` : 'Last month',
      avgHeader: months > 0 ? (monthToDate ? `${months}-mo avg (${throughLabel(day)})` : `${months}-mo avg`) : '—',
      spentPrev: months > 0 ? money(pick(value('previousMonthsSpend'), value('previousMonthsSpendToDate')), code) : '—',
      spentPrevTitle: months > 0 ? `${previousName} full month: ${money(value('previousMonthsSpend'), code)}` : '',
      spentAvg: months > 0 ? money(pick(value('trailingSpendAverage'), value('trailingSpendAverageToDate')), code) : '—',
      spentAvgTitle: months > 0 ? `${months}-month average (full months): ${money(value('trailingSpendAverage'), code)}` : '',
      earnThis: `+${money(value('monthsIncome'), code)}`,
      earnPrev: months > 0 ? `+${money(pick(value('previousMonthsIncome'), value('previousMonthsIncomeToDate')), code)}` : '—',
      earnPrevTitle: months > 0 ? `${previousName} full month: +${money(value('previousMonthsIncome'), code)}` : '',
      earnAvg: months > 0 ? `+${money(pick(value('trailingIncomeAverage'), value('trailingIncomeAverageToDate')), code)}` : '—',
      earnAvgTitle: months > 0 ? `${months}-month average (full months): +${money(value('trailingIncomeAverage'), code)}` : '',
      convThis,
      convPrev,
      convAvg,
      hasConversions,
      paceText: budget <= 0
        ? ''
        : `${money(Math.abs(paceDelta), code)} ${paceDelta >= 0 ? 'less' : 'more'} than expected`,
      paceClass: paceDelta >= 0 ? 'pace--ok' : 'pace--over',
      progressPct: pct,
      progressAriaText: budget > 0 ? `${Math.round(pct)}% of budget used` : 'No budget set',
      paceMarkerHidden: budget <= 0,
      paceMarkerLeft: `${(paceFraction * 100).toFixed(1)}%`,
      cardClass: cardState(spent, budget),
    }
  })()

  const currencyCards = (data?.currencies || [])
    .filter((currency) => !currency.primary && currency.hasActivity)
    .map((currency) => {
      const code = currency.code
      const budget = number(currency.monthlyBudget)
      const spent = number(currency.monthsSpend)
      const remaining = budget - spent
      const pct = budget > 0 ? Math.min((spent / budget) * 100, 100) : 0
      const convertedParts = []
      if (number(currency.monthsConvertedOut) > 0) {
        convertedParts.push(`−${money(number(currency.monthsConvertedOut), code)}`)
      }
      if (number(currency.monthsConvertedIn) > 0) {
        convertedParts.push(`+${money(number(currency.monthsConvertedIn), code)}`)
      }
      return {
        code,
        color: currencyColor(code),
        spendText: money(spent, code),
        budgetText: budget > 0 ? `of ${money(budget, code)}` : 'no budget',
        pct,
        ariaNow: Math.round(pct),
        ariaText: budget > 0 ? `${Math.round(pct)}% of budget used` : 'No budget set',
        remainingText: budget > 0 ? (remaining >= 0 ? `${money(remaining, code)} left` : `${money(-remaining, code)} over`) : null,
        remainingOver: budget > 0 && remaining < 0,
        earnedText: `+${money(number(currency.monthsIncome), code)} in`,
        convertedText: convertedParts.length ? `${convertedParts.join(' / ')} converted` : null,
        cardClass: cardState(spent, budget),
      }
    })

  const expenses = sortNewestFirst(data?.transactions || [])
  const expensesMeta = expenses.length ? formatCount(expenses.length) : ''

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
        fetchData({ silent: true })
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const openBudget = (code) => budgetDialogRef.current.show(code)
  const addTransaction = () => transactionDialogRef.current.showAdd({ primaryCode: primary ? primary.code : '' })
  const editTransaction = (transaction) => transactionDialogRef.current.showEdit(transaction)
  const importTransactions = () => importDialogRef.current.show()
  const deleteTransaction = (transaction) => deleteDialogRef.current.show(transaction)

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
            <button className={`outline secondary icon-button${spinning ? ' is-spinning' : ''}`} title="Refresh" aria-label="Refresh data" onClick={refreshNow}>
              <RefreshCw size={16} strokeWidth={1.8} />
            </button>
            <ThemeToggle />
          </div>
        </div>
        <div className="app-header__meta">
          <span>{contextLabel}</span>
          <span className="app-header__meta-tools">
            <span className="muted">{updatedLabel}</span>
          </span>
        </div>
      </header>

      <main className="layout">
        <div className="layout__main">
          <section className={`card card--hero ${hero.cardClass}`} aria-labelledby="monthHeading">
            <div className="card__header">
              <h2 className="currency-badge" style={hero.accent ? { '--currency': hero.accent } : undefined}>
                <span id="monthHeading">{hero.heading}</span>
              </h2>
              <span className="card__header-tools">
                <span className="card__context">{hero.monthName}</span>
                <button
                  className="outline secondary icon-button icon-button--small"
                  title="Edit budget"
                  aria-label="Edit budget"
                  disabled={!data}
                  onClick={() => primary && openBudget(primary.code)}
                ><SquarePen size={16} strokeWidth={1.8} /></button>
              </span>
            </div>
            <p className="figure">
              <Breakable id="monthSpend" className="figure__spend" text={hero.spendText} />
              <span className="figure__meta">
                <span className="figure__of">of</span>
                <Breakable id="monthBudget" className="figure__budget" text={hero.budgetText} />
              </span>
            </p>
            <div
              className="progress"
              id="monthProgress"
              role="progressbar"
              aria-valuemin="0"
              aria-valuemax="100"
              aria-valuenow={Math.round(hero.progressPct)}
              aria-valuetext={hero.progressAriaText}
            >
              <div className="progress__fill" style={{ width: `${hero.progressPct.toFixed(1)}%` }}></div>
              <div className="progress__pace" hidden={hero.paceMarkerHidden} style={{ left: hero.paceMarkerLeft }}></div>
            </div>
            <p className={`pace ${hero.paceClass}`}>{hero.paceText}</p>
            <div className="stat-tiles">
              <div className="stat-tile">
                <span className="stat-tile__label">Left</span>
                <Breakable className={`stat-tile__value${hero.remainingOver ? ' is-over' : ''}`} text={hero.remainingText} />
              </div>
              <div className="stat-tile">
                <span className="stat-tile__label">Per day</span>
                <Breakable className="stat-tile__value" text={hero.dailyText} />
              </div>
              <div className="stat-tile">
                <span className="stat-tile__label">Days left</span>
                <span className="stat-tile__value">{hero.daysLeft}</span>
              </div>
            </div>
            <div className="mini-grid mini-grid--primary">
              <span className="mini-grid__label"></span>
              <span className="mini-grid__header">{hero.thisHeader}</span>
              <span className="mini-grid__header">{hero.prevHeader}</span>
              <span className="mini-grid__header">{hero.avgHeader}</span>
              <span className="mini-grid__label">Spent</span>
              <Breakable className="mini-grid__value" text={hero.spentThis} />
              <Breakable className="mini-grid__value" title={hero.spentPrevTitle} text={hero.spentPrev} />
              <Breakable className="mini-grid__value" title={hero.spentAvgTitle} text={hero.spentAvg} />
              <span className="mini-grid__label">Earned</span>
              <Breakable className="mini-grid__value mini-grid__value--in" text={hero.earnThis} />
              <Breakable className="mini-grid__value mini-grid__value--in" title={hero.earnPrevTitle} text={hero.earnPrev} />
              <Breakable className="mini-grid__value mini-grid__value--in" title={hero.earnAvgTitle} text={hero.earnAvg} />
              {hero.hasConversions ? (
                <>
                  <span className="mini-grid__label">Converted</span>
                  <Breakable className="mini-grid__value mini-grid__value--conv" title={hero.convThis.title} text={hero.convThis.text} />
                  <Breakable className="mini-grid__value mini-grid__value--conv" title={hero.convPrev.title} text={hero.convPrev.text} />
                  <Breakable className="mini-grid__value mini-grid__value--conv" title={hero.convAvg.title} text={hero.convAvg.text} />
                </>
              ) : null}
            </div>
          </section>

          <div className="currency-grid" hidden={currencyCards.length === 0}>
            {currencyCards.map((card) => (
              <section className={`currency-card ${card.cardClass}`} key={card.code} aria-label={`${card.code} budget`} style={{ '--currency': card.color }}>
                <div className="currency-card__header">
                  <span className="currency-badge">{card.code}</span>
                  <button
                    className="outline secondary icon-button icon-button--small"
                    title={`Edit ${card.code} budget`}
                    aria-label={`Edit ${card.code} budget`}
                    onClick={() => openBudget(card.code)}
                  ><SquarePen size={16} strokeWidth={1.8} /></button>
                </div>
                <p className="currency-card__figure">
                  <Breakable className="currency-card__spend" text={card.spendText} />
                  <Breakable className="currency-card__budget" text={card.budgetText} />
                </p>
                <div
                  className="progress progress--sm"
                  role="progressbar"
                  aria-valuemin="0"
                  aria-valuemax="100"
                  aria-valuenow={card.ariaNow}
                  aria-valuetext={card.ariaText}
                >
                  <div className="progress__fill" style={{ width: `${card.pct.toFixed(1)}%` }}></div>
                </div>
                <div className="currency-card__meta">
                  {card.remainingText ? (
                    <span className={card.remainingOver ? 'currency-card__over' : ''}>{card.remainingText}</span>
                  ) : null}
                  <span className="currency-card__earned">{card.earnedText}</span>
                </div>
                {card.convertedText ? (
                  <div className="currency-card__converted">{card.convertedText}</div>
                ) : null}
              </section>
            ))}
          </div>

          <section className="card" id="historyCard" aria-labelledby="historyHeading" hidden={historyHidden}>
            <div className="card__header">
              <h2 id="historyHeading">Last 12 months</h2>
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
        </div>

        <div className="layout__side">
          <details className="card" id="expensesCard" open>
            <summary>
              <span>This month</span>
              <span className="muted">{expensesMeta}</span>
            </summary>
            <div className="expenses__actions">
              <button className="outline secondary" hidden={!writable} onClick={importTransactions}>Import</button>
              <button hidden={!writable} onClick={addTransaction}>Add transaction</button>
            </div>
            <TransactionList
              id="expensesList"
              transactions={expenses}
              money={money}
              today={today}
              writable={writable}
              markFuture
              onedit={editTransaction}
              ondelete={deleteTransaction}
            />
            <p className="muted" hidden={expenses.length > 0}>No transactions recorded this month.</p>
          </details>
        </div>
      </main>

      <BudgetDialog ref={budgetDialogRef} data={data} onrefresh={() => fetchData({ silent: true })} />
      <TransactionDialog ref={transactionDialogRef} data={data} today={today} onrefresh={() => fetchData({ silent: true })} />
      <ImportDialog ref={importDialogRef} data={data} today={today} onrefresh={() => fetchData({ silent: true })} />
      <DeleteDialog ref={deleteDialogRef} money={money} onrefresh={() => fetchData({ silent: true })} />

      <Toasts />
    </>
  )
}
