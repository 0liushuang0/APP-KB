import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThan, Repository } from 'typeorm';
import { ApprovalFlow } from '../approvals/entities/approval-flow.entity';
import { AiCallLog } from '../ai/entities/ai-call-log.entity';
import { ReindexService } from '../ai/reindex.service';
import { ProductCompletenessService } from '../products/product-completeness.service';
import { BackupService } from '../backup/backup.service';
import { CurrentUser } from '../../common/services/permission.service';

/**
 * 系统与数据健康总览（工作台「系统健康」面板）。
 *
 * 只汇总、不修改。每项给出 状态(ok/warn/bad) + 一句话 + 去处理的位置，
 * 让负责人不用懂技术也能看出「哪里需要人管一下」。阈值见 evaluate()，有单测锁定。
 */
export type Level = 'ok' | 'warn' | 'bad';

export interface HealthItem {
  key: 'index' | 'products' | 'approvals' | 'parse' | 'backup';
  label: string;
  level: Level;
  /** 主数值（百分比或数量） */
  value: string;
  /** 一句话说明 */
  detail: string;
  /** 去处理的页面 */
  path: string;
}

export interface HealthInputs {
  index: { expected: number; indexed: number; aiOnline: boolean; laggingLabels: string[] };
  products: { total: number; quoteReady: number };
  approvals: { pending: number; oldestDays: number | null };
  parse: { calls: number; ok: number };
  backup: {
    latestFullHours: number | null;
    latestDbHours: number | null;
    fullIntervalHours: number;
    historyDays: number;
    offsite: boolean;
  };
}

const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 100);

/** 纯函数：输入 → 五项健康结论 */
export function evaluate(i: HealthInputs): HealthItem[] {
  const items: HealthItem[] = [];

  const cov = pct(i.index.indexed, i.index.expected);
  items.push({
    key: 'index',
    label: 'AI 可检索覆盖',
    level: !i.index.aiOnline ? 'bad' : cov >= 90 ? 'ok' : cov >= 60 ? 'warn' : 'bad',
    value: i.index.aiOnline ? `${cov}%` : '离线',
    detail: !i.index.aiOnline
      ? 'AI 服务未连接，问答与检索不可用'
      : cov >= 90
        ? `${i.index.indexed}/${i.index.expected} 份资料与数据可被问答找到`
        : `仍有 ${i.index.expected - i.index.indexed} 项未入索引${i.index.laggingLabels.length ? `（${i.index.laggingLabels.slice(0, 3).join('、')}）` : ''}，系统会自动补建`,
    path: '/settings/ai',
  });

  const ready = pct(i.products.quoteReady, i.products.total);
  items.push({
    key: 'products',
    label: '产品报价就绪',
    level: i.products.total === 0 ? 'warn' : ready >= 80 ? 'ok' : ready >= 30 ? 'warn' : 'bad',
    value: `${i.products.quoteReady}/${i.products.total}`,
    detail: i.products.total === 0 ? '还没有产品' : `型号价格表与规格参数齐全的产品占 ${ready}%`,
    path: '/products',
  });

  items.push({
    key: 'approvals',
    label: '待审批',
    level: i.approvals.pending <= 20 ? 'ok' : i.approvals.pending <= 100 ? 'warn' : 'bad',
    value: String(i.approvals.pending),
    detail:
      i.approvals.pending === 0
        ? '没有积压'
        : `最早一条已等待 ${i.approvals.oldestDays ?? 0} 天`,
    path: '/approvals',
  });

  const parseRate = pct(i.parse.ok, i.parse.calls);
  items.push({
    key: 'parse',
    label: '文档解析成功率',
    level: i.parse.calls === 0 ? 'ok' : parseRate >= 95 ? 'ok' : parseRate >= 80 ? 'warn' : 'bad',
    value: i.parse.calls === 0 ? '—' : `${parseRate}%`,
    detail: i.parse.calls === 0 ? '近 7 天没有新上传需要解析' : `近 7 天解析 ${i.parse.calls} 次，失败 ${i.parse.calls - i.parse.ok} 次`,
    path: '/documents',
  });

  const b = i.backup;
  const fullLate = b.latestFullHours === null || b.latestFullHours > b.fullIntervalHours * 2;
  const dbLate = b.latestDbHours !== null && b.latestDbHours > 3;
  items.push({
    key: 'backup',
    label: '数据备份',
    level: fullLate ? 'bad' : dbLate || !b.offsite ? 'warn' : 'ok',
    value: b.latestFullHours === null ? '无' : `${Math.round(b.latestFullHours)} 小时前`,
    detail: fullLate
      ? '全量备份已过期或从未成功，请检查'
      : `可回溯 ${b.historyDays} 天${b.offsite ? '' : '；备份与数据在同一块盘，建议配置异地目录'}`,
    path: '/settings/backup',
  });
  return items;
}

