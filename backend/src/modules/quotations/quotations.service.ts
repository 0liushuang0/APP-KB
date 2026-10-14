import { Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Like } from 'typeorm';
import { Quotation, QuotationItem } from './entities/quotation.entity';
import { QuotationVersion } from './entities/quotation-version.entity';
import { CreateQuotationDto, UpdateQuotationDto, SuggestQuotationDto, QueryQuotationDto, CreateQuotationItemDto } from './dto/quotation.dto';
import { TransactionService } from '../../common/services/transaction.service';
import { CurrentUser, PermissionService } from '../../common/services/permission.service';
import { NumberingService } from '../../common/services/numbering.service';
import { SharedFieldsService } from '../../common/services/shared-fields.service';
import { PermissionQueryService } from '../../common/services/permission-query.service';
import { paginate, PaginatedResult } from '../../common/dto/pagination.dto';
import { KnowledgeSyncService } from '../../common/services/knowledge-sync.service';
import { AiService } from '../../common/services/ai.service';
import { ApprovalsService } from '../approvals/approvals.service';
import { Customer } from '../customers/entities/customer.entity';

@Injectable()
export class QuotationsService {
  constructor(
    @InjectRepository(Quotation)
    private quotationRepository: Repository<Quotation>,
    @InjectRepository(QuotationItem)
    private itemRepository: Repository<QuotationItem>,
    @InjectRepository(QuotationVersion)
    private versionRepository: Repository<QuotationVersion>,
    @InjectRepository(Customer)
    private customerRepository: Repository<Customer>,
    private permissionService: PermissionService,
    private knowledgeSyncService: KnowledgeSyncService,
    private aiService: AiService,
    private approvalsService: ApprovalsService,
    private readonly tx: TransactionService,
    private permissionQuery: PermissionQueryService,
    private numbering: NumberingService,
    private sharedFields: SharedFieldsService,
  ) {}

  /** 列表（服务端分页，权限已下沉到 SQL） */
  async findAll(query: QueryQuotationDto, user: CurrentUser): Promise<PaginatedResult<Quotation>> {
    const qb = this.quotationRepository.createQueryBuilder('q');

    if (query.status) qb.andWhere('q.status = :status', { status: query.status });
    if (query.keyword) {
      // 报价号 + 关联方案号 + 需求标题 + 客户名 一起搜（顺着 报价→方案→需求→客户 取值）。
      // 之前只匹配 quotationNo，但前端 placeholder 写"搜索编号/客户"，按客户名搜必然空。
      qb.andWhere(
        `(q.quotationNo LIKE :kw OR EXISTS (
          SELECT 1 FROM proposals pp
          LEFT JOIN requirements rq ON rq.id = pp."requirementId"
          LEFT JOIN customers cc ON cc.id = rq."customerId"
          WHERE pp.id = q."proposalId"
            AND (pp."proposalNo" LIKE :kw OR rq.title LIKE :kw OR cc.name LIKE :kw)
        ))`,
        { kw: `%${query.keyword}%` },
      );
    }

    this.permissionQuery.apply(qb, 'q', user);

    const result = await paginate(qb, 'q', query, ['createdAt', 'quotationNo', 'amount', 'status']);
    return { ...result, list: await this.attachRelations(result.list) };
  }

