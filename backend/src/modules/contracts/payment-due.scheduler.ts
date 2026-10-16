import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, LessThanOrEqual, Repository } from 'typeorm';
import { Contract } from './entities/contract.entity';
import { ContractPayment } from './entities/contract-payment.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { AuditLog } from '../audit-logs/entities/audit-log.entity';
import { recordAutomation } from '../../common/utils/automation-log';
import { JobLockService } from '../../common/services/job-lock.service';
import { DuePaymentRow, SOON_DAYS, addDays, dateStr, planReminders, reminderMessage } from './payment-due';

/**
 * 回款到期提醒：每天早上 8 点后给合同负责人发站内通知（规则见 payment-due.ts）。
 *
 * 每 30 分钟检查一次，经任务锁保证全集群一天只跑一轮；同一回款节点同一阶段只提醒一次，
 * 发过的记在 audit_logs（action='auto'、objectType='payment_reminded'、objectId=节点id:阶段），
 * 同时计入「本周系统替你做了什么」。PAYMENT_DUE_REMINDER=false 可关闭。
 */
@Injectable()
export class PaymentDueScheduler implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(PaymentDueScheduler.name);
  private timers: NodeJS.Timeout[] = [];
  static readonly JOB = 'payment-due';
  /** 早于这个钟点不发（夜里重启不在半夜推通知） */
  static readonly SEND_HOUR = 8;

  constructor(
    @InjectRepository(ContractPayment) private readonly payments: Repository<ContractPayment>,
    @InjectRepository(Contract) private readonly contracts: Repository<Contract>,
    private readonly notifications: NotificationsService,
    private readonly jobLock: JobLockService,
  ) {}

  onApplicationBootstrap(): void {
    if (process.env.PAYMENT_DUE_REMINDER === 'false' || process.env.NODE_ENV === 'test') return;
    const tick = () => {
      if (new Date().getHours() < PaymentDueScheduler.SEND_HOUR) return;
      void this.jobLock
        .runExclusive(PaymentDueScheduler.JOB, () => this.runOnce(), { ttlMs: 10 * 60_000, minIntervalMs: 20 * 3_600_000 })
        .catch((e) => this.logger.warn(`回款到期提醒失败：${e?.message}`));
    };
    const first = setTimeout(tick, 2 * 60_000);
    const every = setInterval(tick, 30 * 60_000);
    first.unref?.();
    every.unref?.();
    this.timers.push(first, every);
  }

  onModuleDestroy(): void {
    this.timers.forEach((t) => clearTimeout(t));
  }

  /** 读出 7 天内到期或已逾期、还没收款的节点（合同已终止的不算） */
  async loadDue(today: string): Promise<DuePaymentRow[]> {
    const pays = await this.payments.find({
      // dueDate <= 今天+7（NULL 不满足比较，自然排除）
      where: { receivedDate: IsNull(), dueDate: LessThanOrEqual(addDays(today, SOON_DAYS) as any) },
    });
    if (!pays.length) return [];
    const contractIds = [...new Set(pays.map((p) => p.contractId))];
    const contracts = await this.contracts.find({
      select: ['id', 'contractNo', 'title', 'currency', 'ownerId', 'status'] as any,
      where: { id: In(contractIds) },
    });
    const byId = new Map(contracts.map((c) => [String(c.id), c]));
    const rows: DuePaymentRow[] = [];
    for (const p of pays) {
      const c = byId.get(String(p.contractId));
      const due = dateStr(p.dueDate);
      if (!c || !due || c.status === 'terminated') continue;
      rows.push({
        id: p.id,
        contractId: p.contractId,
        nodeName: p.nodeName,
        dueDate: due,
        dueAmount: Number(p.dueAmount || 0),
        contractNo: c.contractNo,
        contractTitle: c.title,
        currency: c.currency,
        ownerId: c.ownerId,
      });
    }
    return rows;
  }

  async runOnce(now = new Date()): Promise<{ candidates: number; sent: number; owners: number }> {
    const today = dateStr(now) as string;
    const rows = await this.loadDue(today);
    if (!rows.length) return { candidates: 0, sent: 0, owners: 0 };

    // 已提醒过的（节点id:阶段）
    const ids = rows.map((r) => r.id);
    const logged = await this.payments.manager
      .getRepository(AuditLog)
      .createQueryBuilder('a')
      .select('a.objectId', 'objectId')
      .where('a.action = :a AND a.objectType = :t', { a: 'auto', t: 'payment_reminded' })
      .andWhere('a.createdAt >= :from', { from: new Date(now.getTime() - 120 * 86_400_000) })
      .getRawMany<{ objectId: string }>();
    const idSet = new Set(ids);
    const sentKeys = new Set(logged.map((l) => l.objectId).filter((k) => k && idSet.has(k.split(':')[0])));

    const plan = planReminders(rows, today, sentKeys);
    let sent = 0;
    for (const [ownerId, items] of plan) {
      const { title, content } = reminderMessage(items);
      try {
        await this.notifications.create({ type: 'payment', title, content, recipientId: ownerId, linkUrl: '/contracts?focus=payment&owner=me' });
      } catch (e: any) {
        this.logger.warn(`回款提醒通知发送失败：${e?.message}`);
        continue; // 没发出去就不记，下一轮再发
      }
      for (const it of items) await recordAutomation(this.payments.manager, 'payment_reminded', 1, it.key);
      sent += items.length;
    }
    if (sent) this.logger.log(`回款到期提醒：${rows.length} 个待收节点，提醒 ${sent} 笔（${plan.size} 位负责人）`);
    return { candidates: rows.length, sent, owners: plan.size };
  }
}
