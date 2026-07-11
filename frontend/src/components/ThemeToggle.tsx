import { useState } from 'react'
import { currentTheme, toggleTheme, type Theme } from '../theme'

export default function ThemeToggle() {
  const [theme, setThemeState] = useState<Theme>(currentTheme())
  return (
    <button
      className="mini ghost theme-toggle"
      onClick={() => setThemeState(toggleTheme())}
      title={theme === 'dark' ? 'Switch to the light theme' : 'Switch to the dark theme'}
    >
      {theme === 'dark' ? 'Light' : 'Dark'}
    </button>
  )
}
