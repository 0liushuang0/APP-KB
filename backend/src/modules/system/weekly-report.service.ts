import { Injectable, Logger, NotFoundException, ForbiddenException, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { WeeklyReport } from './weekly-report.entity';
import { SystemService } from './system.service';
import { NotificationsService } from '../notifications/notifications.service';
import { JobLockService } from '../../common/services/job-lock.service';
import { CurrentUser, PermissionService } from '../../common/services/permission.service';
import { toCny } from '../../common/utils/currency.util';
import { CycleMetrics } from './cycle-metrics';

const DAY = 86_400_000;

/** 上一个自然周（周一 0 点 ~ 下周一 0 点，服务器本地时区）与它的 ISO 周号；due = 本周一 8:30 */
export function reportWeek(now: Date): { from: Date; to: Date; key: string; due: Date } {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  const dow = (d.getDay() + 6) % 7; // 周一 = 0
  const thisMonday = new Date(d);
  thisMonday.setDate(d.getDate() - dow);
  const from = new Date(thisMonday);
  from.setDate(thisMonday.getDate() - 7);
  const due = new Date(thisMonday);
  due.setHours(8, 30, 0, 0);
  return { from, to: thisMonday, key: isoWeekKey(from), due };
}

/** 本周一 0 点到现在（「预览本周」用） */
export function currentWeek(now: Date): { from: Date; to: Date; key: string } {
  const w = reportWeek(now);
  return { from: w.to, to: now, key: isoWeekKey(w.to) };
}

export function isoWeekKey(date: Date): string {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / DAY + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

const md = (d: Date) => `${d.getMonth() + 1}/${d.getDate()}`;
const wan = (n: number) => (Math.abs(n) >= 10000 ? `¥${(n / 10000).toFixed(n >= 1e6 ? 0 : 1)}万` : `¥${Math.round(n).toLocaleString('zh-CN')}`);

export interface WeeklyItem { id: string; no?: string; title?: string; customer?: string; amountCny?: number; at?: string }
export interface WeeklyReportContent {
  weekKey: string;
  from: string;
  to: string;
  scope: 'personal' | 'company';
  owner?: { id: string; name: string };
  activity: {
    requirements: { count: number; items: WeeklyItem[] };
    quotations: { count: number; amountCny: number; items: WeeklyItem[] };
    contracts: { count: number; amountCny: number; items: WeeklyItem[] };
    payments: { count: number; amountCny: number };
    followUps: number;
    tasksDone: number;
  };
  todos: Record<string, number>;
  automation: Array<{ kind: string; label: string; count: number }>;
  metrics: CycleMetrics;
  byOwner?: Array<{ name: string; requirements: number; quotations: number; quoteAmountCny: number; contracts: number; dealAmountCny: number }>;
  highlights: string[];
  preview?: boolean;
}

/** 可以看全公司周报的角色 */
const COMPANY_ROLES = ['admin', 'manager', 'sales_lead'];

/**
 * 周报自动生成与推送。
 *
 * 每周一 8:30 起（服务器停过就在本周内补发）给每个人生成上周个人周报：本人负责的新需求、报价、签约、回款、
 * 沟通与完成的任务，加上当下的待办（跟进超期、回款到期、报价超 14 天未签约…）和业务结果指标；
 * 管理者另收一份全公司周报（含按负责人拆分）。推送渠道目前是站内通知（企业微信按要求暂缓），点通知直达周报页。
 * 上周什么都没有、手上也没有待办的人不发，免得刷屏。
 *
 * 多台服务器：经任务锁全集群只生成一次；本周是否已发记在 job_locks.lastResult（周号）。
 * 首次上线不补发上一周（那一周的数据多为补录），从下一个周一开始自动推送；周报页可随时「预览本周」。
 * weekly_report_enabled=false 可关闭。
 */
@Injectable()
export class WeeklyReportService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(WeeklyReportService.name);
  private timers: NodeJS.Timeout[] = [];
  static readonly JOB = 'weekly-report';

  constructor(
    @InjectRepository(WeeklyReport) private readonly reports: Repository<WeeklyReport>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly system: SystemService,
    private readonly notifications: NotificationsService,
    private readonly jobLock: JobLockService,
    private readonly permissions: PermissionService,
  ) {}

  onApplicationBootstrap(): void {
    if (process.env.NODE_ENV === 'test' || process.env.WEEKLY_REPORT === 'false') return;
    const tick = () => void this.tick().catch((e) => this.logger.warn(`周报调度失败：${e?.message}`));
    const first = setTimeout(tick, 90_000);
    const every = setInterval(tick, 30 * 60_000);
    first.unref?.();
    every.unref?.();
    this.timers.push(first, every);
  }

  onModuleDestroy(): void {
    this.timers.forEach((t) => clearTimeout(t));
  }

  private async enabled(): Promise<boolean> {
    const row = await this.dataSource
      .createQueryBuilder()
      .select('c.value', 'value')
      .from('system_configs', 'c')
      .where('c.key = :k', { k: 'weekly_report_enabled' })
      .getRawOne<{ value: string }>();
    return String(row?.value ?? 'true').trim().toLowerCase() !== 'false';
  }

  /** 定时检查：到了本周一 8:30、上一周还没发 → 抢锁生成并推送 */
  async tick(now = new Date()): Promise<{ sent: number; weekKey: string } | null> {
    const week = reportWeek(now);
    if (now.getTime() < week.due.getTime()) return null;
    if (!(await this.enabled())) return null;
    const state = await this.jobLock.getState(WeeklyReportService.JOB);
    if (state?.lastResult === week.key) return null;
    const r = await this.jobLock.runExclusive(
      WeeklyReportService.JOB,
      async () => {
        // 抢到锁后再读一次：另一台可能刚发完
        const s = await this.jobLock.getState(WeeklyReportService.JOB);
        if (s?.lastResult === week.key) return { sent: 0, weekKey: week.key };
        if (!s?.lastResult) {
          // 首次上线：不补发上一周，从下一个周一开始
          await this.jobLock.setResult(WeeklyReportService.JOB, week.key);
          this.logger.log(`周报首次启用：${week.key} 不补发，下周一 8:30 起自动推送`);
          return { sent: 0, weekKey: week.key };
        }
        const sent = await this.generate(week, { notify: true });
        await this.jobLock.setResult(WeeklyReportService.JOB, week.key);
        return { sent, weekKey: week.key };
      },
      { ttlMs: 30 * 60_000 },
    );
    return r.ran ? r.result ?? null : null;
  }

  /** 收件人：单机版只有管理员；团队版是全部启用的账号 */
  private async recipients(): Promise<Array<{ id: string; name: string; company: boolean }>> {
    const users: any[] = await this.dataSource.getRepository('User').find({ where: { isActive: true } as any });
    const single = this.permissions.isSingleMode();
    return users
      .filter((u) => !single || u.isSystemAdmin)
      .map((u) => ({
        id: String(u.id),
        name: u.nickname || u.username,
        company: !!u.isSystemAdmin || (u.roles || []).some((r: any) => COMPANY_ROLES.includes(r.code)),
      }));
  }

  /**
   * 生成一周的周报。notify=true 时推送站内通知。返回发出的份数。
   * 同一周重复生成会替换旧的（手动重算不重复堆积）。
   */
  async generate(week: { from: Date; to: Date; key: string }, opts: { notify: boolean }): Promise<number> {
    const people = await this.recipients();
    let sent = 0;
    const [companyContent] = await Promise.all([this.build(week, null)]);
    const companyTitle = `第${week.key.slice(-2)}周全公司周报（${md(week.from)}–${md(new Date(week.to.getTime() - 1))}）`;
    await this.reports.delete({ weekKey: week.key });
    const company = await this.reports.save(
      this.reports.create({ weekKey: week.key, scope: 'company', recipientId: null as any, title: companyTitle, content: JSON.stringify(companyContent) }),
    );
    for (const p of people) {
      const content = await this.build(week, p, p.company);
      const empty =
        !content.activity.requirements.count && !content.activity.quotations.count && !content.activity.contracts.count &&
        !content.activity.payments.count && !content.activity.followUps && !content.activity.tasksDone &&
        !Object.values(content.todos).some((n) => Number(n) > 0);
      if (empty && !p.company) continue;
      const title = `第${week.key.slice(-2)}周周报（${md(week.from)}–${md(new Date(week.to.getTime() - 1))}）`;
      const saved = await this.reports.save(
        this.reports.create({ weekKey: week.key, scope: 'personal', recipientId: p.id, title, content: JSON.stringify(content) }),
      );
      if (opts.notify) {
        await this.notifications
          .create({
            type: 'report',
            title: `${title}已生成`,
            content: content.highlights.slice(0, 3).join('；'),
            recipientId: p.id,
            linkUrl: `/reports/weekly?id=${saved.id}`,
          })
          .catch(() => undefined);
        if (p.company) {
          await this.notifications
            .create({
              type: 'report',
              title: `${companyTitle}已生成`,
              content: companyContent.highlights.slice(0, 3).join('；'),
              recipientId: p.id,
              linkUrl: `/reports/weekly?id=${company.id}`,
            })
            .catch(() => undefined);
        }
      }
      sent++;
    }
    this.logger.log(`周报 ${week.key}：个人 ${sent} 份 + 全公司 1 份${opts.notify ? '，已推送通知' : ''}`);
    return sent;
  }

  /** 组装一份周报内容：owner 为空 = 全公司 */
  async build(
    week: { from: Date; to: Date; key: string },
    owner: { id: string; name: string } | null,
    /** 个人周报的人有审批权：待审批按全部算；否则只算自己提交的 */
    approver = true,
  ): Promise<WeeklyReportContent> {
    const m = this.dataSource.manager;
    const inWeek = (v: any) => {
      if (!v) return false;
      const t = new Date(v).getTime();
      return t >= week.from.getTime() && t < week.to.getTime();
    };
    const mine = (r: any, col = 'ownerId') => !owner || String(r[col] || '') === owner.id;
    const [customers, reqs, quotes, contracts, payments, followUps, tasks, users] = await Promise.all([
      m.query(`SELECT id, name, code FROM customers`),
      m.query(`SELECT id, "requirementNo", title, "customerId", "ownerId", "requirementDate", "createdAt", "isCurrent" FROM requirements`),
      m.query(`SELECT id, "quotationNo", amount, currency, "exchangeRate", "quotedAt", "createdAt", "ownerId", "customerId" FROM quotations`),
      m.query(`SELECT id, "contractNo", title, amount, currency, "exchangeRate", "signedDate", "ownerId", "customerId", status FROM contracts`),
      m.query(`SELECT p.id, p."contractId", p."receivedDate", p."receivedAmount", c.currency, c."exchangeRate", c."ownerId" FROM contract_payments p JOIN contracts c ON CAST(c.id AS TEXT) = p."contractId" WHERE p."receivedDate" IS NOT NULL`),
      m.query(`SELECT id, "createdBy", "followUpAt", "createdAt" FROM follow_up_records`),
      m.query(`SELECT id, "ownerId", status, "updatedAt" FROM work_tasks WHERE status = 'done'`),
      m.query(`SELECT id, nickname, username FROM users`),
    ]);
    const cust = new Map<string, string>(customers.map((c: any) => [String(c.id), c.code || c.name]));
    const userName = new Map<string, string>(users.map((u: any) => [String(u.id), u.nickname || u.username]));

    const weekReqs = reqs.filter((r: any) => r.isCurrent !== false && inWeek(r.requirementDate || r.createdAt) && mine(r));
    const weekQuotes = quotes.filter((q: any) => inWeek(q.quotedAt || q.createdAt) && mine(q));
    const weekDeals = contracts.filter((c: any) => c.signedDate && inWeek(c.signedDate) && mine(c) && c.status !== 'terminated');
    const weekPays = payments.filter((p: any) => inWeek(p.receivedDate) && mine(p));
    const cnyQ = (q: any) => toCny(q.amount, q.currency, q.exchangeRate);
    const quoteAmount = weekQuotes.reduce((s: number, q: any) => s + cnyQ(q), 0);
    const dealAmount = weekDeals.reduce((s: number, c: any) => s + cnyQ(c), 0);
    const payAmount = weekPays.reduce((s: number, p: any) => s + toCny(p.receivedAmount, p.currency, p.exchangeRate), 0);

    const activity = {
      requirements: {
        count: weekReqs.length,
        items: weekReqs.slice(0, 8).map((r: any) => ({ id: r.id, no: r.requirementNo, title: r.title, customer: cust.get(String(r.customerId)) })),
      },
      quotations: {
        count: weekQuotes.length,
        amountCny: Math.round(quoteAmount),
        items: weekQuotes.slice(0, 8).map((q: any) => ({ id: q.id, no: q.quotationNo, customer: cust.get(String(q.customerId)), amountCny: Math.round(cnyQ(q)) })),
      },
      contracts: {
        count: weekDeals.length,
        amountCny: Math.round(dealAmount),
        items: weekDeals.slice(0, 8).map((c: any) => ({ id: c.id, no: c.contractNo, title: c.title, customer: cust.get(String(c.customerId)), amountCny: Math.round(cnyQ(c)) })),
      },
      payments: { count: weekPays.length, amountCny: Math.round(payAmount) },
      followUps: followUps.filter((f: any) => inWeek(f.followUpAt || f.createdAt) && mine(f, 'createdBy')).length,
      tasksDone: tasks.filter((t: any) => inWeek(t.updatedAt) && mine(t)).length,
    };

    const [todos, automation, metrics] = await Promise.all([
      this.system.computeTodos(owner?.id, owner && !approver ? owner.id : undefined),
      this.system.automationBetween(week.from, week.to),
      this.system.getCycleMetrics(owner?.id, 180),
    ]);

    let byOwner: WeeklyReportContent['byOwner'];
    if (!owner) {
      const map = new Map<string, NonNullable<WeeklyReportContent['byOwner']>[number]>();
      const row = (id: any) => {
        const k = String(id || '');
        if (!map.has(k)) map.set(k, { name: userName.get(k) || '未指定负责人', requirements: 0, quotations: 0, quoteAmountCny: 0, contracts: 0, dealAmountCny: 0 });
        return map.get(k)!;
      };
      for (const r of weekReqs) row(r.ownerId).requirements++;
      for (const q of weekQuotes) {
        const x = row(q.ownerId);
        x.quotations++;
        x.quoteAmountCny += Math.round(cnyQ(q));
      }
      for (const c of weekDeals) {
        const x = row(c.ownerId);
        x.contracts++;
        x.dealAmountCny += Math.round(cnyQ(c));
      }
      byOwner = [...map.values()].sort((a, b) => b.dealAmountCny - a.dealAmountCny || b.quoteAmountCny - a.quoteAmountCny);
    }

    const highlights: string[] = [];
    highlights.push(
      `上周${owner ? '你' : '全公司'}新增需求 ${activity.requirements.count} 条、报价 ${activity.quotations.count} 份` +
        (activity.quotations.amountCny ? `（${wan(activity.quotations.amountCny)}）` : '') +
        `、签约 ${activity.contracts.count} 单` +
        (activity.contracts.amountCny ? `（${wan(activity.contracts.amountCny)}）` : '') +
        (activity.payments.amountCny ? `、回款 ${wan(activity.payments.amountCny)}` : ''),
    );
    const todoBits = [
      todos.followupsOverdue ? `跟进超期 ${todos.followupsOverdue} 条` : '',
      todos.paymentsDue ? `回款到期 ${todos.paymentsDue} 笔` : '',
      todos.quotesStale ? `报价超 14 天未签约 ${todos.quotesStale} 份` : '',
      todos.approvals ? `待审批 ${todos.approvals} 件` : '',
      todos.specsToConfirm ? `识别结果待确认 ${todos.specsToConfirm} 条` : '',
      todos.projectsRisk ? `项目需关注 ${todos.projectsRisk} 个` : '',
    ].filter(Boolean);
    if (todoBits.length) highlights.push(`本周要处理：${todoBits.join('、')}`);
    const qr = metrics.quoteResponse;
    if (qr.n) {
      highlights.push(
        `近 180 天报价响应中位数 ${qr.median} 天（${qr.n} 个样本，其中真实业务日期 ${qr.nReal} 个）` +
          (metrics.winRate.rate != null ? `，赢单率 ${metrics.winRate.rate}%` : ''),
      );
    }
    const auto = automation.reduce((s, a) => s + a.count, 0);
    if (auto) highlights.push(`系统上周自动完成 ${auto} 件事：${automation.slice(0, 3).map((a) => `${a.label} ${a.count}`).join('、')}`);

    return {
      weekKey: week.key,
      from: week.from.toISOString(),
      to: week.to.toISOString(),
      scope: owner ? 'personal' : 'company',
      owner: owner ? { id: owner.id, name: owner.name } : undefined,
      activity,
      todos,
      automation,
      metrics,
      byOwner,
      highlights,
    };
  }

  private canSeeCompany(user: CurrentUser): boolean {
    if (this.permissions.isSingleMode()) return true;
    return !!user?.isSystemAdmin || (user?.roles || []).some((r) => COMPANY_ROLES.includes(r));
  }

  /** 我的周报列表（个人 + 有权限时的全公司），新的在前 */
  async list(user: CurrentUser) {
    const qb = this.reports
      .createQueryBuilder('w')
      .select(['w.id', 'w.weekKey', 'w.scope', 'w.title', 'w.createdAt', 'w.recipientId'])
      .orderBy('w.weekKey', 'DESC')
      .addOrderBy('w.scope', 'ASC')
      .take(60);
    if (this.canSeeCompany(user)) qb.where('(w.recipientId = :me OR w.scope = :company)', { me: user?.userId, company: 'company' });
    else qb.where('w.recipientId = :me', { me: user?.userId });
    return qb.getMany();
  }

  async get(id: string, user: CurrentUser) {
    const r = await this.reports.findOne({ where: { id } });
    if (!r) throw new NotFoundException('周报不存在');
    const allowed = r.scope === 'company' ? this.canSeeCompany(user) : r.recipientId === user?.userId || !!user?.isSystemAdmin;
    if (!allowed) throw new ForbiddenException('无权查看该周报');
    return { ...r, content: JSON.parse(r.content) };
  }

  /** 预览本周至今（不保存、不推送）：scope=company 需要管理权限 */
  async preview(user: CurrentUser, scope: 'personal' | 'company') {
    const week = currentWeek(new Date());
    const company = scope === 'company' && this.canSeeCompany(user);
    const name = user?.username || '我';
    const content = await this.build(week, company ? null : { id: user?.userId, name }, this.canSeeCompany(user));
    return { title: `本周至今（${md(week.from)}–${md(week.to)}）${company ? '全公司' : ''}周报预览`, content: { ...content, preview: true } };
  }
}
