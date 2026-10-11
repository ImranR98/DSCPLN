<script>
  import { onMount } from 'svelte'
  import { getJson, postJson, putJson, formatDateTime, ThemeToggle } from '@dscpln/ui-kit'
  import { BarChart3, RefreshCw, Settings } from 'lucide-svelte'
  import { currencyColor, moneyFor } from './lib/money.js'
  import { currencyAxis, mountChart } from './lib/chart.js'

  let data = $state(null)
  let month = $state(new Date())
  let error = $state('')
  let chartHost = $state(null)
  let chart = null

  let budgetDialog = $state(null) // { currency, monthlyBudget, firstDayBias }
  let txDialog = $state(null) // { id?, date, details, kind, amount, currency, notes, error }

  const iso = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  const monthLabel = $derived(month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }))
  const symbolFor = $derived((code) => data?.currencies?.find((c) => c.code === code)?.symbol ?? null)
  const money = $derived(moneyFor((code) => symbolFor(code)))
  const primary = $derived(data?.currencies?.find((c) => c.primary) ?? data?.currencies?.[0] ?? null)
  const day = $derived(month.getMonth() === new Date().getMonth() && month.getFullYear() === new Date().getFullYear() ? new Date().getDate() : new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate())
  const daysInMonth = $derived(new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate())

  async function refresh() {
    try {
      data = await getJson(`data?date=${iso(month)}`)
      error = ''
    } catch (err) {
      error = err.message
    }
  }

  function shift(delta) {
    month = new Date(month.getFullYear(), month.getMonth() + delta, 1)
    refresh()
  }

  function spentPercent(currency) {
    if (!currency.monthlyBudget) return 0
    return Math.min(100, Math.round((currency.monthsSpend / currency.monthlyBudget) * 100))
  }

  function openBudget(currency) {
    budgetDialog = { currency: currency.code, monthlyBudget: currency.monthlyBudget, firstDayBias: currency.firstDayBias, error: '' }
  }

  async function saveBudget() {
    try {
      await postJson('budget', {
        monthlyBudget: Number(budgetDialog.monthlyBudget),
        firstDayBias: Number(budgetDialog.firstDayBias) || 0,
        currency: budgetDialog.currency,
      })
      budgetDialog = null
      refresh()
    } catch (err) {
      budgetDialog.error = err.message
    }
  }

  function openAdd() {
    txDialog = { date: iso(new Date()), details: '', kind: 'expense', amount: '', currency: primary?.code ?? '', notes: '', error: '' }
  }

  function openEdit(tx) {
    txDialog = {
      id: tx.id,
      date: tx.date,
      details: tx.details ?? '',
      kind: tx.kind === 'income' ? 'income' : 'expense',
      amount: String(tx.kind === 'income' ? tx.moneyIn ?? '' : tx.expenses ?? ''),
      currency: tx.currency,
      notes: tx.notes ?? '',
      error: '',
    }
  }

  async function saveTransaction() {
    const amount = Number(txDialog.amount)
    if (!txDialog.date || !txDialog.details || !Number.isFinite(amount) || amount <= 0) {
      txDialog.error = 'Date, details and a positive amount are required.'
      return
    }
    const body = {
      date: txDialog.date,
      details: txDialog.details,
      moneyIn: txDialog.kind === 'income' ? amount : 0,
      expenses: txDialog.kind === 'expense' ? amount : 0,
      currency: txDialog.currency,
      notes: txDialog.notes,
    }
    try {
      if (txDialog.id) await putJson(`transactions/${encodeURIComponent(txDialog.id)}`, body)
      else await postJson('transactions', body)
      txDialog = null
      refresh()
    } catch (err) {
      txDialog.error = err.message
    }
  }

  async function removeTransaction(tx) {
    if (!confirm(`Delete "${tx.details}"?`)) return
    try {
      await fetch(new URL(`transactions/${encodeURIComponent(tx.id)}`, document.baseURI), { method: 'DELETE' })
      refresh()
    } catch (err) {
      error = err.message
    }
  }

  function moneyIn(tx) {
    return tx.kind === 'income' ? tx.moneyIn : 0
  }

  function moneyOut(tx) {
    return tx.kind === 'income' ? 0 : tx.expenses
  }

  $effect(() => {
    if (!chartHost || !data?.history || !primary) return
    chart?.()
    chart = mountChart(chartHost, {
      type: 'bar',
      data: {
        labels: (data.history ?? []).map((entry) => new Date(entry.year, entry.month - 1, 1).toLocaleDateString(undefined, { month: 'short' })),
        datasets: [
          {
            label: 'Out',
            data: (data.history ?? []).map((entry) => entry.currencies[primary.code]?.spend ?? 0),
            backgroundColor: currencyColor(primary.code),
          },
          {
            label: 'In',
            data: (data.history ?? []).map((entry) => entry.currencies[primary.code]?.income ?? 0),
            backgroundColor: '#16a34a',
          },
        ],
      },
      options: { responsive: true, maintainAspectRatio: false, scales: { y: currencyAxis() } },
    })
  })

  onMount(() => {
    refresh()
    const timer = setInterval(refresh, 60_000)
    return () => clearInterval(timer)
  })
