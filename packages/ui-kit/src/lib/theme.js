// Theme: "auto" follows the OS and resolves to an explicit light/dark value on
// <html data-theme>, so the design tokens switch with the system. The choice is
// remembered in localStorage.

const KEY = 'dscpln-theme'

function prefersDark() {
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

export function currentTheme() {
  try {
    return localStorage.getItem(KEY) || 'auto'
  } catch {
    return 'auto'
  }
}

function apply(theme) {
  const dark = theme === 'dark' || (theme === 'auto' && prefersDark())
  document.documentElement.dataset.theme = dark ? 'dark' : 'light'
}

export function setTheme(theme) {
  if (theme === 'auto') {
    try {
      localStorage.removeItem(KEY)
    } catch {
      // storage unavailable
    }
  } else {
    try {
      localStorage.setItem(KEY, theme)
    } catch {
      // storage unavailable
    }
  }
  apply(theme)
}

export function effectiveTheme() {
  return document.documentElement.dataset.theme || (prefersDark() ? 'dark' : 'light')
}

export function toggleTheme() {
  setTheme(effectiveTheme() === 'dark' ? 'light' : 'dark')
  return currentTheme()
}

if (typeof window !== 'undefined') {
  const media = window.matchMedia('(prefers-color-scheme: dark)')
  const onSystemChange = () => {
    if (currentTheme() === 'auto') {
      apply('auto')
    }
  }
  if (media.addEventListener) {
    media.addEventListener('change', onSystemChange)
  } else if (media.addListener) {
    media.addListener(onSystemChange)
  }
}
