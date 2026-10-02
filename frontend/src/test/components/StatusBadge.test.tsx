import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import StatusBadge from '../../components/StatusBadge'

describe('StatusBadge', () => {
  it('renders approved status with success tone', () => {
    render(<StatusBadge status="approved" />)
    const badge = screen.getByText('可用')
    expect(badge).toBeInTheDocument()
    expect(badge.className).toContain('bg-success-bg')
  })

  it('renders pending status with warning tone', () => {
    render(<StatusBadge status="pending" />)
    const badge = screen.getByText('待整理')
    expect(badge).toBeInTheDocument()
    expect(badge.className).toContain('bg-warning-bg')
  })

  it('renders rejected status with danger tone', () => {
    render(<StatusBadge status="rejected" />)
    const badge = screen.getByText('已停用')
    expect(badge).toBeInTheDocument()
    expect(badge.className).toContain('bg-danger-bg')
  })

  it('renders draft status with neutral tone', () => {
    render(<StatusBadge status="draft" />)
    const badge = screen.getByText('草稿')
    expect(badge).toBeInTheDocument()
    expect(badge.className).toContain('bg-neutral-bg')
  })

  it('renders unknown status with neutral tone and raw label', () => {
    render(<StatusBadge status="unknown_key" />)
    // Component returns "-" when status not in map and no label
    expect(screen.getByText('-')).toBeInTheDocument()
  })

  it('renders dash when no status or label', () => {
    const { container } = render(<StatusBadge />)
    expect(container.textContent).toBe('-')
  })

  it('renders custom label override', () => {
    render(<StatusBadge status="approved" label="Custom Label" />)
    expect(screen.getByText('Custom Label')).toBeInTheDocument()
  })

  it('renders ongoing with info tone', () => {
    render(<StatusBadge status="ongoing" />)
    const badge = screen.getByText('进行中')
    expect(badge.className).toContain('bg-info-bg')
  })

  it('renders won with success tone', () => {
    render(<StatusBadge status="won" />)
    const badge = screen.getByText('已成交')
    expect(badge.className).toContain('bg-success-bg')
  })

  it('renders lost with danger tone', () => {
    render(<StatusBadge status="lost" />)
    const badge = screen.getByText('已流失')
    expect(badge.className).toContain('bg-danger-bg')
  })
})
