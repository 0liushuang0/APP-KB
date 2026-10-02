import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import EmptyState from '../../components/EmptyState'

describe('EmptyState', () => {
  it('renders title', () => {
    render(<EmptyState title="No data" />)
    expect(screen.getByText('No data')).toBeInTheDocument()
  })

  it('renders description', () => {
    render(<EmptyState description="Nothing here yet" />)
    expect(screen.getByText('Nothing here yet')).toBeInTheDocument()
  })

  it('renders action button', () => {
    render(<EmptyState action={<button>Create new</button>} />)
    expect(screen.getByText('Create new')).toBeInTheDocument()
  })

  it('renders custom icon', () => {
    const CustomIcon = ({ className }: any) => (
      <svg data-testid="custom-icon" className={className} />
    )
    render(<EmptyState icon={CustomIcon} />)
    expect(screen.getByTestId('custom-icon')).toBeInTheDocument()
  })

  it('renders default title and description', () => {
    render(<EmptyState />)
    expect(screen.getByText('暂无数据')).toBeInTheDocument()
    expect(screen.getByText('还没有任何记录')).toBeInTheDocument()
  })

  it('applies bare class when bare is true', () => {
    const { container } = render(<EmptyState bare />)
    const wrapper = container.firstChild as HTMLElement
    expect(wrapper.className).not.toContain('bg-surface')
  })

  it('applies border class when bare is false', () => {
    const { container } = render(<EmptyState />)
    const wrapper = container.firstChild as HTMLElement
    expect(wrapper.className).toContain('border')
  })
})
