import { Dialog } from '@dscpln/ui-kit'

export default function ConfirmDialog({ title, text, confirmLabel, tone, onResolve, onClose }) {
  return (
    <Dialog
      className="narrow-dialog"
      data-testid="confirm-dialog"
      title={title}
      onClose={onClose}
      actions={(
        <>
          <button className="outline secondary" onClick={() => onResolve(false)}>Cancel</button>
          <button className={tone === 'danger' ? 'danger' : ''} onClick={() => onResolve(true)}>{confirmLabel}</button>
        </>
      )}
    >
      <p className="muted">{text}</p>
    </Dialog>
  )
}
