<script>
  let { fn, card } = $props()
  let Icon = $derived(fn.icon)
</script>

<a class="portal-card" href={`/${fn.path}`} data-testid={`card-${fn.path}`}>
  <span class="portal-card__icon"><Icon size={20} /></span>
  <span class="portal-card__body">
    <strong>{fn.name}</strong>
    <small>{fn.description}</small>
    {#if card?.detail}
      <small class={`status-${card.tone || 'muted'}`} data-testid={`detail-${fn.path}`}>{card.detail}</small>
    {/if}
    {#if card?.next}
      <small class={`status-${card.nextTone || 'muted'}`} data-testid={`next-${fn.path}`}>{card.next}</small>
    {/if}
  </span>
  <small
    class={`portal-card__status ${card?.online ? 'status-ok' : 'status-over'}`}
    data-testid={`status-${fn.path}`}
  >{card?.loaded ? (card.online ? 'online' : 'unreachable') : '…'}</small>
</a>
