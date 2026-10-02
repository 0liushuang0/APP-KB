import {
  Injectable,
  NotFoundException,
  BadRequestException,
  OnModuleInit,
  Logger,
  StreamableFile,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import * as XLSX from 'xlsx';
import {
  CalcTemplate,
  CalcRecord,
  type CalcSchema,
} from './entities/calc.entity';
import { CalcSheet } from './entities/calc-sheet.entity';
import { evaluateFormula, validateFormula, FormulaError } from './formula.engine';
import { CALC_TEMPLATE_SEEDS } from './seeds/calc-templates.seed';
import { CurrentUser } from '../../common/services/permission.service';

export interface CalcResultItem {
  key: string;
  label: string;
  unit?: string;
  value: number;
  expr: string;
  /** 超出模板设定的告警区间 */
  warn?: 'below' | 'above';
  hint?: string;
  /** 是否为最终展示项 */
  isOutput: boolean;
}

export interface CalcResult {
  templateCode: string;
  templateName: string;
  templateVersion: number;
  inputs: Record<string, number | string>;
  results: CalcResultItem[];
  notes?: string;
}

@Injectable()
export class CalcToolsService implements OnModuleInit {
  private readonly logger = new Logger(CalcToolsService.name);

  constructor(
    @InjectRepository(CalcTemplate) private templates: Repository<CalcTemplate>,
    @InjectRepository(CalcRecord) private records: Repository<CalcRecord>,
    @InjectRepository(CalcSheet) private sheets: Repository<CalcSheet>,
  ) {}

  async onModuleInit() {
    await this.seed();
  }

  /** 首次启动写入内置模板；已存在的不覆盖，避免冲掉技术部改过的公式 */
  private async seed(): Promise<void> {
    for (const seed of CALC_TEMPLATE_SEEDS) {
      const existing = await this.templates.findOne({ where: { code: seed.code } });
      if (existing) continue;
      await this.templates.save(
        this.templates.create({
          code: seed.code,
          name: seed.name,
          category: seed.category,
          icon: seed.icon,
          description: seed.description,
          sortOrder: seed.sortOrder,
          schema: JSON.stringify(seed.schema),
        }),
      );
      this.logger.log(`已写入计算模板：${seed.name}`);
    }
  }

  parseSchema(template: CalcTemplate): CalcSchema {
    try {
      const parsed = JSON.parse(template.schema);
      // 草稿允许只填了一半，补全形状让前端不必到处判空
      return { inputs: [], formulas: [], ...parsed };
    } catch {
      throw new BadRequestException(`模板「${template.name}」的 schema 不是合法 JSON`);
    }
  }

  /**
   * 列表默认含草稿 —— 草稿是"建了一半待续"的工具，不在列表里露出来，
   * 用户就没有入口回去接着配，那这个功能等于不存在。停用的才藏起来。
   */
  async findAll(includeDisabled = false): Promise<Array<CalcTemplate & { schema: CalcSchema }>> {
    const rows = await this.templates.find({
      where: includeDisabled ? {} : { status: In(['active', 'draft']) },
      order: { sortOrder: 'ASC', name: 'ASC' },
    });
    return rows.map((t) => ({ ...t, schema: this.parseSchema(t) }) as any);
  }

  async findByCode(code: string): Promise<CalcTemplate & { schema: CalcSchema }> {
    const template = await this.templates.findOne({ where: { code } });
    if (!template) throw new NotFoundException(`计算模板不存在：${code}`);
    return { ...template, schema: this.parseSchema(template) } as any;
  }

  /**
   * 执行计算（不落库）。
   *
   * 输入先按 schema 校验再求值：缺必填项、超出量程都在这里拦下，
   * 而不是让公式算出一个物理上不可能的数字再由人去发现。
   */
  async calculate(code: string, rawInputs: Record<string, any>): Promise<CalcResult> {
    const template = await this.findByCode(code);
    if (template.status === 'draft' || !template.schema?.formulas?.length) {
      throw new BadRequestException(
        `「${template.name}」还是草稿，公式尚未配置完整，请先在编辑器里补全并保存`,
      );
    }
    return this.runSchema(template.schema, rawInputs, {
      code: template.code,
      name: template.name,
      version: template.version,
    });
  }

  /**
   * 按 schema 跑一遍计算。
   *
   * 从 calculate 里抽出来，是为了让模板编辑器能对**还没保存的** schema 试算 ——
   * 公式写完当场看到结果，比存进库再回来点一遍靠谱。
   */
  private runSchema(
    schema: CalcSchema,
    rawInputs: Record<string, any>,
    meta: { code: string; name: string; version: number },
  ): CalcResult {
    const scope: Record<string, number> = {};
    const inputs: Record<string, number | string> = {};
    const errors: string[] = [];

    for (const def of schema.inputs) {
      const raw = rawInputs?.[def.key] ?? def.default;

      if (raw === undefined || raw === null || raw === '') {
        if (def.required) errors.push(`「${def.label}」为必填项`);
        continue;
      }

      const num = Number(raw);
      if (!Number.isFinite(num)) {
        errors.push(`「${def.label}」不是有效数字`);
        continue;
      }
      if (def.min != null && num < def.min) {
        errors.push(`「${def.label}」不应小于 ${def.min}${def.unit || ''}`);
        continue;
      }
      if (def.max != null && num > def.max) {
        errors.push(`「${def.label}」不应大于 ${def.max}${def.unit || ''}`);
        continue;
      }

      scope[def.key] = num;
      inputs[def.key] = num;
    }

    if (errors.length) throw new BadRequestException(errors.join('；'));

    const outputKeys = new Set(schema.outputs || schema.formulas.map((f) => f.key));
    const results: CalcResultItem[] = [];

    for (const formula of schema.formulas) {
      let value: number;
      try {
        value = evaluateFormula(formula.expr, scope);
      } catch (err) {
        const msg = err instanceof FormulaError ? err.message : '计算失败';
        throw new BadRequestException(`「${formula.label}」计算失败：${msg}`);
      }

      const digits = formula.digits ?? 2;
      const rounded = Math.round(value * 10 ** digits) / 10 ** digits;

      // 中间量写回作用域，供后续公式引用
      scope[formula.key] = rounded;

      let warn: 'below' | 'above' | undefined;
      if (formula.warnBelow != null && rounded < formula.warnBelow) warn = 'below';
      if (formula.warnAbove != null && rounded > formula.warnAbove) warn = 'above';

      results.push({
        key: formula.key,
        label: formula.label,
        unit: formula.unit,
        value: rounded,
        expr: formula.expr,
        warn,
        hint: formula.hint,
        isOutput: outputKeys.has(formula.key),
      });
    }

    return {
      templateCode: meta.code,
      templateName: meta.name,
      templateVersion: meta.version,
      inputs,
      results,
      notes: schema.notes,
    };
  }

  /**
   * 对未保存的 schema 试算。模板编辑器用它验证公式确实能算出数来 ——
   * 静态校验只能看出语法和未知变量，除零、开负数根这类要真跑一次才知道。
   */
  tryCalculate(schema: CalcSchema, rawInputs: Record<string, any>): CalcResult {
    const problems = this.validateSchema(schema);
    const fatal = problems.filter((p) => p.level === 'error');
    if (fatal.length) {
      throw new BadRequestException(fatal.map((p) => p.message).join('；'));
    }
    return this.runSchema(schema, rawInputs, { code: 'preview', name: '试算', version: 0 });
  }

  /**
   * 逐条检查 schema，返回问题清单而不是抛异常。
   *
   * 编辑器要在用户敲字的过程中把错误标在对应那一行上，
   * 一抛异常就只剩一句话，定位不到是哪条公式。
   */
  validateSchema(schema: CalcSchema): Array<{
    level: 'error' | 'warn';
    /** 出问题的位置，形如 inputs[2] / formulas[0] */
    at: string;
    message: string;
  }> {
    const problems: Array<{ level: 'error' | 'warn'; at: string; message: string }> = [];
    const inputs = schema?.inputs || [];
    const formulas = schema?.formulas || [];

    if (!inputs.length) problems.push({ level: 'error', at: 'inputs', message: '至少需要一个输入项' });
    if (!formulas.length) problems.push({ level: 'error', at: 'formulas', message: '至少需要一条公式' });

    const KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
    const seen = new Map<string, string>();

    inputs.forEach((def, i) => {
      const at = `inputs[${i}]`;
      if (!def.key) problems.push({ level: 'error', at, message: '变量名不能为空' });
      else if (!KEY_RE.test(def.key))
        problems.push({
          level: 'error',
          at,
          message: `变量名「${def.key}」只能用字母、数字、下划线，且不能以数字开头`,
        });
      else if (seen.has(def.key))
        problems.push({ level: 'error', at, message: `变量名「${def.key}」与${seen.get(def.key)}重复` });
      else seen.set(def.key, '前面的输入项');

      if (!def.label) problems.push({ level: 'error', at, message: `${def.key || '该项'} 缺少显示名称` });
      if (def.min != null && def.max != null && def.min > def.max)
        problems.push({ level: 'error', at, message: `${def.label || def.key}：下限大于上限` });
    });

    // 公式按顺序求值，所以只能引用输入项和**前面**的公式
    const knownVars = inputs.filter((d) => KEY_RE.test(d.key || '')).map((d) => d.key);
    formulas.forEach((f, i) => {
      const at = `formulas[${i}]`;
      if (!f.key) problems.push({ level: 'error', at, message: '变量名不能为空' });
      else if (!KEY_RE.test(f.key))
        problems.push({ level: 'error', at, message: `变量名「${f.key}」不合法` });
      else if (seen.has(f.key))
        problems.push({ level: 'error', at, message: `变量名「${f.key}」与${seen.get(f.key)}重复` });
      else seen.set(f.key, '前面的公式或输入项');

      if (!f.label) problems.push({ level: 'error', at, message: `${f.key || '该条'} 缺少显示名称` });

      if (!f.expr?.trim()) {
        problems.push({ level: 'error', at, message: `${f.label || f.key}：公式不能为空` });
      } else {
        const err = validateFormula(f.expr, knownVars);
        if (err) problems.push({ level: 'error', at, message: `${f.label || f.key}：${err}` });
      }
      if (f.key && KEY_RE.test(f.key)) knownVars.push(f.key);
    });

    const formulaKeys = new Set(formulas.map((f) => f.key));
    (schema?.outputs || []).forEach((k) => {
      if (!formulaKeys.has(k))
        problems.push({ level: 'error', at: 'outputs', message: `输出项「${k}」没有对应的公式` });
    });
    if (formulas.length && schema?.outputs && !schema.outputs.length)
      problems.push({ level: 'warn', at: 'outputs', message: '没有勾选输出项，结果区会展示全部计算量' });

    return problems;
  }

  /** 保存计算记录，可关联到需求 / 方案 / 报价 */
  async saveRecord(
    dto: {
      templateCode: string;
      title?: string;
      inputs: Record<string, any>;
      relatedSolutionId?: string;
      relatedProposalId?: string;
      relatedRequirementId?: string;
      relatedQuotationId?: string;
      customerId?: string;
      remark?: string;
    },
    user: CurrentUser,
  ): Promise<CalcRecord> {
    // 重新计算而不是信任前端传来的结果，保证记录里的数字一定出自当前模板
    const result = await this.calculate(dto.templateCode, dto.inputs);

    const record = this.records.create({
      templateCode: result.templateCode,
      templateName: result.templateName,
      templateVersion: result.templateVersion,
      title: dto.title || `${result.templateName} ${new Date().toLocaleDateString('zh-CN')}`,
      inputData: JSON.stringify(result.inputs),
      resultData: JSON.stringify(result.results),
      relatedSolutionId: dto.relatedSolutionId,
      relatedProposalId: dto.relatedProposalId,
      relatedRequirementId: dto.relatedRequirementId,
      relatedQuotationId: dto.relatedQuotationId,
      customerId: dto.customerId,
      remark: dto.remark,
      createdBy: user?.userId,
      createdByName: user?.username,
    });

    const saved = await this.records.save(record);
    await this.templates.increment({ code: dto.templateCode }, 'useCount', 1);
    return saved;
  }

  async listRecords(query: {
    templateCode?: string;
    relatedSolutionId?: string;
    relatedProposalId?: string;
    relatedRequirementId?: string;
    customerId?: string;
  }): Promise<CalcRecord[]> {
    const where: any = {};
    for (const [k, v] of Object.entries(query)) {
      if (v) where[k] = v;
    }
    return this.records.find({ where, order: { createdAt: 'DESC' }, take: 200 });
  }

  async getRecord(id: string): Promise<CalcRecord & { inputs: any; results: any }> {
    const record = await this.records.findOne({ where: { id } });
    if (!record) throw new NotFoundException('计算记录不存在');
    return {
      ...record,
      inputs: JSON.parse(record.inputData || '{}'),
      results: JSON.parse(record.resultData || '[]'),
    };
  }

  async removeRecord(id: string): Promise<{ success: boolean }> {
    const record = await this.records.findOne({ where: { id } });
    if (!record) throw new NotFoundException('计算记录不存在');
    await this.records.delete(id);
    return { success: true };
  }

  /**
   * 新增 / 更新模板。保存前静态校验每条公式，
   * 让公式写错在保存时就暴露，而不是等业务人员用的时候才炸。
   */
  async upsertTemplate(dto: {
    code: string;
    name: string;
    category?: string;
    icon?: string;
    description?: string;
    schema: CalcSchema;
    sortOrder?: number;
    status?: string;
  }): Promise<CalcTemplate> {
    if (!/^[a-z][a-z0-9_]*$/i.test(dto.code || '')) {
      throw new BadRequestException('模板编码只能用字母、数字、下划线，且以字母开头');
    }
    if (!dto.name?.trim()) {
      throw new BadRequestException('请填写工具名称');
    }

    // 草稿：先占个位，参数和公式后面接着配。
    // 只有正式启用时才要求配全 —— 否则"先建后填"这条路根本走不通。
    const isDraft = dto.status === 'draft';
    const schema: CalcSchema = { inputs: [], formulas: [], ...(dto.schema || {}) };

    if (!isDraft) {
      const problems = this.validateSchema(schema).filter((p) => p.level === 'error');
      if (problems.length) {
        throw new BadRequestException(`模板校验失败 —— ${problems.map((p) => p.message).join('；')}`);
      }
    }

    const existing = await this.templates.findOne({ where: { code: dto.code } });
    if (existing) {
      Object.assign(existing, {
        name: dto.name,
        category: dto.category,
        icon: dto.icon,
        description: dto.description,
        schema: JSON.stringify(schema),
        sortOrder: dto.sortOrder ?? existing.sortOrder,
        // 配全了保存就是正式启用，草稿标记自动摘掉
        status: isDraft ? 'draft' : dto.status ?? 'active',
        // 改了公式就升版本，历史记录才能说明当时用的是哪一版。
        // 草稿阶段反复改不算数，正式启用后才开始计版本。
        version:
          existing.status !== 'draft' && existing.schema !== JSON.stringify(schema)
            ? existing.version + 1
            : existing.version,
      });
      return this.templates.save(existing);
    }

    return this.templates.save(
      this.templates.create({
        code: dto.code,
        name: dto.name,
        category: dto.category,
        icon: dto.icon,
        description: dto.description,
        schema: JSON.stringify(schema),
        sortOrder: dto.sortOrder ?? 99,
        status: isDraft ? 'draft' : 'active',
      }),
    );
  }

  /**
   * 删除模板。
   *
   * 已经有计算记录的模板不真删，改成停用 —— 记录里存着当时的输入和结果，
   * 但「这个数是怎么算出来的」要回模板里看公式。把模板抹掉，历史记录就成了孤证。
   */
  async removeTemplate(code: string): Promise<{ success: boolean; disabled?: boolean; used?: number }> {
    const template = await this.templates.findOne({ where: { code } });
    if (!template) throw new NotFoundException('计算模板不存在');

    const used = await this.records.count({ where: { templateCode: code } });
    if (used > 0) {
      template.status = 'disabled';
      await this.templates.save(template);
      return { success: true, disabled: true, used };
    }

    await this.templates.delete({ code });
    return { success: true, disabled: false, used: 0 };
  }

  /** 已停用的模板重新启用 */
  async enableTemplate(code: string): Promise<CalcTemplate> {
    const template = await this.templates.findOne({ where: { code } });
    if (!template) throw new NotFoundException('计算模板不存在');
    template.status = 'active';
    return this.templates.save(template);
  }

  // ── 计算表相关方法 ─────────────────────────────────────────

  /**
   * 列表查询计算表
   */
  async listSheets(filters: {
    templateCode?: string;
    relatedRequirementId?: string;
    relatedProposalId?: string;
    customerId?: string;
  }): Promise<CalcSheet[]> {
    const where: any = {};
    if (filters.templateCode) where.templateCode = filters.templateCode;
    if (filters.relatedRequirementId) where.relatedRequirementId = filters.relatedRequirementId;
    if (filters.relatedProposalId) where.relatedProposalId = filters.relatedProposalId;
    if (filters.customerId) where.customerId = filters.customerId;

    return this.sheets.find({
      where,
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * 获取单个计算表
   */
  async getSheet(id: string): Promise<CalcSheet> {
    const sheet = await this.sheets.findOne({ where: { id } });
    if (!sheet) throw new NotFoundException('计算表不存在');
    return sheet;
  }

  /**
   * 上传Excel并解析为Luckysheet格式
   */
  async uploadSheet(
    file: Express.Multer.File,
    dto: {
      name?: string;
      templateCode?: string;
      relatedRequirementId?: string;
      relatedProposalId?: string;
      customerId?: string;
    },
    user: CurrentUser,
  ): Promise<CalcSheet> {
    if (!file) {
      throw new BadRequestException('请上传Excel文件');
    }

    // 验证文件类型
    const allowedMimes = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
    ];
    if (!allowedMimes.includes(file.mimetype) && !file.originalname.match(/\.(xlsx|xls)$/i)) {
      throw new BadRequestException('只支持 .xlsx 或 .xls 格式的Excel文件');
    }

    // 处理中文文件名 - 解码Buffer
    let originalName = file.originalname;
    try {
      // Multer可能将中文文件名编码为Buffer，尝试解码
      const buf = Buffer.from(originalName, 'latin1');
      originalName = buf.toString('utf8');
    } catch {
      // 解码失败则使用原始值
    }

    // 1. 保存文件到磁盘
    const fileKey = `${uuidv4()}.xlsx`;
    const uploadDir = path.resolve(process.cwd(), 'data', 'uploads', 'calc-sheets');
    fs.mkdirSync(uploadDir, { recursive: true });
    fs.writeFileSync(path.join(uploadDir, fileKey), file.buffer);

    // 2. 解析Excel为Luckysheet格式
    const workbook = XLSX.read(file.buffer, { type: 'buffer', cellFormula: true, cellNF: true });
    const sheetData = this.convertToLuckysheetFormat(workbook);

    // 3. 保存到数据库
    const sheet = this.sheets.create({
      name: dto.name || originalName.replace(/\.[^.]+$/, ''),
      fileKey,
      fileName: originalName,
      mimeType: file.mimetype,
      fileSize: file.size,
      sheetData: JSON.stringify(sheetData),
      templateCode: dto.templateCode,
      relatedRequirementId: dto.relatedRequirementId,
      relatedProposalId: dto.relatedProposalId,
      customerId: dto.customerId,
      createdBy: user?.userId,
      createdByName: user?.username,
    });

    return this.sheets.save(sheet);
  }

  /**
   * Excel转Luckysheet格式
   *
   * Luckysheet数据格式要求：
   * - celldata: [{r, c, v: {v, m, ct, f}}]
   *   - r: 行号, c: 列号
   *   - v: 单元格原始值
   *   - m: 显示值（字符串）
   *   - ct: 单元格类型 {fa: 格式, t: 类型}
   *   - f: 公式（如果有）
   */
  private convertToLuckysheetFormat(workbook: XLSX.WorkBook): any[] {
    const sheets: any[] = [];

    workbook.SheetNames.forEach((sheetName, index) => {
      const worksheet = workbook.Sheets[sheetName];

      // 获取工作表范围
      const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1');
      const rowCount = range.e.r + 1;
      const colCount = range.e.c + 1;

      // 转换为Luckysheet的celldata格式
      const celldata: any[] = [];

      // 遍历所有单元格
      for (let row = range.s.r; row <= range.e.r; row++) {
        for (let col = range.s.c; col <= range.e.c; col++) {
          const addr = XLSX.utils.encode_cell({ r: row, c: col });
          const cell = worksheet[addr];

          if (!cell) continue;

          const cellData: any = {
            r: row,
            c: col,
            v: {
              v: cell.v,
              m: cell.w || String(cell.v || ''),
              ct: { fa: cell.z || 'General', t: this.getCellType(cell.v) },
            },
          };

          // 如果有公式
          if (cell.f) {
            cellData.v.f = cell.f;
          }

          celldata.push(cellData);
        }
      }

      // 获取合并单元格信息
      const merges = (worksheet as any)['!merges'] || [];
      const mergeInfo: any = {};
      merges.forEach((m: any, idx: number) => {
        mergeInfo[idx] = {
          r: m.s.r,
          c: m.s.c,
          rs: m.e.r - m.s.r + 1,
          cs: m.e.c - m.s.c + 1,
        };
      });

      // 获取列宽
      const colinfo = (worksheet as any)['!cols'] || [];
      const config: any = {};
      if (colinfo.length > 0) {
        config.columnlen = {};
        colinfo.forEach((col: any, idx: number) => {
          if (col.wpx) {
            config.columnlen[idx] = col.wpx;
          } else if (col.width) {
            config.columnlen[idx] = Math.round(col.width * 7);
          }
        });
      }

      // 获取行高
      const rowinfo = (worksheet as any)['!rows'] || [];
      if (rowinfo.length > 0) {
        config.rowlen = {};
        rowinfo.forEach((row: any, idx: number) => {
          if (row.hpt) {
            config.rowlen[idx] = Math.round(row.hpt * 1.33);
          }
        });
      }

      if (Object.keys(mergeInfo).length > 0) {
        config.merge = mergeInfo;
      }

      sheets.push({
        name: sheetName,
        index: index,
        status: index === 0 ? 1 : 0,
        order: index,
        row: Math.max(rowCount, 100),
        column: Math.max(colCount, 26),
        celldata: celldata,
        config: config,
      });
    });

    return sheets;
  }

  /**
   * 获取单元格类型
   */
  private getCellType(value: any): string {
    if (value === null || value === undefined) return 'g';
    if (typeof value === 'number') return 'n';
    if (typeof value === 'boolean') return 'b';
    if (value instanceof Date) return 'd';
    return 's';
  }

  /**
   * 更新Luckysheet数据（编辑后保存）
   */
  async updateSheetData(id: string, sheetData: any): Promise<void> {
    const sheet = await this.getSheet(id);
    sheet.sheetData = JSON.stringify(sheetData);
    sheet.version += 1;
    await this.sheets.save(sheet);
  }

  /**
   * 更新基本信息（名称、描述）
   */
  async updateSheet(
    id: string,
    dto: { name?: string; description?: string },
  ): Promise<CalcSheet> {
    const sheet = await this.getSheet(id);
    if (dto.name !== undefined) sheet.name = dto.name;
    if (dto.description !== undefined) sheet.description = dto.description;
    return this.sheets.save(sheet);
  }

  /**
   * 删除计算表（同时删除文件）
   */
  async removeSheet(id: string): Promise<{ success: boolean }> {
    const sheet = await this.getSheet(id);

    // 删除文件
    const filePath = path.resolve(
      process.cwd(),
      'data',
      'uploads',
      'calc-sheets',
      sheet.fileKey,
    );
    if (fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
      } catch (err) {
        this.logger.warn(`删除计算表文件失败：${filePath}，${err}`);
      }
    }

    await this.sheets.remove(sheet);
    return { success: true };
  }

  /**
   * 下载原始Excel文件
   */
  async downloadSheet(id: string, res: Response): Promise<StreamableFile> {
    const sheet = await this.getSheet(id);
    const filePath = path.resolve(
      process.cwd(),
      'data',
      'uploads',
      'calc-sheets',
      sheet.fileKey,
    );

    if (!fs.existsSync(filePath)) {
      throw new NotFoundException('文件已丢失，可能已被删除');
    }

    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(sheet.fileName)}"; filename*=UTF-8''${encodeURIComponent(sheet.fileName)}`,
    );
    res.setHeader(
      'Content-Type',
      sheet.mimeType || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Cache-Control', 'private, no-store');

    return new StreamableFile(fs.createReadStream(filePath));
  }
}
