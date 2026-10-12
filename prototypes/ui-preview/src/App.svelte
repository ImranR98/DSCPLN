<script>
  import { ModeWatcher, toggleMode, mode } from 'mode-watcher'
  import Sun from '@lucide/svelte/icons/sun'
  import Moon from '@lucide/svelte/icons/moon'
  import { Button } from '$lib/components/ui/button/index.js'
  import { Badge } from '$lib/components/ui/badge/index.js'
  import { Toaster } from '$lib/components/ui/sonner/index.js'
  import Dashboard from './routes/Dashboard.svelte'
  import Insights from './routes/Insights.svelte'

  let route = $state(location.hash.replace(/^#\/?/, '') || 'dashboard')

  const go = (next) => {
    route = next
    location.hash = `#/${next}`
  }

  $effect(() => {
    const onHash = () => (route = location.hash.replace(/^#\/?/, '') || 'dashboard')
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  })
</script>

<ModeWatcher />

<div class="min-h-svh bg-background">
  <header class="sticky top-0 z-20 border-b bg-background/80 backdrop-blur">
    <div class="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4">
      <span class="text-sm font-semibold tracking-tight">
        D<span class="text-blue-600 dark:text-blue-400">$</span>CPLN
      </span>
      <Badge variant="secondary" class="hidden sm:inline-flex">Balance · UI preview</Badge>
      <nav class="ml-auto flex items-center gap-1">
        <Button variant={route === 'dashboard' ? 'secondary' : 'ghost'} size="sm" onclick={() => go('dashboard')}>
          Dashboard
        </Button>
        <Button variant={route === 'insights' ? 'secondary' : 'ghost'} size="sm" onclick={() => go('insights')}>
          Insights
        </Button>
        <Button variant="ghost" size="icon-sm" aria-label="Toggle theme" onclick={toggleMode}>
          {#if mode.current === 'dark'}<Sun />{:else}<Moon />{/if}
        </Button>
      </nav>
    </div>
  </header>

  <main class="mx-auto max-w-6xl px-4 py-6">
    {#if route === 'insights'}
      <Insights />
    {:else}
      <Dashboard />
    {/if}
  </main>
</div>

<Toaster richColors position="bottom-right" />
