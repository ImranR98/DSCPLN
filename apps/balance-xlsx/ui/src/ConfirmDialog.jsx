import { forwardRef, useEffect, useId, useImperativeHandle, useRef, useState } from 'react'
import { Dialog } from '@dscpln/ui-kit'

const ConfirmDialog = forwardRef(function ConfirmDialog(_props, ref) {
  const rootRef = useRef(null)
  const actionRef = useRef(null)
  const titleId = useId()
  const messageId = useId()
  const [state, setState] = useState({
    title: '',
    message: '',
    confirmLabel: 'Confirm',
    cancelLabel: 'Cancel',
    danger: false,
  })

  useImperativeHandle(ref, () => ({
    show({
      title,
      message,
      confirmLabel = 'Confirm',
      cancelLabel = 'Cancel',
      danger = false,
      onConfirm,
    }) {
      actionRef.current = onConfirm
      setState({ title, message, confirmLabel, cancelLabel, danger })
      if (!rootRef.current.open) rootRef.current.showModal()
    },
  }))

  useEffect(() => {
    const element = rootRef.current
    if (!element) return undefined
    const reset = () => {
      actionRef.current = null
    }
    element.addEventListener('close', reset)
    return () => element.removeEventListener('close', reset)
  }, [])

  const confirm = () => {
    const action = actionRef.current
    rootRef.current.close()
    action?.()
  }

  return (
    <Dialog
      dialogRef={rootRef}
      autoOpen={false}
      className="narrow-dialog forecast-dialog"
      title={state.title}
      titleId={titleId}
      describedBy={messageId}
      actions={(
        <>
          <button className="outline secondary" type="button" onClick={() => rootRef.current.close()}>{state.cancelLabel}</button>
          <button className={state.danger ? 'danger' : ''} type="button" onClick={confirm}>{state.confirmLabel}</button>
        </>
      )}
    >
      <div className="confirm-dialog__message" id={messageId}>{state.message}</div>
    </Dialog>
  )
})

export default ConfirmDialog
