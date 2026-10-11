// Theme is Pico's: the effective theme comes from <html data-theme> when set,
// otherwise the OS preference. The choice is remembered in localStorage.

const KEY = 'dscpln-theme'

export function currentTheme() {
  try {
    return localStorage.getItem(KEY) || 'auto'
  } catch {
    return 'auto'
  }
}

export function setTheme(theme) {
  const root = document.documentElement
  if (theme === 'auto') {
    delete root.dataset.theme
    try {
      localStorage.removeItem(KEY)
    } catch {
      // storage unavailable
    }
    return
  }
  root.dataset.theme = theme
  try {
    localStorage.setItem(KEY, theme)
  } catch {
    // storage unavailable
  }
}

export function effectiveTheme() {
  return document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
}

export function toggleTheme() {
  setTheme(effectiveTheme() === 'dark' ? 'light' : 'dark')
  return currentTheme()
}
