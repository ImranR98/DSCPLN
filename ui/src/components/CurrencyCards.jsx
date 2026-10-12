import { SquarePen } from 'lucide-react'
import { Breakable } from '@dscpln/ui-kit'

export default function CurrencyCards({ cards, onEditBudget }) {
  return (
    <div className="currency-grid" hidden={cards.length === 0}>
      {cards.map((card) => (
        <section className={`currency-card ${card.cardClass}`} key={card.code} aria-label={`${card.code} budget`} style={{ '--currency': card.color }}>
          <div className="currency-card__header">
            <span className="currency-badge">{card.code}</span>
            <button
              className="outline secondary icon-button icon-button--small"
              title={`Edit ${card.code} budget`}
              aria-label={`Edit ${card.code} budget`}
              onClick={() => onEditBudget(card.code)}
            ><SquarePen size={16} strokeWidth={1.8} /></button>
          </div>
          <p className="currency-card__figure">
            <Breakable className="currency-card__spend" text={card.spendText} />
            <Breakable className="currency-card__budget" text={card.budgetText} />
          </p>
          <div
            className="progress progress--sm"
            role="progressbar"
            aria-valuemin="0"
            aria-valuemax="100"
            aria-valuenow={card.ariaNow}
            aria-valuetext={card.ariaText}
          >
            <div className="progress__fill" style={{ width: `${card.pct.toFixed(1)}%` }}></div>
          </div>
          <div className="currency-card__meta">
            {card.remainingText ? (
              <span className={card.remainingOver ? 'currency-card__over' : ''}>{card.remainingText}</span>
            ) : null}
            <span className="currency-card__earned">{card.earnedText}</span>
          </div>
          {card.convertedText ? (
            <div className="currency-card__converted">{card.convertedText}</div>
          ) : null}
        </section>
      ))}
    </div>
  )
}
