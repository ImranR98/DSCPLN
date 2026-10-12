<script>
  import { onMount } from 'svelte'
  import { ChartNoAxesColumn, RefreshCw, SquarePen, Wrench } from 'lucide-svelte'
  import {
    formats,
    startOfDay,
    toIso,
    breakable,
    showToast,
    ThemeToggle,
    Toasts,
  } from '@dscpln/ui-kit'
  import { moneyFor, number, clean, currencyColor } from './lib/money.js'
  import { renderMonthly } from './lib/chart.js'
  import { sortNewestFirst, formatCount } from './lib/transactions.js'
  import { requestJson } from './lib/request.js'
  import TransactionList from './TransactionList.svelte'
  import BudgetDialog from './BudgetDialog.svelte'
  import TransactionDialog from './TransactionDialog.svelte'
  import ImportDialog from './ImportDialog.svelte'
  import DeleteDialog from './DeleteDialog.svelte'

  const REFRESH_STALE_MS = 60 * 1000

  let data = $state(null)
  let today = $state(startOfDay(new Date()))
  let lastFetchAt = $state(0)
  let loading = $state(true)
  let spinning = $state(false)

  let historyHost = $state(null)
  let historyTooltip = $state(null)
  let historyHidden = $state(true)
  let historyRange = $state('')

  let budgetDialog = $state(null)
  let transactionDialog = $state(null)
  let importDialog = $state(null)
  let deleteDialog = $state(null)

  let fetchSequence = 0

  const fractionalCurrencies = $derived(new Set(
    (data?.currencies || []).filter((entry) => entry.fractional).map((entry) => entry.code)))
  const symbols = $derived(new Map(
    (data?.currencies || []).filter((entry) => entry.symbol).map((entry) => [entry.code, entry.symbol])))
  const symbolFor = (code) => symbols.get(code)
  const money = $derived(moneyFor((code) => Boolean(code) && fractionalCurrencies.has(code), symbolFor))

  const primary = $derived((data?.currencies || []).find((currency) => currency.primary) || (data?.currencies || [])[0] || null)
  const writable = $derived(data?.writable !== false)

  const contextLabel = $derived(`Today · ${formats.weekday.format(today)}`)
  const updatedLabel = $derived(lastFetchAt ? `Updated ${formats.time.format(new Date(lastFetchAt))}` : '')

  $effect(() => {
    document.body.classList.toggle('is-loading', !data)
  })

  async function fetchData({ silent = false } = {}) {
    const sequence = ++fetchSequence
    today = startOfDay(new Date())
    if (!data && !silent) loading = true
    try {
      const params = new URLSearchParams({ date: toIso(today) })
      const result = await requestJson(`/data?${params}`)
      if (sequence !== fetchSequence) return
      data = result
      lastFetchAt = Date.now()
    } catch (e) {
      if (sequence === fetchSequence) {
        console.error(e)
        showToast('Could not load data. Check the server logs.', 'error')
      }
    } finally {
      if (sequence === fetchSequence) {
        loading = false
      }
    }
  }

  function refreshNow() {
    spinning = true
    window.setTimeout(() => (spinning = false), 600)
    fetchData({ silent: true })
  }

  function cardState(spent, budget) {
    if (budget <= 0) return 'card--none'
    if (spent >= budget) return 'card--over'
    if (spent / budget >= 0.8) return 'card--warn'
    return 'card--ok'
  }

  const hero = $derived.by(() => {
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
  })

  const currencyCards = $derived.by(() =>
    (data?.currencies || []).filter((currency) => !currency.primary && currency.hasActivity).map((currency) => {
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
    }))

  const expenses = $derived(sortNewestFirst(data?.transactions || []))
  const expensesMeta = $derived(expenses.length ? formatCount(expenses.length) : '')

  $effect(() => {
    if (!historyHost || !historyTooltip || !data) return
    const history = data.history || []
    const codes = (data.currencies || []).map((currency) => currency.code)
    const rendered = renderMonthly(historyHost, historyTooltip, {
      months: history,
      codes,
      money,
      symbolFor,
    })
    historyHidden = !rendered
    if (!rendered) {
      historyRange = ''
      return
    }
    const first = history[0]
    const last = history[history.length - 1]
    historyRange = formats.monthYear.format(new Date(first.year, first.month - 1, 1)) + ' – ' +
      formats.monthYear.format(new Date(last.year, last.month - 1, 1))
  })

  onMount(() => {
    fetchData()
    const onVisibility = () => {
      if (document.visibilityState === 'visible' && Date.now() - lastFetchAt > REFRESH_STALE_MS) {
        fetchData({ silent: true })
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  })

  const openBudget = (code) => budgetDialog.show(code)
  const addTransaction = () => transactionDialog.showAdd({ primaryCode: primary ? primary.code : '' })
  const editTransaction = (transaction) => transactionDialog.showEdit(transaction)
  const importTransactions = () => importDialog.show()
  const deleteTransaction = (transaction) => deleteDialog.show(transaction)
</script>

<header class="app-header">
  <div class="app-header__top">
    <h1>D<span class="accent">$</span>CPLN <span class="app-header__app">⋅ Balance XLSX</span></h1>
    <div class="app-header__actions">
      <a role="button" class="outline secondary icon-button" href="insights" title="Insights" aria-label="Insights">
        <ChartNoAxesColumn size={16} strokeWidth={1.8} />
      </a>
      <a role="button" class="outline secondary icon-button" href="settings" title="API settings" aria-label="API settings">
        <Wrench size={16} strokeWidth={1.8} />
      </a>
      <button class="outline secondary icon-button{spinning ? ' is-spinning' : ''}" title="Refresh" aria-label="Refresh data" onclick={refreshNow}>
        <RefreshCw size={16} strokeWidth={1.8} />
      </button>
      <ThemeToggle />
    </div>
  </div>
  <div class="app-header__meta">
    <span>{contextLabel}</span>
    <span class="app-header__meta-tools">
      <span class="muted">{updatedLabel}</span>
    </span>
  </div>
</header>

<main class="layout">
  <div class="layout__main">
    <section class="card card--hero {hero.cardClass}" aria-labelledby="monthHeading">
      <div class="card__header">
        <h2 class="currency-badge" style={hero.accent ? `--currency: ${hero.accent}` : undefined}>
          <span id="monthHeading">{hero.heading}</span>
        </h2>
        <span class="card__header-tools">
          <span class="card__context">{hero.monthName}</span>
          <button
            class="outline secondary icon-button icon-button--small"
            title="Edit budget"
            aria-label="Edit budget"
            disabled={!data}
            onclick={() => primary && openBudget(primary.code)}
          ><SquarePen size={16} strokeWidth={1.8} /></button>
        </span>
      </div>
      <p class="figure">
        <span id="monthSpend" class="figure__spend" use:breakable={hero.spendText}></span>
        <span class="figure__meta">
          <span class="figure__of">of</span>
          <span id="monthBudget" class="figure__budget" use:breakable={hero.budgetText}></span>
        </span>
      </p>
      <div
        class="progress"
        id="monthProgress"
        role="progressbar"
        aria-valuemin="0"
        aria-valuemax="100"
        aria-valuenow={Math.round(hero.progressPct)}
        aria-valuetext={hero.progressAriaText}
      >
        <div class="progress__fill" style={`width: ${hero.progressPct.toFixed(1)}%`}></div>
        <div class="progress__pace" hidden={hero.paceMarkerHidden} style={`left: ${hero.paceMarkerLeft}`}></div>
      </div>
      <p class="pace {hero.paceClass}">{hero.paceText}</p>
      <div class="stat-tiles">
        <div class="stat-tile">
          <span class="stat-tile__label">Left</span>
          <span class="stat-tile__value" class:is-over={hero.remainingOver} use:breakable={hero.remainingText}></span>
        </div>
        <div class="stat-tile">
          <span class="stat-tile__label">Per day</span>
          <span class="stat-tile__value" use:breakable={hero.dailyText}></span>
        </div>
        <div class="stat-tile">
          <span class="stat-tile__label">Days left</span>
          <span class="stat-tile__value">{hero.daysLeft}</span>
        </div>
      </div>
      <div class="mini-grid mini-grid--primary">
        <span class="mini-grid__label"></span>
        <span class="mini-grid__header">{hero.thisHeader}</span>
        <span class="mini-grid__header">{hero.prevHeader}</span>
        <span class="mini-grid__header">{hero.avgHeader}</span>
        <span class="mini-grid__label">Spent</span>
        <span class="mini-grid__value" use:breakable={hero.spentThis}></span>
        <span class="mini-grid__value" title={hero.spentPrevTitle} use:breakable={hero.spentPrev}></span>
        <span class="mini-grid__value" title={hero.spentAvgTitle} use:breakable={hero.spentAvg}></span>
        <span class="mini-grid__label">Earned</span>
        <span class="mini-grid__value mini-grid__value--in" use:breakable={hero.earnThis}></span>
        <span class="mini-grid__value mini-grid__value--in" title={hero.earnPrevTitle} use:breakable={hero.earnPrev}></span>
        <span class="mini-grid__value mini-grid__value--in" title={hero.earnAvgTitle} use:breakable={hero.earnAvg}></span>
        {#if hero.hasConversions}
          <span class="mini-grid__label">Converted</span>
          <span class="mini-grid__value mini-grid__value--conv" title={hero.convThis.title} use:breakable={hero.convThis.text}></span>
          <span class="mini-grid__value mini-grid__value--conv" title={hero.convPrev.title} use:breakable={hero.convPrev.text}></span>
          <span class="mini-grid__value mini-grid__value--conv" title={hero.convAvg.title} use:breakable={hero.convAvg.text}></span>
        {/if}
      </div>
    </section>

    <div class="currency-grid" hidden={currencyCards.length === 0}>
      {#each currencyCards as card (card.code)}
        <section class="currency-card {card.cardClass}" aria-label={`${card.code} budget`} style={`--currency: ${card.color}`}>
          <div class="currency-card__header">
            <span class="currency-badge">{card.code}</span>
            <button
              class="outline secondary icon-button icon-button--small"
              title={`Edit ${card.code} budget`}
              aria-label={`Edit ${card.code} budget`}
              onclick={() => openBudget(card.code)}
            ><SquarePen size={16} strokeWidth={1.8} /></button>
          </div>
          <p class="currency-card__figure">
            <span class="currency-card__spend" use:breakable={card.spendText}></span>
            <span class="currency-card__budget" use:breakable={card.budgetText}></span>
          </p>
          <div
            class="progress progress--sm"
            role="progressbar"
            aria-valuemin="0"
            aria-valuemax="100"
            aria-valuenow={card.ariaNow}
            aria-valuetext={card.ariaText}
          >
            <div class="progress__fill" style={`width: ${card.pct.toFixed(1)}%`}></div>
          </div>
          <div class="currency-card__meta">
            {#if card.remainingText}
              <span class={card.remainingOver ? 'currency-card__over' : ''}>{card.remainingText}</span>
            {/if}
            <span class="currency-card__earned">{card.earnedText}</span>
          </div>
          {#if card.convertedText}
            <div class="currency-card__converted">{card.convertedText}</div>
          {/if}
        </section>
      {/each}
    </div>

    <section class="card" id="historyCard" aria-labelledby="historyHeading" hidden={historyHidden}>
      <div class="card__header">
        <h2 id="historyHeading">Last 12 months</h2>
        <span class="card__header-tools">
          <span class="card__context">{historyRange}</span>
          <span class="chart-legend">
            <span class="chart-legend__item">
              <span class="chart-legend__swatch"></span>Out
            </span>
            <span class="chart-legend__item">
              <span class="chart-legend__swatch chart-legend__swatch--in"></span>In
            </span>
          </span>
        </span>
      </div>
      <div bind:this={historyHost} class="chart-host"></div>
      <div bind:this={historyTooltip} class="chart-tooltip" hidden></div>
    </section>
  </div>

  <div class="layout__side">
    <details class="card" id="expensesCard" open>
      <summary>
        <span>This month</span>
        <span class="muted">{expensesMeta}</span>
      </summary>
      <div class="expenses__actions">
        <button class="outline secondary" hidden={!writable} onclick={importTransactions}>Import</button>
        <button hidden={!writable} onclick={addTransaction}>Add transaction</button>
      </div>
      <TransactionList
        id="expensesList"
        transactions={expenses}
        {money}
        {today}
        {writable}
        markFuture
        onedit={editTransaction}
        ondelete={deleteTransaction}
      />
      <p class="muted" hidden={expenses.length > 0}>No transactions recorded this month.</p>
    </details>
  </div>
</main>

<BudgetDialog bind:this={budgetDialog} {data} onrefresh={() => fetchData({ silent: true })} />
<TransactionDialog bind:this={transactionDialog} {data} {today} onrefresh={() => fetchData({ silent: true })} />
<ImportDialog bind:this={importDialog} {data} {today} onrefresh={() => fetchData({ silent: true })} />
<DeleteDialog bind:this={deleteDialog} {money} onrefresh={() => fetchData({ silent: true })} />

<Toasts />
