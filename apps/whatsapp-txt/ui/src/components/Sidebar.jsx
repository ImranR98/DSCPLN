import { dateLabel, initials } from '../lib/format.js'

export default function Sidebar({ conversations, activeId, open, filter, onFilterChange, senderStyle, onOpen }) {
  return (
    <aside id="sidebar" className={`sidebar${open ? ' open' : ''}`} aria-label="Conversations">
      <div className="sidebar-head">
        <input id="conversation-filter" type="search" placeholder="Filter conversations" autoComplete="off" spellCheck="false"
          aria-label="Filter conversations" value={filter} onChange={(event) => onFilterChange(event.target.value)} />
      </div>
      <ul id="conversation-list" className="conversation-list">
        {conversations.map((entry) => (
          <li
            key={entry.id}
            className={`conversation-item${activeId === entry.id ? ' active' : ''}`}
            tabIndex="0"
            role="button"
            aria-current={activeId === entry.id ? 'true' : undefined}
            onClick={() => onOpen(entry.id)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                onOpen(entry.id)
              }
            }}
          >
            <div className="avatar" style={senderStyle(entry.id, (entry.senders && entry.senders[0]) ?? entry.name)}>{initials(entry.name)}</div>
            <div className="info">
              <div className="name">{entry.name}</div>
              <div className="meta">
                <span>{entry.messageCount.toLocaleString()} msgs</span>
                <span>{dateLabel(entry.last)}</span>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </aside>
  )
}
