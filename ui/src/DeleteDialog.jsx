import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { deleteJson, showToast } from '@dscpln/ui-kit'


const DeleteDialog = forwardRef(function DeleteDialog({ money, onrefresh }, ref) {
  const rootRef = useRef(null)
  const [pending, setPending] = useState(null)
  const [description, setDescription] = useState('')
  const [formError, setFormError] = useState('')
  const [deleting, setDeleting] = useState(false)

  useImperativeHandle(ref, () => ({
    show(transaction) {
      setPending(transaction)
      const amount = transaction.kind === 'income' ? transaction.moneyIn : transaction.expenses
      setDescription(`${money(amount || 0, transaction.currency)} · ${transaction.details || 'No details'}`)
      setFormError('')
      rootRef.current.showModal()
    },
  }))

  useEffect(() => {
    const element = rootRef.current
    if (!element) return undefined
    const handleClose = () => setPending(null)
    element.addEventListener('close', handleClose)
    return () => element.removeEventListener('close', handleClose)
  }, [])

  const confirm = async () => {
    if (!pending) return
    setDeleting(true)
    try {
      await deleteJson(`/transactions/${encodeURIComponent(pending.id)}`)
      rootRef.current.close()
      setPending(null)
      showToast('Transaction deleted')
      onrefresh?.()
    } catch (e) {
      if (e.status === 409) {
        rootRef.current.close()
        setPending(null)
        showToast(e.message, 'error')
        onrefresh?.()
      } else {
        if (!e.status) {
          console.error(e)
        }
        setFormError(e.status ? e.message : 'Could not delete the transaction. Check the server logs.')
      }
    } finally {
      setDeleting(false)
    }
  }

  return (
    <dialog ref={rootRef} className="narrow-dialog">
      <article>
        <header className="card__header">
          <h2>Delete transaction</h2>
          <span className="card__header-tools">
            <button className="outline secondary icon-button" type="button" aria-label="Close" onClick={() => rootRef.current.close()}>&times;</button>
          </span>
        </header>

        <p className="muted">{description}</p>
        {formError ? <p className="form-error">{formError}</p> : null}

        <div className="dialog-actions">
          <button className="outline secondary" type="button" onClick={() => rootRef.current.close()}>Cancel</button>
          <button className="danger" type="button" disabled={deleting} onClick={confirm}>Delete</button>
        </div>
      </article>
    </dialog>
  )
})

export default DeleteDialog
