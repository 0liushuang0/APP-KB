import { Injectable, OnModuleInit, BadRequestException, Logger } from '@nestjs/common';
import { buildFunnel, chainFacts, cny, dealDate, dealsBetween, delta, monthlyTrend, quoteDate, winRate } from './business-metrics';
import { loadRegionDict, normalizeRegion } from '../../common/utils/region.util';
import { cycleMetrics } from './cycle-metrics';
import { summarizeAutomation } from '../../common/utils/automation-log';
import { domainEvents } from '../../common/services/domain-events';
import { ConfigService } from '@nestjs/config';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import * as XLSX from 'xlsx';
import * as fs from 'fs';
import * as path from 'path';
import { RolesService } from '../roles/roles.service';
import { UsersService } from '../users/users.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { NumberingService } from '../../common/services/numbering.service';
import { Customer } from '../customers/entities/customer.entity';
import { Proposal } from '../proposals/entities/proposal.entity';
import { Quotation } from '../quotations/entities/quotation.entity';
import { Product } from '../products/entities/product.entity';
import { Supplier } from '../suppliers/entities/supplier.entity';
import { Project } from '../projects/entities/project.entity';
import { Document } from '../documents/entities/document.entity';
import { Requirement } from '../requirements/entities/requirement.entity';
import { Contract } from '../contracts/entities/contract.entity';
import { AiCallLog } from '../ai/entities/ai-call-log.entity';
import { AiFeedback } from '../ai/entities/ai-feedback.entity';
import { ContractPayment } from '../contracts/entities/contract-payment.entity';
import { AuditLog } from '../audit-logs/entities/audit-log.entity';

const DEFAULT_SYSTEM_NAME = 'BOYA 智能运营中心';

@Injectable()
export class SystemService implements OnModuleInit {
  private readonly logger = new Logger(SystemService.name);
  constructor(
    private configService: ConfigService,
    private rolesService: RolesService,
    private usersService: UsersService,
    private systemConfigService: SystemConfigService,
    private numbering: NumberingService,
    @InjectDataSource() private dataSource: DataSource,
    @InjectRepository(Customer)
    private customerRepository: Repository<Customer>,
    @InjectRepository(Proposal)
    private proposalRepository: Repository<Proposal>,
    @InjectRepository(Quotation)
    private quotationRepository: Repository<Quotation>,
    @InjectRepository(Product)
    private productRepository: Repository<Product>,
    @InjectRepository(Supplier)
    private supplierRepository: Repository<Supplier>,
    @InjectRepository(Project)
    private projectRepository: Repository<Project>,
    @InjectRepository(Document)
    private documentRepository: Repository<Document>,
    @InjectRepository(Requirement)
    private requirementRepository: Repository<Requirement>,
    @InjectRepository(Contract)
    private contractRepository: Repository<Contract>,
    @InjectRepository(AiCallLog)
    private aiCallLogRepository: Repository<AiCallLog>,
    @InjectRepository(AuditLog)
    private auditLogRepository: Repository<AuditLog>,
  ) {}

  async onModuleInit() {
    // 任何业务写操作成功后统计缓存立即失效：新建/删除完回到工作台、列表页，数字就是新的
    domainEvents.onEvent('data.changed', () => {
      this.dashboardCache = null;
      this.moduleStatsCache = null;
    });
    await this.initialize();
  }

  async initialize() {
    await this.rolesService.seedSystemRoles();

    const appMode = this.configService.get<'single' | 'team'>('app.appMode');
    if (appMode === 'single') {
      await this.ensureDefaultAdmin();
    } else if ((await this.usersService.findAll()).length === 0) {
      /*
       * team 模式首次启动：一个用户都没有就没人能登录，系统直接变砖。
       * 仅在空库时引导默认管理员（管理员被删除后重启不会复活），
       * 并在日志里醒目提示立即改密码。
       */
      await this.ensureDefaultAdmin();
      this.logger.warn(
        `团队模式首次启动：已创建默认管理员「${this.configService.get('app.defaultAdmin.username')}」，请立即登录并修改默认密码`,
      );
    }
  }

  private async ensureDefaultAdmin() {
    const username = this.configService.get('app.defaultAdmin.username');
    let user = await this.usersService.findByUsername(username);

    if (!user) {
      const adminRole = await this.rolesService.findByCode('admin');
      user = await this.usersService.create({
        username,
        password: this.configService.get('app.defaultAdmin.password'),
        nickname: this.configService.get('app.defaultAdmin.nickname'),
        email: this.configService.get('app.defaultAdmin.email'),
        roleIds: adminRole ? [adminRole.id] : [],
      });
    }

    if (!user.isSystemAdmin) {
      await this.usersService.update(user.id, { isSystemAdmin: true });
    }
  }

  getAppMode(): 'single' | 'team' {
    return this.configService.get<'single' | 'team'>('app.appMode') || 'team';
  }

  async getSystemInfo() {
    const [name, adminTitle, subtitle] = await Promise.all([
      this.systemConfigService.getValue('system_name', DEFAULT_SYSTEM_NAME),
      this.systemConfigService.getValue('admin_title', ''),
      this.systemConfigService.getValue('system_subtitle', ''),
    ]);
    return {
      mode: this.getAppMode(),
      version: '0.1.0',
      name: name || DEFAULT_SYSTEM_NAME,
      // admin_title / system_subtitle 是登录页要展示的文案，必须随这个
      // @Public 接口带出——前端未登录时调不了 /system-configs/*，
      // 只暴露这两个固定 key，不接受任意 key 查询
      adminTitle: adminTitle || '',
      subtitle: subtitle || '',
    };
  }

  getVersionInfo() {
    let version = '0.1.0';
    try {
      const packageJsonPath = path.join(process.cwd(), 'package.json');
      if (fs.existsSync(packageJsonPath)) {
        const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
        version = packageJson.version || version;
      }
    } catch (_e) {
      // Ignore errors reading package.json
    }

    return {
      version,
      buildDate: new Date().toISOString(),
      gitHash: process.env.GIT_HASH || null,
    };
  }

  /**
   * 工作台数据：KPI + 转化漏斗 + 近 6 个月趋势。
   *
   * 一次请求返回全部，避免首屏发 4~5 个并发请求 ——
   * 数据量都在千级，一次算完比多次往返快。
   */
  /** dashboard-stats 同样加缓存（15 秒：工作台要相对新鲜但不需实时） */
  private dashboardCache: { data: any; expiresAt: number } | null = null;
  private static readonly DASHBOARD_TTL_MS = 15_000;

  /**
   * 工作台数据。公司口径的 KPI/流水线/漏斗走缓存；「我的今天」按人现算（几条计数查询，很便宜）。
   *
   * scope='mine'：只数当前用户负责的（需求/报价/合同按负责人、项目按项目经理、回款按合同负责人；
   * 审批：有审批权的人看全部待审，没有的看自己提交的）。原来计数是全公司合计，团队上线后每个人看到的都是全公司的待办。
   */
  async getDashboardStats(user?: { userId?: string; isSystemAdmin?: boolean; roles?: string[] }, scope: 'mine' | 'all' = 'all') {
    if (!this.dashboardCache || Date.now() >= this.dashboardCache.expiresAt) {
      this.dashboardCache = {
        data: await this.computeDashboardStats(),
        expiresAt: Date.now() + SystemService.DASHBOARD_TTL_MS,
      };
    }
    const mine = scope === 'mine' && !!user?.userId;
    const approver = !!user?.isSystemAdmin || (user?.roles || []).some((r) => ['admin', 'approver', 'manager'].includes(r));
    const todos = await this.computeTodos(mine ? user!.userId : undefined, mine && !approver ? user!.userId : undefined);
    return { ...this.dashboardCache.data, todos, todosScope: mine ? 'mine' : 'all' };
  }

