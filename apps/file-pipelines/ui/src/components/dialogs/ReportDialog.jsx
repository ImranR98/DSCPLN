import Modal from '../Modal.jsx'

export default function ReportDialog({ entries, onClose }) {
  return (
    <Modal onClose={onClose} className="wide-dialog">
      <article>
        <header className="card__header"><h2>Report</h2></header>
        <div className="checklist">
          {entries.map((entry) => (
            <div className="checklist__row" key={entry.name + (entry.reason ?? '')}>
              <span className="checklist__main">{entry.name}</span>
              <span className="checklist__meta"><span className="msg error">{entry.reason ?? ''}</span></span>
            </div>
          ))}
        </div>
        <div className="dialog-actions">
          <button onClick={onClose}>Close</button>
        </div>
      </article>
    </Modal>
  )
}
