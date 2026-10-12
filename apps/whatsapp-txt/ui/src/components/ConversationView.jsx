import { ArrowDown, ArrowUp } from 'lucide-react'
import { bodyParts, dateLabel, timeLabel } from '../lib/format.js'

export default function ConversationView({
  conversation,
  messageView,
  skeleton,
  scrollRef,
  onScroll,
  topVisible,
  latestVisible,
  onJumpFirst,
  onJumpLatest,
  senderStyle,
}) {
  return (
    <>
      <div className="conversation-header">
        <div className="titles">
          <h2>{conversation.name}</h2>
          <div className="meta">
            {conversation.messageCount.toLocaleString()} messages · {dateLabel(conversation.first)} → {dateLabel(conversation.last)} · {conversation.senders.length} participants
          </div>
        </div>
      </div>
      <div id="message-scroll" className="message-scroll" ref={scrollRef} onScroll={onScroll}>
        {skeleton ? (
          <div className="message-rows">
            {Array.from({ length: 8 }, (_, index) => (
              <div className="skeleton-row" key={index}>
                <div className="skeleton skeleton-line short"></div>
                <div className="skeleton skeleton-line"></div>
                <div className="skeleton skeleton-line medium"></div>
              </div>
            ))}
          </div>
        ) : (
          <div className="message-rows">
            {messageView.map((row) => {
              if (row.kind === 'date') {
                return <div className="date-separator" key={row.key}><span>{row.label}</span></div>
              }
              const message = row.message
              return (
                <div
                  key={row.key}
                  className={`message type-${message.type}${row.grouped ? ' grouped' : ''}`}
                  id={`m-${message.index}`}
                  style={message.sender ? senderStyle(conversation.id, message.sender) : undefined}
                >
                  <div className="bubble">
                    {!row.grouped ? (
                      <div className="line1">
                        {message.sender ? <span className="sender">{message.sender}</span> : null}
                        <span className="time">{timeLabel(message.date)}</span>
                      </div>
                    ) : null}
                    <div className="body">
                      {bodyParts(message.body).map((part, index) => (
                        part.href
                          ? <a key={index} href={part.href} target="_blank" rel="noopener noreferrer">{part.href}</a>
                          : part.text
                      ))}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
      <div className="jump-controls">
        <button className={`jump-btn${topVisible ? '' : ' hidden'}`} title="Jump to the first message (Home)" aria-label="Jump to the first message" onClick={onJumpFirst}>
          <ArrowUp size={16} strokeWidth={1.8} />
        </button>
        <button className={`jump-btn${latestVisible ? '' : ' hidden'}`} title="Jump to the latest message (End)" aria-label="Jump to the latest message" onClick={onJumpLatest}>
          <ArrowDown size={16} strokeWidth={1.8} />
        </button>
      </div>
    </>
  )
}
