import { useState } from 'react'
import { Monitor, Moon, Sun } from 'lucide-react'
import { currentTheme, setTheme } from './theme.js'

const ORDER = ['auto', 'light', 'dark']

export default function ThemeToggle() {
  const [theme, updateTheme] = useState(currentTheme)

  const cycle = () => {
    const next = ORDER[(ORDER.indexOf(theme) + 1) % ORDER.length]
    updateTheme(next)
    setTheme(next)
  }

  return (
    <button
      className="outline secondary icon-button"
      type="button"
      data-testid="theme-toggle"
      title={`Theme: ${theme}`}
      aria-label={`Theme: ${theme}. Click to change.`}
      onClick={cycle}
    >
      {theme === 'auto' ? (
        <Monitor size={16} strokeWidth={1.8} />
      ) : theme === 'dark' ? (
        <Moon size={16} strokeWidth={1.8} />
      ) : (
        <Sun size={16} strokeWidth={1.8} />
      )}
    </button>
  )
}
