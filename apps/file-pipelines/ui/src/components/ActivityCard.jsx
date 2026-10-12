import { RefreshCw } from 'lucide-react'

export default function ActivityCard({ logLines, onRefresh }) {
  return (
    <section className="card" id="activityCard" aria-labelledby="activityHeading">
      <div className="card__header">
        <h2 id="activityHeading">Activity</h2>
        <span className="card__header-tools">
          <button className="outline secondary icon-button" title="Refresh log" aria-label="Refresh log" onClick={onRefresh}>
            <RefreshCw size={16} strokeWidth={1.8} />
          </button>
        </span>
      </div>
      <pre className="code-block activity-log">{logLines.join('\n') || 'No activity yet.'}</pre>
    </section>
  )
}
