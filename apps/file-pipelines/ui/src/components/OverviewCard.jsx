export default function OverviewCard({ folderCount, totals, trashCount, onReview, onCleanupAll }) {
  return (
    <section className="card card--hero" id="overviewCard" aria-labelledby="overviewHeading">
      <div className="card__header">
        <h2 id="overviewHeading">Overview</h2>
        <span className="card__header-tools">
          <span className="card__context">{folderCount} folder{folderCount === 1 ? '' : 's'} watched</span>
        </span>
      </div>
      <div className="overview__grid">
        <div className="stat-tile">
          <span className="stat-tile__label">Pending</span>
          <span className="stat-tile__value">{totals.pending}</span>
        </div>
        <div className="stat-tile">
          <span className="stat-tile__label">Processing</span>
          <span className="stat-tile__value">{totals.processing}</span>
        </div>
        <div className="stat-tile">
          <span className="stat-tile__label">Processed</span>
          <span className="stat-tile__value">{totals.processed}</span>
        </div>
        <div className="stat-tile">
          <span className="stat-tile__label">Issues</span>
          <span className={`stat-tile__value${totals.issues > 0 ? ' is-over' : ''}`}>{totals.issues}</span>
        </div>
        <div className="stat-tile">
          <span className="stat-tile__label">Trash</span>
          <span className="stat-tile__value">{trashCount}</span>
        </div>
      </div>
      <div className="overview__actions">
        <button className="outline secondary" onClick={onReview}>Review</button>
        <button disabled={!totals.cleanable} onClick={onCleanupAll}>Cleanup all{totals.cleanable ? ` (${totals.cleanable})` : ''}</button>
      </div>
    </section>
  )
}
