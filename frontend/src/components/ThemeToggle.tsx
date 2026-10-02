import { Sun, Moon, Monitor } from 'lucide-react'
import { useThemeStore } from '../store/themeStore'

const options = [
  { value: 'light' as const, icon: Sun, label: '浅色' },
  { value: 'dark' as const, icon: Moon, label: '深色' },
  { value: 'system' as const, icon: Monitor, label: '跟随系统' },
]

export default function ThemeToggle() {
  const { theme, setTheme } = useThemeStore()

  return (
    <div className="flex items-center bg-canvas rounded-lg p-0.5 border border-border">
      {options.map(({ value, icon: Icon, label }) => (
        <button
          key={value}
          onClick={() => setTheme(value)}
          title={label}
          aria-label={label}
          className={`w-7 h-7 flex items-center justify-center rounded-md transition-colors ${
            theme === value
              ? 'bg-surface text-accent-600 shadow-sm'
              : 'text-muted hover:text-ink'
          }`}
        >
          <Icon size={14} />
        </button>
      ))}
    </div>
  )
}
