<script>
  import { onMount } from 'svelte'
  import { getJson, ThemeToggle } from '@dscpln/ui-kit'
  import { ArrowLeft } from 'lucide-svelte'
  import { currencyColor } from './lib/money.js'
  import { currencyAxis, mountChart } from './lib/chart.js'
  import { filterTransactions, categoryTotalsMap, totals, startOfMonth } from './lib/insights-math.js'

  let data = $state(null)
  let currency = $state('')
  let range = $state(defaultRange())
  let transactions = $state([])
  let error = $state('')
  let monthlyHost = $state(null)
  let cumulativeHost = $state(null)
  let monthlyChart = null
  let cumulativeChart = null

  function iso(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  }

  function defaultRange() {
    const end = new Date()
    const start = startOfMonth(end)
    start.setMonth(start.getMonth() - 11)
    return { start: iso(start), end: iso(end) }
  }

  function ytdRange() {
    const end = new Date()
    return { start: iso(new Date(end.getFullYear(), 0, 1)), end: iso(end) }
  }

  const inRange = $derived(filterTransactions(transactions, {
    start: new Date(`${range.start}T00:00:00`),
    end: new Date(`${range.end}T00:00:00`),
    currency: currency || undefined,
  }))

  const previousRange = $derived.by(() => {
    const start = new Date(`${range.start}T00:00:00`)
    const end = new Date(`${range.end}T00:00:00`)
    const length = Math.round((end - start) / 86_400_000) + 1
    const prevEnd = new Date(start)
    prevEnd.setDate(prevEnd.getDate() - 1)
    const prevStart = new Date(prevEnd)
    prevStart.setDate(prevStart.getDate() - (length - 1))
    return { start: prevStart, end: prevEnd }
  })

  const previous = $derived(filterTransactions(transactions, {
    start: previousRange.start,
    end: previousRange.end,
    currency: currency || undefined,
  }))

  const currentTotals = $derived(totals(inRange))
  const previousTotals = $derived(totals(previous))

  const monthly = $derived.by(() => {
    const months = new Map()
    for (const tx of inRange) {
      const key = tx.date.slice(0, 7)
      if (!months.has(key)) months.set(key, { spend: 0, income: 0 })
      const entry = months.get(key)
      if (tx.kind === 'income') entry.income += tx.moneyIn ?? 0
      else entry.spend += tx.expenses ?? 0
    }
    return [...months.entries()].sort(([a], [b]) => (a < b ? -1 : 1))
  })

  const movers = $derived.by(() => {
    const current = categoryTotalsMap(inRange, 'expense')
    const prev = categoryTotalsMap(previous, 'expense')
    return [...new Set([...Object.keys(current), ...Object.keys(prev)])]
      .map((category) => ({ category, delta: (current[category] ?? 0) - (prev[category] ?? 0), current: current[category] ?? 0 }))
      .filter((entry) => Math.abs(entry.delta) >= 0.01)
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
      .slice(0, 12)
  })

  async function load() {
    try {
      data = await getJson(`data?date=${range.end}`)
      if (!currency) currency = (data.currencies.find((c) => c.primary) ?? data.currencies[0])?.code ?? ''
      const result = await getJson(`transactions?start=${range.start}&end=${range.end}`)
      transactions = result.transactions.map((tx) => ({ ...tx, date: new Date(tx.date) }))
      error = ''
    } catch (err) {
      error = err.message
    }
  }

  function applyPreset(preset) {
    range = preset === 'ytd' ? ytdRange() : defaultRange()
    load()
  }

  $effect(() => {
    if (!monthlyHost || !monthly.length) return
    monthlyChart?.()
    monthlyChart = mountChart(monthlyHost, {
      type: 'bar',
      data: {
        labels: monthly.map(([key]) => key),
        datasets: [
          { label: 'Out', data: monthly.map(([, entry]) => entry.spend), backgroundColor: currencyColor(currency) },
          { label: 'In', data: monthly.map(([, entry]) => entry.income), backgroundColor: '#16a34a' },
        ],
      },
      options: { responsive: true, maintainAspectRatio: false, scales: { y: currencyAxis() } },
    })
  })

  $effect(() => {
    if (!cumulativeHost || !monthly.length) return
    let running = 0
    const cumulative = monthly.map(([, entry]) => {
      running += entry.spend
      return running
    })
    cumulativeChart?.()
    cumulativeChart = mountChart(cumulativeHost, {
      type: 'line',
      data: {
        labels: monthly.map(([key]) => key),
        datasets: [{ label: 'Cumulative spend', data: cumulative, borderColor: currencyColor(currency), fill: true, tension: 0.25 }],
      },
      options: { responsive: true, maintainAspectRatio: false, scales: { y: currencyAxis() } },
    })
  })

  onMount(load)
