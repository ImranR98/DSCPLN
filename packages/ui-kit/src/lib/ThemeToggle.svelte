<script>
  import { Moon, Sun } from 'lucide-svelte'
  import { effectiveTheme, toggleTheme } from './theme.js'

  let dark = $state(effectiveTheme() === 'dark')

  function toggle() {
    toggleTheme()
    dark = effectiveTheme() === 'dark'
  }
</script>

<button
  class="outline secondary"
  type="button"
  data-testid="theme-toggle"
  aria-label="Toggle theme"
  title="Toggle theme"
  onclick={toggle}
>
  {#if dark}
    <Sun size={16} />
  {:else}
    <Moon size={16} />
  {/if}
</button>
