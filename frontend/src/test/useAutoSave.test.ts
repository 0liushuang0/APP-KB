import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useAutoSave } from '../hooks/useAutoSave'

describe('useAutoSave', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('debounced save triggers after delay', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    const { result, rerender } = renderHook(
      ({ values }) => useAutoSave(values, onSave, { delay: 1000 }),
      { initialProps: { values: { name: 'a' } } },
    )

    expect(result.current.status).toBe('idle')

    rerender({ values: { name: 'b' } })

    // Before delay — still idle, onSave not called
    expect(result.current.status).toBe('idle')
    expect(onSave).not.toHaveBeenCalled()

    // Advance past the debounce delay
    await act(async () => {
      vi.advanceTimersByTime(1000)
    })

    expect(onSave).toHaveBeenCalledWith({ name: 'b' })
    expect(result.current.status).toBe('saved')
  })

  it('skip unchanged values', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    const { rerender } = renderHook(
      ({ values }) => useAutoSave(values, onSave, { delay: 500 }),
      { initialProps: { values: { x: 1 } } },
    )

    // Re-render with the same serialized value
    rerender({ values: { x: 1 } })

    await act(async () => {
      vi.advanceTimersByTime(500)
    })

    expect(onSave).not.toHaveBeenCalled()
  })

  it('status lifecycle: idle → saving → saved → idle', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    const { result, rerender } = renderHook(
      ({ values }) => useAutoSave(values, onSave, { delay: 200 }),
      { initialProps: { values: { a: 1 } } },
    )

    expect(result.current.status).toBe('idle')

    rerender({ values: { a: 2 } })

    await act(async () => {
      vi.advanceTimersByTime(200)
    })

    // After save resolves → saved
    expect(result.current.status).toBe('saved')

    // After 3 seconds → idle
    await act(async () => {
      vi.advanceTimersByTime(3000)
    })

    expect(result.current.status).toBe('idle')
  })

  it('error status on save failure', async () => {
    const onSave = vi.fn().mockRejectedValue(new Error('fail'))
    const onError = vi.fn()
    const { result, rerender } = renderHook(
      ({ values }) => useAutoSave(values, onSave, { delay: 200, onError }),
      { initialProps: { values: { a: 1 } } },
    )

    rerender({ values: { a: 2 } })

    await act(async () => {
      vi.advanceTimersByTime(200)
    })

    expect(result.current.status).toBe('error')
    expect(onError).toHaveBeenCalled()

    // After 5 seconds → idle
    await act(async () => {
      vi.advanceTimersByTime(5000)
    })

    expect(result.current.status).toBe('idle')
  })

  it('manual save() triggers immediately', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    const { result, rerender } = renderHook(
      ({ values }) => useAutoSave(values, onSave, { delay: 5000 }),
      { initialProps: { values: { a: 1 } } },
    )

    rerender({ values: { a: 2 } })

    await act(async () => {
      await result.current.save()
    })

    expect(onSave).toHaveBeenCalledWith({ a: 2 })
    expect(result.current.status).toBe('saved')
  })

  it('beforeunload handler calls sendBeacon', () => {
    const sendBeacon = vi.fn().mockReturnValue(true)
    Object.defineProperty(navigator, 'sendBeacon', {
      value: sendBeacon,
      writable: true,
      configurable: true,
    })

    const onSave = vi.fn().mockResolvedValue(undefined)
    const { rerender } = renderHook(
      ({ values }) => useAutoSave(values, onSave, { delay: 5000 }),
      { initialProps: { values: { a: 1 } } },
    )

    // Change values so there's an unsaved diff
    rerender({ values: { a: 2 } })

    act(() => {
      window.dispatchEvent(new Event('beforeunload'))
    })

    expect(sendBeacon).toHaveBeenCalled()
  })

  it('does not save when enabled is false', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    const { rerender } = renderHook(
      ({ values, enabled }) => useAutoSave(values, onSave, { delay: 200, enabled }),
      { initialProps: { values: { a: 1 }, enabled: false } },
    )

    rerender({ values: { a: 2 }, enabled: false })

    await act(async () => {
      vi.advanceTimersByTime(200)
    })

    expect(onSave).not.toHaveBeenCalled()
  })

  it('lastSavedText formats time correctly', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    const { result, rerender } = renderHook(
      ({ values }) => useAutoSave(values, onSave, { delay: 100 }),
      { initialProps: { values: { a: 1 } } },
    )

    expect(result.current.lastSavedText).toBeNull()

    rerender({ values: { a: 2 } })

    await act(async () => {
      vi.advanceTimersByTime(100)
    })

    expect(result.current.lastSavedText).toMatch(/^\d{2}:\d{2} 已自动保存$/)
  })
})
