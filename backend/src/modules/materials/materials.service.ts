import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { Repository, Like, DataSource } from 'typeorm';
import { Material, MaterialSpecItem } from './entities/material.entity';
import { computeSpecSignature } from '../../common/utils/spec-signature.util';
import { NumberingService } from '../../common/services/numbering.service';
import { v4 as uuidv4 } from 'uuid';

export interface CreateMaterialDto {
  name: string;
  category?: string;
  specs?: MaterialSpecItem[];
  unit?: string;
  standardPrice?: number;
  description?: string;
}

export interface UpdateMaterialDto extends Partial<CreateMaterialDto> {}

export interface QueryMaterialDto {
  category?: string;
  keyword?: string;
}

@Injectable()
export class MaterialsService {
  private readonly logger = new Logger(MaterialsService.name);

  constructor(
    @InjectRepository(Material)
    private readonly materialRepository: Repository<Material>,
    private readonly numbering: NumberingService,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  /** 列表（按品类/关键词过滤） */
  async findAll(query: QueryMaterialDto): Promise<Material[]> {
    const where: any = {};
    if (query.category) where.category = query.category;
    if (query.keyword) {
      return this.materialRepository.find({
        where: [
          { name: Like(`%${query.keyword}%`) },
          { materialCode: Like(`%${query.keyword}%`) },
        ],
        order: { createdAt: 'DESC' },
      });
    }
    return this.materialRepository.find({ where, order: { createdAt: 'DESC' } });
  }

  async findOne(id: string): Promise<Material> {
    const m = await this.materialRepository.findOne({ where: { id } });
    if (!m) throw new NotFoundException('物料不存在');
    return m;
  }

  async create(dto: CreateMaterialDto): Promise<Material> {
    if (!dto.name?.trim()) throw new BadRequestException('请输入物料名称');
    // 物料编码自动生成（NumberingService 的 material 规则，可在系统设置里改）
    const materialCode = await this.numbering.next('material');
    const specs = dto.specs || [];
    const material = this.materialRepository.create({
      materialCode,
      name: dto.name.trim(),
      category: dto.category || null,
      specs: JSON.stringify(specs),
      specSignature: computeSpecSignature(specs),
      unit: dto.unit || '件',
      standardPrice: dto.standardPrice ?? null,
      description: dto.description || null,
    });
    return this.materialRepository.save(material);
  }

  async update(id: string, dto: UpdateMaterialDto): Promise<Material> {
    const m = await this.findOne(id);
    if (dto.name !== undefined) m.name = dto.name.trim();
    if (dto.category !== undefined) m.category = dto.category || null;
    if (dto.unit !== undefined) m.unit = dto.unit;
    if (dto.standardPrice !== undefined) m.standardPrice = dto.standardPrice;
    if (dto.description !== undefined) m.description = dto.description;
    // specs 变了要重算签名
    if (dto.specs !== undefined) {
      m.specs = JSON.stringify(dto.specs || []);
      m.specSignature = computeSpecSignature(dto.specs);
    }
    return this.materialRepository.save(m);
  }

  async remove(id: string): Promise<void> {
    const m = await this.findOne(id);
    await this.materialRepository.delete(id);
    this.logger.log(`删除物料 ${m.materialCode}`);
  }

  /**
   * 按规格签名匹配物料（供供应产品自动挂物料用）。
   * 返回命中的物料；签名唯一才适合自动绑定，多个命中交给人工确认。
   */
  async matchBySignature(signature: string): Promise<Material[]> {
    if (!signature) return [];
    return this.materialRepository.find({ where: { specSignature: signature } });
  }

  /**
   * 该物料下各供应商的报价（同规格跨厂家比价的数据）。
   * 用原生查询 join supplier_products + suppliers，避免与 SupplierProductsService 循环依赖。
   * 按 priceMin 升序，前端据此高亮最低价。
   */
  async offerings(materialId: string): Promise<any[]> {
    await this.findOne(materialId); // 404 if not exist
    // 走 createQueryBuilder：列名引号与参数占位符由 TypeORM 按方言处理
    // （原来的裸 SQL 用 ? 占位符且列名未加引号，PostgreSQL 下直接报错）
    return this.materialRepository.manager
      .createQueryBuilder()
      .select([
        'sp.id AS id',
        'sp.productName AS productName',
        'sp.brand AS brand',
        'sp.model AS model',
        'sp.priceMin AS priceMin',
        'sp.priceMax AS priceMax',
        'sp.currency AS currency',
        'sp.deliveryDays AS deliveryDays',
        'sp.moq AS moq',
        'sp.priceDate AS priceDate',
        's.name AS supplierName',
        's.origin AS origin',
        's.tier AS tier',
        's.rating AS rating',
        's.onTimeRate AS onTimeRate',
      ])
      .from('supplier_products', 'sp')
      .leftJoin('suppliers', 's', 's.id = sp.supplierId')
      .where('sp.materialId = :mid', { mid: materialId })
      .orderBy('sp.priceMin IS NULL', 'ASC')
      .addOrderBy('sp.priceMin', 'ASC')
      .getRawMany<any>();
  }

  /**
   * 在物料下直接添加一条厂家报价（从物料侧录入，厂家来自供应管理）。
   * 创建一条 supplier_product 挂到该物料，productName 取物料名。
   */
  async addOffering(materialId: string, dto: {
    supplierId: string;
    brand?: string;
    model?: string;
    priceMin?: number;
    priceMax?: number;
    currency?: string;
    deliveryDays?: number;
    moq?: number;
  }): Promise<any> {
    const material = await this.findOne(materialId);
    const id = uuidv4();
    const now = new Date();
    // 列名全加引号 + $n 占位符：PG 会把未加引号的 camelCase 列折叠成小写，
    // 而 ? 不是 PostgreSQL 的参数占位符；date('now')/datetime('now') 也是 SQLite 专有
    await this.dataSource.query(
      `INSERT INTO supplier_products ("id", "supplierId", "productName", "brand", "model",
        "category", "materialId", "specs", "unit", "priceMin", "priceMax", "currency",
        "priceDate", "priceSource", "deliveryDays", "moq", "isSubstitutable", "status", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5,
        $6, $7, $8, '件', $9, $10, $11,
        $12, 'quote', $13, $14, false, 'active', $15, $16)`,
      [
        id, dto.supplierId, material.name, dto.brand || null, dto.model || null,
        material.category, materialId, material.specs,
        dto.priceMin ?? null, dto.priceMax ?? null, dto.currency || 'CNY',
        now, dto.deliveryDays ?? null, dto.moq ?? null, now, now,
      ],
    );
    return { id, ...dto, materialId };
  }

  /** 删除一条厂家报价 */
  async removeOffering(offeringId: string): Promise<void> {
    await this.dataSource.query(`DELETE FROM supplier_products WHERE "id" = $1`, [offeringId]);
  }

  /** 解析 specs 字段为结构化数组（给前端/匹配用） */
  static parseSpecs(raw?: string): MaterialSpecItem[] {
    try {
      const p = JSON.parse(raw || '[]');
      return Array.isArray(p) ? p : [];
    } catch {
      return [];
    }
  }
}
