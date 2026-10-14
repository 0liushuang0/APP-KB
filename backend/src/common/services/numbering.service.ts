import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { randomBytes } from 'crypto';

export type NumberedEntity =
  | 'customer'
  | 'requirement'
  | 'proposal'
  | 'quotation'
  | 'contract'
  | 'ticket'
  | 'project'
  | 'supplier'
  | 'solution'
  | 'material';

export interface NumberRule {
  prefix: string;
  /**
   * 日期段格式：
   * - YYYY  四位年      → 2026
   * - YY    两位年      → 26
   * - YYYYMM 四位年+月  → 202608
   * - YYMM   两位年+月  → 2608
   * - none  不带日期
   */
  yearFormat: 'YYYY' | 'YY' | 'YYYYMM' | 'YYMM' | 'none';
  /** 流水号位数 */
  digits: number;
  separator: string;
}

export const DEFAULT_RULES: Record<NumberedEntity, NumberRule> = {
  customer: { prefix: 'CUST', yearFormat: 'YYYY', digits: 3, separator: '-' },
  requirement: { prefix: 'REQ', yearFormat: 'YYYY', digits: 3, separator: '-' },
  proposal: { prefix: 'PROP', yearFormat: 'YYYY', digits: 3, separator: '-' },
  quotation: { prefix: 'QUO', yearFormat: 'YYYY', digits: 3, separator: '-' },
  contract: { prefix: 'CON', yearFormat: 'YYYY', digits: 3, separator: '-' },
  ticket: { prefix: 'TICKET', yearFormat: 'YYYY', digits: 3, separator: '-' },
  project: { prefix: 'PRJ', yearFormat: 'YYYY', digits: 3, separator: '-' },
  supplier: { prefix: 'SUP', yearFormat: 'YYYY', digits: 3, separator: '-' },
  solution: { prefix: 'SOL', yearFormat: 'YYYY', digits: 3, separator: '-' },
  material: { prefix: 'MAT', yearFormat: 'YYYY', digits: 4, separator: '-' },
};

export const CONFIG_KEY = 'numbering.rules';

/**
 * 从上游编号里取出流水号段。
 *
 * 单据号的流水号后面可能挂两种尾巴：
 *   REQ-2026-007        裸号
 *   REQ-2026-007-V2     需求改版（见 requirements.service.createVersion）
 *   PROP-2026-007-A     同一上游派生的第二份（见下面 derive 的撞号处理）
 *
 * 原来是 /(\d+)(?:-[A-Z]+)?$/，可选尾巴只认字母 —— 碰上 -V2 里带数字匹配不上，
 * 就退而求其次匹配末尾那个 "2"。结果 REQ-2026-007-V2 派生出的方案变成
 * PROP-2026-002，而报价、合同还会沿着这个错号一路继承下去，一个改版需求
 * 能污染整条单据链。
 *
 * 现在把两种尾巴都吃掉（且允许叠加），保证取到的始终是最靠前的那段流水号。
 */
export function extractSerial(sourceNo: string): string | null {
  const m = /(\d+)(?:-(?:V\d+|[A-Z]+))*$/.exec(sourceNo || '');
  return m ? m[1] : null;
}

/** 每类单据的表名与编号列 */
const SOURCE: Record<NumberedEntity, { table: string; column: string }> = {
  customer: { table: 'customers', column: 'customerCode' },
  requirement: { table: 'requirements', column: 'requirementNo' },
  proposal: { table: 'proposals', column: 'proposalNo' },
  quotation: { table: 'quotations', column: 'quotationNo' },
  contract: { table: 'contracts', column: 'contractNo' },
  ticket: { table: 'after_sales_tickets', column: 'ticketNo' },
  project: { table: 'projects', column: 'projectNo' },
  supplier: { table: 'suppliers', column: 'code' },
  solution: { table: 'solutions', column: 'solutionNo' },
  material: { table: 'materials', column: 'materialCode' },
};

/**
 * 单据编号生成。
 *
 * 修掉了两个老毛病：
 *   · 需求编号原先是 `REQ-{年}-{总数+1}` —— 删掉一条再新建就会**重号**，
 *     而编号是业务上对外用的标识，重号比编号跳号严重得多。
 *     改为取当前最大序号 +1。
 *   · 方案编号原先是 `PROP-${Date.now()}`，生成的是 PROP-1785602366517，
 *     和库里既有的 PROP-2026-001 完全不是一套。
 *
 * 另一件事是**对应关系**：同一条业务线（同客户、同项目）的单据共享同一个
 * 流水号尾号 —— 方案继承所关联需求的尾号，报价继承方案的，项目继承需求的。
 * 看到 -007 就知道这几张单属于同一单生意，不用逐层点进去比对。
 */
@Injectable()
export class NumberingService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async getRules(): Promise<Record<NumberedEntity, NumberRule>> {
    const row = await this.dataSource
      .createQueryBuilder()
      .select('c.value', 'value')
      .from('system_configs', 'c')
      .where('c.key = :k', { k: CONFIG_KEY })
      .getRawOne<{ value: string }>();

