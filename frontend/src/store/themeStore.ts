import { create } from 'zustand'
import { persist } from 'zustand/middleware'

type Theme = 'light' | 'dark' | 'system'

interface ThemeState {
  theme: Theme
  resolved: 'light' | 'dark'
  setTheme: (theme: Theme) => void
  initTheme: () => void
}

function getSystemTheme(): 'light' | 'dark' {
  if (typeof window === 'undefined') return 'light'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function applyTheme(resolved: 'light' | 'dark') {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  if (resolved === 'dark') {
    root.classList.add('dark')
  } else {
    root.classList.remove('dark')
  }
  root.style.colorScheme = resolved
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      theme: 'system',
      resolved: getSystemTheme(),

      setTheme: (theme) => {
        const resolved = theme === 'system' ? getSystemTheme() : theme
        applyTheme(resolved)
        set({ theme, resolved })
      },

      initTheme: () => {
        const { theme } = get()
        const resolved = theme === 'system' ? getSystemTheme() : theme
        applyTheme(resolved)
        set({ resolved })

        // Listen for system theme changes when using 'system'
        const mq = window.matchMedia('(prefers-color-scheme: dark)')
        const handler = () => {
          if (get().theme === 'system') {
            const newResolved = getSystemTheme()
            applyTheme(newResolved)
            set({ resolved: newResolved })
          }
        }
        mq.addEventListener('change', handler)
      },
    }),
    {
      name: 'aikb-theme',
      partialize: (state) => ({ theme: state.theme }),
    },
  ),
)
