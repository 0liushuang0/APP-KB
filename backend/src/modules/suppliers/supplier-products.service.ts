import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, ILike, In, IsNull, LessThanOrEqual } from 'typeorm';
import {
  Supplier,
  SupplierProduct,
  SupplierQuote,
} from './entities/supplier.entity';
import {
  CreateSupplierProductDto,
  UpdateSupplierProductDto,
  QuerySupplierProductDto,
  CreateSupplierQuoteDto,
  CompareSupplierDto,
} from './dto/supplier.dto';
import { CurrentUser } from '../../common/services/permission.service';
import { MaterialsService } from '../materials/materials.service';
import { computeSpecSignature } from '../../common/utils/spec-signature.util';
import { bigramScore } from '../quotations/quotation-draft';

/** 比价行：供应产品 + 其供应商的分级与履约信息 */
export interface CompareRow {
  productId: string;
  productName: string;
  brand: string | null;
  model: string | null;
  specification: string | null;
  category: string | null;
  materialId: string | null;
  specs: string | null;
  unit: string | null;
  priceMin: number | null;
  priceMax: number | null;
  currency: string;
  priceDate: Date | null;
  priceSource: string;
  priceStale: boolean;
  deliveryDays: number | null;
  moq: number | null;
  isSubstitutable: boolean;

  supplierId: string;
  supplierName: string;
  origin: string | null;
  originLabel: string;
  tier: string | null;
  tierLabel: string;
  country: string | null;
  rating: string | null;
  cooperationLevel: string | null;
  onTimeRate: number | null;
}

/** 价格超过这个天数就标记为过期 —— 外购件半年内价格基本失效 */
const PRICE_STALE_DAYS = 180;

const ORIGIN_LABEL: Record<string, string> = { domestic: '国内', overseas: '国外' };
const TIER_LABEL: Record<string, string> = { tier1: '一线品牌', tier2: '二线品牌', tier3: '其他' };

@Injectable()
export class SupplierProductsService {
  constructor(
    @InjectRepository(SupplierProduct) private products: Repository<SupplierProduct>,
    @InjectRepository(SupplierQuote) private quotes: Repository<SupplierQuote>,
    @InjectRepository(Supplier) private suppliers: Repository<Supplier>,
    private readonly materialsService: MaterialsService,
  ) {}

  async findAll(query: QuerySupplierProductDto): Promise<SupplierProduct[]> {
    const where: any = {};
    if (query.supplierId) where.supplierId = query.supplierId;
    if (query.productId) where.productId = query.productId;
    if (query.category) where.category = query.category;
    if (query.brand) where.brand = ILike(`%${query.brand}%`);
    if (query.deliveryDaysMax) where.deliveryDays = LessThanOrEqual(query.deliveryDaysMax);

    const rows = await this.products.find({
      where: query.keyword
        ? [
            { ...where, productName: ILike(`%${query.keyword}%`) },
            { ...where, model: ILike(`%${query.keyword}%`) },
            { ...where, specification: ILike(`%${query.keyword}%`) },
          ]
        : where,
      order: { createdAt: 'DESC' },
    });

    // 价格上限在应用层过滤：priceMin/priceMax 是区间，SQL 比较语义不直观
    const filtered = query.priceMax != null
      ? rows.filter((r) => r.priceMin == null || Number(r.priceMin) <= query.priceMax!)
      : rows;
    // 按产品查映射时顺带给出供应商名（产品详情「采购来源」直接显示，不必再逐个查）
    if (query.productId && filtered.length) {
      const sups = await this.suppliers.find({ where: { id: In([...new Set(filtered.map((r) => r.supplierId))]) } });
      const nameOf = new Map(sups.map((s) => [s.id, s.name]));
      return filtered.map((r) => Object.assign(r, { supplierName: nameOf.get(r.supplierId) }));
    }
    return filtered;
  }

  async findBySupplier(supplierId: string): Promise<SupplierProduct[]> {
    return this.products.find({ where: { supplierId }, order: { category: 'ASC', productName: 'ASC' } });
  }

  /** DTO 里的日期是 ISO 字符串，实体上是 Date，统一在这里转换 */
  private normalize(dto: CreateSupplierProductDto | UpdateSupplierProductDto): Partial<SupplierProduct> {
    const { priceDate, ...rest } = dto;
    return {
      ...rest,
      ...(priceDate ? { priceDate: new Date(priceDate) } : {}),
      // 取消映射：前端传空串
      ...(rest.productId === '' ? { productId: null } : {}),
    } as Partial<SupplierProduct>;
  }

  async create(supplierId: string, dto: CreateSupplierProductDto): Promise<SupplierProduct> {
    const supplier = await this.suppliers.findOne({ where: { id: supplierId } });
    if (!supplier) throw new NotFoundException('供应商不存在');
    const entity = this.products.create({ ...this.normalize(dto), supplierId });
    return this.products.save(entity);
  }

  async update(id: string, dto: UpdateSupplierProductDto): Promise<SupplierProduct> {
    const product = await this.products.findOne({ where: { id } });
    if (!product) throw new NotFoundException('供应产品不存在');
    Object.assign(product, this.normalize(dto));
    return this.products.save(product);
  }

