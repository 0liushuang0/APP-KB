/**
 * 配套/备件表导出：Excel（xlsx 多工作表）与 Word（HTML→.doc 单文件）。
 *
 * · Excel 用 SheetJS 动态加载（仅点导出时拉取，不进首屏包）
 * · Word 走 application/msword 的 HTML —— 双击即用 Word 打开，可直接复制/编辑进
 *   技术附件文档；按专业分组的小标题 + 表格
 */

export interface SheetSection {
  /** 工作表名 / 分组标题 */
  name: string
  header: string[]
  rows: Array<Array<string | number>>
}

const esc = (v: unknown): string => {
  const s = v == null ? '' : String(v)
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export async function exportSheetsToExcel(sheets: SheetSection[], filename: string): Promise<void> {
  const XLSX = await import('xlsx')
  const wb = XLSX.utils.book_new()
  sheets.forEach((s) => {
    const ws = XLSX.utils.aoa_to_sheet([s.header, ...s.rows])
    XLSX.utils.book_append_sheet(wb, ws, s.name.slice(0, 31))
  })
  XLSX.writeFile(wb, filename)
}

export function exportSectionsToWord(
  title: string,
  sections: SheetSection[],
  filename: string,
): void {
  const parts: string[] = []
  for (const sec of sections) {
    parts.push(`<h3 style="font-size:14pt">${esc(sec.name)}</h3>`)
    parts.push(
      `<table border="1" cellspacing="0" cellpadding="4" style="border-collapse:collapse;font-size:10.5pt">` +
        `<tr>${sec.header.map((h) => `<th bgcolor="#EEF2F6">${esc(h)}</th>`).join('')}</tr>` +
        sec.rows
          .map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`)
          .join('') +
        `</table>`,
    )
  }
  const html =
    `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word">` +
    `<head><meta charset="utf-8"><title>${esc(title)}</title></head>` +
    `<body style="font-family:'Microsoft YaHei',sans-serif"><h2 style="font-size:16pt">${esc(title)}</h2>` +
    parts.join('<br/>') +
    `</body></html>`
  const blob = new Blob(['\ufeff' + html], { type: 'application/msword;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  URL.revokeObjectURL(a.href)
}

export const stamp = () => new Date().toISOString().slice(0, 10).replace(/-/g, '')
