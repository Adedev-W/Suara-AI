import { useEffect, useState } from 'react'

type ThemePreference = 'system' | 'light' | 'dark'

const themes: ThemePreference[] = ['system', 'light', 'dark']

export function ThemePicker() {
  const [preference, setPreference] = useState<ThemePreference>(() => {
    const initial = document.documentElement.dataset.themePreference
    return initial === 'light' || initial === 'dark' ? initial : 'system'
  })

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const applyTheme = () => {
      document.documentElement.dataset.themePreference = preference
      document.documentElement.dataset.theme = preference === 'system'
        ? (media.matches ? 'dark' : 'light')
        : preference
    }
    applyTheme()
    media.addEventListener('change', applyTheme)
    return () => media.removeEventListener('change', applyTheme)
  }, [preference])

  const chooseTheme = (theme: ThemePreference) => {
    setPreference(theme)
    try {
      localStorage.setItem('suaraai-theme', theme)
    } catch {
      // A blocked storage area must not prevent changing the theme for this visit.
    }
  }

  return <fieldset className="theme-picker">
    <legend className="sr-only">Appearance</legend>
    {themes.map((theme) => <label className="theme-option" key={theme}>
      <input type="radio" name="appearance" value={theme} checked={preference === theme} onChange={() => chooseTheme(theme)} />
      <span>{theme === 'system' ? 'System' : theme === 'light' ? 'Light' : 'Dark'}</span>
    </label>)}
  </fieldset>
}
