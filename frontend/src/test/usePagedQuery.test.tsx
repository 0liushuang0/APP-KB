import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { usePagedQuery } from '../hooks/usePagedQuery'
import type { ReactNode } from 'react'

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

const mockPagedResponse = (page: number, pageSize: number, total: number) => ({
  list: Array.from({ length: Math.min(pageSize, total - (page - 1) * pageSize) }, (_, i) => ({
    id: (page - 1) * pageSize + i + 1,
    name: `item-${(page - 1) * pageSize + i + 1}`,
  })),
  total,
  page,
  pageSize,
  totalPages: Math.ceil(total / pageSize),
})

describe('usePagedQuery', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('initial page load', async () => {
    const fetcher = vi.fn().mockResolvedValue(mockPagedResponse(1, 20, 50))

    const { result } = renderHook(
      () => usePagedQuery({ key: ['test'], fetcher, initialPageSize: 20 }),
      { wrapper: createWrapper() },
    )

    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(result.current.list).toHaveLength(20)
    expect(result.current.total).toBe(50)
    expect(result.current.page).toBe(1)
    expect(fetcher).toHaveBeenCalledWith(expect.objectContaining({ page: 1, pageSize: 20 }))
  })

  it('page change', async () => {
    const fetcher = vi.fn().mockResolvedValue(mockPagedResponse(1, 20, 50))

    const { result } = renderHook(
      () => usePagedQuery({ key: ['test'], fetcher, initialPageSize: 20 }),
      { wrapper: createWrapper() },
    )

    await waitFor(() => expect(result.current.isLoading).toBe(false))

    // Change to page 2
    fetcher.mockResolvedValueOnce(mockPagedResponse(2, 20, 50))

    act(() => {
      result.current.setPage(2)
    })

    await waitFor(() => expect(result.current.page).toBe(2))
    expect(fetcher).toHaveBeenCalledWith(expect.objectContaining({ page: 2, pageSize: 20 }))
  })

  it('page size change resets to page 1', async () => {
    const fetcher = vi.fn().mockResolvedValue(mockPagedResponse(1, 20, 50))

    const { result } = renderHook(
      () => usePagedQuery({ key: ['test'], fetcher, initialPageSize: 20 }),
      { wrapper: createWrapper() },
    )

    await waitFor(() => expect(result.current.isLoading).toBe(false))

    // Go to page 3 first
    fetcher.mockResolvedValueOnce(mockPagedResponse(3, 20, 50))
    act(() => { result.current.setPage(3) })
    await waitFor(() => expect(result.current.page).toBe(3))

    // Change page size — should reset to page 1
    fetcher.mockResolvedValueOnce(mockPagedResponse(1, 50, 50))
    act(() => { result.current.setPageSize(50) })

    await waitFor(() => {
      expect(result.current.pageSize).toBe(50)
    })
    // page should be reset to 1 by the useEffect
    expect(result.current.page).toBe(1)
  })

  it('query invalidation refetches data', async () => {
    let callCount = 0
    const fetcher = vi.fn().mockImplementation(() => {
      callCount++
      return Promise.resolve(mockPagedResponse(1, 20, callCount === 1 ? 50 : 60))
    })

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })

    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )

    const { result } = renderHook(
      () => usePagedQuery({ key: ['test'], fetcher, initialPageSize: 20 }),
      { wrapper },
    )

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.total).toBe(50)

    // Invalidate triggers refetch
    await act(async () => {
      queryClient.invalidateQueries({ queryKey: ['test'] })
    })

    await waitFor(() => expect(result.current.total).toBe(60))
  })
})
