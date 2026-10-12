import { useSyncExternalStore } from 'react'
import { Check, CircleAlert } from 'lucide-react'
import { dismissToast, toasts } from './toast.js'

export default function Toasts() {
  const items = useSyncExternalStore(toasts.subscribe, () => toasts.items)
  return (
    <div className="toasts" aria-live="polite" aria-atomic="false" data-testid="toasts">
      {items.map((toast) => (
        <div
          key={toast.id}
          className={`toast toast--${toast.tone}`}
          role="status"
          onClick={() => dismissToast(toast.id)}
        >
          <span className="toast__icon">
            {toast.tone === 'error' ? <CircleAlert size={16} /> : <Check size={16} />}
          </span>
          <span>{toast.message}</span>
        </div>
      ))}
    </div>
  )
}
