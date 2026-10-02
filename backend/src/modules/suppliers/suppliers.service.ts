import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Like, Brackets, In } from 'typeorm';
import { Supplier, SupplierCapability, SupplierProduct, SupplierQuote } from './entities/supplier.entity';
import { CreateSupplierDto, UpdateSupplierDto, QuerySupplierDto } from './dto/supplier.dto';
import { TransactionService } from '../../common/services/transaction.service';
import { normalizeUniqueOptional } from '../../common/utils/normalize.util';
import { NumberingService } from '../../common/services/numbering.service';
import { CurrentUser, PermissionService } from '../../common/services/permission.service';
import { PermissionQueryService } from '../../common/services/permission-query.service';
import { paginate, PaginatedResult } from '../../common/dto/pagination.dto';
import { KnowledgeSyncService } from '../../common/services/knowledge-sync.service';
import { ApprovalsService } from '../approvals/approvals.service';
import { SupplierProductsService } from './supplier-products.service';

@Injectable()
export class SuppliersService {
  constructor(
    @InjectRepository(Supplier)
    private supplierRepository: Repository<Supplier>,
    @InjectRepository(SupplierCapability)
    private capabilityRepository: Repository<SupplierCapability>,
    @InjectRepository(SupplierProduct)
    private supplierProductRepository: Repository<SupplierProduct>,
    @InjectRepository(SupplierQuote)
    private supplierQuoteRepository: Repository<SupplierQuote>,
    private permissionService: PermissionService,
    private knowledgeSyncService: KnowledgeSyncService,
    private approvalsService: ApprovalsService,
    private supplierProductsService: SupplierProductsService,
    private readonly tx: TransactionService,
    private permissionQuery: PermissionQueryService,
    private numbering: NumberingService,
  ) {}

  /** 供应商列表（服务端分页，权限已下沉到 SQL） */
  async findAll(
    query: QuerySupplierDto,
    user: CurrentUser,
  ): Promise<PaginatedResult<Supplier>> {
    const qb = this.supplierRepository.createQueryBuilder('s');

    if (query.origin) qb.andWhere('s.origin = :origin', { origin: query.origin });
    if (query.tier) qb.andWhere('s.tier = :tier', { tier: query.tier });
    if (query.cooperationLevel) {
      qb.andWhere('s.cooperationLevel = :coop', { coop: query.cooperationLevel });
    }
    if (query.rating) qb.andWhere('s.rating = :rating', { rating: query.rating });
    if (query.status) qb.andWhere('s.status = :status', { status: query.status });

    if (query.keyword) {
      qb.andWhere('(s.name LIKE :kw OR s.code LIKE :kw OR s.contactName LIKE :kw)', {
        kw: `%${query.keyword}%`,
      });
    }

    /*
     * productCategories 是 simple-array（逗号分隔文本）。
     * 此前放在应用层过滤，一分页就会出现"过滤后不足一页"的问题，
     * 所以改成给两端补分隔符再 LIKE —— 避免「液压」误命中「液压油」之类的前缀。
     */
    const categories = query.category?.split(',').map((c) => c.trim()).filter(Boolean);
    if (categories?.length) {
      qb.andWhere(
        new Brackets((w) => {
          categories.forEach((cat, i) => {
            const key = `cat${i}`;
            const cond = `(',' || COALESCE(s.productCategories, '') || ',') LIKE :${key}`;
            const val = `%,${cat},%`;
            i === 0 ? w.where(cond, { [key]: val }) : w.orWhere(cond, { [key]: val });
          });
        }),
      );
    }

    this.permissionQuery.apply(qb, 's', user);

    const result = await paginate(qb, 's', query, ['createdAt', 'name', 'rating']);

    // 只为当前这一页补统计，不再扫全表
    const stats = await this.supplierProductsService.priceRangeBySupplier(
      result.list.map((s) => s.id),
    );
    result.list = result.list.map((s) => {
      const stat = stats.get(s.id);
      return Object.assign(s, {
        productCount: stat?.count ?? 0,
        priceMin: stat?.min ?? null,
        priceMax: stat?.max ?? null,
        avgDeliveryDays: stat?.avgDelivery ?? null,
      });
    });

    return result;
  }

  async findOne(id: string, user: CurrentUser): Promise<Supplier> {
    const supplier = await this.supplierRepository.findOne({ where: { id } });
    if (!supplier) throw new NotFoundException('供应商不存在');
    if (!this.permissionService.canAccess(user, this.toSubject(supplier))) {
      throw new BadRequestException('无权访问该供应商');
    }
    const [capabilities, products] = await Promise.all([
      this.capabilityRepository.find({ where: { supplierId: id } }),
      this.supplierProductsService.findBySupplier(id),
    ]);
    (supplier as any).capabilities = capabilities;
    (supplier as any).products = products;
    return supplier;
  }

