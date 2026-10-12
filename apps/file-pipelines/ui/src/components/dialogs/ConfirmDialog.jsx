import Modal from '../Modal.jsx'

export default function ConfirmDialog({ title, text, confirmLabel, tone, onResolve, onClose }) {
  return (
    <Modal onClose={onClose} data-testid="confirm-dialog" className="narrow-dialog">
      <article>
        <header className="card__header"><h2>{title}</h2></header>
        <p className="muted">{text}</p>
        <div className="dialog-actions">
          <button className="outline secondary" onClick={() => onResolve(false)}>Cancel</button>
          <button className={tone === 'danger' ? 'danger' : ''} onClick={() => onResolve(true)}>{confirmLabel}</button>
        </div>
      </article>
    </Modal>
  )
}
