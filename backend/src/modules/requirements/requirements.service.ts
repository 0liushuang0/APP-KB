import {
  Injectable,
  Optional,
  NotFoundException,
  BadRequestException,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Like, In } from 'typeorm';
import { Document } from '../documents/entities/document.entity';
import { hasRealParsedText } from '../../common/utils/parsed-text.util';
import { recordAutomation } from '../../common/utils/automation-log';
import { domainEvents } from '../../common/services/domain-events';
import * as fs from 'fs';
import * as path from 'path';
import { safeUploadTarget, resolveInsideDir } from '../../common/utils/safe-path.util';
import { Requirement, RequirementAttachment, RequirementLog } from './entities/requirement.entity';
import { Proposal } from '../proposals/entities/proposal.entity';
import { Solution } from '../solutions/entities/solution.entity';
import { Project } from '../projects/entities/project.entity';
import { DocumentLink } from '../projects/entities/document-link.entity';
import {
  CreateRequirementDto,
  UpdateRequirementDto,
  QueryRequirementDto,
  AddRequirementLogDto,
} from './dto/requirement.dto';
import { CurrentUser, PermissionService } from '../../common/services/permission.service';
import { PermissionQueryService } from '../../common/services/permission-query.service';
import { NumberingService } from '../../common/services/numbering.service';
import { paginate, PaginatedResult } from '../../common/dto/pagination.dto';
import { KnowledgeSyncService } from '../../common/services/knowledge-sync.service';
import { TransactionService } from '../../common/services/transaction.service';
import { JobLockService } from '../../common/services/job-lock.service';
import { toCny } from '../../common/utils/currency.util';
import { AiService } from '../../common/services/ai.service';
import { ApprovalsService } from '../approvals/approvals.service';
import { Customer, ContactPerson } from '../customers/entities/customer.entity';
import { DocumentsService } from '../documents/documents.service';
import { BusinessTrashService } from '../recycle-bin/business-trash.service';

@Injectable()
export class RequirementsService implements OnModuleInit, OnModuleDestroy, OnApplicationBootstrap {
  private readonly logger = new Logger(RequirementsService.name);

  /*
   * 资料到了就自动识别。
   *
   * 需求页一直写着「上传客户原始资料后点击结构化识别，系统会自动抽取技术参数」，
   * 实际上传的资料进了资料模块（document_links），识别读的却是需求附件表（0 条），
   * AI 只看到标题和描述。现在：挂在需求下的资料解析完（或已解析的资料被挂上来），
   * 等几秒把同一批上传合并，自动跑一次识别，结果标「待确认」由人核对。
   */
  private autoTimers = new Map<string, NodeJS.Timeout>();
  private unsubscribers: Array<() => void> = [];
  static readonly AUTO_DELAY_MS = 8_000;

  onModuleInit(): void {
    if (process.env.REQ_AUTO_ANALYZE === 'false' || process.env.NODE_ENV === 'test') return;
    this.unsubscribers.push(
      domainEvents.onEvent('document.parsed', async ({ documentId }) => {
        const links = await this.documentLinkRepository.find({ where: { documentId } });
        for (const l of links) if (l.requirementId) this.scheduleAutoAnalyze(l.requirementId);
      }),
      domainEvents.onEvent('document.linked', ({ requirementId }) => {
        if (requirementId) this.scheduleAutoAnalyze(requirementId);
      }),
    );
  }

  /**
   * 补识别一次历史需求：自动识别上线前就挂好资料、但从没识别过的需求（实测 8 条）。
   * 启动 2 分钟后逐条串行跑（每条约 40 秒），AI 服务连续失败 2 次就停，下次启动再来；
   * 人确认/修改过的结果不会被覆盖（shouldAutoAnalyze）。
   */
  onApplicationBootstrap(): void {
    if (process.env.REQ_AUTO_ANALYZE === 'false' || process.env.NODE_ENV === 'test') return;
    // 多台服务器同时启动时只让一台补识别（否则同一条需求被两台各调一次大模型）
    const t = setTimeout(() => {
      const run = () => this.backfillAutoAnalyze();
      (this.jobLock
        ? this.jobLock.runExclusive('requirement-backfill', run, { ttlMs: 2 * 3_600_000, minIntervalMs: 30 * 60_000 })
        : run()
      ).catch((e) => this.logger.warn(`历史需求补识别中止：${e?.message}`));
    }, 120_000);
    t.unref?.();
    this.autoTimers.set('__backfill__', t);
  }

  async backfillAutoAnalyze(): Promise<{ done: number; failed: number }> {
    const rows = await this.requirementRepository.find({ select: ['id', 'requirementNo', 'specStatus', 'structuredSpec', 'isCurrent'] as any });
    let done = 0;
    let failedInRow = 0;
    let failed = 0;
    for (const r of rows) {
      // 只补「从没识别过」的；已有待确认结果的不在启动时重跑（新资料到了由事件触发刷新），免得每次重启都重复调用大模型
      if (!RequirementsService.neverAnalyzed(r)) continue;
      const sources = await this.collectSources(r.id);
      if (!sources.length) continue;
      try {
        await this.analyzeStructured(r.id, null as any, { auto: true });
        done++;
        failedInRow = 0;
      } catch (e: any) {
        failed++;
        failedInRow++;
        this.logger.warn(`需求 ${r.requirementNo} 补识别失败：${e?.message}`);
        if (failedInRow >= 2) break;
      }
    }
    if (done || failed) this.logger.log(`历史需求补识别：完成 ${done} 条，失败 ${failed} 条`);
    return { done, failed };
  }

  onModuleDestroy(): void {
    this.unsubscribers.forEach((u) => u());
    this.autoTimers.forEach((t) => clearTimeout(t));
    this.autoTimers.clear();
  }

  scheduleAutoAnalyze(requirementId: string, delayMs = RequirementsService.AUTO_DELAY_MS): void {
    const prev = this.autoTimers.get(requirementId);
    if (prev) clearTimeout(prev);
    const t = setTimeout(() => {
      this.autoTimers.delete(requirementId);
      this.autoAnalyze(requirementId).catch((e) => this.logger.warn(`需求 ${requirementId} 自动识别失败：${e?.message}`));
    }, delayMs);
    t.unref?.();
    this.autoTimers.set(requirementId, t);
  }

  /** 从没识别过（启动补识别只处理这类） */
  static neverAnalyzed(r: Pick<Requirement, 'specStatus' | 'structuredSpec' | 'isCurrent'>): boolean {
    return r.isCurrent !== false && !r.structuredSpec && (!r.specStatus || r.specStatus === 'pending');
  }

