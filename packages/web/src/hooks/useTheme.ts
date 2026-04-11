import { useState, useEffect, useCallback } from 'react'

export type Theme = 'light' | 'dark' | 'system'

function getSystemTheme(): 'light' | 'dark' {
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

function applyTheme(theme: Theme): void {
  const resolved = theme === 'system' ? getSystemTheme() : theme
  document.documentElement.classList.toggle('light', resolved === 'light')
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(() => {
    const stored = localStorage.getItem('ra-theme') as Theme | null
    return stored ?? 'dark'
  })

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next)
    localStorage.setItem('ra-theme', next)
    applyTheme(next)
  }, [])

  // Apply on mount + listen for system changes
  useEffect(() => {
    applyTheme(theme)

    if (theme !== 'system') return

    const mq = window.matchMedia('(prefers-color-scheme: light)')
    const handler = () => applyTheme('system')
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [theme])

  const cycle = useCallback(() => {
    setTheme(theme === 'dark' ? 'light' : theme === 'light' ? 'system' : 'dark')
  }, [theme, setTheme])

  const resolved: 'light' | 'dark' = theme === 'system' ? getSystemTheme() : theme

  return { theme, resolved, setTheme, cycle }
}