  private async computeDashboardStats() {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);

    const [customers, allRequirements, proposals, quotations, contracts, projects, tickets] = await Promise.all([
      this.customerRepository.find({ select: ['id', 'name', 'code'] as any }), // 客户简称存在 code 列（历史遗留）
      this.requirementRepository.find(),
      this.proposalRepository.find(),
      this.quotationRepository.find(),
      this.contractRepository.find(),
      this.projectRepository.find(),
      this.dataSource.query(
        `SELECT id, "ticketNo", title, status, priority, "customerId", "createdAt" FROM after_sales_tickets`,
      ) as Promise<any[]>,
    ]);
    const requirements = allRequirements.filter((r) => r.isCurrent !== false);
    const custName = new Map(customers.map((c: any) => [String(c.id), c.code || c.name]));
    const since = (d: any, from: Date, to?: Date) => {
      if (!d) return false;
      const t = new Date(d).getTime();
      return t >= from.getTime() && (!to || t < to.getTime());
    };
    const sum = (rows: any[]) => rows.reduce((s, r) => s + cny(r), 0);

    const monthReqs = requirements.filter((r) => since(r.createdAt, monthStart)).length;
    const lastMonthReqs = requirements.filter((r) => since(r.createdAt, lastMonthStart, monthStart)).length;
    const monthQuote = sum(quotations.filter((q) => since(quoteDate(q as any), monthStart)));
    const lastMonthQuote = sum(quotations.filter((q) => since(quoteDate(q as any), lastMonthStart, monthStart)));
    const monthDeals = dealsBetween(contracts as any, monthStart);
    const lastMonthDeals = dealsBetween(contracts as any, lastMonthStart, monthStart);

    const needsAttention = requirements.filter((requirement: any) => {
      if (!requirement.specStatus || requirement.specStatus === 'pending') return true;
      if (requirement.specStatus !== 'done' || !requirement.structuredSpec) return false;
      try {
        const parsed = JSON.parse(requirement.structuredSpec);
        const card = parsed?.card ?? parsed;
        return Array.isArray(card?.missing) && card.missing.length > 0;
      } catch {
        return true;
      }
    }).length;

    const funnel = buildFunnel(requirements as any, proposals as any, quotations as any, contracts as any);
    const activeProjects = projects.filter((p) => ['ongoing', 'active'].includes(String(p.status))).length;

