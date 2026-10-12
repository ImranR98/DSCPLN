export default function FunctionCard({ fn, card }) {
  const Icon = fn.icon
  const offline = Boolean(card?.loaded) && !card.online

  return (
    <a
      className={`portal-card${offline ? ' is-offline' : ''}`}
      href={`/${fn.path}`}
      data-testid={`card-${fn.path}`}
      aria-disabled={offline}
      onClick={(event) => { if (offline) event.preventDefault() }}
    >
      <span className="portal-card__icon"><Icon size={20} strokeWidth={1.8} /></span>
      <span className="portal-card__body">
        <span className="portal-card__name">{fn.name}</span>
        <span className="portal-card__desc">{fn.description}</span>
        {card?.detail ? (
          <span className={`portal-card__detail${card.tone ? ` is-${card.tone}` : ''}`} data-testid={`detail-${fn.path}`}>{card.detail}</span>
        ) : null}
        {card?.next ? (
          <span className={`portal-card__next${card.nextTone ? ` is-${card.nextTone}` : ''}`} data-testid={`next-${fn.path}`}>{card.next}</span>
        ) : null}
      </span>
      <span
        className={`portal-card__status ${offline ? 'is-fail' : 'is-ok'}`}
        data-testid={`status-${fn.path}`}
        hidden={!offline}
      >unreachable</span>
    </a>
  )
}
