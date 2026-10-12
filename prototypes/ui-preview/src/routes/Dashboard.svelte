<script>
  import { onMount } from 'svelte'
  import Ellipsis from '@lucide/svelte/icons/ellipsis'
  import Plus from '@lucide/svelte/icons/plus'
  import Upload from '@lucide/svelte/icons/upload'
  import { scaleBand } from 'd3-scale'
  import { BarChart } from 'layerchart'
  import { toast } from 'svelte-sonner'
  import * as Card from '$lib/components/ui/card/index.js'
  import { Button } from '$lib/components/ui/button/index.js'
  import { Badge } from '$lib/components/ui/badge/index.js'
  import { Progress } from '$lib/components/ui/progress/index.js'
  import * as Dialog from '$lib/components/ui/dialog/index.js'
  import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js'
  import * as Select from '$lib/components/ui/select/index.js'
  import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js'
  import * as Popover from '$lib/components/ui/popover/index.js'
  import * as Command from '$lib/components/ui/command/index.js'
  import { Input } from '$lib/components/ui/input/index.js'
  import { Label } from '$lib/components/ui/label/index.js'
  import { Textarea } from '$lib/components/ui/textarea/index.js'
  import { Alert, AlertDescription, AlertTitle } from '$lib/components/ui/alert/index.js'
  import * as Table from '$lib/components/ui/table/index.js'
  import * as Chart from '$lib/components/ui/chart/index.js'
  import { moneyFor, currencyColor, number } from '@balance/money.js'
  import { requestJson } from '$lib/api.js'
  import { dateLabel, parseIso, sortNewestFirst, formatCount } from '$lib/tx.js'

  const compact = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 })
  const monthShort = new Intl.DateTimeFormat(undefined, { month: 'short' })
  const monthName = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' })
  const monthYear = new Intl.DateTimeFormat(undefined, { month: 'short', year: 'numeric' })
  const updatedAt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' })
  const today = new Date()

  let data = $state(null)
  let lastFetchAt = $state(0)

  let fractionalCurrencies = $state(new Set())
  let symbols = $state(new Map())
  const money = $derived(moneyFor((code) => fractionalCurrencies.has(code), (code) => symbols.get(code)))
  const primary = $derived(data?.currencies?.find((entry) => entry.primary) ?? data?.currencies?.[0] ?? null)
  const writable = $derived(data?.writable !== false)

  async function fetchData() {
    const result = await requestJson(`/data?date=${iso(today)}`)
    data = result
    fractionalCurrencies = new Set((result.currencies || []).filter((entry) => entry.fractional).map((entry) => entry.code))
    symbols = new Map((result.currencies || []).filter((entry) => entry.symbol).map((entry) => [entry.code, entry.symbol]))
    lastFetchAt = Date.now()
  }

  const iso = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`

  const hero = $derived.by(() => {
    if (!primary) return null
    const code = primary.code
    const budget = number(primary.monthlyBudget)
    const spent = number(primary.monthsSpend)
    const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate()
    const day = today.getDate()
    const daysLeft = Math.max(1, daysInMonth - day + 1)
    const expected = number(primary.monthsExpectedSpend) || budget * (day / daysInMonth)
    const remaining = budget - spent
    const pace = expected - spent
    return {
      code,
      month: monthName.format(today),
      spent: money(spent, code),
      budget: budget > 0 ? money(budget, code) : 'no budget',
      remaining: budget > 0 ? money(remaining, code) : '—',
      daily: budget > 0 ? money(remaining >= 0 ? remaining / daysLeft : 0, code) : '—',
      daysLeft,
      earned: `+${money(number(primary.monthsIncome), code)}`,
      progress: budget > 0 ? Math.min((spent / budget) * 100, 100) : 0,
      pace: budget <= 0 ? null : `${money(Math.abs(pace), code)} ${pace >= 0 ? 'less' : 'more'} than expected`,
      paceOk: pace >= 0,
      over: budget > 0 && remaining < 0,
    }
  })

  const comparison = $derived.by(() => {
    if (!primary) return []
    const code = primary.code
    const value = (key) => number(primary[key])
    const monthToDate = today.getDate() < new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate()
    const pick = (full, toDate) => (monthToDate ? toDate : full)
    return [
      { label: 'Spent', current: money(value('monthsSpend'), code), prev: money(pick(value('previousMonthsSpend'), value('previousMonthsSpendToDate')), code), avg: money(pick(value('trailingSpendAverage'), value('trailingSpendAverageToDate')), code) },
      { label: 'Earned', current: `+${money(value('monthsIncome'), code)}`, prev: `+${money(pick(value('previousMonthsIncome'), value('previousMonthsIncomeToDate')), code)}`, avg: `+${money(pick(value('trailingIncomeAverage'), value('trailingIncomeAverageToDate')), code)}` },
    ]
  })

  const otherCurrencies = $derived((data?.currencies || []).filter((currency) => !currency.primary && currency.hasActivity))
  const expenses = $derived(sortNewestFirst(data?.transactions || []))

  const monthLabel = (entry) => {
    const base = monthShort.format(new Date(entry.year, entry.month - 1, 1))
    const label = entry.month === 1 ? `${base} '${String(entry.year).slice(-2)}` : base
    return entry.partial ? `${label}*` : label
  }

  const monthlyFor = (code) => (data?.history || []).map((entry) => ({
    label: monthLabel(entry),
    out: number((entry.currencies[code] || {}).spend),
    in: number((entry.currencies[code] || {}).income),
  }))

  const chartConfig = (code) => ({
    out: { label: 'Out', color: currencyColor(code) || 'var(--chart-1)' },
    in: { label: 'In', color: 'var(--chart-2)' },
  })

  const historyRange = $derived.by(() => {
    const history = data?.history || []
    if (!history.length) return ''
    const first = history[0]
    const last = history[history.length - 1]
    return `${monthYear.format(new Date(first.year, first.month - 1, 1))} – ${monthYear.format(new Date(last.year, last.month - 1, 1))}`
  })

  /* ---------- Details suggestions (popover + command) ---------- */

  let suggestionOpen = $state(false)
  let suggestionQuery = $state('')
  let suggestions = $state([])
  let suggestionTimer = null
  let suggestionSequence = 0

  function scheduleSuggestions(query, kind) {
    window.clearTimeout(suggestionTimer)
    suggestionTimer = window.setTimeout(async () => {
      const sequence = ++suggestionSequence
      try {
        const params = new URLSearchParams({ q: query, kind })
        const result = await requestJson(`/details-suggestions?${params}`)
        if (sequence !== suggestionSequence) return
        suggestions = result.suggestions || []
        suggestionOpen = suggestions.length > 0 && txOpen
      } catch {
        // best-effort
      }
    }, 150)
  }

  /* ---------- Budget dialog ---------- */

  let budgetOpen = $state(false)
  let budgetCurrency = $state(null)
  let budgetMonthly = $state('')
  let budgetBias = $state('')
  const budgetError = $derived.by(() => {
    const monthly = Number.parseFloat(budgetMonthly)
    const bias = Number.parseFloat(budgetBias)
    if (!Number.isFinite(monthly) || monthly < 0) return 'Monthly budget must be 0 or greater.'
    if (!Number.isFinite(bias) || bias < 0) return 'First day bias must be 0 or greater.'
    if (bias > monthly) return 'First day bias cannot be greater than the monthly budget.'
    return ''
  })

  function openBudget(currency) {
    budgetCurrency = currency.code
    budgetMonthly = String(number(currency.monthlyBudget))
    budgetBias = String(number(currency.firstDayBias))
    budgetOpen = true
  }

  async function saveBudget() {
    if (budgetError) return
    try {
      await requestJson('/budget', {
        method: 'POST',
        body: JSON.stringify({
          monthlyBudget: Number.parseFloat(budgetMonthly),
          firstDayBias: Number.parseFloat(budgetBias),
          currency: budgetCurrency,
        }),
      })
      budgetOpen = false
      toast.success('Budget updated')
      await fetchData()
    } catch (err) {
      toast.error(err.message)
    }
  }

  /* ---------- Transaction dialog ---------- */

  let txOpen = $state(false)
  let txEditing = $state(null)
  let txKind = $state('expense')
  let txAmount = $state('')
  let txDetails = $state('')
  let txDate = $state('')
  let txCategory = $state('')
  let txCurrency = $state('')
  let txNotes = $state('')
  let categoryTouched = false
  let categoryHint = $state('')
  let savingTx = $state(false)

  const categoryGroups = $derived((data?.categories || []).filter((group) =>
    txKind === 'income' ? group.group === 'Money In' || group.group === 'Conversions' : group.group !== 'Money In'))
  const allCategories = $derived(categoryGroups.flatMap((group) => group.categories))

  $effect(() => {
    if (txCategory && !allCategories.includes(txCategory)) txCategory = ''
  })

  function openAdd() {
    txEditing = null
    txKind = 'expense'
    txAmount = ''
    txDetails = ''
    txNotes = ''
    txCategory = ''
    txCurrency = primary?.code ?? ''
    txDate = iso(today)
    categoryTouched = false
    categoryHint = ''
    suggestions = []
    txOpen = true
  }

  function openEdit(transaction) {
    txEditing = transaction
    txKind = transaction.kind === 'income' ? 'income' : 'expense'
    txAmount = String(transaction.kind === 'income' ? transaction.moneyIn : transaction.expenses)
    txDetails = transaction.details || ''
    txDate = transaction.date
    txCategory = transaction.category || ''
    txCurrency = transaction.currency || ''
    txNotes = transaction.notes || ''
    categoryTouched = true
    categoryHint = ''
    suggestions = []
    txOpen = true
  }

  function pickSuggestion(suggestion) {
    txDetails = suggestion.details
    if (!categoryTouched && suggestion.category && allCategories.includes(suggestion.category)) {
      txCategory = suggestion.category
      categoryTouched = true
    }
    suggestionOpen = false
    categoryHint = `Suggested: ${suggestion.category ?? '—'}`
  }

  async function saveTransaction() {
    if (!txDate || !txDetails || !Number.isFinite(Number.parseFloat(txAmount))) {
      toast.error('Date, details and an amount are required.')
      return
    }
    savingTx = true
    try {
      await requestJson(txEditing ? `/transactions/${encodeURIComponent(txEditing.id)}` : '/transactions', {
        method: txEditing ? 'PUT' : 'POST',
        body: JSON.stringify({
          kind: txKind,
          amount: Number.parseFloat(txAmount),
          details: txDetails,
          date: txDate,
          category: txCategory,
          currency: txCurrency,
          notes: txNotes,
        }),
      })
      txOpen = false
      toast.success(txEditing ? 'Transaction updated' : 'Transaction added')
      await fetchData()
    } catch (err) {
      if (err.status === 409) {
        txOpen = false
        toast.error(err.message)
        await fetchData()
      } else {
        toast.error(err.message)
      }
    } finally {
      savingTx = false
    }
  }

  /* ---------- Import dialog ---------- */

  let importOpen = $state(false)
  let importText = $state('')
  let importConfirmed = $state(false)
  let importError = $state('')

  const importHint = $derived.by(() => {
    const columns = data?.transactionColumns?.length ? data.transactionColumns : ['Date', 'Details', 'Money In', 'Expenses', 'Currency', 'Type', 'Notes']
    return `One transaction per line, tab-separated: ${columns.join(' · ')}.`
  })

  const importPastCount = $derived.by(() => {
    const dateIndex = Math.max(0, (data?.transactionColumns || ['Date']).indexOf('Date'))
    const monthStart = iso(new Date(today.getFullYear(), today.getMonth(), 1))
    let count = 0
    for (const line of importText.split(/\r?\n/)) {
      if (!line.trim()) continue
      const value = (line.split('\t')[dateIndex] || '').trim()
      if (/^\d{4}-\d{2}-\d{2}$/.test(value) && value < monthStart) count += 1
    }
    return count
  })

  async function submitImport() {
    importError = ''
    if (!importText.trim()) {
      importError = 'Paste at least one transaction line.'
      return
    }
    if (importPastCount > 0 && !importConfirmed) {
      importConfirmed = true
      return
    }
    try {
      const result = await requestJson('/transactions/import', { method: 'POST', body: JSON.stringify({ text: importText }) })
      importOpen = false
      toast.success(`Imported ${result.imported} ${result.imported === 1 ? 'transaction' : 'transactions'}`)
      await fetchData()
    } catch (err) {
      importError = err.message
    }
  }

  /* ---------- Delete dialog ---------- */

  let deleteOpen = $state(false)
  let deleteTarget = $state(null)
  const deleteDescription = $derived(deleteTarget
    ? `${money(deleteTarget.kind === 'income' ? deleteTarget.moneyIn : deleteTarget.expenses, deleteTarget.currency)} · ${deleteTarget.details || 'No details'}`
    : '')

  async function confirmDelete() {
    try {
      await requestJson(`/transactions/${encodeURIComponent(deleteTarget.id)}`, { method: 'DELETE' })
      deleteOpen = false
      toast.success('Transaction deleted')
      await fetchData()
    } catch (err) {
      deleteOpen = false
      toast.error(err.message)
      await fetchData()
    }
  }

  onMount(fetchData)
