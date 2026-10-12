<script>
  import { onMount } from 'svelte'
  import { scaleUtc } from 'd3-scale'
  import { curveLinear } from 'd3-shape'
  import { LineChart } from 'layerchart'
  import * as IM from '@balance/insights-math.js'
  import { moneyFor, currencyColor, number } from '@balance/money.js'
  import * as Card from '$lib/components/ui/card/index.js'
  import { Button } from '$lib/components/ui/button/index.js'
  import { Badge } from '$lib/components/ui/badge/index.js'
  import { Checkbox } from '$lib/components/ui/checkbox/index.js'
  import { Input } from '$lib/components/ui/input/index.js'
  import { Label } from '$lib/components/ui/label/index.js'
  import * as Select from '$lib/components/ui/select/index.js'
  import { Skeleton } from '$lib/components/ui/skeleton/index.js'
  import * as Chart from '$lib/components/ui/chart/index.js'
  import { requestJson } from '$lib/api.js'

  const CATEGORY_PALETTE = ['#2f6fed', '#16a34a', '#d97706', '#8b5cf6', '#0891b2', '#db2777', '#65a30d', '#e11d48', '#0d9488', '#7c3aed', '#ca8a04', '#4f46e5']
  const colorFrom = (palette, key) => {
    let hash = 0
    for (const char of String(key)) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
    return palette[hash % palette.length]
  }
  const categoryColor = (name) => colorFrom(CATEGORY_PALETTE, String(name || ''))

  const dayMonth = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' })
  const monthYear = new Intl.DateTimeFormat(undefined, { month: 'short', year: 'numeric' })
  const monthShort = new Intl.DateTimeFormat(undefined, { month: 'short' })
  const compact = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 })

  const today = new Date()
  let reference = $state(null)
  let transactions = $state([])
  let range = $state({ start: IM.startOfMonth(new Date()), end: IM.endOfMonth(new Date()) })
  let comparison = $state('prev')
  let comparisonData = $state(null)
  let excluded = $state(new Map())
  let loading = $state(true)

  const fractional = $derived(new Set((reference?.currencies || []).filter((entry) => entry.fractional).map((entry) => entry.code)))
  const symbols = $derived(new Map((reference?.currencies || []).filter((entry) => entry.symbol).map((entry) => [entry.code, entry.symbol])))
  const money = $derived(moneyFor((code) => fractional.has(code), (code) => symbols.get(code)))

  const QUICK = {
    'this-month': () => ({ start: IM.startOfMonth(today), end: IM.endOfMonth(today) }),
    'last-month': () => {
      const first = IM.startOfMonth(today)
      const lastDay = IM.addDays(first, -1)
      return { start: IM.startOfMonth(lastDay), end: lastDay }
    },
    'last-3': () => IM.lastCompleteMonths(3, today),
    'last-6': () => IM.lastCompleteMonths(6, today),
    'last-12': () => IM.lastCompleteMonths(12, today),
    ytd: () => ({ start: new Date(today.getFullYear(), 0, 1), end: today }),
    'all-time': () => {
      const bounds = reference?.transactionRange
      return bounds?.first && bounds?.last ? { start: IM.parseIsoDate(bounds.first), end: IM.parseIsoDate(bounds.last) } : null
    },
  }
  const QUICK_LABELS = {
    'this-month': 'This month',
    'last-month': 'Last month',
    'last-3': 'Last 3 months',
    'last-6': 'Last 6 months',
    'last-12': 'Last 12 months',
    ytd: 'Year to date',
    'all-time': 'All time',
  }

  const elapsed = $derived(IM.elapsedRange(range.start, range.end, new Date(today.getFullYear(), today.getMonth(), today.getDate())))

  async function fetchData() {
    loading = true
    try {
      const statsPlan = IM.comparisonPlan(comparison, elapsed)
      const chartPlan = IM.comparisonPlan(comparison, range)
      let fetchStart = [...statsPlan.windows, ...chartPlan.windows].reduce((earliest, window) =>
        !earliest || window.start < earliest ? window.start : earliest, null)
      if (range.start <= today && today <= range.end) {
        const monthStart = IM.startOfMonth(today)
        if (!fetchStart || monthStart < fetchStart) fetchStart = monthStart
      }
      const params = new URLSearchParams({ start: IM.toIsoDate(fetchStart || range.start), end: IM.toIsoDate(range.end) })
      const [referenceResult, transactionsResult] = await Promise.all([
        reference ? Promise.resolve(reference) : requestJson('/data'),
        requestJson(`/transactions?${params}`),
      ])
      reference = referenceResult
      transactions = transactionsResult.transactions || []
      const firstMonths = new Map((referenceResult.currencies || []).map((entry) => [entry.code, entry.firstMonth ? IM.parseIsoDate(entry.firstMonth) : null]))
      const earliest = [...firstMonths.values()].reduce((min, date) => (date && (!min || date < min) ? date : min), null)
      comparisonData = { statsRange: elapsed, chartRange: range, earliest, firstMonths }
    } finally {
      loading = false
    }
  }

  function setRange(next) {
    range = next
    excluded = new Map()
    fetchData()
  }

  function excludedFor(code) {
    return excluded.get(code) ?? new Set(reference?.conversionCategories || [])
  }

  function toggleCategory(code, category, include) {
    const next = new Map(excluded)
    const set = new Set(excludedFor(code))
    if (include) set.delete(category)
    else set.add(category)
    next.set(code, set)
    excluded = next
  }

  function transactionsIn(code, window, excludedSet) {
    return IM.filterTransactions(transactions, { start: window.start, end: window.end, currency: code, excludedCategories: excludedSet })
  }

  const comparisonShort = $derived.by(() => {
    if (!comparisonData) return ''
    const plan = IM.comparisonPlan(comparison, elapsed, comparisonData.earliest)
    if (plan.kind === 'average') return plan.count > 0 ? `${plan.count}-mo avg` : 'no prior data'
    return plan.windows[0] && IM.spansMultipleMonths(plan.windows[0].start, plan.windows[0].end) ? 'previous period' : 'previous month'
  })

  const sections = $derived.by(() => {
    if (!reference || !comparisonData) return []
    const statTxs = IM.filterTransactions(transactions, { start: elapsed.start, end: elapsed.end })
    if (!statTxs.length) return []
    const byCurrency = new Map()
    for (const transaction of statTxs) {
      if (!byCurrency.has(transaction.currency)) byCurrency.set(transaction.currency, [])
      byCurrency.get(transaction.currency).push(transaction)
    }
    const primary = (reference.currencies || []).find((entry) => entry.primary)
    const volume = (code) => {
      const total = IM.totals(byCurrency.get(code))
      return total.spend + total.income
    }
    const codes = [...byCurrency.keys()].sort((a, b) => {
      if (primary && a === primary.code) return -1
      if (primary && b === primary.code) return 1
      return volume(b) - volume(a)
    })
    return codes.map((code) => buildSection(code, byCurrency.get(code)))
  })

  function daysElapsed() {
    return Math.max(1, IM.daysInclusive(comparisonData.statsRange.start, comparisonData.statsRange.end))
  }

  function sectionPlans(code) {
    const firstDataMonth = comparisonData.firstMonths.get(code) || null
    return {
      stats: IM.comparisonPlan(comparison, comparisonData.statsRange, firstDataMonth),
      chart: IM.comparisonPlan(comparison, comparisonData.chartRange, firstDataMonth),
    }
  }

  function comparisonFor(code, excludedSet, plan) {
    const windowTxs = plan.windows.flatMap((window) => transactionsIn(code, window, excludedSet))
    const raw = IM.totals(windowTxs)
    const factor = plan.factor
    return {
      spend: raw.spend * factor,
      income: raw.income * factor,
      net: raw.net * factor,
      count: raw.count * factor,
      dailySpend: plan.days > 0 ? raw.spend / plan.days : 0,
      dailyIncome: plan.days > 0 ? raw.income / plan.days : 0,
      spendMap: IM.categoryTotalsMap(windowTxs, 'expense'),
      incomeMap: IM.categoryTotalsMap(windowTxs, 'income'),
    }
  }

  function deltaBadge(value, compared, money2, code) {
    if (compared == null || (value === 0 && compared === 0)) return { text: '—', tone: 'muted' }
    const change = IM.delta(value, compared)
    if (change.pct == null) {
      return { text: `${change.amount > 0 ? '+' : change.amount < 0 ? '−' : ''}${money2(Math.abs(change.amount), code)} vs ${comparisonShort}`, tone: 'muted' }
    }
    return {
      text: `${change.pct > 0 ? '+' : ''}${change.pct.toFixed(0)}% vs ${comparisonShort}`,
      tone: change.amount === 0 ? 'muted' : change.amount > 0 ? 'up' : 'down',
    }
  }

  function buildSection(code, rangeTxs) {
    const excludedSet = excludedFor(code)
    const included = rangeTxs.filter((transaction) => !excludedSet.has(transaction.category))
    const plans = sectionPlans(code)
    const compared = comparisonFor(code, excludedSet, plans.stats)
    const current = IM.totals(included)
    const days = daysElapsed()

    const kpis = [
      { label: 'Spent', value: money(current.spend, code), delta: deltaBadge(current.spend, compared.spend, money, code) },
      { label: 'Earned', value: money(current.income, code), delta: deltaBadge(current.income, compared.income, money, code), good: true },
      { label: 'Net', value: money(current.net, code), delta: deltaBadge(current.net, compared.net, money, code), good: current.net >= 0 },
      { label: 'Avg / day', value: money(current.spend / days, code), delta: deltaBadge(current.spend / days, compared.dailySpend, money, code) },
      { label: 'Avg earned / day', value: money(current.income / days, code), delta: deltaBadge(current.income / days, compared.dailyIncome, money, code), good: true },
      { label: 'Transactions', value: String(current.count), delta: deltaBadge(current.count, compared.count, (value) => String(value), null) },
    ]

    const categoryLists = [
      { title: 'Spending by category', rows: IM.aggregateByCategory(rangeTxs, 'expense'), comparisonMap: compared.spendMap, invert: false },
      { title: 'Earned by category', rows: IM.aggregateByCategory(rangeTxs, 'income'), comparisonMap: compared.incomeMap, invert: true },
    ].filter((list) => list.rows.length > 0).map((list) => {
      const max = Math.max(...list.rows.map((row) => row.amount))
      const total = list.rows.filter((row) => !excludedSet.has(row.category)).reduce((sum, row) => sum + row.amount, 0)
      return {
        title: list.title,
        invert: list.invert,
        categories: list.rows.map((row) => row.category),
        rows: list.rows.map((row) => {
          const comparisonAmount = list.comparisonMap[row.category] || 0
          const change = IM.delta(row.amount, comparisonAmount)
          return {
            category: row.category,
            color: categoryColor(row.category),
            checked: !excludedSet.has(row.category),
            share: total > 0 ? `${Math.round((row.amount / total) * 100)}%` : '0%',
            amount: money(row.amount, code),
            bar: max > 0 ? Math.max(3, (row.amount / max) * 100) : 0,
            delta: change.pct != null
              ? { text: `${change.amount > 0 ? '+' : ''}${change.pct.toFixed(0)}%`, tone: change.amount > 0 ? 'up' : 'down' }
              : row.amount > 0 ? { text: 'new', tone: 'up' } : null,
          }
        }),
      }
    })

    // Cumulative series: solid to today, dashed baseline across the whole range.
    const daily = IM.dailySeries(included, range.start, range.end)
    let runningSpend = 0
    let runningIncome = 0
    const baseline = plans.chart.windows.length
      ? IM.baselineFromPlan(IM.filterTransactions(transactions, { currency: code, excludedCategories: excludedSet }), plans.chart, IM.daysInclusive(range.start, range.end))
      : { spend: [], income: [] }
    const solidDays = IM.daysInclusive(range.start, elapsed.end)
    const points = daily.map((day, index) => {
      runningSpend += day.spend
      runningIncome += day.income
      return {
        date: IM.parseIsoDate(day.date),
        spent: index < solidDays ? IM.clean(runningSpend) : undefined,
        earned: index < solidDays ? IM.clean(runningIncome) : undefined,
        baseSpent: baseline.spend[index],
        baseIncome: baseline.income[index],
      }
    })
    const currentPoints = points.filter((point) => point.spent !== undefined)
    const lane = currencyColor(code) || 'var(--chart-1)'

    const chartConfig = {
      spent: { label: 'Spent', color: lane },
      earned: { label: 'Earned', color: 'var(--chart-2)' },
      baseSpent: { label: `Spent vs ${comparisonShort}`, color: lane },
      baseIncome: { label: `Earned vs ${comparisonShort}`, color: 'var(--chart-2)' },
    }

    const forecastPlan = plans.chart
    const forecast = []
    if (forecastPlan.windows.length > 0 && forecastPlan.days > 0) {
      const windowTxs = forecastPlan.windows.flatMap((window) => transactionsIn(code, window, excludedSet))
      const totals = IM.totals(windowTxs)
      if (totals.spend > 0 || totals.income > 0) {
        const factor = 30 / forecastPlan.days
        forecast.push({
          label: 'Next 30 days (comparison pace)',
          value: `${money(totals.spend * factor, code)} out · ${money(totals.income * factor, code)} in`,
        })
      }
    }

    const mappers = [
      { title: 'Spending changes', current: IM.categoryTotalsMap(included, 'expense'), compared: compared.spendMap },
      { title: 'Earning changes', current: IM.categoryTotalsMap(included, 'income'), compared: compared.incomeMap },
    ]
    const movers = mappers.map((block) => {
      const entries = IM.categoryMovers(block.current, block.compared, 3)
      const map = (entry) => ({
        category: entry.category,
        color: categoryColor(entry.category),
        amount: `${entry.delta.amount > 0 ? '+' : '−'}${money(Math.abs(entry.delta.amount), code)}`,
        pct: entry.delta.pct == null ? 'new' : `${entry.delta.pct > 0 ? '+' : ''}${entry.delta.pct.toFixed(0)}%`,
        up: entry.delta.amount > 0,
      })
      return { title: block.title, increases: entries.increases.map(map), decreases: entries.decreases.map(map) }
    }).filter((block) => block.increases.length || block.decreases.length)

    return { code, excludedSet, included, kpis, categoryLists, points, currentPoints, chartConfig, lane, forecast, movers }
  }

  const compareNote = $derived.by(() => {
    if (!comparisonData) return ''
    const plan = IM.comparisonPlan(comparison, elapsed, comparisonData.earliest)
    const label = plan.windows.length === 0
      ? 'no earlier data'
      : plan.kind === 'average'
        ? `${plan.count}-mo avg`
        : `${dayMonth.format(plan.windows[0].start)} – ${dayMonth.format(plan.windows[0].end)}`
    return `${dayMonth.format(elapsed.start)} – ${dayMonth.format(elapsed.end)} vs ${label}`
  })

  onMount(fetchData)
