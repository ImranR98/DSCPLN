<script>
  import { toasts, dismissToast } from './toast.svelte.js'
  import { Check, CircleAlert } from 'lucide-svelte'
</script>

<div class="toasts" aria-live="polite" aria-atomic="false" data-testid="toasts">
  {#each toasts.items as toast (toast.id)}
    <div class="toast toast--{toast.tone}" role="status" onclick={() => dismissToast(toast.id)}>
      <span class="toast__icon">
        {#if toast.tone === 'error'}
          <CircleAlert size={16} />
        {:else}
          <Check size={16} />
        {/if}
      </span>
      <span>{toast.message}</span>
    </div>
  {/each}
</div>

<style>
  .toast--error {
    border-color: var(--over);
    color: var(--over);
  }
  .toast__icon {
    display: inline-flex;
    color: var(--ok);
  }
  .toast--error .toast__icon {
    color: var(--over);
  }
</style>
