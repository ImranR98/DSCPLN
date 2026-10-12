import { dateLabel, timeLabel, typeLabel } from '../lib/format.js'

export default function SearchView({
  conversations,
  filters,
  summary,
  error,
  results,
  renderedCount,
  totalCount,
  onFilter,
  onRetry,
  onOpenResult,
  senderStyle,
  sentinelRef,
}) {
  return (
    <div className="search-view">
      <div className="search-filters">
        <select aria-label="Filter by conversation" value={filters.conversation}
          onChange={(event) => onFilter('conversation', event.target.value)}>
          <option value="">All conversations</option>
          {conversations.map((entry) => (
            <option key={entry.id} value={entry.id}>{entry.name}</option>
          ))}
        </select>
        <input className="sender-input" placeholder="Sender" aria-label="Filter by sender" value={filters.sender}
          onChange={(event) => onFilter('sender', event.target.value)} />
        <select aria-label="Filter by type" value={filters.type}
          onChange={(event) => onFilter('type', event.target.value)}>
          <option value="">Any type</option>
          {['text', 'media', 'attachment', 'deleted', 'system'].map((type) => (
            <option key={type} value={type}>{typeLabel(type)}</option>
          ))}
        </select>
        <input type="date" title="From date" aria-label="From date" value={filters.from}
          onChange={(event) => onFilter('from', event.target.value)} />
        <input type="date" title="To date" aria-label="To date" value={filters.to}
          onChange={(event) => onFilter('to', event.target.value)} />
        <select aria-label="Result order" value={filters.order}
          onChange={(event) => onFilter('order', event.target.value)}>
          <option value="desc">Newest first</option>
          <option value="asc">Oldest first</option>
        </select>
        <label className="whole-toggle">
          <input type="checkbox" checked={filters.whole === '1'}
            onChange={(event) => onFilter('whole', event.target.checked ? '1' : '')} />
          <span>Whole words</span>
        </label>
      </div>
      <div className="search-summary">{summary}</div>
      <div className="search-results">
        {error ? (
          <div className="search-error">
            <span>{error}</span>
            <button onClick={onRetry}>Retry</button>
          </div>
        ) : !summary ? (
          <div className="empty-state">Type to search, or use the filters above.</div>
        ) : null}
        {results.map((result) => (
          <div className="result" tabIndex="0" role="button" key={`${result.conversationId}:${result.index}`}
            onClick={() => onOpenResult(result)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                onOpenResult(result)
              }
            }}
          >
            <div className="line1">
              <span className="conversation-name">{result.conversationName}</span>
              <span className="result-time">{dateLabel(result.date)} {timeLabel(result.date)}</span>
              {result.sender ? (
                <span className="sender-chip" style={senderStyle(result.conversationId, result.sender)}>{result.sender}</span>
              ) : null}
              {typeLabel(result.type) ? <span className="type-badge">{typeLabel(result.type)}</span> : null}
            </div>
            <div className="snippet">
              {!result.matchLength ? (
                result.snippet
              ) : (
                <>
                  {result.snippet.slice(0, result.matchStart)}<mark>{result.snippet.slice(result.matchStart, result.matchStart + result.matchLength)}</mark>{result.snippet.slice(result.matchStart + result.matchLength)}
                </>
              )}
            </div>
          </div>
        ))}
        {renderedCount < totalCount ? (
          <div className="sentinel" ref={sentinelRef}></div>
        ) : null}
      </div>
    </div>
  )
}
