// Toast queue shared by the kit's Toasts component.
// Framework-free store: components subscribe with useSyncExternalStore.

let items = []
let nextId = 0
const listeners = new Set()

const emit = () => {
  for (const listener of listeners) listener()
}

export const toasts = {
  get items() {
    return items
  },
  subscribe(listener) {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
}

export function showToast(message, tone = 'success', { timeout = 3500 } = {}) {
  const id = ++nextId
  items = [...items, { id, message, tone }]
  emit()
  setTimeout(() => dismissToast(id), timeout)
  return id
}

export function dismissToast(id) {
  const next = items.filter((toast) => toast.id !== id)
  if (next.length === items.length) return
  items = next
  emit()
}
