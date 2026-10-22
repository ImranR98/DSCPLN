import { useEffect, useRef } from 'react'

// Opens a declaratively rendered <dialog> as a true modal on mount (so it gets
// the full-viewport ::backdrop) and calls onClose when the user dismisses it.
// <dialog ref={ref} className="narrow-dialog"> ... </dialog> + useModal(ref, onClose)
export function useModal(ref, onClose, { autoOpen = true } = {}) {
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    const element = ref.current
    if (!element) return undefined
    let closing = false
    const handleClose = () => {
      if (!closing) onCloseRef.current?.()
    }
    element.addEventListener('close', handleClose)
    if (autoOpen && !element.open) element.showModal()
    return () => {
      closing = true
      element.removeEventListener('close', handleClose)
      if (element.open) element.close()
    }
  }, [ref, autoOpen])
}
