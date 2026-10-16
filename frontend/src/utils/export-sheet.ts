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

export async function exportSheetsToExcel(sheets: SheetSection[], filename: string): Promise<void> {
  const XLSX = await import('xlsx')
  const wb = XLSX.utils.book_new()
  sheets.forEach((s) => {
    const ws = XLSX.utils.aoa_to_sheet([s.header, ...s.rows])
    XLSX.utils.book_append_sheet(wb, ws, s.name.slice(0, 31))
  })
  XLSX.writeFile(wb, filename)
}

/**
 * Word 导出：真正的 .docx（OOXML），A4 纵向 + 规范排版。
 *
 * 排版约定（按技术附件习惯）：
 * · A4（21×29.7cm），页边距 上下 2.54cm / 左右 3.18cm（Word 中文默认）
 * · 正文段落：段前段后 0，行距 1.3 倍（line 312 twips，auto 规则）
 * · 表格内单元格：单倍行距（240），上下 cell margin 40 twips ≈ 0.07cm
 * · 标题：文档题名居中加粗（小四 14pt 半），分组小节四号加粗（14pt）
 */
export async function exportSectionsToWordDocx(
  title: string,
  sections: SheetSection[],
  filename: string,
): Promise<void> {
  const {
    Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
    WidthType, AlignmentType, BorderStyle, ShadingType,
  } = await import('docx')

  // 行距与间距常量（docx 以 twips 计：240 = 单倍，1.3 倍 = 312）
  const LINE_13 = 312
  const LINE_10 = 240
  const CELL_MARGIN = { top: 40, bottom: 40, left: 80, right: 80 }
  const tableBorder = { style: BorderStyle.SINGLE, size: 4, color: '999999' }
  const borders = { top: tableBorder, bottom: tableBorder, left: tableBorder, right: tableBorder,
    insideHorizontal: tableBorder, insideVertical: tableBorder }

  const cell = (text: string | number, opts?: { header?: boolean; width?: number }) =>
    new TableCell({
      margins: CELL_MARGIN,
      width: opts?.width ? { size: opts.width, type: WidthType.PERCENTAGE } : undefined,
      shading: opts?.header ? { type: ShadingType.CLEAR, fill: 'EEF2F6' } : undefined,
      children: [
        new Paragraph({
          spacing: { before: 0, after: 0, line: LINE_10, lineRule: 'auto' },
          children: [
            new TextRun({ text: String(text ?? ''), bold: !!opts?.header, size: 21 }), // 10.5pt
          ],
        }),
      ],
    })

  const children: Array<InstanceType<typeof Paragraph> | InstanceType<typeof Table>> = [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 0, after: 120, line: LINE_13, lineRule: 'auto' },
      children: [new TextRun({ text: title, bold: true, size: 28 })], // 14pt
    }),
  ]

  sections.forEach((sec, si) => {
    children.push(
      new Paragraph({
        spacing: { before: si === 0 ? 0 : 160, after: 80, line: LINE_13, lineRule: 'auto' },
        children: [new TextRun({ text: sec.name, bold: true, size: 24 })], // 12pt 小四
      }),
    )
    children.push(
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        borders,
        rows: [
          new TableRow({
            tableHeader: true,
            children: sec.header.map((h) => cell(h, { header: true })),
          }),
          ...sec.rows.map(
            (r) => new TableRow({ children: r.map((c) => cell(c)) }),
          ),
        ],
      }),
    )
  })

  const doc = new Document({
    sections: [{
      properties: {
        page: {
          size: { width: 11906, height: 16838 }, // A4 纵向
          margin: { top: 1440, bottom: 1440, left: 1800, right: 1800 }, // 2.54cm / 3.18cm
        },
      },
      children,
    }],
  })
  const blob = await Packer.toBlob(doc)
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  URL.revokeObjectURL(a.href)
}

export const stamp = () => new Date().toISOString().slice(0, 10).replace(/-/g, '')
