<script>
  import { renderCumulative } from './lib/chart.js'

  let { data } = $props()
  let host = $state(null)

  $effect(() => {
    if (host && data) {
      renderCumulative(host, data)
    }
  })
</script>

<div class="insights-chart-host" bind:this={host}></div>
