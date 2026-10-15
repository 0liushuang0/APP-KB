import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import StatusBadge from '../components/StatusBadge'
import DistributionBars from '../components/charts/DistributionBars'
import MonthlyBars from '../components/charts/MonthlyBars'
import ProjectGantt from '../components/charts/ProjectGantt'
import StatCards from '../components/StatCards'
import { ClipboardList } from 'lucide-react'

describe('StatusBadge wording per object kind', () => {
  it('business documents say 已审核, library items say 可用, projects say 已立项', () => {
    const { rerender } = render(<StatusBadge status="approved" />)
    expect(screen.getByText('已审核')).toBeInTheDocument()
    rerender(<StatusBadge status="approved" kind="library" />)
    expect(screen.getByText('可用')).toBeInTheDocument()
    rerender(<StatusBadge status="approved" kind="project" />)
    expect(screen.getByText('已立项')).toBeInTheDocument()
  })
})

describe('charts', () => {
  it('distribution bars sort by count, fold the tail into 其他 and act as a filter', () => {
    const pick = vi.fn()
    render(
      <DistributionBars
        max={2}
        onPick={pick}
        items={[
          { key: '冶金', label: '冶金', count: 150 },
          { key: '有色', label: '有色', count: 20 },
          { key: '汽车', label: '汽车', count: 5 },
        ]}
      />,
    )
    const rows = screen.getAllByRole('button')
    expect(rows[0]).toHaveTextContent('冶金')
    expect(screen.getByText('其他 5')).toBeInTheDocument()
    fireEvent.click(rows[1])
    expect(pick).toHaveBeenCalledWith('有色')
  })

  it('monthly bars show both series totals', () => {
    render(
      <MonthlyBars
        data={[
          { month: '2026-09', quoteAmount: 200000, quoteCount: 1, dealAmount: 0, dealCount: 0 },
          { month: '2026-10', quoteAmount: 0, quoteCount: 0, dealAmount: 2960000, dealCount: 2 },
        ]}
      />,
    )
    expect(screen.getByText(/报价 20.0 万/)).toBeInTheDocument()
    expect(screen.getByText(/签约 296.0 万/)).toBeInTheDocument()
  })

  it('gantt explains undated projects instead of drawing nothing', () => {
    const { rerender } = render(<ProjectGantt rows={[{ id: 'a', label: '多辊矫直机' }]} />)
    expect(screen.getByText(/从合同立项时会自动带出/)).toBeInTheDocument()
    const pick = vi.fn()
    rerender(<ProjectGantt onPick={pick} rows={[{ id: 'b', label: '破鳞矫直机', start: '2026-02-13', end: '2026-10-13', progress: 0, health: 'red' }]} />)
    fireEvent.click(screen.getByText('破鳞矫直机'))
    expect(pick).toHaveBeenCalledWith('b')
  })
})

describe('StatCards as filters', () => {
  it('marks the active card and paints alert counts', () => {
    const onClick = vi.fn()
    render(<StatCards items={[{ label: '跟进超期', value: 3, icon: ClipboardList, alert: true, active: true, onClick }]} />)
    const card = screen.getByRole('button', { name: /跟进超期/ })
    expect(card).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('3').className).toContain('text-danger-fg')
    fireEvent.click(card)
    expect(onClick).toHaveBeenCalled()
  })
})
