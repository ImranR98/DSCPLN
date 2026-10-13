import test from 'node:test'
import assert from 'node:assert/strict'
import { showToast, dismissToast, toasts } from '../src/lib/toast.js'

const clearAll = () => {
  for (const toast of [...toasts.items]) dismissToast(toast.id)
}

test('showToast appends and notifies subscribers', () => {
  clearAll()
  let calls = 0
  const unsubscribe = toasts.subscribe(() => {
    calls += 1
  })
  try {
    const id = showToast('hello', 'error', { timeout: 500 })
    assert.equal(toasts.items.length, 1)
    assert.deepEqual(toasts.items[0], { id, message: 'hello', tone: 'error' })
    assert.equal(calls, 1)
    dismissToast(id)
    assert.equal(calls, 2)
  } finally {
    unsubscribe()
    clearAll()
  }
})

test('dismissToast ignores unknown ids', () => {
  clearAll()
  showToast('keep', 'success', { timeout: 500 })
  dismissToast(-1)
  assert.equal(toasts.items.length, 1)
  clearAll()
})

test('toasts auto-dismiss after their timeout', async () => {
  clearAll()
  showToast('brief', 'success', { timeout: 10 })
  assert.equal(toasts.items.length, 1)
  await new Promise((resolve) => setTimeout(resolve, 40))
  assert.equal(toasts.items.length, 0)
})

test('the default tone is success', () => {
  clearAll()
  showToast('plain', undefined, { timeout: 500 })
  assert.equal(toasts.items[0].tone, 'success')
  clearAll()
})
