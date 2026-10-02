/**
 * CSV 导出工具。
 *
 * 将数据数组导出为 CSV 文件并触发浏览器下载。
 * 支持中文（BOM 头）、自动列宽、自定义表头。
 */

export interface CsvColumn<T> {
  key: string
  title: string
  render?: (row: T) => string | number | null | undefined
}

/**
 * 导出数据为 CSV 文件。
 *
 * @param fileName  文件名（不含 .csv 后缀）
 * @param columns   列定义
 * @param data      数据数组
 */
export function exportCsv<T extends Record<string, any>>(
  fileName: string,
  columns: CsvColumn<T>[],
  data: T[],
): void {
  if (!data.length) return

  // BOM 头确保 Excel 打开中文不乱码
  const BOM = '\uFEFF'

  const header = columns.map((c) => escapeCsv(c.title)).join(',')

  const rows = data.map((row) =>
    columns
      .map((col) => {
        const value = col.render ? col.render(row) : row[col.key]
        return escapeCsv(value)
      })
      .join(','),
  )

  const csv = BOM + [header, ...rows].join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)

  const a = document.createElement('a')
  a.href = url
  a.download = `${fileName}-${new Date().toISOString().slice(0, 10)}.csv`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

function escapeCsv(value: any): string {
  if (value === null || value === undefined) return ''
  const str = String(value)
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

/**
 * 通用列表列定义（常用字段）。
 * 各页面可扩展或覆盖。
 */
export const COMMON_COLUMNS = {
  createdAt: {
    key: 'createdAt',
    title: '创建时间',
    render: (row: any) => {
      const d = new Date(row.createdAt)
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    },
  } as CsvColumn<any>,

  updatedAt: {
    key: 'updatedAt',
    title: '更新时间',
    render: (row: any) => {
      const d = new Date(row.updatedAt)
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    },
  } as CsvColumn<any>,

  status: {
    key: 'status',
    title: '状态',
  } as CsvColumn<any>,
}