@Injectable()
export class OpsHealthService {
  constructor(
    private readonly reindex: ReindexService,
    private readonly completeness: ProductCompletenessService,
    private readonly backups: BackupService,
    @InjectRepository(ApprovalFlow) private readonly flows: Repository<ApprovalFlow>,
    @InjectRepository(AiCallLog) private readonly calls: Repository<AiCallLog>,
  ) {}

  async overview(user: CurrentUser): Promise<{ items: HealthItem[]; at: string }> {
    const now = Date.now();
    const [health, report, pending, oldest, parseCalls] = await Promise.all([
      this.reindex.getHealth().catch(() => null),
      this.completeness.report(user).catch(() => ({ total: 0, quoteReady: 0 }) as any),
      this.flows.count({ where: { status: 'pending' } }),
      this.flows.findOne({ where: { status: 'pending' }, order: { createdAt: 'ASC' } as any }),
      this.calls.find({
        where: { endpoint: '/embeddings/parse', createdAt: MoreThan(new Date(now - 7 * 86_400_000)) } as any,
        select: ['id', 'success'] as any,
      }),
    ]);

    const rows = health?.rows || [];
    const counted = rows.filter((r) => r.expected > 0 && r.indexed !== null);
    const expected = counted.reduce((s, r) => s + r.expected, 0);
    const indexed = counted.reduce((s, r) => s + Math.min(r.indexed as number, r.expected), 0);
    const lagging = counted.filter((r) => (r.indexed as number) < r.expected).map((r) => r.label);

    const list = this.backups.list();
    const full = list.filter((x) => x.fileName.startsWith('backup-') && !x.fileName.startsWith('backup-db-'));
    const db = list.filter((x) => x.fileName.startsWith('backup-db-'));
    const hoursAgo = (d?: Date) => (d ? (now - d.getTime()) / 3_600_000 : null);
    const oldestFull = full.length ? full[full.length - 1].createdAt : null;

    const items = evaluate({
      index: { expected, indexed, aiOnline: !!health?.aiOnline, laggingLabels: lagging },
      products: { total: report.total, quoteReady: report.quoteReady },
      approvals: {
        pending,
        oldestDays: oldest ? Math.floor((now - new Date((oldest as any).createdAt).getTime()) / 86_400_000) : null,
      },
      parse: { calls: parseCalls.length, ok: parseCalls.filter((c: any) => c.success).length },
      backup: {
        latestFullHours: hoursAgo(full[0]?.createdAt),
        latestDbHours: hoursAgo(db[0]?.createdAt),
        fullIntervalHours: Math.max(1, parseInt(process.env.AUTO_BACKUP_INTERVAL_HOURS ?? '6', 10) || 6),
        historyDays: oldestFull ? Math.max(0, Math.round((now - oldestFull.getTime()) / 86_400_000)) : 0,
        offsite: !!process.env.BACKUP_OFFSITE_DIR,
      },
    });
    return { items, at: new Date(now).toISOString() };
  }
}