  /** 结构化结果是否还是「自动识别、待人确认」 */
  static isReviewPending(structuredSpec?: string | null): boolean {
    if (!structuredSpec) return false;
    try {
      return JSON.parse(structuredSpec)?.review === true;
    } catch {
      return false;
    }
  }

  /**
   * 是否应该自动识别：没识别过、或上次是自动识别且还没人确认（新资料到了可以刷新）。
   * 人确认/修改过的结果绝不覆盖。
   */
  static shouldAutoAnalyze(r: Pick<Requirement, 'specStatus' | 'structuredSpec' | 'isCurrent'>): boolean {
    if (r.isCurrent === false) return false;
    if (r.specStatus === 'analyzing') return false;
    if (!r.structuredSpec || r.specStatus === 'pending' || !r.specStatus) return true;
    return RequirementsService.isReviewPending(r.structuredSpec);
  }

  private async autoAnalyze(requirementId: string): Promise<void> {
    const r = await this.requirementRepository.findOne({ where: { id: requirementId } });
    if (!r || !RequirementsService.shouldAutoAnalyze(r)) return;
    const sources = await this.collectSources(requirementId);
    if (!sources.length) return;
    await this.analyzeStructured(requirementId, null as any, { auto: true });
    this.logger.log(`需求 ${r.requirementNo} 已根据 ${sources.length} 份资料自动识别参数`);
  }

  /**
   * 识别用的资料正文：需求附件 + 挂在需求下的业务资料（document_links → documents.parsedText）。
   * 解析失败的占位话术/状态标记不算正文。
   */
  async collectSources(requirementId: string): Promise<Array<{ source_id: string; source_type: string; file_name: string; raw_text: string }>> {
    const MAX = 200_000;
    const out: Array<{ source_id: string; source_type: string; file_name: string; raw_text: string }> = [];
    const atts = await this.attachmentRepository.find({ where: { requirementId } });
    for (const a of atts) {
      if (hasRealParsedText(a.parsedText)) out.push({ source_id: a.id, source_type: 'file', file_name: a.fileName, raw_text: a.parsedText.slice(0, MAX) });
    }
    const links = await this.documentLinkRepository.find({ where: { requirementId } });
    const docIds = [...new Set(links.map((l) => l.documentId).filter(Boolean))];
    if (docIds.length) {
      const docs = await this.documentLinkRepository.manager.getRepository(Document).find({
        where: { id: In(docIds) },
        select: ['id', 'fileName', 'parsedText'],
      });
      for (const d of docs) {
        if (hasRealParsedText(d.parsedText)) out.push({ source_id: d.id, source_type: 'file', file_name: d.fileName, raw_text: d.parsedText.slice(0, MAX) });
      }
    }
    return out;
  }
  private uploadDir: string;

  constructor(
    @InjectRepository(Requirement)
    private requirementRepository: Repository<Requirement>,
    @InjectRepository(RequirementAttachment)
    private attachmentRepository: Repository<RequirementAttachment>,
    @InjectRepository(RequirementLog)
    private requirementLogRepository: Repository<RequirementLog>,
    @InjectRepository(Customer)
    private customerRepository: Repository<Customer>,
    @InjectRepository(Proposal)
    private proposalRepository: Repository<Proposal>,
    @InjectRepository(Solution)
    private solutionRepository: Repository<Solution>,
    @InjectRepository(Project)
    private projectRepository: Repository<Project>,
    @InjectRepository(DocumentLink)
    private documentLinkRepository: Repository<DocumentLink>,
    private permissionService: PermissionService,
    private knowledgeSyncService: KnowledgeSyncService,
    private transactionService: TransactionService,
    private aiService: AiService,
    private permissionQuery: PermissionQueryService,
    private numbering: NumberingService,
    private approvalsService: ApprovalsService,
    private documentsService: DocumentsService,
    private readonly trash: BusinessTrashService,
    @Optional() private readonly jobLock?: JobLockService,
  ) {
    this.uploadDir = path.resolve(process.cwd(), 'data', 'uploads', 'requirements');
    if (!fs.existsSync(this.uploadDir)) {
      fs.mkdirSync(this.uploadDir, { recursive: true });
    }
  }