    // ── 流水线：六列计数 + 每列最该先看的 4 张卡（后端一次算好，前端不再拉 6 张表各 200 条） ──
    const PRIO: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 };
    const HEALTH: Record<string, number> = { red: 0, yellow: 1, green: 2 };
    const ts = (d: any) => (d ? new Date(d).getTime() : 0);
    const card = (x: any) => ({ ...x, customerName: x.customerId ? custName.get(String(x.customerId)) || '' : '' });
    const pipeline = {
      requirement: {
        count: requirements.length,
        amount: 0,
        items: requirements
          .filter((r) => r.status !== 'lost')
          .sort((a: any, b: any) => (PRIO[a.priority] ?? 9) - (PRIO[b.priority] ?? 9) || ts(b.createdAt) - ts(a.createdAt))
          .slice(0, 4)
          .map((r: any) => card({ id: r.id, title: r.title, no: r.requirementNo, status: r.status, priority: r.priority, date: r.requirementDate || r.createdAt, customerId: r.customerId, link: `/requirements/${r.id}` })),
      },
      proposal: {
        count: proposals.length,
        amount: 0,
        items: [...proposals]
          .sort((a, b) => ts(b.createdAt) - ts(a.createdAt))
          .slice(0, 4)
          .map((p: any) => card({ id: p.id, title: p.title, no: p.proposalNo, status: p.status, date: p.createdAt, customerId: p.customerId, link: `/proposals?highlight=${p.id}` })),
      },
      quotation: {
        count: quotations.length,
        amount: sum(quotations),
        items: [...quotations]
          .sort((a, b) => ts(b.createdAt) - ts(a.createdAt))
          .slice(0, 4)
          .map((q: any) => card({ id: q.id, title: q.projectName || q.quotationNo, no: q.quotationNo, status: q.status, amount: cny(q), date: q.createdAt, customerId: q.customerId, link: `/quotations?highlight=${q.id}` })),
      },
      contract: {
        count: contracts.length,
        amount: sum(contracts),
        items: [...contracts]
          .sort((a: any, b: any) => (dealDate(b)?.getTime() || 0) - (dealDate(a)?.getTime() || 0))
          .slice(0, 4)
          .map((c: any) => card({ id: c.id, title: c.title || c.contractNo, no: c.contractNo, status: c.status, amount: cny(c), date: dealDate(c), customerId: c.customerId, link: `/contracts?highlight=${c.id}` })),
      },
      project: {
        count: projects.length,
        amount: 0,
        items: [...projects]
          .sort((a: any, b: any) => (HEALTH[a.health] ?? 1) - (HEALTH[b.health] ?? 1) || (ts(a.endDate) || 9e15) - (ts(b.endDate) || 9e15))
          .slice(0, 4)
          .map((p: any) => card({ id: p.id, title: p.name, no: p.projectNo, status: p.status, health: p.health, progress: p.progress, date: p.endDate, customerId: p.customerId, link: `/projects?highlight=${p.id}` })),
      },
      afterSales: {
        count: tickets.length,
        amount: 0,
        items: [...tickets]
          .sort((a: any, b: any) => Number(['resolved', 'closed'].includes(a.status)) - Number(['resolved', 'closed'].includes(b.status)) || (PRIO[a.priority] ?? 9) - (PRIO[b.priority] ?? 9) || ts(b.createdAt) - ts(a.createdAt))
          .slice(0, 4)
          .map((t: any) => card({ id: t.id, title: t.title, no: t.ticketNo, status: t.status, priority: t.priority, date: t.createdAt, customerId: t.customerId, link: `/after-sales?highlight=${t.id}` })),
      },
    };

    return {
      customers: customers.length,
      proposals: proposals.length,
      quotations: quotations.length,
      requirements: requirements.length,
      kpi: {
        monthRequirements: monthReqs,
        monthRequirementsDelta: delta(monthReqs, lastMonthReqs),
        needsAttention,
        activeProjects,
        monthQuoteAmount: monthQuote,
        monthQuoteAmountDelta: delta(monthQuote, lastMonthQuote),
        // 成交 = 签约合同（与流水线「合同成交」同一口径）
        monthWonAmount: monthDeals.amount,
        monthWonAmountDelta: delta(monthDeals.amount, lastMonthDeals.amount),
        monthDeals: monthDeals.count,
        dealsTotal: contracts.length,
        dealAmountTotal: sum(contracts),
        winRate: winRate(quotations as any, contracts as any),
      },
      funnel: funnel.stages,
      directDeals: funnel.direct,
      trend: monthlyTrend(quotations as any, contracts as any, now, 6),
      pipeline,
      automation: await this.automationSummary(),
    };
  }

  /**
   * 我的今天：需要人推动的事，每类都给计数和直达链接（带筛选参数，点过去就是那几条）。
   */
  /** 「我的今天」待办计数（周报也用这一份口径） */
  async computeTodos(ownerId?: string, submittedBy?: string) {
    const today = new Date().toISOString().slice(0, 10);
    const in7 = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    const in30 = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
    const stale = new Date(Date.now() - 14 * 86400000);

    // 按人过滤：参数追加在最后，占位符按序号续上（SQLite 下 portable 会统一换成 ?）
    const own = (col: string, params: any[]) => (ownerId ? ` AND ${col} = $${params.length + 1}` : '');
    const withOwner = (params: any[]) => (ownerId ? [...params, ownerId] : params);
    const one = (sql: string, params: any[] = []) =>
      this.dataSource.query(this.portable(sql), params).then((rows: any[]) => Number((rows[0] || {}).n || 0));

    const [approvals, followups, followupsOverdue, warranties, projectsRisk, deliveriesSoon, paymentsDue] = await Promise.all([
      submittedBy
        ? one(`SELECT COUNT(*) AS n FROM approval_flows WHERE status = 'pending' AND "submittedBy" = $1`, [submittedBy])
        : one(`SELECT COUNT(*) AS n FROM approval_flows WHERE status = 'pending'`),
      one(
        `SELECT COUNT(*) AS n FROM requirements
         WHERE ("isCurrent" IS NULL OR "isCurrent" = true) AND "nextFollowUpDate" IS NOT NULL
           AND "nextFollowUpDate" BETWEEN $1 AND $2 AND (status IS NULL OR status NOT IN ('lost', 'closed', 'won'))` + own('"ownerId"', [today, in7]),
        withOwner([today, in7]),
      ),
      one(
        `SELECT COUNT(*) AS n FROM requirements
         WHERE ("isCurrent" IS NULL OR "isCurrent" = true) AND "nextFollowUpDate" IS NOT NULL
           AND "nextFollowUpDate" < $1 AND (status IS NULL OR status NOT IN ('lost', 'closed', 'won'))` + own('"ownerId"', [today]),
        withOwner([today]),
      ),
      one(
        `SELECT COUNT(*) AS n FROM contracts
         WHERE "warrantyExpiryDate" IS NOT NULL AND "warrantyExpiryDate" > $1 AND "warrantyExpiryDate" <= $2` + own('"ownerId"', [today, in30]),
        withOwner([today, in30]),
      ),
      one(`SELECT COUNT(*) AS n FROM projects WHERE health IN ('red', 'yellow')` + own('"managerId"', []), withOwner([])),
      one(
        `SELECT COUNT(*) AS n FROM contracts
         WHERE "deliveryDate" IS NOT NULL AND "deliveryDate" >= $1 AND "deliveryDate" <= $2
           AND (status IS NULL OR status NOT IN ('completed', 'terminated'))` + own('"ownerId"', [today, in7]),
        withOwner([today, in7]),
      ),
      // 回款到期：7 天内到期或已逾期、还没收到款的回款节点（原来到期不提醒，24 个节点全靠人记）
      one(
        `SELECT COUNT(*) AS n FROM contract_payments p JOIN contracts c ON CAST(c.id AS TEXT) = p."contractId"
         WHERE p."receivedDate" IS NULL AND p."dueDate" IS NOT NULL AND p."dueDate" <= $1
           AND (c.status IS NULL OR c.status NOT IN ('terminated'))` + own('c."ownerId"', [in7]),
        withOwner([in7]),
      ),
    ]);

    // 报价超 14 天没有签约（已审核/已发送、且没有合同挂着它）
    const [quotes, contractQuoteIds] = await Promise.all([
      this.quotationRepository.find({ select: ['id', 'status', 'updatedAt', 'createdAt', 'ownerId'] as any, ...(ownerId ? { where: { ownerId } as any } : {}) }),
      this.contractRepository.find({ select: ['quotationId'] as any }),
    ]);
    const signed = new Set(contractQuoteIds.map((c: any) => c.quotationId).filter(Boolean));
    const quotesStale = quotes.filter(
      (q: any) => ['approved', 'sent', 'pending'].includes(String(q.status)) && !signed.has(q.id) &&
        new Date(q.updatedAt || q.createdAt).getTime() < stale.getTime(),
    ).length;

    // 自动识别出参数、等人确认的需求
    const specRows: Array<{ s: string }> = await this.dataSource.query(
      this.portable(`SELECT "structuredSpec" AS s FROM requirements WHERE ("isCurrent" IS NULL OR "isCurrent" = true) AND "structuredSpec" IS NOT NULL` + own('"ownerId"', [])),
      withOwner([]),
    );
    const specsToConfirm = specRows.filter((r) => {
      try {
        return JSON.parse(r.s)?.review === true;
      } catch {
        return false;
      }
    }).length;

    return {
      approvals,
      followups,
      followupsOverdue,
      warranties,
      projectsRisk,
      deliveriesSoon,
      quotesStale,
      specsToConfirm,
      paymentsDue,
    };
  }

  /** 本周系统替你做了什么：只数事实（来自 audit_logs 里 action='auto' 的记录） */
  private async automationSummary(days = 7): Promise<Array<{ kind: string; label: string; count: number }>> {
    return this.automationBetween(new Date(Date.now() - days * 86400000));
  }

  /** 某段时间里系统自动做了什么（周报按自然周取） */
  async automationBetween(from: Date, to?: Date): Promise<Array<{ kind: string; label: string; count: number }>> {
    const qb = this.auditLogRepository
      .createQueryBuilder('a')
      .select(['a.objectType AS kind', 'a.objectId AS "objectId"', 'a.detail AS detail', 'a.createdAt AS "createdAt"'])
      .where('a.action = :a', { a: 'auto' })
      .andWhere('a.createdAt >= :from', { from });
    if (to) qb.andWhere('a.createdAt < :to', { to });
    const rows = await qb.getRawMany<{ kind: string; objectId: string | null; detail: string; createdAt: any }>();
    return summarizeAutomation(rows);
  }

  /**
   * 业务结果指标：报价响应天数、需求→签约周期、赢单率、丢单原因、回款及时率（定义见 cycle-metrics.ts）。
   * ownerId 给了就只算本人负责的需求链。
   */
  async getCycleMetrics(ownerId?: string, days = 180) {
    const [reqs, props, quotes, contracts, payments] = await Promise.all([
      this.requirementRepository.find({
        select: ['id', 'ownerId', 'requirementDate', 'createdAt', 'updatedAt', 'status', 'lossReason', 'isCurrent'] as any,
        ...(ownerId ? { where: { ownerId } as any } : {}),
      }),
      this.proposalRepository.find({ select: ['id', 'requirementId'] as any }),
      this.quotationRepository.find({ select: ['id', 'proposalId', 'quotedAt', 'createdAt'] as any }),
      this.contractRepository.find({ select: ['id', 'quotationId', 'signedDate', 'createdAt', 'status'] as any }),
      this.dataSource.query(`SELECT "contractId", "dueDate", "receivedDate" FROM contract_payments`) as Promise<any[]>,
    ]);
    let pays = payments;
    if (ownerId) {
      const mine = new Set(
        (await this.contractRepository.find({ select: ['id'] as any, where: { ownerId } as any })).map((c: any) => String(c.id)),
      );
      pays = payments.filter((p) => mine.has(String(p.contractId)));
    }
    return cycleMetrics({ reqs: reqs as any, props: props as any, quotes: quotes as any, contracts: contracts as any, payments: pays }, new Date(), days);
  }

  /** $1/$2 占位符在 SQLite 下换成 ?（PG 原样） */
  private portable(sql: string): string {
    return this.dataSource.options.type === 'postgres' ? sql : sql.replace(/\$\d+/g, '?');
  }

  /**
   * 各业务列表页顶部的统计卡片数据。
   *
   * 为什么合成一个接口而不是每个模块各开一个 /stats：
   * 卡片只要计数，六张表加起来也就几千行，一次算完比让六个页面各自往返一趟省事，
   * 也不必在六个 service 里重复写一遍"按状态分桶"。工作台的 dashboard-stats 已是同样思路。
   *
   * 只返回聚合计数，不含任何单据标题/客户名，暴露面与既有 dashboard-stats 一致。
   */
  /**
   * module-stats 结果缓存（30 秒 TTL）。
   * 统计卡片不要求实时——8 张表全量加载在数据量大时 P99 超 100ms，
   * 六个页面共享一个接口，加缓存后每 30 秒只算一次。
   */
  private moduleStatsCache: { data: any; expiresAt: number } | null = null;
  private static readonly MODULE_STATS_TTL_MS = 30_000;

  async getModuleStats() {
    if (this.moduleStatsCache && Date.now() < this.moduleStatsCache.expiresAt) {
      return this.moduleStatsCache.data;
    }
    const result = await this.computeModuleStats();
    this.moduleStatsCache = {
      data: result,
      expiresAt: Date.now() + SystemService.MODULE_STATS_TTL_MS,
    };
    return result;
  }

  /**
   * 数据一致性巡检：链路悬空引用 + 单据重号 + 历史脏值。
   *
   * 背景：链路外键只存在于应用层（无数据库约束），删除上游或导入历史数据
   * 都可能产生悬空引用 —— 2026-10-14 实际发生过（删方案重建导致报价链断、
   * 合同 quotationId 存了字面量 'none'），客户/项目名整片变空才暴露。
   * 巡检是兜底：主动发现，而不是等界面坏了倒查。
   * SQL 的驼峰列名一律双引号（SQLite/PG 双方言通用写法）。
   */
  async consistencyCheck() {
    const q = (sql: string) => this.dataSource.query(sql);

    const dangling = async (label: string, sql: string) => {
      const rows = await q(sql);
      return { item: label, count: rows.length, sample: rows.slice(0, 3) };
    };

    const [danglingLinks, duplicates, dirty] = await Promise.all([
      Promise.all([
        dangling('报价指向不存在的方案', `SELECT q."quotationNo" AS no FROM quotations q LEFT JOIN proposals p ON p.id = q."proposalId" WHERE q."proposalId" IS NOT NULL AND p.id IS NULL`),
        dangling('合同指向不存在的报价', `SELECT c."contractNo" AS no FROM contracts c LEFT JOIN quotations q ON q.id = c."quotationId" WHERE c."quotationId" IS NOT NULL AND q.id IS NULL`),
        dangling('方案指向不存在的需求', `SELECT p."proposalNo" AS no FROM proposals p LEFT JOIN requirements r ON r.id = p."requirementId" WHERE p."requirementId" IS NOT NULL AND r.id IS NULL`),
        dangling('项目指向不存在的需求', `SELECT pr."projectNo" AS no FROM projects pr LEFT JOIN requirements r ON r.id = pr."requirementId" WHERE pr."requirementId" IS NOT NULL AND r.id IS NULL`),
        dangling('需求指向不存在的客户', `SELECT r."requirementNo" AS no FROM requirements r LEFT JOIN customers c ON c.id = r."customerId" WHERE r."customerId" IS NOT NULL AND c.id IS NULL`),
        dangling('售后工单指向不存在的客户', `SELECT t."ticketNo" AS no FROM after_sales_tickets t LEFT JOIN customers c ON c.id = t."customerId" WHERE t."customerId" IS NOT NULL AND c.id IS NULL`),
        dangling('资料关联指向不存在的单据', `SELECT l.id AS no FROM document_links l LEFT JOIN documents d ON d.id = l."documentId" WHERE d.id IS NULL`),
      ]),
      Promise.all([
        dangling('客户编号重复', `SELECT "customerCode" AS no, COUNT(*) AS n FROM customers WHERE "customerCode" IS NOT NULL AND "customerCode" <> '' GROUP BY "customerCode" HAVING COUNT(*) > 1`),
        dangling('方案编号重复', `SELECT "proposalNo" AS no, COUNT(*) AS n FROM proposals WHERE "proposalNo" IS NOT NULL GROUP BY "proposalNo" HAVING COUNT(*) > 1`),
        dangling('报价编号重复', `SELECT "quotationNo" AS no, COUNT(*) AS n FROM quotations WHERE "quotationNo" IS NOT NULL GROUP BY "quotationNo" HAVING COUNT(*) > 1`),
        dangling('合同编号重复', `SELECT "contractNo" AS no, COUNT(*) AS n FROM contracts WHERE "contractNo" IS NOT NULL AND "contractNo" <> '' GROUP BY "contractNo" HAVING COUNT(*) > 1`),
        dangling('项目编号重复', `SELECT "projectNo" AS no, COUNT(*) AS n FROM projects WHERE "projectNo" IS NOT NULL AND "projectNo" <> '' GROUP BY "projectNo" HAVING COUNT(*) > 1`),
      ]),
      Promise.all([
        dangling('关联字段存在字面量 none（导入脏值）', `SELECT id AS no FROM contracts WHERE "quotationId" = 'none'`),
      ]),
    ]);

    const issues = [...danglingLinks, ...duplicates, ...dirty].filter((c) => c.count > 0);
    return {
      checkedAt: new Date().toISOString(),
      ok: issues.length === 0,
      issues,
      summary: issues.length === 0 ? '链路引用、单据编号、字段取值均正常' : `发现 ${issues.length} 类问题`,
    };
  }

  private async computeModuleStats() {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const soon = new Date(now.getTime() + 30 * 86400000);

    const [
      customers,
      allRequirements,
      proposals,
      quotations,
      contracts,
      projects,
      documents,
      suppliers,
    ] = await Promise.all([
      this.customerRepository.find(),
      this.requirementRepository.find(),
      this.proposalRepository.find(),
      this.quotationRepository.find(),
      this.contractRepository.find(),
      this.projectRepository.find(),
      this.documentRepository.find(),
      this.supplierRepository.find(),
    ]);

    /*
     * 需求表存了历史版本（isCurrent=false 是被新版本顶掉的旧稿）。
     * 列表页只显示当前版本，统计要是把旧版也算进去，卡片上的"需求总数"
     * 会比下面表格的行数多，用户第一反应是"有数据没显示出来"。
     */
    const requirements = allRequirements.filter((r) => r.isCurrent !== false);

    const countBy = <T>(rows: T[], pick: (row: T) => string | undefined | null) => {
      const map: Record<string, number> = {};
      for (const row of rows) {
        const key = pick(row);
        if (key) map[key] = (map[key] || 0) + 1;
      }
      return map;
    };
    const since = (d: Date | string | undefined | null, from: Date) =>
      !!d && new Date(d).getTime() >= from.getTime();
    const sum = (rows: Array<{ amount?: number; currency?: string; exchangeRate?: any }>) =>
      rows.reduce((s, r) => s + cny(r), 0);

    /*
     * 分桶时把多个状态值并进同一格。
     *
     * 库里实际存的状态比 status.enums.ts 里写的那套宽：审批流留下的 `approved`
     * 和项目上的 `active` 都在用，光按文档里的枚举分桶会让卡片整排显示 0 ——
     * 数字全是零的统计栏比没有还糟，用户会以为数据丢了。
     */
    const bucket = <T extends { status?: string }>(rows: T[], ...values: string[]) =>
      rows.filter((r) => r.status && values.includes(r.status)).length;

    const contractStatus = countBy(contracts, (c) => c.status);
    const todayStr = now.toISOString().slice(0, 10);
    const in7Str = new Date(now.getTime() + 7 * 86400000).toISOString().slice(0, 10);
    // 已报价/已成交按 需求→方案→报价→合同 的链路推出，与工作台漏斗同一口径
    const chain = chainFacts(requirements as any, proposals as any, quotations as any, contracts as any);

    return {
      customers: {
        total: customers.length,
        // 客户用的是 businessStatus（活跃/沉默/流失），status 那列是审批态，别混用
        active: customers.filter((c) => (c as any).businessStatus === '活跃').length,
        lead: customers.filter((c) => (c as any).businessStatus === '流失').length,
        sleeping: customers.filter((c) => (c as any).businessStatus === '沉默').length,
        newThisMonth: customers.filter((c) => since(c.createdAt, monthStart)).length,
        // 客户分布（客户页的分布条形图），只给计数
        byIndustry: countBy(customers, (c) => (c as any).industry || '未填'),
        byRegion: countBy(customers, (c) => (c as any).region || '未填'),
        byLevel: countBy(customers, (c) => (c as any).level || '未填'),
      },
      requirements: {
        total: requirements.length,
        // 待处理 = 还没定稿的，用户关心的是"还有多少要盯"；无状态的算待处理
        pending: requirements.filter(
          (r) => !r.status || ['pending', 'analyzing', 'analyzed', 'structuring'].includes(r.status),
        ).length,
        ready: bucket(requirements, 'ready', 'structured', 'approved'),
        quoted: requirements.filter((r) => chain.reqQuoted.has(r.id) || r.status === 'quoted').length,
        won: requirements.filter((r) => chain.reqSigned.has(r.id) || r.status === 'won').length,
        lost: bucket(requirements, 'lost'),
        newThisMonth: requirements.filter((r) => since(r.createdAt, monthStart)).length,
        // 与工作台「我的今天」、列表 focus 筛选同一口径
        review: requirements.filter((r: any) => /"review": true/.test(r.structuredSpec || '')).length,
        incomplete: requirements.filter((r: any) =>
          !r.specStatus || r.specStatus === 'pending' ||
          (/"missing": \[/.test(r.structuredSpec || '') && !/"missing": \[\]/.test(r.structuredSpec || ''))).length,
        followupDue: requirements.filter((r: any) => {
          if (!r.nextFollowUpDate || ['lost', 'closed', 'won'].includes(r.status)) return false;
          const d = String(r.nextFollowUpDate).slice(0, 10);
          return d >= todayStr && d <= in7Str;
        }).length,
        followupOverdue: requirements.filter((r: any) => {
          if (!r.nextFollowUpDate || ['lost', 'closed', 'won'].includes(r.status)) return false;
          return String(r.nextFollowUpDate).slice(0, 10) < todayStr;
        }).length,
      },
      proposals: {
        total: proposals.length,
        pending: bucket(proposals, 'pending'),
        approved: bucket(proposals, 'approved'),
        rejected: bucket(proposals, 'rejected'),
        newThisMonth: proposals.filter((p) => since(p.createdAt, monthStart)).length,
      },
      quotations: {
        total: quotations.length,
        draft: bucket(quotations, 'draft'),
        pending: bucket(quotations, 'pending'),
        approved: bucket(quotations, 'approved'),
        sent: bucket(quotations, 'sent'),
        won: quotations.filter((q) => chain.quoteSigned.has(q.id) || q.status === 'won').length,
        lost: bucket(quotations, 'lost'),
        monthAmount: sum(quotations.filter((q) => since(q.createdAt, monthStart))),
        stale: quotations.filter((q: any) =>
          ['approved', 'sent', 'pending'].includes(q.status) && !chain.quoteSigned.has(q.id) &&
          new Date(q.updatedAt || q.createdAt).getTime() < now.getTime() - 14 * 86400000).length,
      },
      contracts: {
        total: contracts.length,
        signed: contractStatus.signed || 0,
        executing: contractStatus.executing || 0,
        completed: contractStatus.completed || 0,
        totalAmount: sum(contracts),
        // 质保 30 天内到期：到期前要主动联系客户，晚了就是投诉
        deliverySoon: contracts.filter((c: any) => {
          if (!c.deliveryDate || ['completed', 'terminated'].includes(c.status)) return false;
          const d = String(c.deliveryDate instanceof Date ? c.deliveryDate.toISOString() : c.deliveryDate).slice(0, 10);
          return d >= todayStr && d <= in7Str;
        }).length,
        warrantyExpiring: contracts.filter((c) => {
          const d = (c as any).warrantyExpiryDate;
          if (!d) return false;
          const t = new Date(d).getTime();
          return t > now.getTime() && t < soon.getTime();
        }).length,
      },
      projects: {
        total: projects.length,
        // 进行中：ongoing 与 active 是同一个意思，历史数据两种都有
        ongoing: bucket(projects, 'ongoing', 'active'),
        planning: bucket(projects, 'planning', 'pending'),
        completed: bucket(projects, 'completed'),
        paused: bucket(projects, 'paused'),
        // 原来读的 riskLevel 字段并不存在，恒为 0；改看每日重算的健康度
        highRisk: projects.filter((p) => (p as any).health === 'red').length,
        atRisk: projects.filter((p) => ['red', 'yellow'].includes((p as any).health)).length,
      },
      /*
       * 资料类页面是分页加载的，页面自己数不出总数，只能在这里算。
       * 三者共用 documents 一张表，靠 category / customerId 区分，
       * 口径与各自列表接口保持一致（业务资料排除 knowledge*）。
       */
      documents: (() => {
        const isKnowledge = (d: Document) => (d.category || '').startsWith('knowledge');
        const business = documents.filter((d) => !isKnowledge(d));
        const knowledge = documents.filter(isKnowledge);
        const bytes = (rows: Document[]) => rows.reduce((s, d) => s + Number(d.fileSize || 0), 0);
        return {
          business: {
            total: business.length,
            approved: bucket(business as any, 'approved'),
            pending: bucket(business as any, 'pending'),
            linkedCustomer: business.filter((d) => !!d.customerId).length,
            totalSize: bytes(business),
            newThisMonth: business.filter((d) => since(d.createdAt, monthStart)).length,
          },
          knowledge: {
            total: knowledge.length,
            // 已索引：解析出正文才进得了向量库，没有正文的是扫描件
            indexed: knowledge.filter((d) => (d.parsedText || '').length > 50).length,
            categories: new Set(knowledge.map((d) => d.category).filter(Boolean)).size,
            totalSize: bytes(knowledge),
            newThisMonth: knowledge.filter((d) => since(d.createdAt, monthStart)).length,
          },
          customer: {
            total: documents.filter((d) => !!d.customerId).length,
            customers: new Set(documents.map((d) => d.customerId).filter(Boolean)).size,
            totalSize: bytes(documents.filter((d) => !!d.customerId)),
            newThisMonth: documents.filter(
              (d) => !!d.customerId && since(d.createdAt, monthStart),
            ).length,
          },
        };
      })(),
      suppliers: {
        total: suppliers.length,
        domestic: suppliers.filter((s) => (s as any).origin === 'domestic').length,
        overseas: suppliers.filter((s) => (s as any).origin === 'overseas').length,
        tier1: suppliers.filter((s) => (s as any).tier === 'tier1').length,
        qualified: suppliers.filter((s) => (s as any).cooperationLevel === 'qualified').length,
        categories: new Set(suppliers.flatMap((s) => (s as any).productCategories || [])).size,
      },
    };
  }

  /**
   * 个人工作台待办：待解析需求与待补参数需求。
   * 这些是"打开系统第一件该做的事"，比一个纯数字更有用。
   */
  async getTodos() {
    const [requirements] = await Promise.all([
      this.requirementRepository.find({ order: { createdAt: 'DESC' }, take: 100 }),
    ]);

    const unparsed = requirements.filter(
      (r) => r.isCurrent !== false && (!r.specStatus || r.specStatus === 'pending'),
    );

    // 已解析但仍缺关键字段的需求 —— 这些正是该发补问的
    const incomplete = requirements.filter((r) => {
      if (r.specStatus !== 'done' || !r.structuredSpec) return false;
      try {
        const parsed = JSON.parse(r.structuredSpec);
        const card = parsed?.card ?? parsed;
        return Array.isArray(card?.missing) && card.missing.length > 0;
      } catch {
        return false;
      }
    });

    return {
      approvals: [],
      unparsedRequirements: unparsed.slice(0, 10).map((r) => ({
        id: r.id,
        type: 'requirement_unparsed',
        title: r.title,
        code: r.requirementNo,
        createdAt: r.createdAt,
      })),
      incompleteRequirements: incomplete.slice(0, 10).map((r) => ({
        id: r.id,
        type: 'requirement_incomplete',
        title: r.title,
        code: r.requirementNo,
        createdAt: r.createdAt,
      })),
      pendingQuotations: [],
      counts: {
        approvals: 0,
        unparsedRequirements: unparsed.length,
        incompleteRequirements: incomplete.length,
        pendingQuotations: 0,
      },
    };
  }

  async getRecentActivities() {
    const limit = 10;
    const [customers, proposals, quotations, documents] = await Promise.all([
      this.customerRepository.find({ order: { createdAt: 'DESC' }, take: limit }),
      this.proposalRepository.find({ order: { createdAt: 'DESC' }, take: limit }),
      this.quotationRepository.find({ order: { createdAt: 'DESC' }, take: limit }),
      this.documentRepository.find({ order: { createdAt: 'DESC' }, take: limit }),
    ]);

    const activities = [
      ...customers.map((c) => ({ title: `新建客户：${c.name}`, time: c.createdAt, type: 'customer' })),
      ...proposals.map((p) => ({ title: `新建方案：${p.title}`, time: p.createdAt, type: 'proposal' })),
      ...quotations.map((q) => ({ title: `新建报价：${q.quotationNo}`, time: q.createdAt, type: 'quotation' })),
      ...documents.map((d) => ({ title: `上传文档：${d.title}`, time: d.createdAt, type: 'document' })),
    ];

    activities.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());
    return activities.slice(0, limit);
  }

  /**
   * 效能看板数据。
   *
   * 聚合在 JS 侧完成而非 SQL：调用量级是每天几百条，全量加载成本可忽略，
   * 换来的是 sqlite / postgres 两种方言下行为完全一致（日期截断函数不通用）。
   */
  async getPerformanceMetrics() {
    const since = new Date();
    since.setDate(since.getDate() - 6);
    since.setHours(0, 0, 0, 0);

    const [logs, customers, requirements, proposals, quotations, auditLogs, documents, feedbacks] = await Promise.all([
      this.aiCallLogRepository.find({ order: { createdAt: 'DESC' }, take: 5000 }),
      this.customerRepository.count(),
      this.requirementRepository.count(),
      this.proposalRepository.count(),
      this.quotationRepository.count(),
      this.auditLogRepository.count(),
      this.documentRepository.find(),
      this.aiCallLogRepository.manager.getRepository(AiFeedback)
        .find({ select: ['rating'] }),
    ]);

    const total = logs.length;
    const success = logs.filter((l) => l.success).length;
    const failed = total - success;
    const durations = logs.map((l) => l.durationMs || 0);
    const totalTokens = logs.reduce((sum, l) => sum + (l.inputTokens || 0) + (l.outputTokens || 0), 0);

    const round = (n: number) => Math.round(n * 10) / 10;

    // 近 7 天趋势（无调用的日期补 0，避免前端出现断点）
    const trendMap = new Map<string, number>();
    for (let i = 0; i < 7; i++) {
      const d = new Date(since);
      d.setDate(since.getDate() + i);
      trendMap.set(d.toISOString().slice(0, 10), 0);
    }
    for (const log of logs) {
      const key = new Date(log.createdAt).toISOString().slice(0, 10);
      if (trendMap.has(key)) trendMap.set(key, trendMap.get(key) + 1);
    }

    // 按模块聚合
    const moduleMap = new Map<string, { count: number; success: number; duration: number }>();
    for (const log of logs) {
      const key = log.module || log.endpoint || 'unknown';
      const agg = moduleMap.get(key) || { count: 0, success: 0, duration: 0 };
      agg.count += 1;
      if (log.success) agg.success += 1;
      agg.duration += log.durationMs || 0;
      moduleMap.set(key, agg);
    }

    return {
      aiCalls: {
        total,
        success,
        failed: total - success,
        successRate: total ? round((success / total) * 100) : 100,
        avgDurationMs: total ? Math.round(durations.reduce((a, b) => a + b, 0) / total) : 0,
        maxDurationMs: total ? Math.max(...durations) : 0,
        minDurationMs: total ? Math.min(...durations) : 0,
        totalTokens,
      },
      // AI 效果评测（轻量）：用户点赞/点踩的赞同率，配合调用量看"用得多不多、好不好用"
      aiFeedback: (() => {
        const pos = feedbacks.filter((f) => f.rating === 'positive').length;
        const neg = feedbacks.length - pos;
        return {
          total: feedbacks.length,
          positive: pos,
          negative: neg,
          approvalRate: feedbacks.length ? round((pos / feedbacks.length) * 100) : null,
        };
      })(),
      entityCounts: { customers, requirements, proposals, quotations },
      trend: [...trendMap.entries()].map(([date, calls]) => ({ date, calls })),
      byModule: [...moduleMap.entries()]
        .map(([module, agg]) => ({
          module,
          count: agg.count,
          successRate: round((agg.success / agg.count) * 100),
          avgDuration: Math.round(agg.duration / agg.count),
        }))
        .sort((a, b) => b.count - a.count),
      auditLogs,
      knowledgeHealth: {
        total: documents.length,
        parsed: documents.filter((document) => Boolean(document.parsedText?.trim())).length,
        pending: documents.filter((document) => !document.parsedText?.trim()).length,
        usable: documents.filter((document) => document.status === 'approved').length,
        disabled: documents.filter((document) => document.status === 'rejected').length,
      },
    };
  }

  /**
   * 导出 Excel。
   * - 不传 type：全量备份（每个模块一个 sheet）；
   * - 传 type：只导出该模块，并支持 keyword/status 过滤（与列表页当前筛选一致，
   *   导出的列与导入模板一致，改完可直接回灌）。
   */
  async exportExcel(type?: string, keyword?: string, status?: string): Promise<Buffer> {
    const kw = keyword?.trim().toLowerCase() || '';
    const matchKw = (...fields: any[]) =>
      !kw || fields.some((f) => f != null && String(f).toLowerCase().includes(kw));
    const matchStatus = (s: any) => !status || s === status;

    const customerNameMap = new Map<string, string>();
    const loadCustomerNames = async () => {
      if (customerNameMap.size) return;
      const cs = await this.customerRepository.find();
      cs.forEach((c) => customerNameMap.set(c.id, c.name));
    };

    const builders: Record<string, () => Promise<{ name: string; rows: any[] }>> = {
      customer: async () => ({
        name: '客户',
        rows: (await this.customerRepository.find())
          .filter((c) => matchKw(c.name, c.code, c.customerCode, c.industry, c.region) && matchStatus(c.status))
          // 列与客户中心列表一致：编号/名称/简称/类型/行业/等级/业务状态/区域/负责人
          .map((c) => ({
            ID: c.id,
            客户编号: c.customerCode,
            客户名称: c.name,
            简称: c.code,
            客户类型: c.customerType,
            行业: c.industry,
            等级: c.level,
            业务状态: c.businessStatus,
            区域: c.region,
            国家: (c as any).country,
            负责人: c.salesPerson,
            地址: c.address,
            网址: c.website,
            备注: c.description,
            审批状态: c.status,
            创建时间: c.createdAt,
          })),
      }),
      requirement: async () => {
        await loadCustomerNames();
        return {
          name: '需求',
          rows: (await this.requirementRepository.find({ where: { isCurrent: true } }))
            .filter((r) => matchKw(r.title, r.requirementNo, r.description) && matchStatus(r.status))
            .map((r) => ({
              ID: r.id,
              编号: r.requirementNo,
              项目名称: r.title,
              客户名称: r.customerId ? customerNameMap.get(r.customerId) || '' : '',
              需求类型: r.requirementType,
              需求来源: r.category,
              产品类型: r.templateCategory,
              优先级: r.priority,
              状态: r.status,
              联系人: r.contactName,
              联系电话: r.contactPhone,
              邮箱: r.contactEmail,
              需求描述: r.description,
              创建时间: r.createdAt,
            })),
        };
      },
      proposal: async () => ({
        name: '方案',
        rows: (await this.proposalRepository.find())
          .filter((p) => matchKw(p.title, p.proposalNo) && matchStatus(p.status))
          .map((p) => ({
            ID: p.id,
            编号: p.proposalNo,
            标题: p.title,
            类型: p.proposalType,
            状态: p.status,
            创建时间: p.createdAt,
          })),
      }),
      quotation: async () => ({
        name: '报价',
        rows: (await this.quotationRepository.find())
          .filter((q) => matchKw(q.quotationNo) && matchStatus(q.status))
          .map((q) => ({
            ID: q.id,
            编号: q.quotationNo,
            金额: q.amount,
            状态: q.status,
            创建时间: q.createdAt,
          })),
      }),
      contract: async () => ({
        name: '合同',
        rows: (await this.contractRepository.find())
          .filter((c) => matchKw(c.title, c.contractNo) && matchStatus(c.status))
          .map((c) => ({
            ID: c.id,
            编号: c.contractNo,
            标题: c.title,
            金额: c.amount,
            状态: c.status,
            创建时间: c.createdAt,
          })),
      }),
      project: async () => ({
        name: '项目',
        rows: (await this.projectRepository.find())
          .filter((p) => matchKw(p.name, p.projectNo) && matchStatus(p.status))
          .map((p) => ({
            ID: p.id,
            编号: p.projectNo,
            名称: p.name,
            状态: p.status,
            开始: p.startDate,
            结束: p.endDate,
          })),
      }),
      product: async () => ({
        name: '产品',
        rows: (await this.productRepository.find())
          .filter((p) => matchKw(p.name, p.code, p.category) && matchStatus(p.status))
          .map((p) => ({ ID: p.id, 名称: p.name, 编码: p.code, 分类: p.category, 价格: p.price })),
      }),
      supplier: async () => ({
        name: '供应商',
        rows: (await this.supplierRepository.find())
          .filter((s) => matchKw(s.name, s.code, s.contactName) && matchStatus(s.status))
          .map((s) => ({
            ID: s.id,
            名称: s.name,
            编码: s.code,
            联系人: s.contactName,
            电话: s.phone,
          })),
      }),
      document: async () => ({
        name: '文档',
        rows: (await this.documentRepository.find())
          .filter((d) => matchKw(d.title, d.fileName) && matchStatus(d.status))
          .map((d) => ({
            ID: d.id,
            标题: d.title,
            文件名: d.fileName,
            状态: d.status,
            可见性: d.visibility,
            上传时间: d.createdAt,
          })),
      }),
      /*
       * 应收台账（财务对接轻量版）：合同 × 回款节点汇总。
       * 财务可以直接拿这张表对账——合同金额、已建节点应收、实收、未收、进度。
       */
      receivables: async () => {
        const [contracts, payments, customers] = await Promise.all([
          this.contractRepository.find(),
          this.contractRepository.manager.getRepository(ContractPayment).find(),
          this.customerRepository.find(),
        ]);
        const customerName = new Map(customers.map((c) => [c.id, c.name]));
        const byContract = new Map<string, ContractPayment[]>();
        for (const p of payments) {
          if (!byContract.has(p.contractId)) byContract.set(p.contractId, []);
          byContract.get(p.contractId)!.push(p);
        }
        const round2 = (n: any) => Math.round(Number(n || 0) * 100) / 100;
        return {
          name: '应收台账',
          rows: contracts.map((c) => {
            const pays = byContract.get(c.id) || [];
            const due = round2(pays.reduce((s, p) => s + Number(p.dueAmount || 0), 0));
            const recv = round2(pays.reduce((s, p) => s + Number(p.receivedAmount || 0), 0));
            return {
              ID: c.id,
              合同编号: c.contractNo,
              客户: c.customerId ? customerName.get(c.customerId) || '' : '',
              合同金额: round2(c.amount),
              状态: c.status,
              节点数: pays.length,
              应收合计: due,
              已收合计: recv,
              未收: round2(Math.max(due - recv, 0)),
              回款进度: due > 0 ? `${Math.round((recv / due) * 100)}%` : '-',
            };
          }),
        };
      },
    };

    const keys = type ? [type] : Object.keys(builders);
    if (type && !builders[type]) {
      throw new BadRequestException(
        `不支持的导出类型「${type}」，可用：${Object.keys(builders).join(' / ')}`,
      );
    }
    const wb = XLSX.utils.book_new();
    for (const key of keys) {
      const { name, rows } = await builders[key]();
      const ws = XLSX.utils.json_to_sheet(rows);
      XLSX.utils.book_append_sheet(wb, ws, name);
    }

    return XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' });
  }

  /**
   * 通用 Excel / CSV 导入。
   *
   * 表头用中文（与导出模板一致，业务人员直接改导出文件即可回灌），
   * 逐行写入并单独收集失败行 —— 一行报错不应该让整批回滚，
   * 否则 200 行里错 1 行就得全部重来。
   */
  async importExcel(
    type: string,
    buffer: Buffer,
  ): Promise<{ type: string; total: number; imported: number; errors: Array<{ row: number; message: string }> }> {
    // 导入的客户区域按字典归并（华东 → 华东区、俄罗斯 → 海外 + 国家），不再把写法拆碎
    const regionDict = await loadRegionDict(this.dataSource.manager);
    const IMPORTERS: Record<
      string,
      { repo: Repository<any>; map: (row: any) => any | Promise<any>; required: string[] }
    > = {
      customer: {
        repo: this.customerRepository,
        required: ['name'],
        // 列与导出模板一致：客户编号不填则自动生成，等级兼容「A（战略客户）」写法
        map: async (r) => ({
          name: r['客户名称'] ?? r['名称'] ?? r['name'],
          code: r['简称'] ?? r['编码'] ?? r['code'],
          customerCode:
            String(r['客户编号'] ?? '').trim() || (await this.numbering.next('customer')),
          customerType: r['客户类型'] ?? r['customerType'],
          industry: r['行业'] ?? r['industry'],
          level: this.normalizeCustomerLevel(r['等级'] ?? r['level']),
          businessStatus: String(r['业务状态'] ?? '').trim() || null,
          region: normalizeRegion(r['区域'] ?? r['region'], regionDict, r['地址'] ?? r['address']).region,
          country:
            r['国家'] ?? r['country'] ?? normalizeRegion(r['区域'] ?? r['region'], regionDict, r['地址'] ?? r['address']).country,
          salesPerson: r['负责人'] ?? r['salesPerson'],
          scale: r['规模'] ?? r['scale'],
          address: r['地址'] ?? r['address'],
          website: r['网址'] ?? r['website'],
          description: r['备注'] ?? r['description'],
          status: r['审批状态'] ?? r['状态'] ?? r['status'] ?? 'pending',
        }),
      },
      product: {
        repo: this.productRepository,
        required: ['name'],
        map: (r) => ({
          name: r['名称'] ?? r['产品名称'] ?? r['name'],
          code: r['编码'] ?? r['code'],
          category: r['分类'] ?? r['category'],
          price: this.toNumber(r['价格'] ?? r['参考价'] ?? r['price']),
          unit: r['单位'] ?? r['unit'],
          description: r['描述'] ?? r['description'],
          status: r['状态'] ?? r['status'] ?? 'approved',
        }),
      },
      supplier: {
        repo: this.supplierRepository,
        required: ['name'],
        map: (r) => ({
          name: r['名称'] ?? r['供应商名称'] ?? r['name'],
          code: r['编码'] ?? r['code'],
          contactName: r['联系人'] ?? r['contactName'],
          phone: r['电话'] ?? r['phone'],
          email: r['邮箱'] ?? r['email'],
          address: r['地址'] ?? r['address'],
          origin: this.normalizeOrigin(r['来源'] ?? r['国内外'] ?? r['origin']),
          country: r['国家'] ?? r['country'],
          tier: this.normalizeTier(r['层级'] ?? r['品牌层级'] ?? r['tier']),
          productCategories: this.toArray(r['主营品类'] ?? r['产品类别'] ?? r['productCategories']),
          rating: r['评级'] ?? r['rating'] ?? 'b',
          description: r['备注'] ?? r['description'],
          status: r['状态'] ?? r['status'] ?? 'approved',
        }),
      },
      requirement: {
        repo: this.requirementRepository,
        required: ['title'],
        // 需求导入：编号自动生成；客户按名称匹配（找不到先留空，列表会标「未关联」提醒补选）
        map: async (r) => {
          const customerName = r['客户名称'] ?? r['客户'] ?? r['customer'];
          let customerId: string | null = null;
          if (customerName) {
            const customer = await this.customerRepository.findOne({
              where: { name: String(customerName).trim() },
            });
            customerId = customer?.id ?? null;
          }
          return {
            requirementNo: await this.numbering.next('requirement'),
            title: r['项目名称'] ?? r['标题'] ?? r['title'],
            customerId,
            requirementType: r['需求类型'] ?? r['requirementType'],
            category: r['需求来源'] ?? r['category'],
            templateCategory: r['产品类型'] ?? r['templateCategory'],
            contactName: r['联系人'] ?? r['contactName'],
            contactPhone: r['联系电话'] ?? r['contactPhone'],
            contactEmail: r['邮箱'] ?? r['contactEmail'],
            description: r['需求描述'] ?? r['描述'] ?? r['description'],
            priority: this.normalizePriority(r['优先级'] ?? r['priority']),
            // 个人端无审批环节，导入的需求默认直接可用（与单机模式新建一致）
            status: this.normalizeRequirementStatus(r['状态'] ?? r['status']),
            visibility: 'public',
          };
        },
      },
    };

    const importer = IMPORTERS[type];
    if (!importer) {
      throw new BadRequestException(
        `不支持的导入类型「${type}」，可用：${Object.keys(IMPORTERS).join(' / ')}`,
      );
    }

    let rows: any[];
    try {
      const wb = XLSX.read(buffer, { type: 'buffer' });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      rows = XLSX.utils.sheet_to_json(sheet, { defval: null });
    } catch {
      throw new BadRequestException('文件解析失败，请确认是有效的 xlsx / csv 文件');
    }

    const errors: Array<{ row: number; message: string }> = [];
    let imported = 0;

    for (let i = 0; i < rows.length; i++) {
      // +2：Excel 第 1 行是表头，行号从 1 开始
      const rowNo = i + 2;
      try {
        const payload = await importer.map(rows[i]);
        const missing = importer.required.filter((k) => !payload[k]);
        if (missing.length) {
          errors.push({ row: rowNo, message: `缺少必填项：${missing.join('、')}` });
          continue;
        }
        await importer.repo.save(importer.repo.create(payload));
        imported += 1;
      } catch (err: any) {
        errors.push({ row: rowNo, message: err?.message || '写入失败' });
      }
    }

    return { type, total: rows.length, imported, errors };
  }

  private toNumber(v: any): number | null {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(String(v).replace(/[,¥$\s]/g, ''));
    return Number.isFinite(n) ? n : null;
  }

  private toArray(v: any): string[] | null {
    if (!v) return null;
    return String(v)
      .split(/[,，、/|]/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  private normalizeOrigin(v: any): string | null {
    if (!v) return null;
    const s = String(v).trim();
    if (/国内|domestic|中国/i.test(s)) return 'domestic';
    if (/国外|海外|进口|overseas|import/i.test(s)) return 'overseas';
    return null;
  }

  private normalizeTier(v: any): string | null {
    if (!v) return null;
    const s = String(v).trim();
    if (/一线|tier ?1|一级/i.test(s)) return 'tier1';
    if (/二线|tier ?2|二级/i.test(s)) return 'tier2';
    if (/三线|其他|tier ?3/i.test(s)) return 'tier3';
    return null;
  }

  /** 客户等级：取首字母 A-D，兼容「A（战略客户）」这类完整写法 */
  private normalizeCustomerLevel(v: any): string | null {
    if (!v) return null;
    const m = String(v).trim().match(/^[ABCDabcd]/);
    return m ? m[0].toUpperCase() : null;
  }

  /** 优先级：中文/英文都能回灌，未知值落 medium */
  private normalizePriority(v: any): string {
    if (!v) return 'medium';
    const s = String(v).trim();
    if (/紧急|urgent/i.test(s)) return 'urgent';
    if (/^高$|high/i.test(s)) return 'high';
    if (/^低$|low/i.test(s)) return 'low';
    if (/^中$|medium/i.test(s)) return 'medium';
    return 'medium';
  }

  /** 需求商机状态：中文/状态码都能回灌，未知值落 approved（个人端无需审批） */
  private normalizeRequirementStatus(v: any): string {
    if (!v) return 'approved';
    const s = String(v).trim();
    if (/草稿|pending/.test(s)) return 'pending';
    if (/识别中|analyzing/.test(s)) return 'analyzing';
    if (/已识别|analyzed/.test(s)) return 'analyzed';
    if (/已确认|approved|ready|structured/.test(s)) return 'approved';
    if (/已报价|quoted/.test(s)) return 'quoted';
    if (/已成交|won/.test(s)) return 'won';
    if (/已失单|已流失|lost/.test(s)) return 'lost';
    return 'approved';
  }
}
