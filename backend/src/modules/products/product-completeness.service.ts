import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Product, ProductBom } from './entities/product.entity';
import { CurrentUser, PermissionService } from '../../common/services/permission.service';

/**
 * 产品主数据完整度。
 *
 * 离散制造的报价、选型、技术协议都从「产品 → 型号 → 规格 → BOM → 供应商」往下走，
 * 主数据缺哪一块，哪一块就只能靠人工。实测 54 个产品里 1 个有规格参数、0 个有型号价格表、0 个关联供应商。
 * 这里只做度量，不改数据：按字段统计填写率，并列出最不完整的产品，让补数据有明确的清单。
 */
export const COMPLETENESS_FIELDS = [
  { key: 'code', label: '产品编码', critical: false },
  { key: 'description', label: '产品说明', critical: false },
  { key: 'unit', label: '计量单位', critical: false },
  { key: 'priceList', label: '型号价格表', critical: true },
  { key: 'specs', label: '规格参数', critical: true },
  { key: 'bom', label: 'BOM', critical: false },
  { key: 'supplier', label: '供应商', critical: false },
] as const;

export type CompletenessKey = (typeof COMPLETENESS_FIELDS)[number]['key'];

const filled = (v: unknown): boolean => {
  if (v === null || v === undefined) return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'string') return v.trim().length > 0;
  return true;
};

export interface ProductGap {
  id: string;
  name: string;
  category?: string;
  score: number; // 0-100
  missing: CompletenessKey[];
}

export interface CompletenessReport {
  total: number;
  /** 报价必备项（型号价格表 + 规格参数）都齐的产品数 */
  quoteReady: number;
  fields: { key: CompletenessKey; label: string; critical: boolean; filled: number; rate: number }[];
  /** 最不完整的产品（缺报价必备项优先） */
  gaps: ProductGap[];
}

/** 纯函数：便于单测 */
export function buildReport(
  products: Array<Record<string, any> & { id: string; name: string }>,
  bomCount: Map<string, number>,
  limit = 30,
): CompletenessReport {
  const rows = products.map((p) => {
    const has: Record<CompletenessKey, boolean> = {
      code: filled(p.code),
      description: filled(p.description),
      unit: filled(p.unit),
      priceList: filled(p.priceList),
      specs: filled(p.specs),
      bom: (bomCount.get(p.id) || 0) > 0,
      supplier: filled(p.supplierId),
    };
    const missing = COMPLETENESS_FIELDS.filter((f) => !has[f.key]).map((f) => f.key);
    return { p, has, missing, score: Math.round(((COMPLETENESS_FIELDS.length - missing.length) / COMPLETENESS_FIELDS.length) * 100) };
  });
  const n = rows.length;
  const fields = COMPLETENESS_FIELDS.map((f) => {
    const c = rows.filter((r) => r.has[f.key]).length;
    return { key: f.key, label: f.label, critical: f.critical, filled: c, rate: n ? Math.round((c / n) * 100) : 0 };
  });
  const critical = (r: (typeof rows)[number]) => r.missing.filter((k) => k === 'priceList' || k === 'specs').length;
  const gaps = rows
    .filter((r) => r.missing.length > 0)
    .sort((a, b) => critical(b) - critical(a) || a.score - b.score || a.p.name.localeCompare(b.p.name, 'zh'))
    .slice(0, limit)
    .map((r) => ({ id: r.p.id, name: r.p.name, category: r.p.category, score: r.score, missing: r.missing }));
  return {
    total: n,
    quoteReady: rows.filter((r) => r.has.priceList && r.has.specs).length,
    fields,
    gaps,
  };
}

@Injectable()
export class ProductCompletenessService {
  constructor(
    @InjectRepository(Product) private readonly products: Repository<Product>,
    @InjectRepository(ProductBom) private readonly boms: Repository<ProductBom>,
    private readonly permission: PermissionService,
  ) {}

  async report(user: CurrentUser): Promise<CompletenessReport> {
    const all = await this.products.find();
    // 与产品列表同一口径: 只统计当前用户有权看到的产品
    const visible = all.filter((p) =>
      this.permission.canAccess(user, {
        visibility: p.visibility,
        uploaderId: p.ownerId,
        departmentId: p.departmentId,
        groupIds: p.groupIds,
        roleCodes: p.roleCodes,
      }),
    );
    const rows = await this.boms
      .createQueryBuilder('b')
      .select('b.productId', 'productId')
      .addSelect('COUNT(*)', 'n')
      .groupBy('b.productId')
      .getRawMany<{ productId: string; n: string | number }>();
    const bomCount = new Map(rows.map((r) => [r.productId, Number(r.n)]));
    return buildReport(visible as any, bomCount);
  }
}
