import test from 'node:test'
import assert from 'node:assert/strict'
import { currentTheme, effectiveTheme, setTheme, toggleTheme } from '../src/lib/theme.js'

// theme.js resolves globals at call time, so tests install stubs after import.
const installStubs = ({ dark = false, stored = null } = {}) => {
  const store = new Map(stored == null ? [] : [['dscpln-theme', stored]])
  globalThis.localStorage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
  }
  globalThis.window = {
    matchMedia: () => ({ matches: dark, addEventListener: () => {}, removeEventListener: () => {} }),
  }
  globalThis.document = { documentElement: { dataset: {} } }
  return store
}

const removeStubs = () => {
  delete globalThis.localStorage
  delete globalThis.window
  delete globalThis.document
}

test('setTheme persists explicit themes and applies data-theme', () => {
  const store = installStubs()
  try {
    setTheme('dark')
    assert.equal(store.get('dscpln-theme'), 'dark')
    assert.equal(document.documentElement.dataset.theme, 'dark')
    assert.equal(currentTheme(), 'dark')

    setTheme('light')
    assert.equal(document.documentElement.dataset.theme, 'light')
  } finally {
    removeStubs()
  }
})

test('setTheme("auto") clears the stored choice and follows the system', () => {
  const store = installStubs({ dark: true, stored: 'light' })
  try {
    setTheme('auto')
    assert.equal(store.has('dscpln-theme'), false)
    assert.equal(document.documentElement.dataset.theme, 'dark')
    assert.equal(currentTheme(), 'auto')
  } finally {
    removeStubs()
  }
})

test('effectiveTheme falls back to the system preference', () => {
  installStubs({ dark: true })
  try {
    assert.equal(effectiveTheme(), 'dark')
    setTheme('light')
    assert.equal(effectiveTheme(), 'light')
  } finally {
    removeStubs()
  }
})

test('toggleTheme flips between explicit themes', () => {
  installStubs({ dark: false })
  try {
    setTheme('light')
    assert.equal(toggleTheme(), 'dark')
    assert.equal(toggleTheme(), 'light')
  } finally {
    removeStubs()
  }
})

test('currentTheme defaults to auto when storage throws', () => {
  globalThis.localStorage = {
    getItem: () => {
      throw new Error('denied')
    },
  }
  try {
    assert.equal(currentTheme(), 'auto')
  } finally {
    removeStubs()
  }
})