  /**
   * 按规格签名自动挂物料：把该供应产品的 specs 算签名，去物料主档匹配，
   * 命中唯一物料就回填 materialId；命中多个或无命中则不动（交人工确认）。
   * 返回 { matched, materialId? } 供前端提示。
   */
  async autoLinkMaterial(id: string): Promise<{ matched: boolean; materialId: string | null; ambiguous: boolean }> {
    const product = await this.products.findOne({ where: { id } });
    if (!product) throw new NotFoundException('供应产品不存在');
    let specs: any[] = [];
    try {
      const p = JSON.parse(product.specs || '[]');
      if (Array.isArray(p)) specs = p;
    } catch {
      /* specs 损坏按空处理 */
    }
    const sig = computeSpecSignature(specs);
    if (!sig) return { matched: false, materialId: product.materialId, ambiguous: false };
    const hits = await this.materialsService.matchBySignature(sig);
    if (hits.length === 1) {
      product.materialId = hits[0].id;
      await this.products.save(product);
      return { matched: true, materialId: hits[0].id, ambiguous: false };
    }
    // 多个命中：不自动绑（怕绑错），提示人工确认
    return { matched: false, materialId: product.materialId, ambiguous: hits.length > 1 };
  }

  /**
   * 给我方产品找可能的采购来源（供应产品 → 产品映射的建议）。
   *
   * 只按名称相似度（两字片段重合率，双向取高）：「联轴器」对「鼓形齿联轴器」= 100%。
   * 只建议还没映射到任何产品的供应产品，按相似度、再按有无价格排序；由人确认后才映射。
   */
  async suggestForProduct(productId: string, limit = 10): Promise<Array<SupplierProduct & { score: number; supplierName?: string }>> {
    const product: any = await this.products.manager
      .createQueryBuilder()
      .select(['p.id AS id', 'p.name AS name', 'p.category AS category'])
      .from('products', 'p')
      .where('CAST(p.id AS TEXT) = :id', { id: productId })
      .getRawOne();
    if (!product) throw new NotFoundException('产品不存在');
    const leaf = String(product.category || '').split('/').pop() || '';
    const names = [product.name, leaf].filter((s: string) => s && s.length >= 2);
    const pool = await this.products.find({ where: { productId: IsNull(), status: 'active' } as any });
    const scored = pool
      .map((sp) => {
        const spText = `${sp.productName} ${sp.model || ''}`;
        const s = Math.max(
          ...names.map((n: string) => Math.max(bigramScore(sp.productName, n), bigramScore(n, spText))),
          0,
        );
        return { sp, s };
      })
      .filter((x) => x.s >= 0.6)
      .sort((a, b) => b.s - a.s || Number(b.sp.priceMax != null) - Number(a.sp.priceMax != null))
      .slice(0, limit);
    const supplierIds = [...new Set(scored.map((x) => x.sp.supplierId))];
    const sups = supplierIds.length ? await this.suppliers.find({ where: { id: In(supplierIds) } }) : [];
    const nameOf = new Map(sups.map((s) => [s.id, s.name]));
    return scored.map((x) => ({ ...x.sp, score: Math.round(x.s * 100), supplierName: nameOf.get(x.sp.supplierId) }));
  }

  async remove(id: string): Promise<{ success: boolean }> {
    const product = await this.products.findOne({ where: { id } });
    if (!product) throw new NotFoundException('供应产品不存在');
    await this.quotes.delete({ supplierProductId: id });
    await this.products.delete(id);
    return { success: true };
  }

  /**
   * 记录一次实际报价。
   *
   * 同时把产品目录上的价格区间往这次报价的方向扩展 ——
   * 目录价是"见过的价格范围"，每次真实报价都应该让它更准。
   */
  async addQuote(
    productId: string,
    dto: CreateSupplierQuoteDto,
    user: CurrentUser,
  ): Promise<SupplierQuote> {
    const product = await this.products.findOne({ where: { id: productId } });
    if (!product) throw new NotFoundException('供应产品不存在');

    const quote = this.quotes.create({
      ...dto,
      supplierProductId: productId,
      quotedAt: dto.quotedAt ? new Date(dto.quotedAt) : new Date(),
      validUntil: dto.validUntil ? new Date(dto.validUntil) : null,
      createdBy: user?.userId,
    } as Partial<SupplierQuote>);
    const saved = await this.quotes.save(quote);

    const price = Number(dto.unitPrice);
    const min = product.priceMin == null ? price : Math.min(Number(product.priceMin), price);
    const max = product.priceMax == null ? price : Math.max(Number(product.priceMax), price);
    await this.products.save({
      ...product,
      priceMin: min,
      priceMax: max,
      priceDate: saved.quotedAt,
      priceSource: 'quote',
    });

    return saved;
  }

  async priceHistory(productId: string): Promise<SupplierQuote[]> {
    return this.quotes.find({
      where: { supplierProductId: productId },
      order: { quotedAt: 'ASC' },
    });
  }

