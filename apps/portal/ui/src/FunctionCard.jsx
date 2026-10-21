export default function FunctionCard({ fn, card }) {
  const Icon = fn.icon
  const offline = Boolean(card?.loaded) && !card.online
  const kicker = card?.kicker ?? ''
  const primary = card?.primary ?? { value: '—', label: '', tone: '' }
  const stats = card?.stats ?? []
  const footer = card?.footer ?? { text: '', tone: '' }

  return (
    <a
      className={`portal-card${offline ? ' is-offline' : ''}`}
      href={`/${fn.path}`}
      data-testid={`card-${fn.path}`}
      aria-disabled={offline}
      onClick={(event) => { if (offline) event.preventDefault() }}
    >
      <div className="portal-card__head">
        <span className="portal-card__icon"><Icon size={20} strokeWidth={1.8} /></span>
        <div className="portal-card__title">
          <h2 className="portal-card__name">{fn.name}</h2>
          <p className="portal-card__desc">{fn.description}</p>
        </div>
        <span
          className={`portal-card__status ${offline ? 'is-fail' : 'is-ok'}`}
          data-testid={`status-${fn.path}`}
        >{offline ? 'unreachable' : 'online'}</span>
      </div>

      {kicker ? <div className="portal-card__kicker" data-testid={`kicker-${fn.path}`}>{kicker}</div> : null}

      <div className="portal-card__primary">
        <strong className={`portal-card__value${primary.tone ? ` is-${primary.tone}` : ''}`} data-testid={`primary-${fn.path}`}>
          {primary.value}
        </strong>
        {primary.label ? <span className="portal-card__primary-label">{primary.label}</span> : null}
      </div>

      {card?.progress ? (
        <div className="portal-card__progress" aria-hidden="true">
          <span
            className={`portal-card__progress-fill is-${card.progress.tone || 'ok'}`}
            style={{ width: `${Math.max(0, Math.min(100, card.progress.pct))}%` }}
          ></span>
        </div>
      ) : null}

      {stats.length ? (
        <div className="portal-card__stats">
          {stats.map((entry, index) => (
            <div className="portal-card__stat" key={`${entry.label}-${index}`} data-testid={`stat-${fn.path}-${index}`}>
              <span className="portal-card__stat-label">{entry.label}</span>
              <span className={`portal-card__stat-value${entry.tone ? ` is-${entry.tone}` : ''}`}>{entry.value}</span>
            </div>
          ))}
        </div>
      ) : null}

      {footer.text ? (
        <div className={`portal-card__footer${footer.tone ? ` is-${footer.tone}` : ''}`} data-testid={`footer-${fn.path}`}>
          {footer.text}
        </div>
      ) : null}
    </a>
  )
}