  /** 列表（服务端分页，权限已下沉到 SQL） */
  async findAll(query: QueryRequirementDto, user: CurrentUser): Promise<PaginatedResult<Requirement>> {
    const qb = this.requirementRepository.createQueryBuilder('r');

    if (query.category) qb.andWhere('r.category = :category', { category: query.category });
    if (query.status) qb.andWhere('r.status = :status', { status: query.status });
    if ((query as any).owner === 'me' && user?.userId) qb.andWhere('r.ownerId = :ownerMe', { ownerMe: user.userId });
    const todayStr = new Date().toISOString().slice(0, 10);
    const inDays = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
    switch ((query as any).focus) {
      case 'followup-overdue':
        qb.andWhere('r.nextFollowUpDate IS NOT NULL AND r.nextFollowUpDate < :fToday', { fToday: todayStr })
          .andWhere("(r.status IS NULL OR r.status NOT IN ('lost','closed','won'))");
        break;
      case 'followup':
        qb.andWhere('r.nextFollowUpDate BETWEEN :fToday AND :fIn7', { fToday: todayStr, fIn7: inDays(7) })
          .andWhere("(r.status IS NULL OR r.status NOT IN ('lost','closed','won'))");
        break;
      case 'review':
        // 结构化结果以 2 空格缩进存储：自动识别待确认 = "review": true
        qb.andWhere('r.structuredSpec LIKE :fReview', { fReview: '%"review": true%' });
        break;
      case 'incomplete':
        qb.andWhere(`(r.specStatus IS NULL OR r.specStatus = 'pending'
          OR (r.structuredSpec LIKE :fMiss AND r.structuredSpec NOT LIKE :fNoMiss))`, { fMiss: '%"missing": [%', fNoMiss: '%"missing": []%' });
        break;
    }
    // 'none' 是前端"未关联客户"筛选项：业务链上确实存在没挂客户的需求，要能单独捞出来补录
    if (query.customerId === 'none') qb.andWhere('r.customerId IS NULL');
    else if (query.customerId) qb.andWhere('r.customerId = :customerId', { customerId: query.customerId });
    // 落地阶段：按 方案→报价→合同 派生链路的存在性过滤，与 attachLandStage 的推导口径一致（互斥分档）
    if (query.landStage) {
      const hasProposal = `EXISTS (SELECT 1 FROM proposals pl WHERE pl."requirementId" = r.id)`;
      const hasQuotation = `EXISTS (
        SELECT 1 FROM quotations qq JOIN proposals pp ON pp.id = qq."proposalId"
        WHERE pp."requirementId" = r.id)`;
      const hasContract = `EXISTS (
        SELECT 1 FROM contracts ct
        JOIN quotations q2 ON q2.id = ct."quotationId"
        JOIN proposals p2 ON p2.id = q2."proposalId"
        WHERE p2."requirementId" = r.id)`;
      switch (query.landStage) {
        case 'won':
          qb.andWhere('r.status = :wonStage', { wonStage: 'won' });
          break;
        case 'lost':
          qb.andWhere('r.status = :lostStage', { lostStage: 'lost' });
          break;
        case 'contract':
          qb.andWhere(`${hasContract} AND r.status NOT IN ('won','lost')`);
          break;
        case 'quotation':
          qb.andWhere(`${hasQuotation} AND NOT ${hasContract}`);
          break;
        case 'proposal':
          qb.andWhere(`${hasProposal} AND NOT ${hasQuotation}`);
          break;
        default:
          qb.andWhere(`NOT ${hasProposal}`);
          break;
      }
    }
    if (query.keyword) {
      // 标题/编号 + 需求描述 + 客户名 一起搜（按客户名找需求很常见）
      qb.andWhere(
        `(r.title LIKE :kw OR r.requirementNo LIKE :kw OR r.description LIKE :kw
          OR EXISTS (SELECT 1 FROM customers cc WHERE cc.id = r.customerId AND cc.name LIKE :kw))`,
        { kw: `%${query.keyword}%` },
      );
    }
    // 列表默认只显示当前版本，历史版本从详情页的版本标签进入
    if (!query.includeHistory) qb.andWhere('r.isCurrent = :cur', { cur: true });

    this.permissionQuery.apply(qb, 'r', user);

    // 看跟进类待办时，最该先联系的排最前
    const focusSort = String((query as any).focus || '').startsWith('followup') ? { field: 'nextFollowUpDate', order: 'ASC' as const } : { field: 'requirementNo', order: 'ASC' as const };
    const result = await paginate(qb, 'r', query, ['createdAt', 'title', 'priority', 'status', 'requirementNo', 'requirementDate', 'nextFollowUpDate'], focusSort);
    const withCustomer = await this.attachCustomerNames(result.list);
    const withCounts = await this.attachAttachmentCounts(withCustomer);
    const withStage = await this.attachLandStage(withCounts);
    /*
     * 优先级建议：按 期望金额 / 客户等级 推一个建议档，列表显示"建议优先级"
     * —— 系统给依据，人只做确认，减少逐条凭感觉定优先级的人为判断。
     * 不改动用户已设的 priority，两者并排展示。
     */
    return {
      ...result,
      list: withStage.map((r: any) => ({ ...r, priorityHint: this.suggestPriority(r) })),
    };
  }

  /**
   * 需求落地阶段：从 方案→报价→合同 派生链路自动推导（三次批量查询，防 N+1）。
   *
   * 需求登记后"走到哪一步"原来要靠人脑串联四张表；这里系统直接给结论：
   * 已登记(没方案) → 方案阶段(有方案没报价) → 报价阶段(有报价没合同)
   * → 已签约(有合同) / 已成交、已失单(需求自身状态，优先级最高)。
   * 分档互斥，与 findAll 的 landStage 筛选口径保持一致。
   */
  private async attachLandStage<T extends { id: string; status?: string }>(
    rows: T[],
  ): Promise<(T & { landStage: string })[]> {
    if (!rows.length) return rows.map((r) => ({ ...r, landStage: 'registered' }));
    const mgr = this.requirementRepository.manager;
    const ids = rows.map((r) => r.id);

    const proposalIds = new Set(
      (
        await mgr
          .createQueryBuilder()
          .select('pl."requirementId" AS rid')
          .from('proposals', 'pl')
          .where('pl."requirementId" IN (:...ids)', { ids })
          .getRawMany<{ rid: string }>()
      ).map((x) => x.rid),
    );
    const quotationIds = new Set(
      (
        await mgr
          .createQueryBuilder()
          .select('pp."requirementId" AS rid')
          .from('quotations', 'qq')
          .innerJoin('proposals', 'pp', 'pp.id = qq."proposalId"')
          .where('pp."requirementId" IN (:...ids)', { ids })
          .getRawMany<{ rid: string }>()
      ).map((x) => x.rid),
    );
    const contractIds = new Set(
      (
        await mgr
          .createQueryBuilder()
          .select('p2."requirementId" AS rid')
          .from('contracts', 'ct')
          .innerJoin('quotations', 'q2', 'q2.id = ct."quotationId"')
          .innerJoin('proposals', 'p2', 'p2.id = q2."proposalId"')
          .where('p2."requirementId" IN (:...ids)', { ids })
          .getRawMany<{ rid: string }>()
      ).map((x) => x.rid),
    );

    return rows.map((r) => ({
      ...r,
      landStage:
        r.status === 'lost'
          ? 'lost'
          : r.status === 'won'
            ? 'won'
            : contractIds.has(r.id)
              ? 'contract'
              : quotationIds.has(r.id)
                ? 'quotation'
                : proposalIds.has(r.id)
                  ? 'proposal'
                  : 'registered',
    }));
  }

  /** 期望金额 ≥50万 或 A 级客户 → 建议高；≥10万 或 B 级 → 建议中；其余低 */
  private suggestPriority(r: any): 'high' | 'medium' | 'low' {
    const amount = Number(r.expectedAmount || 0);
    const level = (r as any).customerLevel;
    if (amount >= 500000 || level === 'A') return 'high';
    if (amount >= 100000 || level === 'B') return 'medium';
    return 'low';
  }

