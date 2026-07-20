import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

export type ThemePreference = 'system' | 'light' | 'dark'
export type ResolvedTheme = Exclude<ThemePreference, 'system'>

const storageKey = 'dlq-theme'
const darkModeQuery = '(prefers-color-scheme: dark)'

export function initializeTheme(): void {
  const preference = readThemePreference()
  applyTheme(preference, resolveTheme(preference), false)
}

export function useTheme(): {
  preference: ThemePreference
  resolvedTheme: ResolvedTheme
  setPreference(preference: ThemePreference): void
  toggleResolvedTheme(): void
} {
  const [preference, setPreferenceState] = useState<ThemePreference>(readThemePreference)
  const [systemTheme, setSystemTheme] = useState<ResolvedTheme>(readSystemTheme)
  const initialized = useRef(false)
  const resolvedTheme = preference === 'system' ? systemTheme : preference

  useEffect(() => {
    const media = window.matchMedia(darkModeQuery)
    const updateSystemTheme = (event: MediaQueryListEvent): void => setSystemTheme(event.matches ? 'dark' : 'light')
    media.addEventListener('change', updateSystemTheme)
    return () => media.removeEventListener('change', updateSystemTheme)
  }, [])

  useLayoutEffect(() => {
    applyTheme(preference, resolvedTheme, initialized.current)
    initialized.current = true
  }, [preference, resolvedTheme])

  const setPreference = useCallback((nextPreference: ThemePreference): void => {
    localStorage.setItem(storageKey, nextPreference)
    setPreferenceState(nextPreference)
  }, [])

  const toggleResolvedTheme = useCallback((): void => {
    setPreference(resolvedTheme === 'light' ? 'dark' : 'light')
  }, [resolvedTheme, setPreference])

  return { preference, resolvedTheme, setPreference, toggleResolvedTheme }
}

export function readThemePreference(): ThemePreference {
  const stored = localStorage.getItem(storageKey)
  return stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'system'
}

export function resolveTheme(preference: ThemePreference): ResolvedTheme {
  return preference === 'system' ? readSystemTheme() : preference
}

function readSystemTheme(): ResolvedTheme {
  return window.matchMedia(darkModeQuery).matches ? 'dark' : 'light'
}

function applyTheme(preference: ThemePreference, resolvedTheme: ResolvedTheme, animate: boolean): void {
  const root = document.documentElement
  root.dataset.theme = resolvedTheme
  root.dataset.themePreference = preference
  root.style.colorScheme = resolvedTheme

  const themeColor = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
  themeColor?.setAttribute('content', resolvedTheme === 'dark' ? '#151a20' : '#f2f4f6')

  if (animate && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    root.dataset.themeTransition = 'true'
    window.setTimeout(() => delete root.dataset.themeTransition, 220)
  }
}
