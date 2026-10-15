import { buildProductContent } from '../../common/services/index-content.builder';
import { BusinessTrashService } from '../recycle-bin/business-trash.service';
import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { normalizeUniqueOptional } from '../../common/utils/normalize.util';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Like } from 'typeorm';
import * as XLSX from 'xlsx';
import * as fs from 'fs';
import * as path from 'path';
import { safeUploadTarget } from '../../common/utils/safe-path.util';
import { Product, ProductBom, ProductAttachment, ProductPriceItem } from './entities/product.entity';
import { CreateProductDto, UpdateProductDto, QueryProductDto } from './dto/product.dto';
import { TransactionService } from '../../common/services/transaction.service';
import { CurrentUser, PermissionService } from '../../common/services/permission.service';
import { PermissionQueryService } from '../../common/services/permission-query.service';
import { paginate, PaginatedResult } from '../../common/dto/pagination.dto';
import { KnowledgeSyncService } from '../../common/services/knowledge-sync.service';
import { ApprovalsService } from '../approvals/approvals.service';

@Injectable()
export class ProductsService {
  private readonly logger = new Logger(ProductsService.name);
  private uploadDir: string;

  constructor(
    @InjectRepository(Product)
    private productRepository: Repository<Product>,
    @InjectRepository(ProductBom)
    private bomRepository: Repository<ProductBom>,
    @InjectRepository(ProductAttachment)
    private attachmentRepository: Repository<ProductAttachment>,
    private permissionService: PermissionService,
    private knowledgeSyncService: KnowledgeSyncService,
    private approvalsService: ApprovalsService,
    private readonly tx: TransactionService,
    private permissionQuery: PermissionQueryService,
    private readonly trash: BusinessTrashService,
  ) {
    this.uploadDir = path.resolve(process.cwd(), 'data', 'uploads', 'products');
    if (!fs.existsSync(this.uploadDir)) {
      fs.mkdirSync(this.uploadDir, { recursive: true });
    }
  }

  /** 列表（服务端分页，权限已下沉到 SQL） */
  async findAll(query: QueryProductDto, user: CurrentUser): Promise<PaginatedResult<Product>> {
    const qb = this.productRepository.createQueryBuilder('p');

    if (query.category) qb.andWhere('p.category = :category', { category: query.category });
    if (query.keyword) {
      // 名称/编码/分类 一起搜（按"油缸""联轴器"等分类找产品很常见）
      qb.andWhere('(p.name LIKE :kw OR p.code LIKE :kw OR p.category LIKE :kw)', { kw: `%${query.keyword}%` });
    }

    this.permissionQuery.apply(qb, 'p', user);

    return paginate(qb, 'p', query, ['createdAt', 'name', 'price', 'category']);
  }


  async findOne(id: string, user: CurrentUser): Promise<Product> {
    const product = await this.productRepository.findOne({ where: { id } });
    if (!product) throw new NotFoundException('产品不存在');
    if (!this.permissionService.canAccess(user, this.toSubject(product))) {
      throw new BadRequestException('无权访问该产品');
    }
    const boms = await this.bomRepository.find({ where: { productId: id } });
    (product as any).boms = boms;
    const attachments = await this.attachmentRepository.find({ where: { productId: id } });
    (product as any).attachments = attachments;
    return product;
  }


  /**
   * 这个产品被用在哪儿。
   *
   * 产品管理页此前是个孤岛：能看参数、能改价格，但回答不了业务上最常问的
   * 「这个型号我们报过几次、报什么价、卖给过谁」——而这正是再次报价时的定价依据。
   *
   * 数据来自 quotation_items.productId（新加的引用列）。
   * 老明细没有这个引用，所以只统计得到有引用的部分，界面上会说明。
   */
  async usage(id: string, user: CurrentUser) {
    await this.findOne(id, user); // 借它做存在性与权限校验

    const rows = await this.productRepository.manager
      .createQueryBuilder()
      .select([
        'q.id AS "quotationId"',
        'q.quotationNo AS "quotationNo"',
        'q.status AS "status"',
        'q.createdAt AS "createdAt"',
        'i.quantity AS "quantity"',
        'i.unitPrice AS "unitPrice"',
        'r.title AS "projectName"',
        'c.code AS "customerShortName"',
      ])
      .from('quotation_items', 'i')
      .innerJoin('quotations', 'q', 'q.id = i."quotationId"')
      .leftJoin('proposals', 'p', 'p.id = q."proposalId"')
      .leftJoin('requirements', 'r', 'r.id = p."requirementId"')
      .leftJoin('customers', 'c', 'c.id = r."customerId"')
      .where('i."productId" = :id', { id })
      .orderBy('q."createdAt"', 'DESC')
      .limit(50)
      .getRawMany<any>();

    const prices = rows.map((r) => Number(r.unitPrice)).filter((n) => n > 0);
    return {
      quotations: rows,
      stats: {
        count: rows.length,
        minPrice: prices.length ? Math.min(...prices) : null,
        maxPrice: prices.length ? Math.max(...prices) : null,
        avgPrice: prices.length ? prices.reduce((a, b) => a + b, 0) / prices.length : null,
      },
    };
  }