</script>

<div class="flex flex-col gap-6">
  <div>
    <h1 class="text-2xl font-semibold tracking-tight">Insights</h1>
    <p class="mt-1 text-sm text-muted-foreground">{monthYear.format(range.start)} – {monthYear.format(range.end)} · {compareNote}</p>
  </div>

  <Card.Root>
    <Card.Content class="flex flex-col gap-4">
      <div class="grid gap-3 sm:grid-cols-3">
        <div class="grid gap-2">
          <Label for="start">Start</Label>
          <Input id="start" type="date" value={IM.toIsoDate(range.start)} onchange={(event) => { const start = IM.parseIsoDate(event.target.value); if (start) setRange({ start, end: start > range.end ? start : range.end }) }} />
        </div>
        <div class="grid gap-2">
          <Label for="end">End</Label>
          <Input id="end" type="date" value={IM.toIsoDate(range.end)} onchange={(event) => { const end = IM.parseIsoDate(event.target.value); if (end) setRange({ start: end < range.start ? end : range.start, end }) }} />
        </div>
        <div class="grid gap-2">
          <Label>Compare with</Label>
          <Select.Root
            type="single"
            bind:value={comparison}
            items={[
              { value: 'prev', label: 'Previous period' },
              { value: 'yoy', label: 'Same period last year' },
              { value: 'avg3', label: 'Trailing 3-month average' },
              { value: 'avg6', label: 'Trailing 6-month average' },
              { value: 'avg12', label: 'Trailing 12-month average' },
            ]}
            onOpenChange={(open) => { if (!open) fetchData() }}
          >
            <Select.Trigger class="w-full"><Select.Value placeholder="Comparison" /></Select.Trigger>
            <Select.Content>
              <Select.Item value="prev" label="Previous period">Previous period</Select.Item>
              <Select.Item value="yoy" label="Same period last year">Same period last year</Select.Item>
              <Select.Item value="avg3" label="Trailing 3-month average">Trailing 3-month average</Select.Item>
              <Select.Item value="avg6" label="Trailing 6-month average">Trailing 6-month average</Select.Item>
              <Select.Item value="avg12" label="Trailing 12-month average">Trailing 12-month average</Select.Item>
            </Select.Content>
          </Select.Root>
        </div>
      </div>
      <div class="flex flex-wrap gap-2">
        {#each Object.entries(QUICK_LABELS) as [key, label] (key)}
          {@const preset = QUICK[key]()}
          {@const active = preset && IM.toIsoDate(preset.start) === IM.toIsoDate(range.start) && IM.toIsoDate(preset.end) === IM.toIsoDate(range.end)}
          <Button variant={active ? 'secondary' : 'outline'} size="sm" disabled={!preset} onclick={() => preset && setRange(preset)}>{label}</Button>
        {/each}
      </div>
    </Card.Content>
  </Card.Root>

  {#if loading}
    <div class="grid gap-4">
      <Skeleton class="h-40 w-full" />
      <Skeleton class="h-96 w-full" />
    </div>
  {:else if sections.length === 0}
    <Card.Root>
      <Card.Content class="py-10 text-center text-sm text-muted-foreground">No transactions in this range.</Card.Content>
    </Card.Root>
  {:else}
    {#each sections as section (section.code)}
      <Card.Root>
        <Card.Header class="flex-row items-center justify-between">
          <div class="flex items-center gap-2">
            <Badge class="border-transparent text-white" style={`background: ${currencyColor(section.code)}`}>{section.code}</Badge>
            <Card.Description>{section.included.length} transactions · compared with {comparisonShort}</Card.Description>
          </div>
        </Card.Header>
        <Card.Content class="flex flex-col gap-6">
          <div class="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {#each section.kpis as kpi (kpi.label)}
              <div class="rounded-lg border bg-muted/40 p-3">
                <div class="text-xs text-muted-foreground">{kpi.label}</div>
                <div class="mt-0.5 text-sm font-semibold tabular-nums {kpi.good === false ? 'text-red-600 dark:text-red-400' : ''}">{kpi.value}</div>
                <Badge variant="outline" class="mt-1.5 border-transparent px-0 text-[11px] {kpi.delta.tone === 'up' ? 'text-emerald-600 dark:text-emerald-400' : kpi.delta.tone === 'down' ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground'}">
                  {kpi.delta.text}
                </Badge>
              </div>
            {/each}
          </div>

          <div class="grid gap-6 lg:grid-cols-2">
            <div class="flex flex-col gap-4">
              {#each section.categoryLists as list (list.title)}
                <div class="flex flex-col gap-2">
                  <div class="flex items-center justify-between">
                    <h3 class="text-sm font-medium">{list.title}</h3>
                    <div class="flex gap-1">
                      <Button variant="link" size="sm" onclick={() => list.categories.forEach((category) => toggleCategory(section.code, category, true))}>All</Button>
                      <Button variant="link" size="sm" onclick={() => list.categories.forEach((category) => toggleCategory(section.code, category, false))}>None</Button>
                    </div>
                  </div>
                  {#each list.rows as row (row.category)}
                    <label class="flex items-center gap-3 rounded-md px-1 py-1.5">
                      <Checkbox checked={row.checked} onCheckedChange={(checked) => toggleCategory(section.code, row.category, Boolean(checked))} />
                      <span class="flex size-2.5 shrink-0 rounded-[3px]" style={`background: ${row.color}`}></span>
                      <span class="min-w-0 flex-1">
                        <span class="flex items-baseline justify-between gap-2">
                          <span class="truncate text-sm {row.checked ? '' : 'text-muted-foreground line-through'}">{row.category}</span>
                          <span class="text-xs text-muted-foreground">{row.share}</span>
                        </span>
                        <span class="mt-1 block h-1 w-full overflow-hidden rounded-full bg-muted">
                          <span class="block h-full rounded-full" style={`width: ${row.bar}%; background: ${row.color}`}></span>
                        </span>
                      </span>
                      <span class="flex items-center gap-2">
                        <span class="text-sm tabular-nums">{row.amount}</span>
                        {#if row.delta}
                          {@const bad = list.invert ? row.delta.tone === 'down' : row.delta.tone === 'up'}
                          <Badge variant="outline" class="border-transparent px-0 text-[11px] {bad ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}">{row.delta.text}</Badge>
                        {/if}
                      </span>
                    </label>
                  {/each}
                </div>
              {/each}
            </div>

            <div class="flex flex-col gap-3">
              <h3 class="text-sm font-medium">Cumulative spent &amp; earned</h3>
              <Chart.Container config={section.chartConfig} class="aspect-auto h-64">
                <LineChart
                  data={section.points}
                  x="date"
                  xScale={scaleUtc()}
                  axis="x"
                  series={[
                    { key: 'spent', label: 'Spent', color: section.chartConfig.spent.color, data: section.currentPoints },
                    { key: 'earned', label: 'Earned', color: section.chartConfig.earned.color, data: section.currentPoints },
                    { key: 'baseSpent', label: `Spent vs ${comparisonShort}`, color: section.chartConfig.baseSpent.color, props: { dashArray: '5 5', opacity: 0.45 } },
                    { key: 'baseIncome', label: `Earned vs ${comparisonShort}`, color: section.chartConfig.baseIncome.color, props: { dashArray: '5 5', opacity: 0.45 } },
                  ]}
                  props={{
                    spline: { curve: curveLinear, strokeWidth: 2 },
                    yAxis: { format: (value) => compact.format(value) },
                    xAxis: { tickSpacing: 90, format: (value) => dayMonth.format(value) },
                  }}
                >
                  {#snippet tooltip()}
                    <Chart.Tooltip
                      labelFormatter={(value) => dayMonth.format(value)}
                      formatter={({ value, name }) => `${name}: ${money(value, section.code)}`}
                    />
                  {/snippet}
                </LineChart>
              </Chart.Container>
              <div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span class="flex items-center gap-1.5"><span class="h-0.5 w-4 rounded" style={`background: ${section.lane}`}></span>Spent</span>
                <span class="flex items-center gap-1.5"><span class="h-0.5 w-4 rounded bg-chart-2"></span>Earned</span>
                <span class="flex items-center gap-1.5"><span class="h-0.5 w-4 rounded opacity-45" style={`background: ${section.lane}`}></span>Spent vs {comparisonShort}</span>
                <span class="flex items-center gap-1.5"><span class="h-0.5 w-4 rounded bg-chart-2 opacity-45"></span>Earned vs {comparisonShort}</span>
              </div>
              {#if section.forecast.length}
                <div class="mt-2 grid gap-1.5 rounded-lg border bg-muted/40 p-3 text-sm">
                  {#each section.forecast as row (row.label)}
                    <div class="flex items-center justify-between gap-2">
                      <span class="text-muted-foreground">{row.label}</span>
                      <span class="font-medium tabular-nums">{row.value}</span>
                    </div>
                  {/each}
                </div>
              {/if}
            </div>
          </div>

          {#if section.movers.length}
            <div class="grid gap-4 border-t pt-4 lg:grid-cols-2">
              {#each section.movers as block (block.title)}
                <div class="flex flex-col gap-2">
                  <h3 class="text-sm font-medium">{block.title}</h3>
                  <div class="grid grid-cols-2 gap-4">
                    {#each [{ key: 'increases', heading: 'Increases', entries: block.increases }, { key: 'decreases', heading: 'Decreases', entries: block.decreases }] as column (column.key)}
                      <div class="flex flex-col gap-1.5">
                        <div class="text-xs font-medium text-muted-foreground">{column.heading}</div>
                        {#if column.entries.length === 0}
                          <p class="text-xs text-muted-foreground">None.</p>
                        {:else}
                          {#each column.entries as entry (entry.category)}
                            <div class="flex items-center gap-2 text-sm">
                              <span class="size-2 rounded-[3px]" style={`background: ${entry.color}`}></span>
                              <span class="min-w-0 flex-1 truncate">{entry.category}</span>
                              <span class="tabular-nums {entry.up ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}">{entry.amount}</span>
                              <span class="w-10 text-right text-xs text-muted-foreground">{entry.pct}</span>
                            </div>
                          {/each}
                        {/if}
                      </div>
                    {/each}
                  </div>
                </div>
              {/each}
            </div>
          {/if}
        </Card.Content>
      </Card.Root>
    {/each}
  {/if}
</div>