  /**
   * 附件计数（source=输入 / deliverable=输出），列表操作列的回形针徽标显示用，
   * 与方案/报价/项目列表同一口径。
   */
  private async attachAttachmentCounts<T extends { id: string }>(rows: T[]): Promise<(T & {
    attachmentCounts: { input: number; output: number };
  })[]> {
    const ids = rows.map((r) => r.id);
    const counts = ids.length
      ? await this.requirementRepository.manager
          .createQueryBuilder()
          .select(['l."requirementId" AS "id"', 'l."linkRole" AS "role"', 'COUNT(*) AS "n"'])
          .from('document_links', 'l')
          .where('l."requirementId" IN (:...ids)', { ids })
          .groupBy('l."requirementId"')
          .addGroupBy('l."linkRole"')
          .getRawMany<{ id: string; role: string; n: string }>()
      : [];
    const map = new Map<string, { input: number; output: number }>();
    for (const c of counts) {
      const cur = map.get(c.id) || { input: 0, output: 0 };
      if (c.role === 'source') cur.input = Number(c.n);
      if (c.role === 'deliverable') cur.output = Number(c.n);
      map.set(c.id, cur);
    }
    return rows.map((r) => ({ ...r, attachmentCounts: map.get(r.id) || { input: 0, output: 0 } }));
  }

  /**
   * 补上客户名称与简称。
   *
   * 列表要显示客户简称，但 requirements 表只存 customerId，
   * 前端逐行去查客户会变成 N+1 次请求。这里一次性把用到的客户捞出来贴上。
   *
   * 另外：库里有不少 customerId 指向已不存在的客户（历史数据），
   * 这种情况留空而不是报错 —— 让它在界面上显出来，才有人去修。
   */
  private async attachCustomerNames<T extends { customerId?: string }>(
    rows: T[],
  ): Promise<(T & { customerName?: string; customerShortName?: string })[]> {
    const ids = [...new Set(rows.map((r) => r.customerId).filter(Boolean))];
    if (!ids.length) return rows as any;

    const customers = await this.requirementRepository.manager
      .createQueryBuilder()
      .select(['c.id AS "id"', 'c.name AS "name"', 'c.code AS "code"', 'c.level AS "level"'])
      .from('customers', 'c')
      .where('c.id IN (:...ids)', { ids })
      .getRawMany<{ id: string; name: string; code: string; level?: string }>();

    const map = new Map(customers.map((c) => [c.id, c]));
    return rows.map((r) => {
      const c = r.customerId ? map.get(r.customerId) : undefined;
      return {
        ...r,
        customerName: c?.name ?? null,
        customerShortName: c?.code || c?.name || null,
        // 客户等级：优先级建议的依据之一
        customerLevel: c?.level ?? null,
      };
    });
  }


  /**
   * 创建新版本。
   *
   * 不改动原记录，而是复制一份为新版本并把旧版标记为非当前 ——
   * 报价争议时需要能拿出"当时客户是怎么提的"，就地覆盖会毁掉这个证据链。
   */
  async createVersion(
    id: string,
    dto: { changeReason: string; title?: string; description?: string; category?: string },
    user: CurrentUser,
  ): Promise<Requirement> {
    const source = await this.findOne(id, user);
    if (!dto.changeReason?.trim()) {
      throw new BadRequestException('请填写变更原因');
    }

    const rootId = source.rootRequirementId || source.id;
    const siblings = await this.requirementRepository.find({
      where: [{ rootRequirementId: rootId }, { id: rootId }],
    });
    const nextVersion = Math.max(...siblings.map((s) => s.version || 1)) + 1;
    const siblingIds = siblings.map((s) => s.id);

    const saved = await this.transactionService.run(
      async (manager) => {
        // 核心：标记旧版本为非当前 + 创建新版本必须原子
        // 若此处失败，所有旧版本仍保持 isCurrent=true，不会出现"无当前版本"
        await manager.update(Requirement, siblingIds, { isCurrent: false });

        const {
          id: _id,
          createdAt: _c,
          updatedAt: _u,
          ...rest
        } = source as any;

        const next = manager.create(Requirement, {
          ...rest,
          requirementNo: `${source.requirementNo}-V${nextVersion}`,
          title: dto.title ?? source.title,
          description: dto.description ?? source.description,
          category: dto.category ?? source.category,
          version: nextVersion,
          rootRequirementId: rootId,
          changeReason: dto.changeReason,
          isCurrent: true,
          structuredSpec: null,
          specStatus: 'pending',
          analyzedBy: null,
          analyzedAt: null,
          ownerId: user?.userId || source.ownerId,
        });

        const newReq = await manager.save(next);

        // 迁移附件到新版本：共享同一物理文件（fileKey 不变），只新建指向新版本 id 的行。
        // 此前新版本附件为空 —— 切到新当前版本后详情页看不到资料，旧版本反而全带着。
        const srcAttachments: any[] = (source as any).attachments || [];
        if (srcAttachments.length) {
          const attRows = srcAttachments.map((a: any) => {
            const { id: _aid, createdAt: _ac, updatedAt: _au, requirementId: _rid, ...rest2 } = a;
            return manager.create(RequirementAttachment, { ...rest2, requirementId: newReq.id });
          });
          await manager.save(RequirementAttachment, attRows);
        }

        return newReq;
      },
      async (result) => {
        // 副作用：同步知识库（不在事务内，失败不影响数据）
        await Promise.all(
          siblingIds.map((sid) => this.knowledgeSyncService.deleteObject('requirement', sid)),
        );
        await this.sync(result);
      },
    );
    return saved;
  }

  /** 同一条需求的全部版本，按版本号倒序 */
  async listVersions(id: string, user: CurrentUser): Promise<Requirement[]> {
    const current = await this.findOne(id, user);
    const rootId = current.rootRequirementId || current.id;
    const items = await this.requirementRepository.find({
      where: [{ rootRequirementId: rootId }, { id: rootId }],
      order: { version: 'DESC' },
    });
    return items.filter((r) => this.permissionService.canAccess(user, this.toSubject(r)));
  }

  /** 需求记录：同一条需求下的沟通/变更/确认记录，按时间倒序 */
  async listLogs(id: string, user: CurrentUser): Promise<RequirementLog[]> {
    await this.findOne(id, user); // 存在性 + 读权限
    return this.requirementLogRepository.find({
      where: { requirementId: id },
      order: { createdAt: 'DESC' },
    });
  }

  /** 新增一条需求记录。变更明细（changes）序列化进 metadata，用于日后追溯 */
  async addLog(id: string, dto: AddRequirementLogDto, user: CurrentUser): Promise<RequirementLog> {
    const requirement = await this.findOne(id, user);
    if (!this.permissionService.canManage(user, this.toSubject(requirement))) {
      throw new BadRequestException('无权修改该需求');
    }
    if (!dto.content?.trim()) {
      throw new BadRequestException('请填写记录内容');
    }
    const changes = (dto.changes || []).filter((c) => c && c.field?.trim());
    const log = this.requirementLogRepository.create({
      requirementId: id,
      type: dto.type || 'communication',
      content: dto.content.trim(),
      actorId: user?.userId,
      actorName: user?.username,
      metadata: changes.length ? JSON.stringify(changes) : null,
    });
    return this.requirementLogRepository.save(log);
  }

