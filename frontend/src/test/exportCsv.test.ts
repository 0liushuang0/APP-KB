import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { exportCsv } from '../utils/exportCsv'

describe('exportCsv', () => {
  let mockClick: ReturnType<typeof vi.fn>
  let mockRemove: ReturnType<typeof vi.fn>
  let anchorEl: any

  beforeEach(() => {
    mockClick = vi.fn()
    mockRemove = vi.fn()

    anchorEl = { href: '', download: '', click: mockClick, remove: mockRemove }
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      if (tag === 'a') return anchorEl as any
      return document.createElement(tag)
    })
    vi.spyOn(document.body, 'appendChild').mockImplementation((() => {}) as any)
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('basic export creates a download', () => {
    const columns = [
      { key: 'name', title: 'Name' },
      { key: 'age', title: 'Age' },
    ]
    const data = [
      { name: 'Alice', age: 30 },
      { name: 'Bob', age: 25 },
    ]

    exportCsv('test', columns, data)

    expect(URL.createObjectURL).toHaveBeenCalled()
    expect(document.body.appendChild).toHaveBeenCalled()
    expect(mockClick).toHaveBeenCalled()
    expect(mockRemove).toHaveBeenCalled()
    expect(URL.revokeObjectURL).toHaveBeenCalled()
  })

  it('UTF-8 BOM header is included', () => {
    const blobSpy = vi.spyOn(global, 'Blob')
    exportCsv('test', [{ key: 'x', title: 'X' }], [{ x: 'val' }])

    const blobArg = blobSpy.mock.calls[0][0] as string[]
    expect(blobArg[0]).toContain('\uFEFF')
    blobSpy.mockRestore()
  })

  it('comma escaping wraps field in quotes', () => {
    const blobSpy = vi.spyOn(global, 'Blob')
    exportCsv('test', [{ key: 'val', title: 'Value' }], [{ val: 'a,b' }])

    const csv = (blobSpy.mock.calls[0][0] as string[])[0]
    expect(csv).toContain('"a,b"')
    blobSpy.mockRestore()
  })

  it('quote escaping doubles internal quotes', () => {
    const blobSpy = vi.spyOn(global, 'Blob')
    exportCsv('test', [{ key: 'val', title: 'Value' }], [{ val: 'say "hello"' }])

    const csv = (blobSpy.mock.calls[0][0] as string[])[0]
    expect(csv).toContain('"say ""hello"""')
    blobSpy.mockRestore()
  })

  it('newline escaping wraps field in quotes', () => {
    const blobSpy = vi.spyOn(global, 'Blob')
    exportCsv('test', [{ key: 'val', title: 'Value' }], [{ val: 'line1\nline2' }])

    const csv = (blobSpy.mock.calls[0][0] as string[])[0]
    expect(csv).toContain('"line1\nline2"')
    blobSpy.mockRestore()
  })

  it('custom columns with render function', () => {
    const blobSpy = vi.spyOn(global, 'Blob')
    const columns = [
      { key: 'name', title: 'Name' },
      {
        key: 'price',
        title: 'Price',
        render: (row: any) => `$${row.price.toFixed(2)}`,
      },
    ]
    exportCsv('test', columns, [{ name: 'Widget', price: 9.9 }])

    const csv = (blobSpy.mock.calls[0][0] as string[])[0]
    expect(csv).toContain('$9.90')
    blobSpy.mockRestore()
  })

  it('auto-naming includes date in filename', () => {
    exportCsv('report', [{ key: 'x', title: 'X' }], [{ x: 1 }])
    expect(anchorEl.download).toMatch(/^report-\d{4}-\d{2}-\d{2}\.csv$/)
  })

  it('does nothing when data is empty', () => {
    exportCsv('test', [{ key: 'x', title: 'X' }], [])

    expect(URL.createObjectURL).not.toHaveBeenCalled()
    expect(mockClick).not.toHaveBeenCalled()
  })

  it('handles null/undefined values as empty string', () => {
    const blobSpy = vi.spyOn(global, 'Blob')
    exportCsv('test', [{ key: 'val', title: 'Val' }], [{ val: null }, { val: undefined }])

    const csv = (blobSpy.mock.calls[0][0] as string[])[0]
    const lines = csv.split('\n')
    expect(lines).toHaveLength(3)
    blobSpy.mockRestore()
  })
})
