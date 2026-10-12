import { SquarePen } from 'lucide-react'
import { Breakable } from '@dscpln/ui-kit'

export default function HeroCard({ hero, canEditBudget, onEditBudget }) {
  return (
    <section className={`card card--hero ${hero.cardClass}`} aria-labelledby="monthHeading">
      <div className="card__header">
        <h2 className="currency-badge" style={hero.accent ? { '--currency': hero.accent } : undefined}>
          <span id="monthHeading">{hero.heading}</span>
        </h2>
        <span className="card__header-tools">
          <span className="card__context">{hero.monthName}</span>
          <button
            className="outline secondary icon-button icon-button--small"
            title="Edit budget"
            aria-label="Edit budget"
            disabled={!canEditBudget}
            onClick={onEditBudget}
          ><SquarePen size={16} strokeWidth={1.8} /></button>
        </span>
      </div>
      <p className="figure">
        <Breakable id="monthSpend" className="figure__spend" text={hero.spendText} />
        <span className="figure__meta">
          <span className="figure__of">of</span>
          <Breakable id="monthBudget" className="figure__budget" text={hero.budgetText} />
        </span>
      </p>
      <div
        className="progress"
        id="monthProgress"
        role="progressbar"
        aria-valuemin="0"
        aria-valuemax="100"
        aria-valuenow={Math.round(hero.progressPct)}
        aria-valuetext={hero.progressAriaText}
      >
        <div className="progress__fill" style={{ width: `${hero.progressPct.toFixed(1)}%` }}></div>
        <div className="progress__pace" hidden={hero.paceMarkerHidden} style={{ left: hero.paceMarkerLeft }}></div>
      </div>
      <p className={`pace ${hero.paceClass}`}>{hero.paceText}</p>
      <div className="stat-tiles">
        <div className="stat-tile">
          <span className="stat-tile__label">Left</span>
          <Breakable className={`stat-tile__value${hero.remainingOver ? ' is-over' : ''}`} text={hero.remainingText} />
        </div>
        <div className="stat-tile">
          <span className="stat-tile__label">Per day</span>
          <Breakable className="stat-tile__value" text={hero.dailyText} />
        </div>
        <div className="stat-tile">
          <span className="stat-tile__label">Days left</span>
          <span className="stat-tile__value">{hero.daysLeft}</span>
        </div>
      </div>
      <div className="mini-grid mini-grid--primary">
        <span className="mini-grid__label"></span>
        <span className="mini-grid__header">{hero.thisHeader}</span>
        <span className="mini-grid__header">{hero.prevHeader}</span>
        <span className="mini-grid__header">{hero.avgHeader}</span>
        <span className="mini-grid__label">Spent</span>
        <Breakable className="mini-grid__value" text={hero.spentThis} />
        <Breakable className="mini-grid__value" title={hero.spentPrevTitle} text={hero.spentPrev} />
        <Breakable className="mini-grid__value" title={hero.spentAvgTitle} text={hero.spentAvg} />
        <span className="mini-grid__label">Earned</span>
        <Breakable className="mini-grid__value mini-grid__value--in" text={hero.earnThis} />
        <Breakable className="mini-grid__value mini-grid__value--in" title={hero.earnPrevTitle} text={hero.earnPrev} />
        <Breakable className="mini-grid__value mini-grid__value--in" title={hero.earnAvgTitle} text={hero.earnAvg} />
        {hero.hasConversions ? (
          <>
            <span className="mini-grid__label">Converted</span>
            <Breakable className="mini-grid__value mini-grid__value--conv" title={hero.convThis.title} text={hero.convThis.text} />
            <Breakable className="mini-grid__value mini-grid__value--conv" title={hero.convPrev.title} text={hero.convPrev.text} />
            <Breakable className="mini-grid__value mini-grid__value--conv" title={hero.convAvg.title} text={hero.convAvg.text} />
          </>
        ) : null}
      </div>
    </section>
  )
}