  /**
   * 比价：按品类 / 关键词拉出候选产品，附上供应商的分级与履约数据。
   *
   * 返回扁平行而不是嵌套结构，前端可以直接丢进对比表格排序。
   */
  async compare(query: CompareSupplierDto): Promise<CompareRow[]> {
    const where: any = {};
    if (query.category) where.category = query.category;

    // 按物料比价：查物料的品类，用它来匹配供应产品（不要求已显式挂物料——
    // 新建的物料还没有供应产品挂上来，按品类匹配才能立即可见可比产品）。
    let materialCategory: string | null = null;
    if (query.materialId) {
      try {
        const mat = await this.materialsService.findOne(query.materialId);
        materialCategory = mat.category;
      } catch {
        /* 物料不存在则忽略 */
      }
    }

    let products = await this.products.find({
      where: query.keyword
        ? [
            { ...where, productName: ILike(`%${query.keyword}%`) },
            { ...where, model: ILike(`%${query.keyword}%`) },
            { ...where, brand: ILike(`%${query.keyword}%`) },
            { ...where, specification: ILike(`%${query.keyword}%`) },
          ]
        : where,
    });

    if (!products.length) return [];

    // 按物料筛选：保留已挂该物料的 + 同品类未挂物料的（候选）。
    // 这样新建物料即使还没有供应产品显式挂上来，选它也能看到同品类的可比产品。
    if (query.materialId) {
      products = products.filter(
        (p) => p.materialId === query.materialId ||
              (!p.materialId && materialCategory && p.category === materialCategory),
      );
      if (!products.length) return [];
    }

    const supplierIds = [...new Set(products.map((p) => p.supplierId))];
    const suppliers = await this.suppliers.find({ where: { id: In(supplierIds) } });
    const byId = new Map(suppliers.map((s) => [s.id, s]));

    // 供应商维度的筛选在这里做：产品表上没有 origin/tier
    if (query.origin || query.tier) {
      products = products.filter((p) => {
        const s = byId.get(p.supplierId);
        if (!s) return false;
        if (query.origin && s.origin !== query.origin) return false;
        if (query.tier && s.tier !== query.tier) return false;
        return true;
      });
    }

    const staleBefore = new Date();
    staleBefore.setDate(staleBefore.getDate() - PRICE_STALE_DAYS);

    return products
      .map((p): CompareRow | null => {
        const s = byId.get(p.supplierId);
        if (!s) return null;
        return {
          productId: p.id,
          productName: p.productName,
          brand: p.brand ?? null,
          model: p.model ?? null,
          specification: p.specification ?? null,
          category: p.category ?? null,
          materialId: p.materialId ?? null,
          specs: p.specs ?? null,
          unit: p.unit ?? null,
          priceMin: p.priceMin == null ? null : Number(p.priceMin),
          priceMax: p.priceMax == null ? null : Number(p.priceMax),
          currency: p.currency || 'CNY',
          priceDate: p.priceDate ?? null,
          priceSource: p.priceSource || 'estimate',
          priceStale: !p.priceDate || new Date(p.priceDate) < staleBefore,
          deliveryDays: p.deliveryDays ?? null,
          moq: p.moq ?? null,
          isSubstitutable: !!p.isSubstitutable,

          supplierId: s.id,
          supplierName: s.name,
          origin: s.origin ?? null,
          originLabel: s.origin ? ORIGIN_LABEL[s.origin] : '未分类',
          tier: s.tier ?? null,
          tierLabel: s.tier ? TIER_LABEL[s.tier] : '未分级',
          country: s.country ?? null,
          rating: s.rating ?? null,
          cooperationLevel: s.cooperationLevel ?? null,
          onTimeRate: s.onTimeRate == null ? null : Number(s.onTimeRate),
        };
      })
      .filter((r): r is CompareRow => r !== null)
      .sort((a, b) => (a.priceMin ?? Infinity) - (b.priceMin ?? Infinity));
  }

  /** 供应商的价格区间汇总，用于列表页展示 */
  async priceRangeBySupplier(supplierIds: string[]): Promise<
    Map<string, { min: number | null; max: number | null; count: number; avgDelivery: number | null }>
  > {
    const result = new Map<string, { min: number | null; max: number | null; count: number; avgDelivery: number | null }>();
    if (!supplierIds.length) return result;

    const rows = await this.products.find({ where: { supplierId: In(supplierIds) } });
    for (const id of supplierIds) {
      const own = rows.filter((r) => r.supplierId === id);
      if (!own.length) {
        result.set(id, { min: null, max: null, count: 0, avgDelivery: null });
        continue;
      }
      const mins = own.map((r) => r.priceMin).filter((v): v is number => v != null).map(Number);
      const maxs = own.map((r) => r.priceMax ?? r.priceMin).filter((v): v is number => v != null).map(Number);
      const days = own.map((r) => r.deliveryDays).filter((v): v is number => v != null);
      result.set(id, {
        min: mins.length ? Math.min(...mins) : null,
        max: maxs.length ? Math.max(...maxs) : null,
        count: own.length,
        avgDelivery: days.length ? Math.round(days.reduce((a, b) => a + b, 0) / days.length) : null,
      });
    }
    return result;
  }
}