</script>

<header class="app-header container">
  <div class="app-header__top">
    <h1>D<span class="accent">$</span>CPLN <span class="app-name">&middot; Balance XLSX</span></h1>
    <div class="app-header__actions">
      <a role="button" class="secondary" href="insights" title="Insights" aria-label="Insights"><BarChart3 size={16} /></a>
      <a role="button" class="secondary" href="settings" title="API settings" aria-label="API settings"><Settings size={16} /></a>
      <button class="outline secondary" title="Refresh" aria-label="Refresh data" onclick={refresh}><RefreshCw size={16} /></button>
      <ThemeToggle />
    </div>
  </div>
  <p class="app-header__meta">
    <span>{monthLabel}</span>
    <span class="month-nav">
      <button class="outline secondary" aria-label="Previous month" onclick={() => shift(-1)}>&lsaquo;</button>
      <button class="outline secondary" aria-label="Next month" onclick={() => shift(1)}>&rsaquo;</button>
    </span>
  </p>
</header>

<main class="container">
  {#if error}<article class="error">Could not load data: {error}</article>{/if}

  {#if primary}
    <article>
      <header>
        <strong>{primary.code} budget</strong>
        <span>
          <small>Spent {money(primary.monthsSpend, primary.code)} of {primary.monthlyBudget ? money(primary.monthlyBudget, primary.code) : 'no budget'}</small>
          <button class="outline secondary" title="Edit budget" aria-label="Edit budget" onclick={() => openBudget(primary)}>Edit</button>
        </span>
      </header>
      <p class="figure">
        <span id="monthSpend">{money(primary.monthsSpend, primary.code)}</span>
        <small> of <span id="monthBudget">{primary.monthlyBudget ? money(primary.monthlyBudget, primary.code) : '—'}</span></small>
      </p>
      <progress value={spentPercent(primary)} max="100" id="monthProgress"></progress>
      <dl class="tiles">
        <div><dt>Left</dt><dd>{primary.monthlyBudget ? money(primary.monthlyBudget - primary.monthsSpend, primary.code) : '—'}</dd></div>
        <div><dt>Per day</dt><dd>{money(Math.max(0, primary.monthlyBudget - primary.monthsSpend) / Math.max(1, daysInMonth - day), primary.code)}</dd></div>
        <div><dt>Days left</dt><dd>{Math.max(0, daysInMonth - day)}</dd></div>
        <div><dt>Earned</dt><dd class="in">{money(primary.monthsIncome, primary.code)}</dd></div>
      </dl>
      <table>
        <thead><tr><th></th><th>This month</th><th>Last month</th><th>12-mo avg</th></tr></thead>
        <tbody>
          <tr><td>Spent</td><td>{money(primary.monthsSpend, primary.code)}</td><td>{money(primary.previousMonthsSpendToDate, primary.code)}</td><td>{money(primary.trailingSpendAverageToDate, primary.code)}</td></tr>
          <tr><td>Earned</td><td>{money(primary.monthsIncome, primary.code)}</td><td>{money(primary.previousMonthsIncomeToDate, primary.code)}</td><td>{money(primary.trailingIncomeAverageToDate, primary.code)}</td></tr>
        </tbody>
      </table>
    </article>

    {#if data.currencies.length > 1}
      <div class="currency-grid">
        {#each data.currencies.filter((c) => c.code !== primary.code) as currency (currency.code)}
          <article>
            <header>
              <strong>{currency.code}</strong>
              <button class="outline secondary" title="Edit budget" onclick={() => openBudget(currency)}>Edit</button>
            </header>
            <p><small>{money(currency.monthsSpend, currency.code)} of {currency.monthlyBudget ? money(currency.monthlyBudget, currency.code) : 'no budget'}</small></p>
            <progress value={spentPercent(currency)} max="100"></progress>
          </article>
        {/each}
      </div>
    {/if}

    <article>
      <header><strong>Last 12 months · {primary.code}</strong></header>
      <div class="chart-holder" bind:this={chartHost}></div>
    </article>
  {/if}

  <article>
    <header>
      <strong>Transactions · {monthLabel}</strong>
      <button onclick={openAdd}>Add transaction</button>
    </header>
    {#if !data?.transactions?.length}
      <p><small>No transactions this month.</small></p>
    {:else}
      <table>
        <thead><tr><th>Date</th><th>Details</th><th>Category</th><th class="num">Out</th><th class="num">In</th><th>Currency</th><th></th></tr></thead>
        <tbody>
          {#each data.transactions as tx (tx.id)}
            <tr>
              <td>{tx.date}</td>
              <td>{tx.details}{#if tx.notes}<br><small>{tx.notes}</small>{/if}</td>
              <td>{tx.category ?? ''}</td>
              <td class="num out">{moneyOut(tx) ? money(moneyOut(tx), tx.currency) : ''}</td>
              <td class="num in">{moneyIn(tx) ? money(moneyIn(tx), tx.currency) : ''}</td>
              <td>{tx.currency}</td>
              <td class="row-actions">
                <button class="outline secondary" onclick={() => openEdit(tx)}>Edit</button>
                <button class="outline secondary" onclick={() => removeTransaction(tx)}>Delete</button>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  </article>
</main>

{#if budgetDialog}
  <dialog open data-testid="budget-dialog">
    <article>
      <header><strong>Budget · {budgetDialog.currency}</strong></header>
      <label>Monthly budget <input type="number" min="0" step="0.01" value={budgetDialog.monthlyBudget} oninput={(e) => (budgetDialog.monthlyBudget = e.target.value)} /></label>
      <label>First day bias <input type="number" step="0.01" value={budgetDialog.firstDayBias} oninput={(e) => (budgetDialog.firstDayBias = e.target.value)} /></label>
      {#if budgetDialog.error}<p class="out">{budgetDialog.error}</p>{/if}
      <footer>
        <button class="secondary" onclick={() => (budgetDialog = null)}>Cancel</button>
        <button onclick={saveBudget}>Save</button>
      </footer>
    </article>
  </dialog>
{/if}

{#if txDialog}
  <dialog open data-testid="transaction-dialog">
    <article>
      <header><strong>{txDialog.id ? 'Edit transaction' : 'Add transaction'}</strong></header>
      <div class="form-grid">
        <label>Date <input type="date" value={txDialog.date} oninput={(e) => (txDialog.date = e.target.value)} /></label>
        <label>Details <input value={txDialog.details} oninput={(e) => (txDialog.details = e.target.value)} /></label>
        <label>Kind
          <select value={txDialog.kind} onchange={(e) => (txDialog.kind = e.target.value)}>
            <option value="expense">expense</option>
            <option value="income">income</option>
          </select>
        </label>
        <label>Amount <input type="number" min="0" step="0.01" value={txDialog.amount} oninput={(e) => (txDialog.amount = e.target.value)} /></label>
        <label>Currency
          <select value={txDialog.currency} onchange={(e) => (txDialog.currency = e.target.value)}>
            {#each data?.currencies ?? [] as currency}<option value={currency.code}>{currency.code}</option>{/each}
          </select>
        </label>
        <label>Notes <input value={txDialog.notes} oninput={(e) => (txDialog.notes = e.target.value)} /></label>
      </div>
      {#if txDialog.error}<p class="out">{txDialog.error}</p>{/if}
      <footer>
        <button class="secondary" onclick={() => (txDialog = null)}>Cancel</button>
        <button onclick={saveTransaction}>Save</button>
      </footer>
    </article>
  </dialog>
{/if}

<style>
  .app-name {
    font-size: 0.7em;
    font-weight: 500;
    color: var(--pico-muted-color);
  }
  .month-nav button {
    width: auto;
    margin: 0 0.25rem;
  }
  .figure {
    margin: 0;
  }
  .figure > span {
    font-size: 2rem;
    font-weight: 700;
  }
  .tiles {
    display: flex;
    gap: 2rem;
    flex-wrap: wrap;
    margin-block: 0.5rem;
  }
  .tiles dt {
    font-size: 0.8rem;
    color: var(--pico-muted-color);
  }
  .tiles dd {
    margin: 0;
    font-weight: 600;
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
  .currency-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(16rem, 1fr));
    gap: 1rem;
  }
  .chart-holder {
    height: 18rem;
  }
  .row-actions {
    display: flex;
    gap: 0.25rem;
  }
  .row-actions button {
    width: auto;
    margin: 0;
    padding: 0.15rem 0.5rem;
    font-size: 0.8rem;
  }
  dialog article {
    width: min(38rem, 94vw);
  }
  dialog footer {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
  }
  .form-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
    gap: 0.5rem;
  }
</style>
