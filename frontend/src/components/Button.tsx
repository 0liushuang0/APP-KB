import { Loader2 } from 'lucide-react'

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost'
  size?: 'sm' | 'md'
  loading?: boolean
  children: React.ReactNode
}

export default function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  children,
  className = '',
  disabled,
  ...props
}: ButtonProps) {
  const base =
    'inline-flex items-center justify-center rounded-md font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap'
  const sizes = {
    sm: 'px-3 py-1.5 text-xs',
    md: 'px-4 py-2 text-sm',
  }
  const variants = {
    primary: 'bg-accent-600 text-white hover:bg-accent-700 shadow-[0_1px_2px_rgba(4,120,87,.3)]',
    secondary: 'bg-surface text-ink-soft border border-border hover:bg-canvas hover:text-ink',
    danger: 'bg-danger-fg text-white hover:bg-danger-line',
    ghost: 'bg-transparent text-muted hover:bg-canvas hover:text-ink',
  }

  return (
    <button
      className={`${base} ${sizes[size]} ${variants[variant]} ${className}`}
      disabled={disabled || loading}
      {...props}
    >
      {loading && <Loader2 size={15} className="mr-1.5 animate-spin" />}
      {children}
    </button>
  )
}