  async findOne(id: string, user: CurrentUser): Promise<Requirement> {
    const requirement = await this.requirementRepository.findOne({ where: { id } });
    if (!requirement) throw new NotFoundException('需求不存在');
    if (!this.permissionService.canAccess(user, this.toSubject(requirement))) {
      throw new BadRequestException('无权访问该需求');
    }
    const attachments = await this.attachmentRepository.find({ where: { requirementId: id } });
    (requirement as any).attachments = attachments;
    // 补客户：详情页要用 detail.customer.name 渲染「客户：xxx」跳转链接。
    // 此前 findOne 只挂了 attachments，导致需求→客户导航永远不显示。
    if (requirement.customerId) {
      const customer = await this.customerRepository.findOne({
        where: { id: requirement.customerId },
        select: ['id', 'name', 'code'],
      });
      if (customer) (requirement as any).customer = customer;
    }
    return requirement;
  }

  /**
   * 方案匹配解释：解释某条历史方案/标准方案为何匹配本需求。
   * 只把关键字段送进提示词，长正文截断，避免把整个方案文档塞进上下文。
   */
  async explainMatch(
    id: string,
    user: CurrentUser,
    targetType: 'proposal' | 'solution',
    targetId: string,
  ): Promise<{ highlights: string[]; risks: string[] }> {
    const requirement = await this.findOne(id, user);

    let target: Record<string, any>;
    if (targetType === 'proposal') {
      const proposal = await this.proposalRepository.findOne({ where: { id: targetId } });
      if (!proposal) throw new NotFoundException('方案不存在');
      target = {
        proposalNo: proposal.proposalNo,
        productDescription: proposal.productDescription?.slice(0, 800),
        content: proposal.content?.slice(0, 1500),
        requirements: proposal.requirements?.slice(0, 800),
      };
    } else if (targetType === 'solution') {
      const solution = await this.solutionRepository.findOne({ where: { id: targetId } });
      if (!solution) throw new NotFoundException('标准方案不存在');
      target = {
        solutionNo: solution.solutionNo,
        name: solution.name,
        description: solution.description?.slice(0, 800),
        scenario: solution.scenario,
        keyParams: solution.keyParams,
        paramSummary: solution.paramSummary,
        priceRange: solution.priceRange,
        deliveryCycle: solution.deliveryCycle,
      };
    } else {
      throw new BadRequestException('不支持的目标类型');
    }

    const requirementPayload = {
      title: requirement.title,
      description: requirement.description?.slice(0, 800),
      requirementType: (requirement as any).requirementType,
      templateCategory: (requirement as any).templateCategory,
      priority: requirement.priority,
    };
    return this.aiService.explainSolutionMatch(requirementPayload, target);
  }

  /**
   * 创建需求。
   * 之前团队模式下 status 直接写 'pending' 却从不创建审批流记录——
   * 需求卡在 pending 没有任何审批入口，是个死结。
   * 现在与方案/报价一致：单机模式直接 approved，团队模式建审批流记录。
   */
  async create(dto: CreateRequirementDto, user: CurrentUser): Promise<Requirement> {
    const requirementNo = await this.generateNo();
    const skipApproval = this.permissionService.skipApproval();
    // 下次跟进日期默认 7 天后：原来 12 条需求全空，工作台「今日待办」永远显示"无"
    const nextFollowUpDate = (dto as any).nextFollowUpDate || new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    const requirement = this.requirementRepository.create({
      ...dto,
      nextFollowUpDate,
      requirementNo,
      ownerId: user?.userId,
      departmentId: dto.departmentId || user?.departmentId,
      status: skipApproval ? 'approved' : 'pending',
    });
    const saved = await this.transactionService.run(
      async (manager) => {
        const row = await manager.save(requirement);
        if (!skipApproval) {
          await this.approvalsService.create({
            objectType: 'requirement',
            objectId: row.id,
            submittedBy: user?.userId,
            status: 'pending',
          }, manager);
        }
        return row;
      },
      async (row) => { await this.sync(row); },
    );
    await this.syncContactToCustomer(saved);
    return saved;
  }

  async update(id: string, dto: UpdateRequirementDto, user: CurrentUser): Promise<Requirement> {
    const requirement = await this.findOne(id, user);
    if (!this.permissionService.canManage(user, this.toSubject(requirement))) {
      throw new BadRequestException('无权修改该需求');
    }
    Object.assign(requirement, dto);
    const saved = await this.requirementRepository.save(requirement);
    await this.sync(saved);
    await this.syncContactToCustomer(saved);
    return saved;
  }

  /**
   * 联系人联动：需求里填的联系人沉淀到客户中心该客户名下。
   *
   * · 同名联系人：只**补空**（客户档案里电话/邮箱为空才回填），
   *   客户中心维护的更全信息永远不被需求侧覆盖
   * · 新联系人：直接新增到该客户（联系人是在跟需求接触中认识的，落档案）
   */
  private async syncContactToCustomer(requirement: Requirement): Promise<void> {
    const { customerId, contactName, contactPhone, contactEmail } = requirement as any;
    if (!customerId || !contactName?.trim()) return;
    try {
      const cpRepo = this.customerRepository.manager.getRepository(ContactPerson);
      const existing = await cpRepo.findOne({
        where: { customerId, name: contactName.trim() },
      });
      if (existing) {
        const patch: Partial<ContactPerson> = {};
        if (!existing.phone && contactPhone?.trim()) patch.phone = contactPhone.trim();
        if (!existing.email && contactEmail?.trim()) patch.email = contactEmail.trim();
        if (Object.keys(patch).length) await cpRepo.update(existing.id, patch);
      } else {
        await cpRepo.save(
          cpRepo.create({
            customerId,
            name: contactName.trim(),
            phone: contactPhone?.trim() || null,
            email: contactEmail?.trim() || null,
          }),
        );
      }
    } catch (err) {
      // 同步失败不阻断需求保存：联系人沉淀是增值动作，主流程优先
      console.warn('联系人同步到客户中心失败：', (err as Error).message);
    }
  }