  /** 供应商 + 能力明细 + 审批流一起落库 */
  async create(dto: CreateSupplierDto, user: CurrentUser): Promise<Supplier> {
    const { capabilities, ...data } = dto;
    const skipApproval = this.permissionService.skipApproval();

    return this.tx.run(
      async (manager) => {
        const supplierRepo = manager.getRepository(Supplier);
        const row = await supplierRepo.save(
          supplierRepo.create({
            ...data,
            // 没填就按编号规则自动生成；空串会和别的空串撞唯一约束
            code: normalizeUniqueOptional(data.code) || (await this.numbering.next('supplier')),
            status: skipApproval ? 'approved' : 'pending',
          }),
        );

        if (capabilities?.length) {
          const capRepo = manager.getRepository(SupplierCapability);
          await capRepo.save(capabilities.map((c) => capRepo.create({ ...c, supplierId: row.id })));
        }

        if (!skipApproval) {
          await this.approvalsService.create(
            {
              objectType: 'supplier',
              objectId: row.id,
              submittedBy: user?.userId,
              status: 'pending',
            },
            manager,
          );
        }

        return row;
      },
      async (row) => this.sync(row),
    );
  }

  async update(id: string, dto: UpdateSupplierDto, user: CurrentUser): Promise<Supplier> {
    const supplier = await this.findOne(id, user);
    if (!this.permissionService.canManage(user, this.toSubject(supplier))) {
      throw new BadRequestException('无权修改该供应商');
    }
    const { capabilities, ...data } = dto;
    /*
     * 编号留空要存 NULL，不能存空串。
     * 空串在数据库看来是个**具体的值**，第二家留空的供应商就撞唯一约束了 ——
     * 用户只是没填一个选填项，却收到「编号已存在」。
     */
    Object.assign(supplier, data, { code: normalizeUniqueOptional(data.code) });

    // 能力明细先删后插，不在事务里失败会把明细清空
    return this.tx.run(
      async (manager) => {
        const row = await manager.getRepository(Supplier).save(supplier);
        if (capabilities?.length) {
          const capRepo = manager.getRepository(SupplierCapability);
          await capRepo.delete({ supplierId: id });
          await capRepo.save(capabilities.map((c) => capRepo.create({ ...c, supplierId: row.id })));
        }
        return row;
      },
      async (row) => this.sync(row),
    );
  }

  /**
   * 删除供应商：能力、产品、报价（经产品）与主行一起删（事务保护），向量清理放事务外。
   * QuotationItem.supplierId 反向引用不级联置空——供应商删除不等于已报价明细作废。
   */
  async remove(id: string, user: CurrentUser): Promise<void> {
    const supplier = await this.findOne(id, user);
    if (!this.permissionService.canManage(user, this.toSubject(supplier))) {
      throw new BadRequestException('无权删除该供应商');
    }
    await this.tx.run(
      async (manager) => {
        // 先查出该供应商的全部产品 id，用于删报价（报价挂在产品上）
        const productIds = (
          await manager.getRepository(SupplierProduct).find({
            where: { supplierId: id },
            select: ['id'],
          })
        ).map((p) => p.id);
        if (productIds.length) {
          await manager.getRepository(SupplierQuote).delete({ supplierProductId: In(productIds) });
        }
        await manager.getRepository(SupplierProduct).delete({ supplierId: id });
        await manager.getRepository(SupplierCapability).delete({ supplierId: id });
        await manager.getRepository(Supplier).delete(id);
      },
      async () => {
        await this.knowledgeSyncService.deleteObject('supplier', id);
      },
    );
  }

  async approve(id: string, user: CurrentUser): Promise<Supplier> {
    if (!this.permissionService.canApprove(user)) throw new BadRequestException('无权审核');
    const supplier = await this.supplierRepository.findOne({ where: { id } });
    if (!supplier) throw new NotFoundException('供应商不存在');
    supplier.status = 'approved';
    return this.tx.run(
      async (manager) => {
        const saved = await manager.save(supplier);
        await this.approvalsService.approve('supplier', id, user?.userId, '审核通过', manager);
        return saved;
      },
    );
  }

  private async sync(supplier: Supplier): Promise<void> {
    // 把分级与品类也喂进知识库，"有没有国内的一线液压供应商"这类问法才检索得到
    const origin = supplier.origin === 'domestic' ? '国内' : supplier.origin === 'overseas' ? '国外' : '';
    const tier =
      supplier.tier === 'tier1' ? '一线品牌' : supplier.tier === 'tier2' ? '二线品牌' : '';
    const content = [
      supplier.name,
      supplier.code,
      supplier.contactName,
      supplier.phone,
      supplier.email,
      supplier.address,
      origin,
      supplier.country,
      tier,
      (supplier.productCategories || []).join(' '),
      (supplier.qualification || []).join(' '),
      supplier.description,
    ]
      .filter(Boolean)
      .join(' ');
    await this.knowledgeSyncService.syncObject({
      id: supplier.id,
      objectType: 'supplier',
      title: supplier.name,
      content,
      visibility: supplier.visibility,
      groupIds: supplier.groupIds,
      roleCodes: supplier.roleCodes,
    });
  }

  private toSubject(supplier: Supplier) {
    return {
      visibility: supplier.visibility,
      uploaderId: undefined,
      groupIds: supplier.groupIds,
      roleCodes: supplier.roleCodes,
    };
  }
}
