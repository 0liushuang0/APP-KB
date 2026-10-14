import { describe, expect, it } from 'vitest'
import { isChunkLoadError, shouldReload } from '../api/chunkRecovery'

const memStore = () => {
  const m = new Map<string, string>()
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) }
}

describe('chunkRecovery', () => {
  it('recognizes dynamic import failures from different browsers', () => {
    expect(isChunkLoadError(new Error('Failed to fetch dynamically imported module: http://x/assets/A-1.js'))).toBe(true)
    expect(isChunkLoadError('error loading dynamically imported module')).toBe(true)
    expect(isChunkLoadError(new Error('Importing a module script failed.'))).toBe(true)
    expect(isChunkLoadError(new Error('Network Error'))).toBe(false)
    expect(isChunkLoadError(undefined)).toBe(false)
  })

  it('reloads once, then stops within the window to avoid a reload loop', () => {
    const s = memStore()
    expect(shouldReload(s, 1_000_000)).toBe(true)
    expect(shouldReload(s, 1_000_000 + 5_000)).toBe(false)
    expect(shouldReload(s, 1_000_000 + 31_000)).toBe(true)
  })

  it('does not reload when storage is unavailable', () => {
    const broken = { getItem: () => { throw new Error('denied') }, setItem: () => { throw new Error('denied') } }
    expect(shouldReload(broken as any)).toBe(false)
  })
})
