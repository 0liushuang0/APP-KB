import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const PDFDocument = require('pdfkit');
import * as docx from 'docx';
import {
  convertOfficeToPdf,
  OfficePreviewUnavailableError,
} from '../../common/utils/office-preview.util';

/**
 * 需求识别文件（PDF + DOCX）—— 按参考模板排版。
 *
 * 排版要点：
 *   · A4，上 1.5cm / 下 1.5cm / 左 2.0cm / 右 1.5cm
 *   · 页眉：左侧 logo + 右侧公司名，**底部有页眉线**
 *   · 页脚：右下角日期
 *   · 全文宋体（PDF 用 simfang.ttf 仿宋，DOCX 用宋体）
 *   · 段前段后 0 磅，行距 1.25 倍
 *   · 字段用**表格**呈现（章节标题 + 表格，表格间距 1）
 *   · 不含「系统自动生成」等免责文字
 */

const FONT_CANDIDATES = [
  'C:/Windows/Fonts/simsunb.ttf', // 宋体-18030（.ttf 版宋体）
  'C:/Windows/Fonts/simfang.ttf', // 仿宋（最接近宋体的 TTF）
  'C:/Windows/Fonts/simhei.ttf',  // 黑体
  'C:/Windows/Fonts/msyh.ttc',
  '/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc',
];

const LOGO_PATHS = [
  path.resolve(process.cwd(), 'assets', 'company-logo.png'),
  path.resolve(process.cwd(), '..', 'docs', '博亚lggo.png'),
];

const COMPANY_NAME = '襄阳博亚精工装备股份有限公司';

/** 行高（1.25 倍行距 ≈ 15pt for 12pt 字体） */
const LINE_H = 15;

export interface TemplateField {
  key: string;
  label: string;
  unit?: string;
  type?: string;
  section?: string;
  required?: boolean;
  remark?: string;
}

@Injectable()
export class RequirementPdfService {
  private readonly logger = new Logger(RequirementPdfService.name);

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  private resolveFont(): string | null {
    for (const p of FONT_CANDIDATES) {
      if (fs.existsSync(p)) return p;
    }
    return null;
  }

  private resolveLogo(): string | null {
    for (const p of LOGO_PATHS) {
      if (fs.existsSync(p)) return p;
    }
    return null;
  }

  private buildTitle(templateCategory?: string): string {
    if (!templateCategory) return '需求信息文件';
    const parts = templateCategory.split('/').map((s) => s.trim()).filter(Boolean);
    const last = parts[parts.length - 1] || '设备';
    return `${last}需求信息文件`;
  }

