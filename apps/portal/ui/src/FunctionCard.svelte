<script>
  let { fn, card } = $props()
  let Icon = $derived(fn.icon)
  const offline = $derived(Boolean(card?.loaded) && !card.online)
</script>

<a
  class="portal-card"
  class:is-offline={offline}
  href={`/${fn.path}`}
  data-testid={`card-${fn.path}`}
  aria-disabled={offline}
  onclick={(event) => { if (offline) event.preventDefault() }}
>
  <span class="portal-card__icon"><Icon size={20} strokeWidth={1.8} /></span>
  <span class="portal-card__body">
    <span class="portal-card__name">{fn.name}</span>
    <span class="portal-card__desc">{fn.description}</span>
    {#if card?.detail}
      <span class={`portal-card__detail${card.tone ? ` is-${card.tone}` : ''}`} data-testid={`detail-${fn.path}`}>{card.detail}</span>
    {/if}
    {#if card?.next}
      <span class={`portal-card__next${card.nextTone ? ` is-${card.nextTone}` : ''}`} data-testid={`next-${fn.path}`}>{card.next}</span>
    {/if}
  </span>
  <span
    class={`portal-card__status ${offline ? 'is-fail' : 'is-ok'}`}
    data-testid={`status-${fn.path}`}
    hidden={!offline}
  >unreachable</span>
</a>
