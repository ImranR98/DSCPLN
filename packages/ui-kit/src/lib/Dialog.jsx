import { useRef } from 'react'
import { useModal } from './useModal.js'

// Shared native-dialog shell: article/header/title, optional close button and
// action row. Set autoOpen={false} when the caller opens it imperatively via
// a forwarded ref.
export default function Dialog({
  dialogRef = null,
  title = null,
  titleId,
  describedBy,
  className = '',
  onClose,
  autoOpen = true,
  closeButton = true,
  children,
  actions = null,
  ...rest
}) {
  const localRef = useRef(null)
  const ref = dialogRef ?? localRef
  useModal(ref, onClose, { autoOpen })
  const close = () => ref.current?.close()

  return (
    <dialog
      ref={ref}
      className={className}
      aria-labelledby={titleId}
      aria-describedby={describedBy}
      {...rest}
    >
      <article>
        <header className="card__header">
          <h2 id={titleId}>{title}</h2>
          {closeButton ? (
            <span className="card__header-tools">
              <button className="outline secondary icon-button" type="button" aria-label="Close" onClick={close}>&times;</button>
            </span>
          ) : null}
        </header>
        {children}
        {actions ? <div className="dialog-actions">{actions}</div> : null}
      </article>
    </dialog>
  )
}