  /**
   * 贴上客户简称与项目名称。
   *
   * 报价顺着 报价 → 方案 → 需求 取值：这两份值只存在需求上，
   * 报价自己不再维护，不会出现三个模块各写各的名字。
   */
  private async attachRelations(rows: Quotation[]): Promise<any[]> {
    if (!rows.length) return rows;
    const manager = this.quotationRepository.manager;
    const proposalIds = [...new Set(rows.map((r) => r.proposalId).filter(Boolean))];

    const chain = proposalIds.length
      ? await manager
          .createQueryBuilder()
          .select([
            'p.id AS "proposalId"',
            'r.title AS "projectName"',
            'r.requirementNo AS "requirementNo"',
            'c.name AS "customerName"',
            'c.code AS "customerShortName"',
          ])
          .from('proposals', 'p')
          .leftJoin('requirements', 'r', 'r.id = p."requirementId"')
          .leftJoin('customers', 'c', 'c.id = r."customerId"')
          .where('p.id IN (:...ids)', { ids: proposalIds })
          .getRawMany<any>()
      : [];

    const map = new Map(chain.map((x) => [x.proposalId, x]));

    /*
     * 链路可能断（方案被删后重建、导入数据的 requirementId 悬空等），
     * 断了不该让客户整列变空 —— 报价自身就存着 customerId，链取不到时按它回退。
     */
    const broken = rows.filter((q) => {
      const link = q.proposalId ? map.get(q.proposalId) : undefined;
      return !link?.customerName && !link?.customerShortName && !!q.customerId;
    });
    const fallbackIds = [...new Set(broken.map((q) => q.customerId!))];
    const fallbacks = fallbackIds.length
      ? await manager
          .createQueryBuilder()
          .select(['c.id AS "id"', 'c.name AS "customerName"', 'c.code AS "customerShortName"'])
          .from('customers', 'c')
          .where('c.id IN (:...ids)', { ids: fallbackIds })
          .getRawMany<any>()
      : [];
    const fmap = new Map(fallbacks.map((f) => [f.id, f]));

    // 附件计数（source=输入 / deliverable=输出），列表操作列显示用
    const ids = rows.map((q) => q.id);
    const counts = ids.length
      ? await manager
          .createQueryBuilder()
          .select(['l."quotationId" AS "id"', 'l."linkRole" AS "role"', 'COUNT(*) AS "n"'])
          .from('document_links', 'l')
          .where('l."quotationId" IN (:...ids)', { ids })
          .groupBy('l."quotationId"')
          .addGroupBy('l."linkRole"')
          .getRawMany<{ id: string; role: string; n: string }>()
      : [];
    const cmap = new Map<string, { input: number; output: number }>();
    for (const c of counts) {
      const cur = cmap.get(c.id) || { input: 0, output: 0 };
      if (c.role === 'source') cur.input = Number(c.n);
      if (c.role === 'deliverable') cur.output = Number(c.n);
      cmap.set(c.id, cur);
    }

    return rows.map((q) => {
      const link = q.proposalId ? map.get(q.proposalId) : undefined;
      const fb = link?.customerName || link?.customerShortName ? null : fmap.get(q.customerId || '');
      return {
        ...q,
        customerName: link?.customerName || fb?.customerName || null,
        customerShortName: link?.customerShortName || link?.customerName || fb?.customerShortName || fb?.customerName || null,
        projectName: link?.projectName,
        requirementNo: link?.requirementNo,
        attachmentCounts: cmap.get(q.id) || { input: 0, output: 0 },
      };
    });
  }

  /** 报价编号继承所关联方案的流水号：PROP-2026-007 → QUO-2026-007 */
  private async nextNo(proposalId?: string): Promise<string> {
    if (!proposalId) return this.numbering.next('quotation');
    const row = await this.quotationRepository.manager
      .createQueryBuilder()
      .select('p.proposalNo', 'no')
      .from('proposals', 'p')
      .where('p.id = :id', { id: proposalId })
      .getRawOne<{ no: string }>();
    return this.numbering.derive('quotation', row?.no);
  }

  /** 客户跟随上游：报价 → 方案 → 需求 */
  private async inheritCustomerId(proposalId?: string, fallback?: string) {
    if (!proposalId) return fallback;
    const row = await this.quotationRepository.manager
      .createQueryBuilder()
      .select('r.customerId', 'customerId')
      .from('proposals', 'p')
      .leftJoin('requirements', 'r', 'r.id = p.requirementId')
      .where('p.id = :id', { id: proposalId })
      .getRawOne<{ customerId: string }>();
    return row?.customerId ?? fallback;
  }


  async findOne(id: string, user: CurrentUser): Promise<Quotation> {
    const quotation = await this.quotationRepository.findOne({ where: { id } });
    if (!quotation) throw new NotFoundException('报价不存在');
    if (!this.permissionService.canAccess(user, this.toSubject(quotation))) {
      throw new BadRequestException('无权访问该报价');
    }
    const items = await this.itemRepository.find({
      where: { quotationId: id },
      order: { sortOrder: 'ASC' },
    });
    (quotation as any).items = items;
    (quotation as any).margin = this.calcMargin(items);
    return quotation;
  }

