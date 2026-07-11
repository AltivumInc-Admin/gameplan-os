// Theme state. index.html stamps data-theme before first paint; this module
// owns every change after boot. 'sitrep-theme' absent = follow the system.

export type Theme = 'dark' | 'light'

const KEY = 'sitrep-theme'

export function currentTheme(): Theme {
  return document.documentElement.getAttribute('data-theme') === 'light'
    ? 'light'
    : 'dark'
}

export function setTheme(theme: Theme) {
  document.documentElement.setAttribute('data-theme', theme)
  try {
    localStorage.setItem(KEY, theme)
  } catch {
    // Private-mode storage failures degrade to a session-only choice.
  }
}

export function toggleTheme(): Theme {
  const next: Theme = currentTheme() === 'dark' ? 'light' : 'dark'
  setTheme(next)
  return next
}
