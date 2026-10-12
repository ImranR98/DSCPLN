<script>
  import { Monitor, Moon, Sun } from 'lucide-svelte'
  import { currentTheme, setTheme } from './theme.js'

  const ORDER = ['auto', 'light', 'dark']

  let theme = $state(currentTheme())

  function cycle() {
    theme = ORDER[(ORDER.indexOf(theme) + 1) % ORDER.length]
    setTheme(theme)
  }
</script>

<button
  class="outline secondary icon-button"
  type="button"
  data-testid="theme-toggle"
  title={`Theme: ${theme}`}
  aria-label={`Theme: ${theme}. Click to change.`}
  onclick={cycle}
>
  {#if theme === 'auto'}
    <Monitor size={16} strokeWidth={1.8} />
  {:else if theme === 'dark'}
    <Moon size={16} strokeWidth={1.8} />
  {:else}
    <Sun size={16} strokeWidth={1.8} />
  {/if}
</button>