  /**
   * 成本与毛利汇总。
   *
   * 只统计填了成本的明细行 —— 部分行没成本时，把它们当 0 会虚高毛利率，
   * 所以额外返回 coveredRatio，让前端能提示"毛利率仅覆盖 N% 的金额"。
   */
  private calcMargin(items: QuotationItem[]) {
    const total = items.reduce((s, it) => s + Number(it.totalPrice || 0), 0);
    const withCost = items.filter((it) => it.cost != null);
    const costTotal = withCost.reduce(
      (s, it) => s + Number(it.cost) * Number(it.quantity || 1),
      0,
    );
    const coveredRevenue = withCost.reduce((s, it) => s + Number(it.totalPrice || 0), 0);
    const gross = coveredRevenue - costTotal;
    return {
      total,
      costTotal,
      grossProfit: gross,
      grossMargin: coveredRevenue > 0 ? Math.round((gross / coveredRevenue) * 1000) / 10 : null,
      coveredRatio: total > 0 ? Math.round((coveredRevenue / total) * 100) : 0,
      itemsWithoutCost: items.length - withCost.length,
    };
  }

  /**
   * 金额一律服务端重算：明细行金额 = 数量 × 单价（四舍五入到分），
   * 报价总额 = 明细合计。客户端传来的 totalPrice / amount 不再直接落库。
   * 否则会出现"数量 × 单价 ≠ 行金额、行合计 ≠ 总额"的对不上账。
   */
  private normalizeItems(items: CreateQuotationItemDto[] = []) {
    const round2 = (n: number) => Math.round(Number(n || 0) * 100) / 100;
    const computed = items.map((it) => {
      const quantity = round2(it.quantity ?? 1);
      const unitPrice = round2(it.unitPrice ?? 0);
      return { ...it, quantity, unitPrice, totalPrice: round2(quantity * unitPrice) };
    });
    const amount = round2(computed.reduce((s, it) => s + Number(it.totalPrice || 0), 0));
    return { computed, amount };
  }

  /**
   * 新建报价。
   *
   * 报价头 + 明细 + 审批流三张表必须一起成功：
   * 只落了头没落明细的报价单，金额还在但没有依据，业务上是脏数据。
   * AI 知识库同步放到提交之后 —— 一次 AI 服务超时不该让整笔报价回滚。
   */
  async create(dto: CreateQuotationDto, user: CurrentUser): Promise<Quotation> {
    const { items, ...data } = dto;
    const { computed, amount } = this.normalizeItems(items);
    const skipApproval = this.permissionService.skipApproval();

    const saved = await this.tx.run(
      async (manager) => {
        const quotation = manager.getRepository(Quotation).create({
          ...data,
          amount,
          quotationNo: data.quotationNo || (await this.nextNo(data.proposalId)),
          customerId: await this.inheritCustomerId(data.proposalId, data.customerId),
          ownerId: user?.userId,
          departmentId: data.departmentId || user?.departmentId,
          status: skipApproval ? 'approved' : 'pending',
        });
        const row = await manager.getRepository(Quotation).save(quotation);

        if (computed.length) {
          await manager.getRepository(QuotationItem).save(
            computed.map((item) =>
              manager.getRepository(QuotationItem).create({ ...item, quotationId: row.id }),
            ),
          );
        }

        if (!skipApproval) {
          await this.approvalsService.create(
            {
              objectType: 'quotation',
              objectId: row.id,
              submittedBy: user?.userId,
              status: 'pending',
            },
            manager,
          );
        }

        return row;
      },
      async (row) => {
        await this.sync(row, computed);
      },
    );

    return saved;
  }