</script>

<div class="flex flex-col gap-6">
  <div class="flex flex-wrap items-end justify-between gap-3">
    <div>
      <h1 class="text-2xl font-semibold tracking-tight">Balance</h1>
      <p class="mt-1 text-sm text-muted-foreground">
        {monthName.format(today)}
        {#if lastFetchAt}· updated {updatedAt.format(new Date(lastFetchAt))}{/if}
      </p>
    </div>
    {#if writable}
      <div class="flex items-center gap-2">
        <Button variant="outline" size="sm" onclick={() => { importOpen = true; importText = ''; importConfirmed = false; importError = '' }}>
          <Upload /> Import
        </Button>
        <Button size="sm" onclick={openAdd}><Plus /> Add transaction</Button>
      </div>
    {/if}
  </div>

  {#if hero}
    <Card.Root>
      <Card.Header>
        <div class="flex items-center gap-2">
          <Badge class="border-transparent text-white" style={`background: ${currencyColor(hero.code)}`}>{hero.code}</Badge>
          <span class="text-sm text-muted-foreground">{hero.month}</span>
        </div>
        <Card.Action>
          <Button variant="ghost" size="icon-sm" aria-label="Edit budget" onclick={() => openBudget(primary)}>
            <Ellipsis />
          </Button>
        </Card.Action>
      </Card.Header>
      <Card.Content class="flex flex-col gap-4">
        <div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span class="text-4xl font-semibold tracking-tight tabular-nums">{hero.spent}</span>
          <span class="text-sm text-muted-foreground">of {hero.budget}</span>
        </div>
        <div class="flex flex-col gap-2">
          <Progress value={hero.progress} class="h-2" />
          {#if hero.pace}
            <p class="text-xs font-medium {hero.paceOk ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}">{hero.pace}</p>
          {/if}
        </div>
        <div class="grid gap-3 sm:grid-cols-4">
          <div class="rounded-lg border bg-muted/40 p-3">
            <div class="text-xs text-muted-foreground">Left</div>
            <div class="mt-0.5 text-sm font-semibold tabular-nums {hero.over ? 'text-red-600 dark:text-red-400' : ''}">{hero.remaining}</div>
          </div>
          <div class="rounded-lg border bg-muted/40 p-3">
            <div class="text-xs text-muted-foreground">Per day</div>
            <div class="mt-0.5 text-sm font-semibold tabular-nums">{hero.daily}</div>
          </div>
          <div class="rounded-lg border bg-muted/40 p-3">
            <div class="text-xs text-muted-foreground">Days left</div>
            <div class="mt-0.5 text-sm font-semibold tabular-nums">{hero.daysLeft}</div>
          </div>
          <div class="rounded-lg border bg-muted/40 p-3">
            <div class="text-xs text-muted-foreground">Earned</div>
            <div class="mt-0.5 text-sm font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">{hero.earned}</div>
          </div>
        </div>
      </Card.Content>
    </Card.Root>

    <Card.Root>
      <Card.Header>
        <Card.Title>How it compares</Card.Title>
        <Card.Description>Figures through day {today.getDate()} of each period.</Card.Description>
      </Card.Header>
      <Card.Content>
        <Table.Root>
          <Table.Header>
            <Table.Row>
              <Table.Head></Table.Head>
              <Table.Head class="text-right">This month</Table.Head>
              <Table.Head class="text-right">Last month</Table.Head>
              <Table.Head class="text-right">12-mo avg</Table.Head>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {#each comparison as row (row.label)}
              <Table.Row>
                <Table.Cell class="text-muted-foreground">{row.label}</Table.Cell>
                <Table.Cell class="text-right font-medium tabular-nums">{row.current}</Table.Cell>
                <Table.Cell class="text-right tabular-nums">{row.prev}</Table.Cell>
                <Table.Cell class="text-right tabular-nums">{row.avg}</Table.Cell>
              </Table.Row>
            {/each}
          </Table.Body>
        </Table.Root>
      </Card.Content>
    </Card.Root>
  {/if}

  {#if otherCurrencies.length}
    <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {#each otherCurrencies as currency (currency.code)}
        <Card.Root>
          <Card.Header>
            <Badge class="border-transparent text-white w-fit" style={`background: ${currencyColor(currency.code)}`}>{currency.code}</Badge>
            <Card.Action>
              <Button variant="ghost" size="icon-sm" aria-label={`Edit ${currency.code} budget`} onclick={() => openBudget(currency)}>
                <Ellipsis />
              </Button>
            </Card.Action>
          </Card.Header>
          <Card.Content class="flex flex-col gap-3">
            <div class="flex items-baseline gap-2">
              <span class="text-2xl font-semibold tabular-nums">{money(number(currency.monthsSpend), currency.code)}</span>
              <span class="text-xs text-muted-foreground">
                {number(currency.monthlyBudget) > 0 ? `of ${money(number(currency.monthlyBudget), currency.code)}` : 'no budget'}
              </span>
            </div>
            <Progress value={number(currency.monthlyBudget) > 0 ? Math.min((number(currency.monthsSpend) / number(currency.monthlyBudget)) * 100, 100) : 0} class="h-1.5" />
            <div class="flex items-center justify-between text-xs text-muted-foreground">
              <span>{money(number(currency.monthsIncome), currency.code)} earned</span>
              {#if number(currency.monthsConvertedOut) > 0 || number(currency.monthsConvertedIn) > 0}
                <span>converted {money(number(currency.monthsConvertedOut), currency.code)} / {money(number(currency.monthsConvertedIn), currency.code)}</span>
              {/if}
            </div>
          </Card.Content>
        </Card.Root>
      {/each}
    </div>
  {/if}

  <Card.Root>
    <Card.Header>
      <Card.Title>Last 12 months</Card.Title>
      <Card.Description>{historyRange}</Card.Description>
    </Card.Header>
    <Card.Content class="grid gap-6 md:grid-cols-2">
      {#each (data?.currencies || []) as currency (currency.code)}
        <div class="flex flex-col gap-2">
          <div class="flex items-center justify-between">
            <span class="text-xs font-medium">{currency.code}</span>
            <span class="flex items-center gap-3 text-xs text-muted-foreground">
              <span class="flex items-center gap-1.5"><span class="size-2 rounded-[3px]" style={`background: ${currencyColor(currency.code)}`}></span>Out</span>
              <span class="flex items-center gap-1.5"><span class="size-2 rounded-[3px] bg-chart-2"></span>In</span>
            </span>
          </div>
          <Chart.Container config={chartConfig(currency.code)} class="aspect-auto h-44">
            <BarChart
              data={monthlyFor(currency.code)}
              x="label"
              xScale={scaleBand().padding(0.25)}
              axis="x"
              series={[
                { key: 'out', label: 'Out', color: currencyColor(currency.code) || 'var(--chart-1)' },
                { key: 'in', label: 'In', color: 'var(--chart-2)' },
              ]}
              x1Scale={scaleBand().paddingInner(0.2)}
              seriesLayout="group"
              props={{ xAxis: { tickSpacing: 50, format: (value) => value }, yAxis: { format: (value) => compact.format(value) } }}
            >
              {#snippet tooltip()}
                <Chart.Tooltip
                  formatter={({ value, name }) => `${name}: ${money(value, currency.code)}`}
                  labelFormatter={(label2) => label2}
                />
              {/snippet}
            </BarChart>
          </Chart.Container>
        </div>
      {/each}
    </Card.Content>
  </Card.Root>

  <Card.Root>
    <Card.Header>
      <Card.Title>Transactions</Card.Title>
      <Card.Description>{expenses.length ? formatCount(expenses.length) : 'This month'}</Card.Description>
    </Card.Header>
    <Card.Content class="flex flex-col">
      {#if expenses.length === 0}
        <p class="py-6 text-center text-sm text-muted-foreground">No transactions recorded this month.</p>
      {:else}
        {#each expenses as transaction (transaction.id)}
          <div class="flex items-center justify-between gap-3 border-b py-2.5 last:border-b-0">
            <div class="min-w-0">
              <div class="truncate text-sm font-medium">{transaction.details || '—'}</div>
              <div class="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                <span>{parseIso(transaction.date) ? dateLabel(parseIso(transaction.date), today) : transaction.date}</span>
                <Badge variant="outline">{transaction.currency}</Badge>
                {#if transaction.category}<Badge variant="secondary">{transaction.category}</Badge>{/if}
                {#if transaction.notes}<span class="truncate">{transaction.notes}</span>{/if}
              </div>
            </div>
            <div class="flex items-center gap-1">
              <span class="text-sm font-medium tabular-nums {transaction.kind === 'income' ? 'text-emerald-600 dark:text-emerald-400' : ''}">
                {transaction.kind === 'income' ? '+' : ''}{money(transaction.kind === 'income' ? transaction.moneyIn : transaction.expenses, transaction.currency)}
              </span>
              {#if writable}
                <DropdownMenu.Root>
                  <DropdownMenu.Trigger>
                    {#snippet child({ props })}
                      <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${transaction.details || 'transaction'}`} {...props}>
                        <Ellipsis />
                      </Button>
                    {/snippet}
                  </DropdownMenu.Trigger>
                  <DropdownMenu.Content align="end">
                    <DropdownMenu.Item onclick={() => openEdit(transaction)}>Edit</DropdownMenu.Item>
                    <DropdownMenu.Item variant="destructive" onclick={() => { deleteTarget = transaction; deleteOpen = true }}>Delete</DropdownMenu.Item>
                  </DropdownMenu.Content>
                </DropdownMenu.Root>
              {/if}
            </div>
          </div>
        {/each}
      {/if}
    </Card.Content>
  </Card.Root>
</div>

<!-- Budget dialog -->
<Dialog.Root bind:open={budgetOpen}>
  <Dialog.Content>
    <Dialog.Header>
      <Dialog.Title>Edit budget</Dialog.Title>
      <Dialog.Description>Editing the {budgetCurrency} budget.</Dialog.Description>
    </Dialog.Header>
    <div class="grid gap-4">
      <div class="grid gap-2">
        <Label for="budget-monthly">Monthly budget</Label>
        <Input id="budget-monthly" type="number" step="0.01" min="0" bind:value={budgetMonthly} />
      </div>
      <div class="grid gap-2">
        <Label for="budget-bias">First day bias</Label>
        <Input id="budget-bias" type="number" step="0.01" min="0" bind:value={budgetBias} />
        <p class="text-xs text-muted-foreground">Extra amount assigned to the first day of the month.</p>
      </div>
      {#if budgetError}
        <Alert variant="destructive">
          <AlertDescription>{budgetError}</AlertDescription>
        </Alert>
      {/if}
    </div>
    <Dialog.Footer>
      <Button variant="outline" onclick={() => (budgetOpen = false)}>Cancel</Button>
      <Button disabled={Boolean(budgetError)} onclick={saveBudget}>Save</Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>

<!-- Transaction dialog -->
<Dialog.Root bind:open={txOpen} onOpenChange={(open) => { if (!open) suggestionOpen = false }}>
  <Dialog.Content class="sm:max-w-xl">
    <Dialog.Header>
      <Dialog.Title>{txEditing ? 'Edit transaction' : 'Add transaction'}</Dialog.Title>
      <Dialog.Description>Details suggest a category as you type.</Dialog.Description>
    </Dialog.Header>
    <div class="grid gap-4">
      <div class="grid gap-3 sm:grid-cols-2">
        <div class="grid gap-2">
          <Label for="tx-amount">Amount</Label>
          <Input id="tx-amount" type="number" step="any" min="0" bind:value={txAmount} />
        </div>
        <div class="grid gap-2">
          <Label for="tx-date">Date</Label>
          <Input id="tx-date" type="date" bind:value={txDate} />
        </div>
      </div>
      <div class="grid gap-2">
        <Label for="tx-details">Details</Label>
        <Popover.Root bind:open={suggestionOpen}>
          <Popover.Trigger>
            {#snippet child({ props })}
              <Input
                {...props}
                id="tx-details"
                type="text"
                placeholder="What was it for?"
                bind:value={txDetails}
                oninput={(event) => scheduleSuggestions(event.target.value, txKind)}
              />
            {/snippet}
          </Popover.Trigger>
          <Popover.Content class="w-(--bits-popover-anchor-width) p-0" align="start" onOpenAutoFocus={(event) => event.preventDefault()}>
            <Command.Root shouldFilter={false}>
              <Command.List>
                <Command.Empty>No suggestions.</Command.Empty>
                {#each suggestions as suggestion (suggestion.details)}
                  <Command.Item value={suggestion.details} onSelect={() => pickSuggestion(suggestion)}>
                    <span class="flex-1 truncate">{suggestion.details}</span>
                    <span class="text-xs text-muted-foreground">{suggestion.category}</span>
                  </Command.Item>
                {/each}
              </Command.List>
            </Command.Root>
          </Popover.Content>
        </Popover.Root>
        {#if categoryHint}<p class="text-xs text-muted-foreground">{categoryHint}</p>{/if}
      </div>
      <div class="grid gap-3 sm:grid-cols-3">
        <div class="grid gap-2">
          <Label>Kind</Label>
          <Select.Root type="single" bind:value={txKind} items={[{ value: 'expense', label: 'Expense' }, { value: 'income', label: 'Income' }]}>
            <Select.Trigger class="w-full"><Select.Value placeholder="Kind" /></Select.Trigger>
            <Select.Content>
              <Select.Item value="expense" label="Expense">Expense</Select.Item>
              <Select.Item value="income" label="Income">Income</Select.Item>
            </Select.Content>
          </Select.Root>
        </div>
        <div class="grid gap-2">
          <Label>Category</Label>
          <Select.Root type="single" bind:value={txCategory} items={allCategories.map((category) => ({ value: category, label: category }))} onOpenChange={(open) => { if (open) categoryTouched = true }}>
            <Select.Trigger class="w-full"><Select.Value placeholder="Select a category" /></Select.Trigger>
            <Select.Content>
              {#each categoryGroups as group (group.group)}
                <Select.Group>
                  <Select.GroupHeading>{group.group}</Select.GroupHeading>
                  {#each group.categories as category (category)}
                    <Select.Item value={category} label={category}>{category}</Select.Item>
                  {/each}
                </Select.Group>
              {/each}
            </Select.Content>
          </Select.Root>
        </div>
        <div class="grid gap-2">
          <Label>Currency</Label>
          <Select.Root type="single" bind:value={txCurrency} items={(data?.currencies || []).map((currency) => ({ value: currency.code, label: currency.code }))}>
            <Select.Trigger class="w-full"><Select.Value placeholder="Currency" /></Select.Trigger>
            <Select.Content>
              {#each data?.currencies || [] as currency (currency.code)}
                <Select.Item value={currency.code} label={currency.code}>{currency.code}</Select.Item>
              {/each}
            </Select.Content>
          </Select.Root>
        </div>
      </div>
      <div class="grid gap-2">
        <Label for="tx-notes">Notes (optional)</Label>
        <Input id="tx-notes" bind:value={txNotes} />
      </div>
    </div>
    <Dialog.Footer>
      <Button variant="outline" onclick={() => (txOpen = false)}>Cancel</Button>
      <Button disabled={savingTx} onclick={saveTransaction}>Save</Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>

<!-- Import dialog -->
<Dialog.Root bind:open={importOpen}>
  <Dialog.Content class="sm:max-w-xl">
    <Dialog.Header>
      <Dialog.Title>Import transactions</Dialog.Title>
      <Dialog.Description>{importHint}</Dialog.Description>
    </Dialog.Header>
    <div class="grid gap-4">
      <Textarea rows="10" spellcheck="false" placeholder={"2026-09-08\tCASH Dividend\t29.77\t\tCAD\tDividend"} bind:value={importText} />
      {#if importPastCount > 0 && importConfirmed}
        <Alert>
          <AlertTitle>Heads up</AlertTitle>
          <AlertDescription>{importPastCount} {importPastCount === 1 ? 'line is' : 'lines are'} dated before this month. Click “Import anyway” to confirm.</AlertDescription>
        </Alert>
      {/if}
      {#if importError}
        <Alert variant="destructive">
          <AlertDescription>{importError}</AlertDescription>
        </Alert>
      {/if}
    </div>
    <Dialog.Footer>
      <Button variant="outline" onclick={() => (importOpen = false)}>Cancel</Button>
      <Button onclick={submitImport}>{importConfirmed ? 'Import anyway' : 'Import'}</Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>

<!-- Delete confirmation -->
<AlertDialog.Root bind:open={deleteOpen}>
  <AlertDialog.Content>
    <AlertDialog.Header>
      <AlertDialog.Title>Delete transaction</AlertDialog.Title>
      <AlertDialog.Description>{deleteDescription}</AlertDialog.Description>
    </AlertDialog.Header>
    <AlertDialog.Footer>
      <AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
      <AlertDialog.Action class="bg-destructive text-white hover:bg-destructive/90" onclick={confirmDelete}>Delete</AlertDialog.Action>
    </AlertDialog.Footer>
  </AlertDialog.Content>
</AlertDialog.Root>
