import { useRef } from 'react'
import { useModal } from '@dscpln/ui-kit'

// A <dialog> rendered as a true modal while mounted; onClose runs whenever the
// dialog is dismissed (backdrop/Escape/close button).
export default function Modal({ onClose, children, ...rest }) {
  const ref = useRef(null)
  useModal(ref, onClose)
  return (
    <dialog ref={ref} {...rest}>
      {children}
    </dialog>
  )
}