    if (!row?.value) return { ...DEFAULT_RULES };
    try {
      // 只覆盖已配置的项，新增的单据类型仍走默认值
      return { ...DEFAULT_RULES, ...JSON.parse(row.value) };
    } catch {
      return { ...DEFAULT_RULES };
    }
  }

  async setRules(rules: Partial<Record<NumberedEntity, NumberRule>>): Promise<void> {
    const merged = { ...(await this.getRules()), ...rules };
    const value = JSON.stringify(merged);
    const existing = await this.dataSource
      .createQueryBuilder()
      .select('c.id', 'id')
      .from('system_configs', 'c')
      .where('c.key = :k', { k: CONFIG_KEY })
      .getRawOne<{ id: string }>();

    if (existing) {
      await this.dataSource
        .createQueryBuilder()
        .update('system_configs')
        .set({ value, updatedAt: new Date() })
        .where('id = :id', { id: existing.id })
        .execute();
    } else {
      await this.dataSource
        .createQueryBuilder()
        .insert()
        .into('system_configs', ['id', 'key', 'value', 'category', 'description'])
        .values({
          // id 在 JS 侧生成同格式（8-4 位 hex）：randomblob 是 SQLite 专有函数
          id: `${randomBytes(4).toString('hex')}-${randomBytes(2).toString('hex')}`,
          key: CONFIG_KEY,
          value,
          category: 'numbering',
          description: '各类单据的编号规则',
        })
        .execute();
    }
  }

  /**
   * 按规则拼出前缀部分，例如 REQ-2026- 或 REQ-2026-08-。
   * 带月份的格式（YYYYMM / YYMM）会在前缀中包含月，这样 maxSerial 的 LIKE
   * 匹配自然把流水号限定在当月范围内——每月从 001 重新计数。
   */
  private buildPrefix(
    rule: NumberRule,
    year = new Date().getFullYear(),
    month = new Date().getMonth() + 1,
  ): string {
    const parts = [rule.prefix];
    const mm = String(month).padStart(2, '0');
    switch (rule.yearFormat) {
      case 'YYYY':
        parts.push(String(year));
        break;
      case 'YY':
        parts.push(String(year).slice(-2));
        break;
      case 'YYYYMM':
        parts.push(String(year), mm);
        break;
      case 'YYMM':
        parts.push(String(year).slice(-2), mm);
        break;
      // 'none' 不追加日期段
    }
    return parts.join(rule.separator) + rule.separator;
  }

  /**
   * 取该前缀下已用的最大流水号。
   *
   * 用 max 而不是 count：count 在删除记录后会退回去，导致新单撞上老单的编号。
   */
  private async maxSerial(entity: NumberedEntity, prefix: string): Promise<number> {
    const { table, column } = SOURCE[entity];
    // 列名必须加引号：裸 qb 不做列名替换，PG 会把 camelCase 折叠成小写导致整条查询报错
    const rows = await this.dataSource
      .createQueryBuilder()
      .select(`t."${column}"`, 'no')
      .from(table, 't')
      .where(`t."${column}" LIKE :p`, { p: `${prefix}%` })
      .getRawMany<{ no: string }>();

    let max = 0;
    for (const r of rows) {
      // 尾部可能带 -A / -B 后缀（同需求下的第二个方案），只取数字段
      const m = new RegExp(`^${escapeRegExp(prefix)}(\\d+)`).exec(r.no || '');
      if (m) max = Math.max(max, parseInt(m[1], 10));
    }
    return max;
  }

  /** 生成一个全新的编号（没有可继承的上游时用） */
  async next(entity: NumberedEntity): Promise<string> {
    const rules = await this.getRules();
    const rule = rules[entity];
    const prefix = this.buildPrefix(rule);
    const serial = (await this.maxSerial(entity, prefix)) + 1;
    return prefix + String(serial).padStart(rule.digits, '0');
  }

  /**
   * 继承上游单据的流水号。
   *
   * 例：需求 REQ-2026-007 派生出方案 → PROP-2026-007。
   * 若该尾号已被占用（同一需求下的第二个方案），追加字母后缀 -A、-B…
   */
  async derive(entity: NumberedEntity, sourceNo?: string | null): Promise<string> {
    if (!sourceNo) return this.next(entity);

    const rules = await this.getRules();
    const rule = rules[entity];

    // 从上游编号里取出流水号部分（允许其自带 -V2 版本号 / -A 字母后缀）
    const serial = extractSerial(sourceNo);
    if (!serial) return this.next(entity);

    const prefix = this.buildPrefix(rule);
    const base = prefix + serial.padStart(rule.digits, '0');

    const { table, column } = SOURCE[entity];
    const used = await this.dataSource
      .createQueryBuilder()
      .select(`t."${column}"`, 'no')
      .from(table, 't')
      .where(`t."${column}" LIKE :p`, { p: `${base}%` })
      .getRawMany<{ no: string }>();

    const taken = new Set(used.map((u) => u.no));
    if (!taken.has(base)) return base;

    for (let i = 0; i < 26; i++) {
      const candidate = `${base}-${String.fromCharCode(65 + i)}`;
      if (!taken.has(candidate)) return candidate;
    }
    // 26 个都用完了就退回独立流水号，总比生成重复编号强
    return this.next(entity);
  }

  /** 预览：给设置页展示"按当前规则下一个编号长什么样" */
  async preview(entity: NumberedEntity, rule: NumberRule): Promise<string> {
    const prefix = this.buildPrefix(rule);
    const serial = (await this.maxSerial(entity, prefix)) + 1;
    return prefix + String(serial).padStart(rule.digits, '0');
  }
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