  /** 审核通过需求（团队模式）。与方案/报价的 approve 模式一致。 */
  async approve(id: string, user: CurrentUser): Promise<Requirement> {
    if (!this.permissionService.canApprove(user)) throw new BadRequestException('无权审核');
    const requirement = await this.requirementRepository.findOne({ where: { id } });
    if (!requirement) throw new NotFoundException('需求不存在');
    requirement.status = 'approved';
    const saved = await this.requirementRepository.save(requirement);
    await this.approvalsService.approve('requirement', id, user?.userId, '审核通过');
    return saved;
  }

  /**
   * 删除预检：返回该需求删除时受影响的关联项，供前端弹窗提示。
   *
   * 背景：需求的"客户资料"分散在 document_links（按 requirementId 关联），
   * 删除需求会一并清掉这些资料链接。若不预先告知，用户不知道连带的客户资料、
   * 下游方案/项目会受影响 —— 删完才发现客户名下"需求阶段"的档案没了。
   */
  async removePreview(id: string, user: CurrentUser) {
    const requirement = await this.findOne(id, user);
    if (!this.permissionService.canManage(user, this.toSubject(requirement))) {
      throw new BadRequestException('无权删除该需求');
    }

    let customerName: string | null = null;
    if (requirement.customerId) {
      const c = await this.customerRepository.findOne({
        where: { id: requirement.customerId },
        select: ['id', 'name'],
      });
      customerName = c?.name || null;
    }

    const [attachmentsCount, proposalsCount, projectsCount, linkedDocsCount] = await Promise.all([
      this.attachmentRepository.count({ where: { requirementId: id } }),
      this.proposalRepository.count({ where: { requirementId: id } }),
      this.projectRepository.count({ where: { requirementId: id } }),
      // 该需求名下的客户资料（document_links 按 requirementId 关联）—— 删除会一并清掉
      this.documentLinkRepository.count({ where: { requirementId: id } }),
    ]);

    return {
      id,
      requirementNo: requirement.requirementNo,
      title: requirement.title,
      customerId: requirement.customerId || null,
      customerName,
      // 各受影响项计数：附件/资料会被物理删除；方案/项目是解除关联（置空 requirementId）
      attachmentsCount,
      linkedDocsCount,
      proposalsCount,
      projectsCount,
      hasImpact:
        attachmentsCount + linkedDocsCount + proposalsCount + projectsCount > 0 || !!customerName,
    };
  }

  /**
   * 删除需求：附件（行+磁盘文件）、文档链接、需求主行进事务保护；
   * 下游方案/报价/项目的 requirementId 解除链接（置空而非级联删——
   * 需求删除不等于已报价/已签约的业务作废），向量和文件清理放事务外。
   * 之前附件文件删了但下游 requirementId 全部悬空。
   */
  async remove(id: string, user: CurrentUser): Promise<void> {
    const requirement = await this.findOne(id, user);
    if (!this.permissionService.canManage(user, this.toSubject(requirement))) {
      throw new BadRequestException('无权删除该需求');
    }
    const attachments = await this.attachmentRepository.find({ where: { requirementId: id } });

    /*
     * 只挂在本需求上的资料：删需求时一并送回收站，不在客户 360 / 资料中心
     * 里留孤儿文件（历史版本只删 link 不删文件，导致需求删了文档还在
     * 客户档案里挂着）。仍挂着其他链路节点（方案/项目/其他需求等）的
     * 资料只解除本需求的关联，文件本身保留。
     */
    const linksOfReq = await this.documentLinkRepository.find({ where: { requirementId: id } });
    const exclusiveDocIds: string[] = [];
    for (const docId of [...new Set(linksOfReq.map((l) => l.documentId))]) {
      const linkCount = await this.documentLinkRepository.count({ where: { documentId: docId } });
      if (linkCount <= 1) exclusiveDocIds.push(docId);
    }

    await this.transactionService.run(
      async (manager) => {
        const [downProposals, downProjects] = await Promise.all([
          manager.getRepository(Proposal).find({ where: { requirementId: id }, select: ['id'] }),
          manager.getRepository(Project).find({ where: { requirementId: id }, select: ['id'] }),
        ]);
        await this.trash.capture(manager, 'requirement', id, `${requirement.requirementNo || ''} ${requirement.title || ''}`.trim(), [
          { table: 'requirements', column: 'id', ids: [id] },
          { table: 'requirement_attachments', column: 'requirementId', ids: [id] },
          { table: 'requirement_logs', column: 'requirementId', ids: [id] },
          { table: 'document_links', column: 'requirementId', ids: [id] },
        ], user?.userId, [
          { table: 'proposals', column: 'requirementId', ids: downProposals.map((p) => p.id) },
          { table: 'projects', column: 'requirementId', ids: downProjects.map((p) => p.id) },
        ]);
        // 附件行
        await manager.getRepository(RequirementAttachment).delete({ requirementId: id });
        // 需求记录
        await manager.getRepository(RequirementLog).delete({ requirementId: id });
        // 文档链接：用 repository 参数化删除（跨库安全），原先的 '"requirementId"' 双引号
        // 是 PG 语法，在 SQLite 上靠 DQS 兼容才没炸，换成与客户删除一致的写法。
        await manager.getRepository(DocumentLink).delete({ requirementId: id });
        // 下游解除链接（置空 requirementId，保留业务数据）。
        await manager.getRepository(Proposal).update({ requirementId: id }, { requirementId: null as any });
        await manager.getRepository(Project).update({ requirementId: id }, { requirementId: null as any });
        // 主行
        await manager.getRepository(Requirement).delete(id);
      },
      async () => {
        // 附件磁盘文件 + 向量
        for (const att of attachments) {
          this.deleteAttachmentFile(att.fileKey);
        }
        await this.knowledgeSyncService.deleteObject('requirement', id);
      },
    );

    // 专属资料送回收站（内部会移文件、清向量，可还原）；单个失败不阻断需求删除
    for (const docId of exclusiveDocIds) {
      try {
        await this.documentsService.remove(docId, user);
      } catch (err: any) {
        this.logger.warn(`需求 ${id} 删除后清理专属资料 ${docId} 失败：${err?.message}`);
      }
    }
  }