  async update(id: string, dto: UpdateQuotationDto, user: CurrentUser): Promise<Quotation> {
    const quotation = await this.findOne(id, user);
    if (!this.permissionService.canManage(user, this.toSubject(quotation))) {
      throw new BadRequestException('无权修改该报价');
    }

    /*
     * 乐观锁：提交的版本号与服务器不一致，说明读取之后有人改过这张报价，
     * 拒绝保存而不是静默覆盖对方的修改。
     */
    if (dto.version != null && dto.version !== quotation.version) {
      throw new ConflictException('该报价已被他人修改，请刷新页面后重试');
    }

    /*
     * 写回必须在权限校验**之后** —— 之前放在最前面，等于无权修改这张报价的人
     * 也能顺着它把关联需求的项目名称改掉，绕过了整条权限链。
     */
    await this.sharedFields.writeBack('quotation', id, {
      projectName: (dto as any).projectName,
      customerId: (dto as any).customerId,
    });

    /*
     * 版本冻结：修改前把当前版整体存档（头字段 + 明细）。
     * 必须在 Object.assign 覆盖实体之前取值，否则旧值就丢了。
     */
    const currentItems = await this.itemRepository.find({ where: { quotationId: id } });
    const archivedVersion = quotation.version;
    // 实体马上会被 Object.assign 覆盖，先按当前值序列化快照
    const archivedSnapshot = JSON.stringify({ ...quotation });
    const archivedItems = JSON.stringify(currentItems);

    // projectName 不是报价表的列；version 已用于冲突检查，不能再赋回实体
    const { items, projectName: _pn, version: _v, ...data } = dto as any;
    const wasApproved = quotation.status === 'approved';
    Object.assign(quotation, data);

    // 明细存在时金额由服务器重算，覆盖客户端传值
    let computed: CreateQuotationItemDto[] | undefined;
    if (items?.length) {
      const norm = this.normalizeItems(items);
      computed = norm.computed;
      quotation.amount = norm.amount;
    }

    /*
     * 已审核的报价被修改：一律退回待审并重新生成审批流。
     * "审批通过"只能作为审批结果存在，不能在改单后继续挂着 ——
     * 否则客户拿到的报价单和系统里已批准的金额对不上。
     */
    const needsReapproval = wasApproved && !this.permissionService.skipApproval();
    if (needsReapproval) quotation.status = 'pending';
    quotation.version = (quotation.version || 1) + 1;

    /*
     * 明细是"先删后插"：不在事务里的话，删除成功而插入失败会把整张报价单的
     * 明细清空且无法恢复。这是本次改造里风险最高的一处。
     */
    const saved = await this.tx.run(
      async (manager) => {
        // 同一事务内先存档旧版本：存档失败则整次修改回滚，不留"改了却没档案"的缺口
        await manager.getRepository(QuotationVersion).save(
          manager.getRepository(QuotationVersion).create({
            quotationId: id,
            version: archivedVersion,
            snapshot: archivedSnapshot,
            itemsSnapshot: archivedItems,
            changedBy: user?.userId,
            note: '修改报价（自动存档）',
          }),
        );
        const row = await manager.getRepository(Quotation).save(quotation);
        if (computed) {
          await manager.getRepository(QuotationItem).delete({ quotationId: id });
          await manager.getRepository(QuotationItem).save(
            computed.map((item) =>
              manager.getRepository(QuotationItem).create({ ...item, quotationId: row.id }),
            ),
          );
        }
        if (needsReapproval) {
          await this.approvalsService.create(
            {
              objectType: 'quotation',
              objectId: row.id,
              submittedBy: user?.userId,
              status: 'pending',
            },
            manager,
          );
        }
        return row;
      },
      async (row) => {
        await this.sync(row, computed);
      },
    );

    return saved;
  }

  /**
   * 删除报价：明细行与主行必须一起删（事务保护），向量清理放到事务外。
   * 之前只删主行不删明细，quotation_items 会永久残留成脏数据。
   * Project.quotationId 这种反向引用不做级联置空——报价被删不等于项目失败，
   * 留着旧 id 比静默抹掉项目历史更安全；展示层已用 attachRelations 兜底。
   */
  async remove(id: string, user: CurrentUser): Promise<void> {
    const quotation = await this.findOne(id, user);
    if (!this.permissionService.canManage(user, this.toSubject(quotation))) {
      throw new BadRequestException('无权删除该报价');
    }
    await this.tx.run(
      async (manager) => {
        await manager.getRepository(QuotationItem).delete({ quotationId: id });
        await manager.getRepository(Quotation).delete(id);
      },
      async () => {
        await this.knowledgeSyncService.deleteObject('quotation', id);
      },
    );
  }

  /** 历史版本（修改自动存档，倒序）；快照 JSON 已解析便于前端直接使用 */
  async listVersions(id: string, user: CurrentUser): Promise<any[]> {
    await this.findOne(id, user); // 复用访问权限校验
    const rows = await this.versionRepository.find({
      where: { quotationId: id },
      order: { createdAt: 'DESC' },
    });
    return rows.map((r) => ({
      id: r.id,
      version: r.version,
      changedBy: r.changedBy,
      note: r.note,
      createdAt: r.createdAt,
      snapshot: JSON.parse(r.snapshot),
      items: r.itemsSnapshot ? JSON.parse(r.itemsSnapshot) : [],
    }));
  }

