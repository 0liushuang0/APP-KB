import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import Skeleton from '../../components/Skeleton'

describe('Skeleton', () => {
  it('renders with default class', () => {
    const { container } = render(<Skeleton />)
    const el = container.firstChild as HTMLElement
    expect(el).toBeInTheDocument()
    expect(el.className).toContain('animate-pulse')
    expect(el.className).toContain('bg-border')
    expect(el.className).toContain('rounded')
  })

  it('accepts className prop', () => {
    const { container } = render(<Skeleton className="w-32 h-4" />)
    const el = container.firstChild as HTMLElement
    expect(el.className).toContain('w-32')
    expect(el.className).toContain('h-4')
  })

  it('renders a div element', () => {
    const { container } = render(<Skeleton />)
    expect(container.firstChild?.nodeName).toBe('DIV')
  })
})