  async uploadAttachment(
    id: string,
    file: Express.Multer.File,
    user: CurrentUser,
  ): Promise<RequirementAttachment> {
    const requirement = await this.findOne(id, user);
    // 此前这里既不校验扩展名也不防路径穿越
    const { displayName, fileName, filePath } = safeUploadTarget(
      this.uploadDir,
      file.originalname,
      'requirement',
    );
    const fileKey = `requirements/${fileName}`;
    fs.writeFileSync(filePath, file.buffer);

    const publicUrl = `${process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || 3001}`}/uploads/requirements/${fileName}`;

    const attachment = this.attachmentRepository.create({
      requirementId: requirement.id,
      fileName: displayName,
      fileKey,
      fileUrl: publicUrl,
      fileSize: file.size,
      mimeType: file.mimetype,
    });
    const saved = await this.attachmentRepository.save(attachment);
    return saved;
  }

  async removeAttachment(id: string, aid: string, user: CurrentUser): Promise<void> {
    const requirement = await this.findOne(id, user);
    if (!this.permissionService.canManage(user, this.toSubject(requirement))) {
      throw new BadRequestException('无权删除附件');
    }
    const attachment = await this.attachmentRepository.findOne({ where: { id: aid, requirementId: id } });
    if (!attachment) throw new NotFoundException('附件不存在');
    this.deleteAttachmentFile(attachment.fileKey);
    await this.attachmentRepository.delete(aid);
  }

  async analyze(id: string, user: CurrentUser): Promise<Requirement> {
    const requirement = await this.findOne(id, user);
    requirement.status = 'analyzing';
    await this.requirementRepository.save(requirement);

    const attachments = await this.attachmentRepository.find({ where: { requirementId: id } });
    const attachmentTexts = attachments
      .map((a) => a.parsedText)
      .filter((t) => t)
      .join('\n\n');

    const fullText = `${requirement.title}\n${requirement.description || ''}\n${attachmentTexts}`;

    const messages = [
      {
        role: 'system',
        content:
          '你是一名需求分析师。请分析以下客户需求资料，提取关键信息：1. 核心需求 2. 技术要求 3. 商务要求 4. 关键约束条件。用简洁的中文输出，不超过500字。',
      },
      { role: 'user', content: fullText.slice(0, 8000) },
    ];

    const analysis = await this.aiService.chat(messages, 'requirement');

    requirement.aiAnalysis = analysis;
    requirement.status = 'analyzed';
    const saved = await this.requirementRepository.save(requirement);

    await this.knowledgeSyncService.syncObject({
      id: saved.id,
      objectType: 'requirement',
      title: saved.title,
      content: `${saved.title} ${saved.description || ''} ${analysis} ${attachmentTexts}`,
      visibility: saved.visibility,
      uploaderId: saved.ownerId,
      departmentId: saved.departmentId,
      groupIds: saved.groupIds,
      roleCodes: saved.roleCodes,
    });

    return saved;
  }

  async analyzeStructured(id: string, user: CurrentUser, opts: { auto?: boolean } = {}): Promise<Requirement> {
    const requirement = opts.auto
      ? await this.requirementRepository.findOne({ where: { id } })
      : await this.findOne(id, user);
    if (!requirement) throw new NotFoundException('需求不存在');

    const sources = await this.collectSources(id);
    if (!sources.length && !(requirement.description || '').trim()) {
      throw new BadRequestException('还没有可识别的内容：请先在「需求资料」里上传客户的技术附件，或填写需求描述');
    }

    const prevStatus = requirement.specStatus;
    requirement.specStatus = 'analyzing';
    await this.requirementRepository.save(requirement);

    const templates = await this.templatesForStructuring(requirement.templateCategory);
    const result = await this.aiService.structureRequirement(requirement.title, requirement.description || '', sources, templates);
    const card = result?.card;
    const ok = !result?.error && card && Array.isArray(card.fields) && (card.fields.length > 0 || (card.missing || []).length > 0);
    if (!ok) {
      // 失败不能记成"已完成"：原实现 AI 不可用时也存一个空结果并标 done，页面显示"已识别"却什么都没有
      requirement.specStatus = prevStatus === 'done' ? 'done' : 'pending';
      await this.requirementRepository.save(requirement);
      throw new BadRequestException(result?.error || 'AI 识别服务暂时不可用，请稍后重试');
    }

    /*
     * 没选产品类型、引擎在需求模板里判定出了类型 → 自动填上（置信度够才填），并记一笔需求记录。
     * 之后报价草稿按产品类型带明细、历史报价参考、补问都靠这个字段；人可以随时改。
     */
    let autoCategory: string | null = null;
    if (
      !requirement.templateCategory &&
      card.template_source === 'inferred' &&
      card.template_category &&
      Number(card.category_confidence) >= 0.6
    ) {
      autoCategory = card.template_category;
      requirement.templateCategory = autoCategory as string;
      await this.requirementLogRepository.save(
        this.requirementLogRepository.create({
          requirementId: id,
          type: 'change',
          content: `系统按资料判定产品类型为「${autoCategory}」${card.category_reason ? `（${card.category_reason}）` : ''}，如不对请在需求上修改`,
          actorId: user?.userId || 'system',
          actorName: user?.username || '系统',
          metadata: JSON.stringify([{ field: 'templateCategory', label: '产品类型', from: '', to: autoCategory }]),
        }),
      );
    }

    requirement.structuredSpec = JSON.stringify(
      {
        card,
        summary: result.summary || '',
        digest: result.digest || '',
        // 自动识别的结果先标「待确认」，人核对（保存或点确认）后清掉
        review: !!opts.auto,
        sources: sources.map((x) => x.file_name),
        analyzedAt: new Date().toISOString(),
        // 按哪个需求模板识别的（页面显示「识别依据」）；autoCategory = 本次由系统判定并填上
        templateCategory: card.template_category || requirement.templateCategory || null,
        templateSource: card.template_source || null,
        autoCategory,
      },
      null,
      2,
    );
    if (result.summary) requirement.aiAnalysis = result.summary;
    requirement.specStatus = 'done';
    requirement.analyzedBy = user?.userId || 'system';
    requirement.analyzedAt = new Date();
    const saved = await this.requirementRepository.save(requirement);
    await this.sync(saved);

    if (opts.auto) {
      await recordAutomation(this.requirementRepository.manager, 'spec_extracted', 1, id);
      await recordAutomation(this.requirementRepository.manager, 'missing_params', (card.missing || []).length, id);
    }
    return saved;
  }

  /**
   * 识别要用的需求模板。
   *
   * 需求选了产品类型 → 只传该类型的模板（按它的字段抽、按它的必填项列缺失）；
   * 没选，或选的类型还没维护字段 → 传全部有字段的模板，由 AI 服务按资料内容判定。
   * 原来一个都不传，引擎只认代码里写死的 6 个大类 ——「需求模板」页维护的 58 个模板对识别毫无作用。
   */
  async templatesForStructuring(category?: string | null): Promise<{
    template: { category: string; fields: any[] } | null;
    candidates: Array<{ category: string; fields: any[] }>;
  }> {
    const rows: Array<{ category: string; fields: string }> = await this.requirementRepository.manager
      .createQueryBuilder()
      .select(['t.category AS category', 't.fields AS fields'])
      .from('param_templates', 't')
      .where('t."deletedAt" IS NULL')
      .getRawMany();
    const parsed = rows
      .map((r) => {
        try {
          const fields = JSON.parse(r.fields || '[]');
          return Array.isArray(fields) && fields.length ? { category: r.category, fields } : null;
        } catch {
          return null;
        }
      })
      .filter(Boolean) as Array<{ category: string; fields: any[] }>;
    const chosen = category ? parsed.find((t) => t.category === category.trim()) : undefined;
    if (chosen) return { template: chosen, candidates: [] };
    return { template: null, candidates: parsed };
  }

  /**
   * 同类产品的历史报价区间：新建需求填「预计金额」时给个参考。
   * 只按已有报价统计（报价 → 方案 → 需求的产品类型），样本少于 1 条就不给。
   */
  async amountReference(category?: string): Promise<{ count: number; median?: number; min?: number; max?: number }> {
    if (!category?.trim()) return { count: 0 };
    const rows: Array<{ amount: any; currency?: string; exchangeRate?: any }> = await this.requirementRepository.manager
      .createQueryBuilder()
      .select(['q.amount AS amount', 'q.currency AS currency', 'q."exchangeRate" AS "exchangeRate"'])
      .from('quotations', 'q')
      .innerJoin('proposals', 'p', 'CAST(p.id AS TEXT) = q."proposalId"')
      .innerJoin('requirements', 'r', 'CAST(r.id AS TEXT) = p."requirementId"')
      .where('r."templateCategory" = :c', { c: category.trim() })
      .andWhere('q.amount > 0')
      .getRawMany();
    // 外币报价折人民币后再比（参考区间统一按人民币给）
    const vals = rows.map((r: any) => toCny(r.amount, r.currency, r.exchangeRate)).filter((n) => n > 0).sort((a, b) => a - b);
    if (!vals.length) return { count: 0 };
    const mid = Math.floor(vals.length / 2);
    const median = vals.length % 2 ? vals[mid] : (vals[mid - 1] + vals[mid]) / 2;
    return { count: vals.length, median, min: vals[0], max: vals[vals.length - 1] };
  }

  /** 人工确认自动识别的结果（不改内容，只去掉「待确认」） */
  async confirmSpec(id: string, user: CurrentUser): Promise<Requirement> {
    const requirement = await this.findOne(id, user);
    if (!requirement.structuredSpec) throw new BadRequestException('还没有识别结果');
    try {
      const spec = JSON.parse(requirement.structuredSpec);
      spec.review = false;
      spec.confirmedBy = user?.userId;
      spec.confirmedAt = new Date().toISOString();
      requirement.structuredSpec = JSON.stringify(spec, null, 2);
    } catch {
      throw new BadRequestException('识别结果格式异常，请重新识别');
    }
    return this.requirementRepository.save(requirement);
  }

  async updateSpec(id: string, spec: any, user: CurrentUser): Promise<Requirement> {
    const requirement = await this.findOne(id, user);
    // 人改过就是确认过：去掉「待确认」标记
    if (spec && typeof spec === 'object' && 'review' in spec) spec.review = false;
    requirement.structuredSpec = JSON.stringify(spec, null, 2);
    requirement.specStatus = 'done';
    const saved = await this.requirementRepository.save(requirement);
    await this.sync(saved);
    return saved;
  }

  /**
   * 生成补问草稿（微信 / 邮件两套话术）。
   *
   * 依赖已完成的结构化解析 —— 草稿内容来自需求卡的 missing 清单，
   * 没解析过就没有缺失清单可问。
   */
  async followupDraft(id: string, user: CurrentUser): Promise<any> {
    const requirement = await this.findOne(id, user);

    if (!requirement.structuredSpec) {
      throw new BadRequestException('请先执行「结构化识别」，再生成补问草稿');
    }

    let card: any;
    try {
      card = JSON.parse(requirement.structuredSpec);
    } catch {
      throw new BadRequestException('结构化结果解析失败，请重新执行结构化识别');
    }

    // structuredSpec 可能存的是 {card: {...}} 也可能直接是 card 本体
    const cardPayload = card?.card ?? card;

    let customerName = '客户';
    if (requirement.customerId) {
      const customer = await this.customerRepository.findOne({
        where: { id: requirement.customerId },
      });
      if (customer?.name) customerName = customer.name;
    }

    const draft = await this.aiService.followupDraft(cardPayload, customerName);
    return {
      ...draft,
      missing: cardPayload?.missing || [],
      customer: customerName,
    };
  }

  /**
   * 需求编号。
   *
   * 原实现是 `REQ-{年}-{总数+1}` —— 删掉一条再新建就会**重号**，
   * 而编号是对外用的业务标识，重号比跳号严重得多。
   * 现在统一走 NumberingService，取当前最大序号 +1，且规则可在系统设置里配。
   */
  private async generateNo(): Promise<string> {
    return this.numbering.next('requirement');
  }

  private async sync(requirement: Requirement): Promise<void> {
    if (requirement.isCurrent === false) {
      await this.knowledgeSyncService.deleteObject('requirement', requirement.id);
      return;
    }
    const content = `${requirement.title} ${requirement.description || ''} ${requirement.aiAnalysis || ''} ${requirement.structuredSpec || ''}`;
    await this.knowledgeSyncService.syncObject({
      id: requirement.id,
      objectType: 'requirement',
      title: requirement.title,
      content,
      visibility: requirement.visibility,
      uploaderId: requirement.ownerId,
      departmentId: requirement.departmentId,
      groupIds: requirement.groupIds,
      roleCodes: requirement.roleCodes,
    });
  }

  private deleteAttachmentFile(fileKey: string): void {
    try {
      // resolveInsideDir 防穿越：被污染的 fileKey（导入/历史数据）不能删到目录外
      const filePath = resolveInsideDir(this.uploadDir, fileKey.replace(/^requirements\//, ''));
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch (err) {
      this.logger.error('Delete attachment file failed', err?.message);
    }
  }

  private toSubject(requirement: Requirement) {
    return {
      visibility: requirement.visibility,
      uploaderId: requirement.ownerId,
      departmentId: requirement.departmentId,
      groupIds: requirement.groupIds,
      roleCodes: requirement.roleCodes,
    };
  }
}