  /** 型号价格表导出：列与导入模板一致，改完可直接回灌 */
  async exportPriceList(id: string, user: CurrentUser): Promise<Buffer> {
    const product = await this.findOne(id, user);
    const rows = (product.priceList || []).map((r) => ({
      型号规格: r.model,
      关键参数: r.spec || '',
      成本价: r.costPrice ?? '',
      参考价: r.referencePrice ?? '',
      标配价: r.standardPrice ?? '',
      销售价: r.salePrice ?? '',
      单位: r.unit || '',
      备注: r.remark || '',
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), '型号价格表');
    return XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' });
  }

  /**
   * 型号价格表导入：按「型号规格」匹配 ——
   * 已有型号只覆盖导入文件里非空的字段（导出后只改部分列也能回灌），新型号追加到末尾。
   */
  async importPriceList(id: string, buffer: Buffer, user: CurrentUser) {
    const product = await this.findOne(id, user);
    if (!this.permissionService.canManage(user, this.toSubject(product))) {
      throw new BadRequestException('无权修改该产品');
    }

    let rows: any[];
    try {
      const wb = XLSX.read(buffer, { type: 'buffer' });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      rows = XLSX.utils.sheet_to_json(sheet, { defval: null });
    } catch {
      throw new BadRequestException('文件解析失败，请确认是有效的 xlsx / csv 文件');
    }

    const merged: ProductPriceItem[] = [...(product.priceList || [])];
    const idxByModel = new Map(merged.map((r, i) => [r.model, i]));
    const errors: Array<{ row: number; message: string }> = [];
    let updated = 0;
    let added = 0;

    for (let i = 0; i < rows.length; i++) {
      const rowNo = i + 2; // +2：第 1 行是表头，行号从 1 开始
      const r = rows[i];
      const model = String(r['型号规格'] ?? r['型号'] ?? r['model'] ?? '').trim();
      if (!model) {
        errors.push({ row: rowNo, message: '缺少型号规格' });
        continue;
      }
      const patch: Partial<ProductPriceItem> = {};
      const spec = r['关键参数'] ?? r['spec'];
      const unit = r['单位'] ?? r['unit'];
      const remark = r['备注'] ?? r['remark'];
      if (spec != null && spec !== '') patch.spec = String(spec);
      if (unit != null && unit !== '') patch.unit = String(unit);
      if (remark != null && remark !== '') patch.remark = String(remark);
      const costPrice = this.toPriceNumber(r['成本价'] ?? r['costPrice']);
      const referencePrice = this.toPriceNumber(r['参考价'] ?? r['referencePrice']);
      const standardPrice = this.toPriceNumber(r['标配价'] ?? r['standardPrice']);
      const salePrice = this.toPriceNumber(r['销售价'] ?? r['salePrice']);
      if (costPrice !== undefined) patch.costPrice = costPrice;
      if (referencePrice !== undefined) patch.referencePrice = referencePrice;
      if (standardPrice !== undefined) patch.standardPrice = standardPrice;
      if (salePrice !== undefined) patch.salePrice = salePrice;
      patch.updatedAt = new Date().toISOString();

      if (idxByModel.has(model)) {
        const idx = idxByModel.get(model)!;
        merged[idx] = { ...merged[idx], ...patch };
        updated += 1;
      } else {
        merged.push({ model, ...patch });
        idxByModel.set(model, merged.length - 1);
        added += 1;
      }
    }

    product.priceList = merged;
    await this.tx.run(
      async (manager) => manager.getRepository(Product).save(product),
      async (row) => this.sync(row),
    );

    return { total: rows.length, added, updated, errors, priceList: merged };
  }

  private toPriceNumber(v: any): number | undefined {
    if (v === null || v === undefined || v === '') return undefined;
    const n = Number(String(v).replace(/[,¥$\s]/g, ''));
    return Number.isFinite(n) ? n : undefined;
  }

  async create(dto: CreateProductDto, user: CurrentUser): Promise<Product> {
    const { boms, ...data } = dto;
    const product = this.productRepository.create({
      ...data,
      ownerId: user?.userId,
      departmentId: user?.departmentId,
      code: normalizeUniqueOptional(data.code),
      status: this.permissionService.skipApproval() ? 'approved' : 'pending',
    });

    /*
     * 主行 + BOM + 审批记录在同一事务内。
     *
     * 审批原来放在事务外，理由写的是"审批是独立关切"。但主行已经带着
     * status='pending' 提交了，审批记录若建失败，这条产品就永远卡在待审
     * 而审批中心里根本没有它 —— 既过不了审也退不回去。
     * requirements / customers / proposals / quotations / contracts 五个模块
     * 都是放在事务内的（approvalsService.create 第二个参数就是为此留的），
     * 这里对齐它们，别让同一件事在八个模块里有两种语义。
     *
     * 向量同步仍在事务外：它设计上就是提交后异步，失败也只影响检索。
     */
    const skipApproval = this.permissionService.skipApproval();
    const saved = await this.tx.run(
      async (manager) => {
        const row = await manager.getRepository(Product).save(product);
        if (boms?.length) {
          const bomRepo = manager.getRepository(ProductBom);
          const bomEntities = boms.map((bom) => bomRepo.create({ ...bom, productId: row.id }));
          await bomRepo.save(bomEntities);
        }
        if (!skipApproval) {
          await this.approvalsService.create({
            objectType: 'product',
            objectId: row.id,
            submittedBy: user?.userId,
            status: 'pending',
          }, manager);
        }
        return row;
      },
    );

    await this.sync(saved);
    return saved;
  }

  async update(id: string, dto: UpdateProductDto, user: CurrentUser): Promise<Product> {
    const product = await this.findOne(id, user);
    if (!this.permissionService.canManage(user, this.toSubject(product))) {
      throw new BadRequestException('无权修改该产品');
    }
    const { boms, ...data } = dto;
    Object.assign(product, data, { code: normalizeUniqueOptional(data.code) });

    // BOM 先删后插：不在事务里失败会把整张 BOM 清空
    return this.tx.run(
      async (manager) => {
        const row = await manager.getRepository(Product).save(product);
        if (boms?.length) {
          const bomRepo = manager.getRepository(ProductBom);
          await bomRepo.delete({ productId: id });
          await bomRepo.save(boms.map((b) => bomRepo.create({ ...b, productId: row.id })));
        }
        return row;
      },
      async (row) => this.sync(row),
    );
  }

  /**
   * 删除产品：BOM、附件行（含磁盘文件）、附件向量与主行一起清理。
   * 磁盘文件删除放在事务外（文件 IO 不应进 DB 事务），主表 + BOM + 附件行进事务。
   * 之前只删主行，附件文件永久留在磁盘、附件向量永久残留在向量库。
   */
  async remove(id: string, user: CurrentUser): Promise<void> {
    const product = await this.findOne(id, user);
    if (!this.permissionService.canManage(user, this.toSubject(product))) {
      throw new BadRequestException('无权删除该产品');
    }
    const attachments = await this.attachmentRepository.find({ where: { productId: id } });
    await this.tx.run(
      async (manager) => {
        await this.trash.capture(manager, 'product', id, `${product.code || ''} ${product.name || ''}`.trim(), [
          { table: 'products', column: 'id', ids: [id] },
          { table: 'product_boms', column: 'productId', ids: [id] },
          { table: 'product_attachments', column: 'productId', ids: [id] },
        ], user?.userId);
        await manager.getRepository(ProductBom).delete({ productId: id });
        await manager.getRepository(ProductAttachment).delete({ productId: id });
        await manager.getRepository(Product).delete(id);
      },
      async () => {
        // 向量清理：主产品 + 每个附件（复合 id）
        await this.knowledgeSyncService.deleteObject('product', id);
        await Promise.all(
          attachments.map((a) =>
            this.knowledgeSyncService.deleteObject('product_attachment', `${id}_attachment_${a.id}`),
          ),
        );
        // 磁盘文件清理
        for (const att of attachments) {
          try {
            const filePath = path.join(this.uploadDir, att.fileKey.replace(/^products\//, ''));
            if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
          } catch (err) {
            this.logger.error('Delete attachment file failed', err?.message);
          }
        }
      },
    );
  }

  private readonly allowedAttachmentExtensions = [
    '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.txt', '.md', '.png', '.jpg', '.jpeg',
  ];

  async uploadAttachment(
    id: string,
    file: Express.Multer.File,
    attachmentType: string,
    user: CurrentUser,
  ): Promise<ProductAttachment> {
    const product = await this.findOne(id, user);
    // 此前这里既不校验扩展名也不防路径穿越。路径穿越已补，这里补扩展名白名单，
    // 与 documents 模块保持一致，避免上传可执行/脚本类文件。
    const dotIdx = file.originalname.toLowerCase().lastIndexOf('.');
    const ext = dotIdx >= 0 ? file.originalname.toLowerCase().slice(dotIdx) : '';
    if (!this.allowedAttachmentExtensions.includes(ext)) {
      throw new BadRequestException(
        `不支持的产品附件类型: ${ext}，支持 ${this.allowedAttachmentExtensions.join(', ')}`,
      );
    }
    const { displayName, fileName, filePath } = safeUploadTarget(
      this.uploadDir,
      file.originalname,
      'product',
    );
    const fileKey = `products/${fileName}`;
    fs.writeFileSync(filePath, file.buffer);

    const publicUrl = `${process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || 3001}`}/uploads/products/${fileName}`;

    const attachment = this.attachmentRepository.create({
      productId: product.id,
      fileName: displayName,
      fileKey,
      fileUrl: publicUrl,
      fileSize: file.size,
      mimeType: file.mimetype,
      attachmentType: attachmentType || 'other',
    });
    const saved = await this.attachmentRepository.save(attachment);

    this.knowledgeSyncService.syncObject({
      id: `${product.id}_attachment_${saved.id}`,
      objectType: 'product_attachment',
      title: `${product.name} - ${file.originalname}`,
      content: `${product.name} ${product.code || ''} ${product.description || ''} ${file.originalname} ${attachmentType}`,
      visibility: product.visibility,
      groupIds: product.groupIds,
      roleCodes: product.roleCodes,
    }).catch((err) => this.logger.error('Sync attachment failed', err?.message));

    return saved;
  }

  async removeAttachment(id: string, aid: string, user: CurrentUser): Promise<void> {
    const product = await this.findOne(id, user);
    if (!this.permissionService.canManage(user, this.toSubject(product))) {
      throw new BadRequestException('无权删除附件');
    }
    const attachment = await this.attachmentRepository.findOne({ where: { id: aid, productId: id } });
    if (!attachment) throw new NotFoundException('附件不存在');
    try {
      const filePath = path.join(this.uploadDir, attachment.fileKey.replace(/^products\//, ''));
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch (err) {
      this.logger.error('Delete attachment file failed', err?.message);
    }
    await this.knowledgeSyncService.deleteObject('product_attachment', `${id}_attachment_${aid}`);
    await this.attachmentRepository.delete(aid);
  }

  async approve(id: string, user: CurrentUser): Promise<Product> {
    if (!this.permissionService.canApprove(user)) throw new BadRequestException('无权审核');
    const product = await this.productRepository.findOne({ where: { id } });
    if (!product) throw new NotFoundException('产品不存在');
    product.status = 'approved';
    return this.tx.run(
      async (manager) => {
        const saved = await manager.save(product);
        await this.approvalsService.approve('product', id, user?.userId, '审核通过', manager);
        return saved;
      },
    );
  }

  private async sync(product: Product): Promise<void> {
    // 与全量重建同一套内容(含型号价格表、技术参数、BOM): 日常保存后的索引不能比重建后的更差
    const content = buildProductContent(product);
    await this.knowledgeSyncService.syncObject({
      id: product.id,
      objectType: 'product',
      title: product.name,
      content,
      visibility: product.visibility,
      groupIds: product.groupIds,
      roleCodes: product.roleCodes,
    });
  }

  private toSubject(product: Product) {
    return {
      visibility: product.visibility,
      uploaderId: product.ownerId,
      departmentId: product.departmentId,
      groupIds: product.groupIds,
      roleCodes: product.roleCodes,
    };
  }
}
