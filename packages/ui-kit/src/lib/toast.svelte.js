// Toast queue shared by the kit's Toasts component.

let items = $state([])
let nextId = 0

export const toasts = {
  get items() {
    return items
  },
}

export function showToast(message, tone = 'success', { timeout = 3500 } = {}) {
  const id = ++nextId
  items = [...items, { id, message, tone }]
  setTimeout(() => dismissToast(id), timeout)
  return id
}

export function dismissToast(id) {
  items = items.filter((toast) => toast.id !== id)
}
