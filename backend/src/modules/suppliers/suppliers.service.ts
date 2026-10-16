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

    /*
     * 排序白名单补上 tier/cooperationLevel/origin：供应商列表的核心场景是比价，
     * 产品数/价格区间/平均交期这几列是分页后另查统计表拼上去的（priceRangeBySupplier），
     * 不是 Supplier 表自身字段，排不了序；层级/合作等级/评级/名称都是真实列，可以直接排。
     */
    const result = await paginate(qb, 's', query, ['createdAt', 'name', 'rating', 'tier', 'cooperationLevel', 'origin']);

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
    // 重名拦截：厂家名册同名会让设备配套的 datalist 提示出现两条，无从选择
    if (data.name?.trim()) {
      const dup = await this.supplierRepository.findOne({ where: { name: data.name.trim() } });
      if (dup) throw new BadRequestException(`已存在同名供应商「${data.name.trim()}」（${dup.code || dup.id.slice(0, 8)}），请勿重复创建`);
    }
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


  /**
   * 供应商改名 → 同步 equipment_bom / spare_parts_bom 里 suppliers 数组的旧名。
   * 这两份配置以 JSON 存 system_configs，引用的是厂家名字符串；
   * 只做数组元素级替换（读→改→写），避免字符串全文替换误伤备注等文本。
   */
  private async renameInBomConfigs(from: string, to: string): Promise<void> {
    const mgr = this.supplierRepository.manager;
    for (const key of ['equipment_bom', 'spare_parts_bom']) {
      try {
        const row = await mgr.query('SELECT value FROM system_configs WHERE key = $1', [key]);
        if (!row?.length || !row[0].value) continue;
        const bom = JSON.parse(row[0].value);
        let touched = 0;
        for (const equip of Object.keys(bom)) {
          bom[equip] = (bom[equip] || []).map((item: any) => {
            if (item && Array.isArray(item.suppliers)) {
              const before = item.suppliers.length;
              item.suppliers = item.suppliers.map((n: string) => (n === from ? to : n));
              if (item.suppliers.length === before && item.suppliers.includes(to)) touched++;
            }
            return item;
          });
        }
        if (touched || JSON.stringify(bom) !== row[0].value) {
          await mgr.query('UPDATE system_configs SET value = $1 WHERE key = $2', [JSON.stringify(bom), key]);
        }
      } catch (err) {
        console.warn(`同步 ${key} 供应商改名失败：`, (err as Error).message);
      }
    }
  }

  async update(id: string, dto: UpdateSupplierDto, user: CurrentUser): Promise<Supplier> {
    const supplier = await this.findOne(id, user);
    if (!this.permissionService.canManage(user, this.toSubject(supplier))) {
      throw new BadRequestException('无权修改该供应商');
    }
    const { capabilities, ...data } = dto;
    // 改名：拦重名 + 同步设备配套/备件配置里的引用（否则配套表里仍是旧名，两边对不上）
    if (data.name?.trim() && data.name.trim() !== supplier.name) {
      const dup = await this.supplierRepository.findOne({ where: { name: data.name.trim() } });
      if (dup) throw new BadRequestException(`已存在同名供应商「${data.name.trim()}」，请勿重复创建`);
      await this.renameInBomConfigs(supplier.name, data.name.trim());
    }
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