</script>

<header class="app-header container">
  <div class="app-header__top">
    <h1>D<span class="accent">$</span>CPLN <span class="app-name">&middot; Insights</span></h1>
    <div class="app-header__actions">
      <a role="button" class="secondary" href="./"><ArrowLeft size={16} /> Dashboard</a>
      <ThemeToggle />
    </div>
  </div>
</header>

<main class="container">
  {#if error}<article class="error">{error}</article>{/if}

  <article>
    <div class="controls">
      <label>Currency
        <select bind:value={currency} onchange={load}>
          {#each data?.currencies ?? [] as entry}<option value={entry.code}>{entry.code}</option>{/each}
        </select>
      </label>
      <label>From <input type="date" bind:value={range.start} onchange={load} /></label>
      <label>To <input type="date" bind:value={range.end} onchange={load} /></label>
      <button class="secondary" onclick={() => applyPreset('12m')}>Last 12 months</button>
      <button class="secondary" onclick={() => applyPreset('ytd')}>Year to date</button>
    </div>
  </article>

  <div id="insightsContent">
    <dl class="tiles">
      <div><dt>Spent</dt><dd>{currentTotals.spend.toFixed(2)}</dd></div>
      <div><dt>Earned</dt><dd class="in">{currentTotals.income.toFixed(2)}</dd></div>
      <div><dt>Net</dt><dd class={currentTotals.net >= 0 ? 'in' : 'out'}>{currentTotals.net.toFixed(2)}</dd></div>
      <div><dt>Previous spend</dt><dd>{previousTotals.spend.toFixed(2)}</dd></div>
    </dl>

    <article>
      <header><strong>Monthly totals</strong></header>
      <div class="chart-holder" bind:this={monthlyHost}></div>
    </article>

    <article>
      <header><strong>Cumulative spend</strong></header>
      <div class="chart-holder" bind:this={cumulativeHost}></div>
    </article>

    <article>
      <header><strong>Biggest category moves vs previous period</strong></header>
      {#if !movers.length}
        <p><small>No category changes in this range.</small></p>
      {:else}
        <table>
          <thead><tr><th>Category</th><th class="num">This period</th><th class="num">Change</th></tr></thead>
          <tbody>
            {#each movers as mover (mover.category)}
              <tr>
                <td>{mover.category}</td>
                <td class="num">{mover.current.toFixed(2)}</td>
                <td class="num {mover.delta >= 0 ? 'out' : 'in'}">{mover.delta >= 0 ? '+' : ''}{mover.delta.toFixed(2)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
    </article>
  </div>
</main>

<style>
  .app-name {
    font-size: 0.7em;
    font-weight: 500;
    color: var(--pico-muted-color);
  }
  .controls {
    display: flex;
    gap: 1rem;
    flex-wrap: wrap;
    align-items: end;
  }
  .controls button {
    width: auto;
    margin: 0;
  }
  .tiles {
    display: flex;
    gap: 2rem;
    flex-wrap: wrap;
  }
  .tiles dt {
    font-size: 0.8rem;
    color: var(--pico-muted-color);
  }
  .tiles dd {
    margin: 0;
    font-weight: 600;
  }
  .chart-holder {
    height: 18rem;
  }
  table .num {
    text-align: right;
  }
  .in {
    color: var(--pico-ins-color);
  }
  .out {
    color: var(--pico-del-color);
  }
</style>
