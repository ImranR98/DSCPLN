import { Dialog } from '@dscpln/ui-kit'

export default function ReportDialog({ entries, onClose }) {
  return (
          <Dialog onClose={onClose} className="wide-dialog" title="Report">
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
    </Dialog>
  )
}