  /** 估算文本宽度（12pt 宋体：CJK/全角 ≈ 240 twips，ASCII ≈ 120 twips） */
  private estimateTextWidth(text: string): number {
    let w = 0;
    for (const ch of text) {
      w += /[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/.test(ch) ? 240 : 120;
    }
    return w;
  }

  /** 计算表格列宽百分比：左列按最长标签定宽 +1 字 padding，剩余给右列，上限 45% */
  private calcColumnPercents(fields: TemplateField[]): { left: number; right: number } {
    const allLabels = fields.map((f) => `${f.label}${f.unit ? `（${f.unit}）` : ''}：`);
    const maxLabelW = Math.max(0, ...allLabels.map((l) => this.estimateTextWidth(l)));
    const contentTwips = docx.convertMillimetersToTwip(175); // 210 - 20(left) - 15(right)
    const left = Math.min(Math.ceil(((maxLabelW + 240) / contentTwips) * 100), 45);
    return { left, right: 100 - left };
  }

  // ============================================================
  // DOCX 生成
  // ============================================================
  async generateDocx(requirementId: string): Promise<{ buffer: Buffer; fileName: string }> {
    const { req, fields, values } = await this.load(requirementId);
    const title = this.buildTitle(req.templateCategory);
    const logoPath = this.resolveLogo();

    // 按章节分组
    const sections = new Map<string, TemplateField[]>();
    for (const f of fields) {
      const sec = f.section || '其他';
      if (!sections.has(sec)) sections.set(sec, []);
      sections.get(sec)!.push(f);
    }

    const fmt = (raw: any): string => {
      if (raw === undefined || raw === null || raw === '') return '';
      return Array.isArray(raw) ? raw.join('、') : String(raw);
    };

    // 通用段落属性：段前段后 0，宋体。lineSpacing 默认 300（1.25 倍），表格内传 240（单倍）
    const p = (text: string, opts?: { bold?: boolean; size?: number; align?: (typeof docx.AlignmentType)[keyof typeof docx.AlignmentType]; indent?: number; lineSpacing?: number }) =>
      new docx.Paragraph({
        alignment: opts?.align,
        indent: opts?.indent ? { firstLine: opts.indent } : undefined,
        spacing: { before: 0, after: 0, line: opts?.lineSpacing ?? 300, lineRule: docx.LineRuleType.AUTO },
        children: [
          new docx.TextRun({
            text,
            bold: opts?.bold,
            size: opts?.size || 24, // 12pt
            font: '宋体',
          }),
        ],
      });

    const bodyChildren: docx.Paragraph[] = [];

    // 标题（宋体 16pt 加粗居中）
    bodyChildren.push(p(title, { bold: true, size: 32, align: docx.AlignmentType.CENTER }));
    // 空行
    bodyChildren.push(p(''));
    // 引言（首行缩进 2 字符 = 480 twips）
    bodyChildren.push(p('为完成专业且详尽的方案及报价，有如下信息需要填写（以下信息尽量填全，若无法填写则双方交流确认）：', { indent: 480 }));

    // 客户信息用表格排版（两列，避免长名称挤压换行）
    const noBorders = {
      top: { style: docx.BorderStyle.NONE, size: 0, color: 'FFFFFF' },
      bottom: { style: docx.BorderStyle.NONE, size: 0, color: 'FFFFFF' },
      left: { style: docx.BorderStyle.NONE, size: 0, color: 'FFFFFF' },
      right: { style: docx.BorderStyle.NONE, size: 0, color: 'FFFFFF' },
    };
    const infoTable = new docx.Table({
      width: { size: 100, type: docx.WidthType.PERCENTAGE },
      borders: {
        top: { style: docx.BorderStyle.NONE, size: 0, color: 'FFFFFF' },
        bottom: { style: docx.BorderStyle.NONE, size: 0, color: 'FFFFFF' },
        left: { style: docx.BorderStyle.NONE, size: 0, color: 'FFFFFF' },
        right: { style: docx.BorderStyle.NONE, size: 0, color: 'FFFFFF' },
        insideHorizontal: { style: docx.BorderStyle.NONE, size: 0, color: 'FFFFFF' },
        insideVertical: { style: docx.BorderStyle.NONE, size: 0, color: 'FFFFFF' },
      },
      rows: [
        new docx.TableRow({
          children: [
            new docx.TableCell({ width: { size: 50, type: docx.WidthType.PERCENTAGE }, borders: noBorders, children: [p(`客户名称：${req.customerName || '—'}`)] }),
            new docx.TableCell({ width: { size: 50, type: docx.WidthType.PERCENTAGE }, borders: noBorders, children: [p(`项目名称：${req.title || '—'}`)] }),
          ],
        }),
        new docx.TableRow({
          children: [
            new docx.TableCell({ borders: noBorders, children: [p(`需求编码：${req.requirementNo || '—'}`)] }),
            new docx.TableCell({ borders: noBorders, children: [p(`需求分类：${req.templateCategory || '未指定'}`)] }),
          ],
        }),
      ],
    });

    // 左列宽度：取所有字段标签中最长的 +1 字 padding，不超过 45%，剩余给右列
    const { left: leftColPct, right: rightColPct } = this.calcColumnPercents(fields);

    // 按章节列字段（编号标题 + 表格）
    const tableChildren: (docx.Paragraph | docx.Table)[] = [...bodyChildren, infoTable, p('')];
    let secNum = 0;

    for (const [section, items] of sections) {
      secNum++;
      // 章节标题
      tableChildren.push(p(`${secNum}.${section}`, { bold: true }));

      // 字段表格（左列按最长标签定宽，表格内行距单倍 240）
      const tableRows: docx.TableRow[] = items.map((f) => {
        const val = fmt(this.pickValue(values, f));
        const label = `${f.label}${f.unit ? `（${f.unit}）` : ''}：`;
        return new docx.TableRow({
          children: [
            new docx.TableCell({
              width: { size: leftColPct, type: docx.WidthType.PERCENTAGE },
              margins: { top: 20, bottom: 20, left: 60, right: 60 },
              children: [p(label, { lineSpacing: 240 })],
            }),
            new docx.TableCell({
              width: { size: rightColPct, type: docx.WidthType.PERCENTAGE },
              margins: { top: 20, bottom: 20, left: 60, right: 60 },
              children: [p(val || '　', { lineSpacing: 240 })],
            }),
          ],
        });
      });

      tableChildren.push(
        new docx.Table({
          width: { size: 100, type: docx.WidthType.PERCENTAGE },
          borders: {
            top: { style: docx.BorderStyle.SINGLE, size: 1, color: '000000' },
            bottom: { style: docx.BorderStyle.SINGLE, size: 1, color: '000000' },
            left: { style: docx.BorderStyle.SINGLE, size: 1, color: '000000' },
            right: { style: docx.BorderStyle.SINGLE, size: 1, color: '000000' },
            insideHorizontal: { style: docx.BorderStyle.SINGLE, size: 1, color: '000000' },
            insideVertical: { style: docx.BorderStyle.SINGLE, size: 1, color: '000000' },
          },
          rows: tableRows,
        }),
      );
      // 章节后空行
      tableChildren.push(p(''));
    }

    if (!fields.length) {
      tableChildren.push(p('该需求尚未指定需求分类，无法按模板列出参数项。'));
    }

    // 确认栏
    tableChildren.push(p(''));
    tableChildren.push(p(''));
    tableChildren.push(p('客户确认（签字/盖章）：____________________　　日期：____________'));

    // 页眉（logo 左 + 公司名右，底部页眉线）
    const headerChildren: docx.Paragraph[] = [];
    if (logoPath) {
      headerChildren.push(
        new docx.Paragraph({
          alignment: docx.AlignmentType.RIGHT,
          spacing: { before: 0, after: 0 },
          border: { bottom: { style: docx.BorderStyle.SINGLE, size: 6, color: '000000', space: 4 } },
          children: [
            new docx.ImageRun({
              type: 'png',
              data: fs.readFileSync(logoPath),
              transformation: { width: 83, height: 26 },
              floating: {
                // 相对「页边距」定位：offset 0 = 左边距处，避免 logo 贴到页面最左侧
                horizontalPosition: { relative: docx.HorizontalPositionRelativeFrom.MARGIN, offset: 0 },
                verticalPosition: { relative: docx.VerticalPositionRelativeFrom.PARAGRAPH, offset: 0 },
              },
            }),
            new docx.TextRun({ text: `\t${COMPANY_NAME}`, bold: true, size: 21, font: '宋体' }),
          ],
        }),
      );
    } else {
      headerChildren.push(
        new docx.Paragraph({
          alignment: docx.AlignmentType.RIGHT,
          spacing: { before: 0, after: 0 },
          border: { bottom: { style: docx.BorderStyle.SINGLE, size: 6, color: '000000', space: 4 } },
          children: [new docx.TextRun({ text: COMPANY_NAME, bold: true, size: 21, font: '宋体' })],
        }),
      );
    }

    // 页脚（日期右下角）
    const today = new Date();
    const dateStr = `${today.getFullYear()}-${today.getMonth() + 1}-${today.getDate()}`;

    const doc = new docx.Document({
      styles: {
        default: {
          document: { run: { font: '宋体', size: 24 } },
        },
      },
      sections: [
        {
          properties: {
            page: {
              size: {
                width: docx.convertMillimetersToTwip(210),
                height: docx.convertMillimetersToTwip(297),
              },
              margin: {
                top: docx.convertMillimetersToTwip(25), // 页眉下方留空间
                bottom: docx.convertMillimetersToTwip(15),
                left: docx.convertMillimetersToTwip(20),
                right: docx.convertMillimetersToTwip(15),
              },
            },
          },
          headers: { default: new docx.Header({ children: headerChildren }) },
          footers: {
            default: new docx.Footer({
              children: [
                new docx.Paragraph({
                  alignment: docx.AlignmentType.RIGHT,
                  children: [new docx.TextRun({ text: dateStr, size: 18, font: '宋体' })],
                }),
              ],
            }),
          },
          children: tableChildren,
        },
      ],
    });

    const buffer = await docx.Packer.toBuffer(doc);
    return { buffer, fileName: `${req.requirementNo || '需求'}_需求信息文件.docx` };
  }

  // ============================================================
  // 取数
  // ============================================================
  private async load(requirementId: string) {
    const m = this.dataSource.manager;
    const req = await m
      .createQueryBuilder()
      .select([
        'r.id AS "id"', 'r."requirementNo" AS "requirementNo"', 'r.title AS "title"',
        'r."templateCategory" AS "templateCategory"', 'r."structuredSpec" AS "structuredSpec"',
        'r.description AS "description"', 'r."createdAt" AS "createdAt"',
        'c.name AS "customerName"', 'c.code AS "customerShortName"',
      ])
      .from('requirements', 'r')
      .leftJoin('customers', 'c', 'c.id = r."customerId"')
      .where('r.id = :id', { id: requirementId })
      .getRawOne<any>();
    if (!req) throw new NotFoundException('需求不存在');
    /*
     * 别名必须带双引号：PG 会把不带引号的别名折叠成小写，
     * getRawOne 回来的键全变成 requirementno/customername，下面按
     * req.requirementNo / req.customerName 取值全是 undefined，
     * 导出来的需求文件除了标题全是「—」。（SQLite 不折叠，所以旧库时代是好的。）
     */

    let fields: TemplateField[] = [];
    if (req.templateCategory) {
      const tpl = await m
        .createQueryBuilder()
        .select('t.fields', 'fields')
        .from('param_templates', 't')
        .where('t.category = :c', { c: req.templateCategory })
        .getRawOne<{ fields: string }>();
      try {
        const parsed = JSON.parse(tpl?.fields || '[]');
        if (Array.isArray(parsed)) fields = parsed;
      } catch { /* 模板坏了不阻塞导出 */ }
    }

    let spec: any = {};
    try { spec = JSON.parse(req.structuredSpec || '{}') || {}; } catch { spec = {}; }
    const values = this.resolveSpecValues(spec);
    return { req, fields, values, spec };
  }

  /**
   * structuredSpec 有三种历史形态，导出统一摊平成 key/label → 值 的查找表：
   *   ① 扁平 {key: value}
   *   ② 需求卡 {fields: [{key, label, value, normalized}]}（结构化识别新版）
   *   ③ AI 卡 {params: [{key, value, unit}]}（结构化识别旧版，key 是中文）
   * 模板字段按 key 或中文标签都能命中。exportValues（预览弹窗里人工改过的值）
   * 最后合并、优先级最高。
   */
  private resolveSpecValues(spec: any): Record<string, any> {
    const out: Record<string, any> = {};
    if (!spec || typeof spec !== 'object' || Array.isArray(spec)) return out;
    if (Array.isArray(spec.fields)) {
      for (const f of spec.fields) {
        const v = f?.normalized ?? f?.value;
        if (f?.key) out[f.key] = v;
        if (f?.label) out[f.label] = v;
      }
    }
    if (Array.isArray(spec.params)) {
      for (const p of spec.params) {
        if (p?.key) out[p.key] = p?.value;
        if (p?.label) out[p.label] = p?.value;
      }
    }
    if (!Array.isArray(spec.fields) && !Array.isArray(spec.params)) {
      for (const [k, v] of Object.entries(spec)) {
        if (k === 'exportValues' || v === null || v === undefined || typeof v === 'object') continue;
        out[k] = v;
      }
    }
    if (spec.exportValues && typeof spec.exportValues === 'object' && !Array.isArray(spec.exportValues)) {
      Object.assign(out, spec.exportValues);
    }
    return out;
  }

  /** 模板字段取值：先按 key，再按中文标签（AI 卡的 key 就是中文） */
  private pickValue(values: Record<string, any>, f: TemplateField): any {
    const v = values[f.key] ?? values[f.label];
    return v;
  }

  /** 导出预览：与 PDF/DOCX 完全同一份取数，前端按文档版式渲染、改值后再导出 */
  async loadPreview(requirementId: string) {
    const { req, fields, values, spec } = await this.load(requirementId);
    return {
      id: req.id,
      requirementNo: req.requirementNo,
      title: req.title,
      templateCategory: req.templateCategory,
      customerName: req.customerName,
      docTitle: this.buildTitle(req.templateCategory),
      fields,
      values,
      spec,
    };
  }

  // ============================================================
  // PDF 生成
  // ============================================================
  async generate(requirementId: string): Promise<{ buffer: Buffer; fileName: string }> {
    const { req, fields, values } = await this.load(requirementId);
    const fileName = `${req.requirementNo || '需求'}_需求信息文件.pdf`;
    /*
     * 优先走 Word→PDF：复用已经调好排版的 DOCX，由 LibreOffice 渲染，
     * 中文与表格布局与 Word 完全一致，规避 pdfkit 的中文乱码与表格错位。
     * LibreOffice 未装或转换失败时回退到 pdfkit（render）保底。
     */
    try {
      const { buffer: docxBuffer } = await this.generateDocx(requirementId);
      const pdfBuffer = await this.docxToPdf(docxBuffer);
      return { buffer: pdfBuffer, fileName };
    } catch (err) {
      if (err instanceof OfficePreviewUnavailableError) {
        this.logger.warn('LibreOffice 未安装，回退到 pdfkit 渲染 PDF（可能出现中文乱码/布局错位）');
      } else {
        this.logger.warn(`Word→PDF 转换失败，回退到 pdfkit：${(err as Error)?.message || err}`);
      }
      const buffer = await this.render(req, fields, values);
      return { buffer, fileName };
    }
  }

  /**
   * 把内存里的 docx Buffer 转成 PDF：
   * 落临时文件 → 调 LibreOffice（convertOfficeToPdf）→ 读回 PDF → 清理临时文件。
   * convertOfficeToPdf 会把产物写到 <uploadsRoot>/.preview/ 下，读回后删掉。
   */
  private async docxToPdf(docxBuffer: Buffer): Promise<Buffer> {
    const tmpRoot = os.tmpdir();
    const tmpDocx = path.join(
      tmpRoot,
      `req-ident-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.docx`,
    );
    fs.writeFileSync(tmpDocx, docxBuffer);
    try {
      const { pdfPath } = await convertOfficeToPdf(tmpDocx, tmpRoot);
      const pdfBuffer = fs.readFileSync(pdfPath);
      try { fs.unlinkSync(pdfPath); } catch { /* 缓存产物清理失败不阻塞 */ }
      return pdfBuffer;
    } finally {
      try { fs.unlinkSync(tmpDocx); } catch { /* 忽略 */ }
    }
  }

  private render(req: any, fields: TemplateField[], values: Record<string, any>): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const M = { left: 56.7, right: 42.5, bottom: 42.5 }; // 左 2.0cm / 右 1.5cm / 下 1.5cm
      const HEADER_H = 40; // 页眉区域高度
      const TOP = 42.5 + HEADER_H; // 正文起始 Y = 上边距 + 页眉高

      const doc = new PDFDocument({
        size: 'A4',
        margins: { top: TOP, bottom: M.bottom, left: M.left, right: M.right },
      });
      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const fontPath = this.resolveFont();
      const logoPath = this.resolveLogo();
      const title = this.buildTitle(req.templateCategory);

      if (fontPath) {
        doc.registerFont('cjk', fontPath);
        doc.font('cjk');
      } else {
        this.logger.warn('未找到中文字体');
      }

      const pageW = doc.page.width - M.left - M.right;
      const LOGO_W = 83;   // 放大 1.5 倍（原 55×17 → 83×26）
      const LOGO_H = 26;

      // ── 页眉：logo 左 + 公司名右 + 底部页眉线 ──
      // 防重入：pageAdded → drawHeader → doc.text 若又触发换页会递归爆栈。
      // 页眉页脚绘制期间屏蔽 pageAdded。
      let inHeaderDraw = false;
      const drawHeader = () => {
        if (inHeaderDraw) return;
        inHeaderDraw = true;
        try {
          const lineY = 42; // 页眉线固定位置

          // logo（左侧，底部与页眉线对齐）
          if (logoPath) {
            try {
              doc.image(logoPath, M.left, lineY - LOGO_H, { width: LOGO_W, height: LOGO_H });
            } catch { /* logo 读不到不阻塞 */ }
          }
          // 公司名（右侧，底部与页眉线对齐）。不用 doc.text（会推进 doc.y、可能触发换页），
          // 直接写 content stream。
          doc.save();
          doc.font('cjk').fontSize(10.5).fillColor('#000');
          const cnW = doc.widthOfString(COMPANY_NAME);
          doc.text(COMPANY_NAME, doc.page.width - M.right - cnW, lineY - 13, {
            width: cnW + 10, lineBreak: false,
          });
          doc.restore();

          // 页眉线（贯穿全宽，logo 和文字底部对齐此线）
          doc.moveTo(M.left, lineY).lineTo(doc.page.width - M.right, lineY)
            .strokeColor('#000').lineWidth(0.5).stroke();

          // 页脚（日期右下角）
          const today = new Date();
          const dateStr = `${today.getFullYear()}-${today.getMonth() + 1}-${today.getDate()}`;
          doc.save();
          doc.font('cjk').fontSize(9).fillColor('#444');
          doc.text(dateStr, doc.page.width - M.right - 60, doc.page.height - 28, { width: 60, align: 'right', lineBreak: false });
          doc.restore();

          // 恢复正文光标（页眉绘制不应吃掉正文 y）
          doc.x = M.left;
          doc.y = TOP;
        } finally {
          inHeaderDraw = false;
        }
      };

      drawHeader();
      doc.on('pageAdded', () => drawHeader());

      // ── 标题（宋体 16pt 加粗居中）──
      doc.font('cjk').fontSize(16).fillColor('#000');
      doc.text(title, M.left, TOP, { width: pageW, align: 'center', lineGap: LINE_H - 16 });
      doc.y += 8;

      // ── 引言 ──
      doc.fontSize(12);
      doc.text('为完成专业且详尽的方案及报价，有如下信息需要填写（以下信息尽量填全，若无法填写则双方交流确认）：', M.left, doc.y, { width: pageW, lineGap: 3, indent: 24 });
      doc.y += LINE_H;

      // ── 客户信息（两列对齐，避免长名称互相挤压换行）──
      const colW = pageW * 0.48;
      const col2X = M.left + pageW * 0.52;
      const infoY = doc.y;

      doc.fontSize(12).fillColor('#000');
      // 第一行：客户名称 | 项目名称
      doc.text(`客户名称：${req.customerName || '—'}`, M.left, infoY, { width: colW, lineGap: 0, ellipsis: true });
      doc.text(`项目名称：${req.title || '—'}`, col2X, infoY, { width: colW, lineGap: 0, ellipsis: true });
      doc.y = infoY + LINE_H;

      // 第二行：需求编码 | 需求分类
      doc.text(`需求编码：${req.requirementNo || '—'}`, M.left, doc.y, { width: colW, lineGap: 0, ellipsis: true });
      doc.text(`需求分类：${req.templateCategory || '未指定'}`, col2X, doc.y, { width: colW, lineGap: 0, ellipsis: true });
      doc.y += LINE_H + 5;

      if (!fields.length) {
        doc.fontSize(11).fillColor('#a00');
        doc.text('该需求尚未指定需求分类，无法按模板列出参数项。');
        doc.fillColor('#000');
        if (req.description) doc.text(String(req.description));
        doc.end();
        return;
      }

      // ── 按章节：编号标题 + 表格 ──
      const sections = new Map<string, TemplateField[]>();
      for (const f of fields) {
        const sec = f.section || '其他';
        if (!sections.has(sec)) sections.set(sec, []);
        sections.get(sec)!.push(f);
      }

      const { left: leftPct, right: rightPct } = this.calcColumnPercents(fields);
      const labelW = pageW * (leftPct / 100);
      const valueW = pageW * (rightPct / 100);
      const cellH = LINE_H + 2; // 表格行高（单倍行距）

      let secNum = 0;
      for (const [section, items] of sections) {
        secNum++;

        // 章节标题前分页
        if (doc.y > doc.page.height - 80) doc.addPage();

        // 编号加粗章节标题
        doc.fontSize(12).fillColor('#000').font('cjk');
        doc.text(`${secNum}.${section}`, M.left, doc.y, { width: pageW, lineGap: LINE_H - 12 });
        doc.y += 2;

        // 画表格
        const tableTop = doc.y;
        const tableH = items.length * cellH;

        // 表格边框（外框）
        doc.lineWidth(0.5).strokeColor('#000');
        doc.rect(M.left, tableTop, pageW, tableH).stroke();

        for (let i = 0; i < items.length; i++) {
          const f = items[i];
          const rowY = tableTop + i * cellH;

          // 行分隔线（内横线）
          if (i > 0) {
            doc.moveTo(M.left, rowY).lineTo(M.left + pageW, rowY).stroke();
          }

          // 列分隔线（内竖线）
          doc.moveTo(M.left + labelW, rowY).lineTo(M.left + labelW, rowY + cellH).stroke();

          // label（左列）
          const raw = this.pickValue(values, f);
          const filled = raw === undefined || raw === null || raw === '' ? '' : Array.isArray(raw) ? raw.join('、') : String(raw);
          const labelText = `${f.label}${f.unit ? `（${f.unit}）` : ''}：`;

          doc.fontSize(12).fillColor('#000');
          doc.text(labelText, M.left + 6, rowY + 4, { width: labelW - 12, lineGap: 0 });

          // value（右列）
          if (filled) {
            doc.text(filled, M.left + labelW + 6, rowY + 4, { width: valueW - 12, lineGap: 0 });
          }
        }

        doc.y = tableTop + tableH + 8;
      }

      // ── 确认栏 ──
      if (doc.y > doc.page.height - 80) doc.addPage();
      doc.y += 15;
      doc.fontSize(12).fillColor('#000').font('cjk');
      doc.text('客户确认（签字/盖章）：____________________　　日期：____________', M.left, doc.y, { width: pageW, lineGap: LINE_H - 12 });

      doc.end();
    });
  }
}