  async approve(id: string, user: CurrentUser): Promise<Quotation> {
    if (!this.permissionService.canApprove(user)) throw new BadRequestException('无权审核');
    const quotation = await this.quotationRepository.findOne({ where: { id } });
    if (!quotation) throw new NotFoundException('报价不存在');
    quotation.status = 'approved';
    return this.tx.run(
      async (manager) => {
        const saved = await manager.save(quotation);
        await this.approvalsService.approve('quotation', id, user?.userId, '审核通过', manager);
        return saved;
      },
    );
  }

  async suggest(dto: SuggestQuotationDto): Promise<{ text: string; items: any[] }> {
    const [customer, references] = await Promise.all([
      this.customerRepository.findOne({ where: { id: dto.customerId } }),
      this.aiService.searchRag(
        dto.requirements,
        ['quotation', 'proposal', 'product', 'solution', 'supplier', 'document', 'requirement', 'customer', 'project', 'knowledge'],
        15,
      ),
    ]);
    const context = [
      customer
        ? `客户：${customer.name}；行业：${customer.industry || '未填写'}；规模：${customer.scale || '未填写'}；背景：${customer.description || '未填写'}`
        : '',
      ...references.map(
        (item, index) =>
          `[${index + 1}] [${item.source_type}:${item.source_id}] ${item.content.slice(0, 600)}`,
      ),
    ]
      .filter(Boolean)
      .join('\n\n');
    const raw = await this.aiService.suggestQuotation(dto.requirements, context);
    return this.parseSuggestedItems(raw);
  }

  /**
   * 从 AI 建议文本中拆出正文与建议明细行：
   * 提示词约定正文后附 ```json``` 明细块，拆出来才能一键回填到报价单；
   * 解析失败时静默降级为纯文本，不阻断建议展示。
   */
  private parseSuggestedItems(raw: string): { text: string; items: any[] } {
    const match = raw?.match(/```json\s*([\s\S]*?)```/i);
    if (!match) return { text: raw || '', items: [] };
    try {
      const parsed = JSON.parse(match[1].trim());
      const items = (Array.isArray(parsed) ? parsed : [])
        .filter((it: any) => it && typeof it.name === 'string' && it.name.trim())
        .map((it: any) => ({
          name: String(it.name).trim(),
          specification: it.specification ? String(it.specification) : '',
          quantity: Number(it.quantity) > 0 ? Number(it.quantity) : 1,
          unit: it.unit ? String(it.unit) : '',
          unitPrice: Number(it.unitPrice) > 0 ? Number(it.unitPrice) : 0,
        }));
      return { text: raw.replace(match[0], '').trim(), items };
    } catch {
      return { text: raw || '', items: [] };
    }
  }

  private async sync(quotation: Quotation, items?: CreateQuotationDto['items']): Promise<void> {
    const sourceItems = items ?? (await this.itemRepository.find({ where: { quotationId: quotation.id } }));
    const lineItems = sourceItems
      .map(
        (item) =>
          `${item.name} ${item.specification || ''} ${item.brand || ''} 数量:${item.quantity || 1}${item.unit || ''} 单价:${item.unitPrice || 0} 成本:${item.cost ?? '未填写'} 供应商:${item.supplierName || '未填写'} 交期:${item.deliveryDays ?? '未填写'}天`,
      )
      .join('\n');
    const content = `${quotation.quotationNo} 金额:${quotation.amount} ${quotation.costBreakdown || ''} ${quotation.notes || ''}\n${lineItems}`;
    await this.knowledgeSyncService.syncObject({
      id: quotation.id,
      objectType: 'quotation',
      title: quotation.quotationNo,
      content,
      visibility: quotation.visibility,
      uploaderId: quotation.ownerId,
      departmentId: quotation.departmentId,
      groupIds: quotation.groupIds,
      roleCodes: quotation.roleCodes,
    });
  }

  private toSubject(quotation: Quotation) {
    return {
      visibility: quotation.visibility,
      uploaderId: quotation.ownerId,
      departmentId: quotation.departmentId,
      groupIds: quotation.groupIds,
      roleCodes: quotation.roleCodes,
    };
  }
}
