import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: {
    generatedAt: '2026-09-30T08:00:00Z',
    project: { projectNo: 'PRJ-001', name: '试制设备', status: 'completed', progress: 100 },
    customer: { name: '示例客户' },
    team: { managerId: 'manager' },
    scope: { requirement: { title: '设备需求' }, proposal: { title: '技术方案' },
      quotation: { quotationNo: 'QUO-001', amount: 100000 } },
    execution: { completedStages: 2, totalStages: 2, completedTasks: 4, totalTasks: 4,
      taskCompletionRate: 100, stages: [] },
    financials: { contract: { contractNo: 'CON-001', amount: 100000 },
      payments: { nodes: [], summary: { totalDue: 100000, totalReceived: 60000, outstanding: 40000 } },
      estimatedMargin: { estimatedCost: 70000, estimatedMarginPercent: 30,
        note: '基于报价估算，非实际利润' } },
    risks: [], pending: { incompleteTasks: [], outstandingPayments: '尚有 40000 元未收回' },
    afterSales: { suggestion: '建立售后工单' },
  } }),
}))

import ProjectCompletionReport from '../pages/ProjectCompletionReport'

describe('project completion report page', () => {
  it('shows delivery, cash collection and estimate limitations', () => {
    render(<MemoryRouter initialEntries={['/projects/p1/report']}>
      <Routes><Route path="/projects/:id/report" element={<ProjectCompletionReport />} /></Routes>
    </MemoryRouter>)
    expect(screen.getByText('项目结项报告')).toBeInTheDocument()
    expect(screen.getByText('试制设备', { exact: false })).toBeInTheDocument()
    expect(screen.getByText(/未收：¥40,000.00/)).toBeInTheDocument()
    expect(screen.getByText('基于报价估算，非实际利润')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '打印 / 保存为 PDF' })).toBeInTheDocument()
  })
})
