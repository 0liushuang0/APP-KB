import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, EntityManager, DataSource } from 'typeorm';
import { ApprovalFlow } from './entities/approval-flow.entity';
import { CreateApprovalDto, QueryApprovalDto } from './dto/approval.dto';
import { NotificationsService } from '../notifications/notifications.service';

/** 审批对象类型 → 中文标签（用于通知标题） */
const OBJECT_LABELS: Record<string, string> = {
  customer: '客户', requirement: '需求', proposal: '方案', quotation: '报价',
  contract: '合同', project: '项目', product: '产品', supplier: '供应商', document: '文档',
};

/**
 * 审批对象类型 → 业务表名。
 * 审批中心必须把结果回写到业务单据：只改审批记录的话，
 * 业务页面永远停在"待审"，形成两套互相矛盾的状态。
 * 这里用表名直更而不是注入各业务 Service —— approvals 被
 * quotation/contract/project 等模块引用，反向注入会循环依赖。
 */
const OBJECT_TABLES: Record<string, string> = {
  customer: 'customers', requirement: 'requirements', proposal: 'proposals',
  quotation: 'quotations', contract: 'contracts', project: 'projects',
  product: 'products', supplier: 'suppliers', document: 'documents',
};

/** 各类型对象的标题列（审批中心要显示「审的是什么」，而不是一串 id） */
const OBJECT_TITLE_COLUMNS: Record<string, string> = {
  customer: 'name', requirement: 'title', proposal: 'title', quotation: '"quotationNo"',
  contract: 'title', project: 'name', product: 'name', supplier: 'name', document: 'title',
};

export type ApprovalListRow = ApprovalFlow & { objectTitle?: string | null; objectCategory?: string | null };

@Injectable()
export class ApprovalsService {
  /**
   * 审批通过后的回调（按对象类型注册）。
   * 例如资料通过后要建 AI 索引 —— 资料模块依赖本模块，反向注入会循环依赖，所以由资料模块在启动时登记回调。
   */
  private readonly approvedListeners = new Map<string, Array<(objectId: string, reviewedBy?: string) => Promise<unknown>>>();

  onApproved(objectType: string, listener: (objectId: string, reviewedBy?: string) => Promise<unknown>): void {
    const list = this.approvedListeners.get(objectType) || [];
    list.push(listener);
    this.approvedListeners.set(objectType, list);
  }

  private fireApproved(objectType: string, objectId: string, reviewedBy?: string): void {
    for (const fn of this.approvedListeners.get(objectType) || []) {
      fn(objectId, reviewedBy).catch(() => undefined); // 后续动作失败不影响审批结果
    }
  }

  constructor(
    @InjectRepository(ApprovalFlow)
    private approvalRepository: Repository<ApprovalFlow>,
    private notificationsService: NotificationsService,
    private dataSource: DataSource,
  ) {}

  async findAll(query: QueryApprovalDto): Promise<ApprovalListRow[]> {
    const where: any = {};
    if (query.objectType) where.objectType = query.objectType;
    if (query.status) where.status = query.status;
    const rows = await this.approvalRepository.find({
      where,
      order: { createdAt: 'DESC' },
    });
    return this.withTitles(rows);
  }

  /** 按类型批量补上对象标题与分类（每类一条 IN 查询） */
  private async withTitles(rows: ApprovalFlow[]): Promise<ApprovalListRow[]> {
    const byType = new Map<string, string[]>();
    for (const r of rows) {
      if (!OBJECT_TABLES[r.objectType]) continue;
      byType.set(r.objectType, [...(byType.get(r.objectType) || []), r.objectId]);
    }
    const titles = new Map<string, { title: string | null; category: string | null }>();
    for (const [type, ids] of byType) {
      const col = OBJECT_TITLE_COLUMNS[type] || 'id';
      const catCol = type === 'document' ? ', "category"' : '';
      for (let i = 0; i < ids.length; i += 500) {
        const chunk = ids.slice(i, i + 500);
        const ph = chunk.map((_, k) => `$${k + 1}`).join(', ');
        try {
          const found: any[] = await this.dataSource.query(
            `SELECT "id", ${col} AS "title"${catCol} FROM "${OBJECT_TABLES[type]}" WHERE "id" IN (${ph})`,
            chunk,
          );
          for (const f of found) titles.set(`${type}:${f.id}`, { title: f.title ?? null, category: f.category ?? null });
        } catch {
          /* 标题只是辅助信息，查不到不影响审批 */
        }
      }
    }
    return rows.map((r) => {
      const t = titles.get(`${r.objectType}:${r.objectId}`);
      return Object.assign(r, { objectTitle: t?.title ?? null, objectCategory: t?.category ?? null });
    });
  }

  async findByObject(objectType: string, objectId: string): Promise<ApprovalFlow> {
    return this.approvalRepository.findOne({
      where: { objectType, objectId },
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * 创建审批流。
   *
   * 可选传入 EntityManager：业务对象与其审批流要么一起落库、要么一起回滚，
   * 否则会出现"报价存在但没有审批记录"这类卡住流程的脏数据。
   */
  async create(dto: CreateApprovalDto, manager?: EntityManager): Promise<ApprovalFlow> {
    const repo = manager ? manager.getRepository(ApprovalFlow) : this.approvalRepository;
    return repo.save(repo.create(dto));
  }

  async approve(
    objectType: string,
    objectId: string,
    reviewedBy?: string,
    comment?: string,
    manager?: EntityManager,
  ): Promise<ApprovalFlow> {
    const repo = manager ? manager.getRepository(ApprovalFlow) : this.approvalRepository;
    let flow = manager
      ? await manager.findOne(ApprovalFlow, { where: { objectType, objectId } })
      : await this.findByObject(objectType, objectId);
    if (!flow) {
      flow = repo.create({
        objectType,
        objectId,
        submittedBy: reviewedBy,
      });
    }
    flow.status = 'approved';
    flow.reviewedBy = reviewedBy;
    flow.comment = comment;
    const saved = await repo.save(flow);
    this.notify(saved, true, comment);
    return saved;
  }

  async reject(
    objectType: string,
    objectId: string,
    reviewedBy?: string,
    comment?: string,
    manager?: EntityManager,
  ): Promise<ApprovalFlow> {
    const repo = manager ? manager.getRepository(ApprovalFlow) : this.approvalRepository;
    let flow = manager
      ? await manager.findOne(ApprovalFlow, { where: { objectType, objectId } })
      : await this.findByObject(objectType, objectId);
    if (!flow) {
      flow = repo.create({
        objectType,
        objectId,
        submittedBy: reviewedBy,
      });
    }
    flow.status = 'rejected';
    flow.reviewedBy = reviewedBy;
    flow.comment = comment;
    const saved = await repo.save(flow);
    this.notify(saved, false, comment);
    return saved;
  }

  /** 把审批结果回写到业务单据状态（参数绑定，$n 占位符在 SQLite/PostgreSQL 通用） */
  private async syncObjectStatus(objectType: string, objectId: string, status: string): Promise<void> {
    const table = OBJECT_TABLES[objectType];
    if (!table) return; // 未知类型只维护审批记录本身
    await this.dataSource.query(
      `UPDATE "${table}" SET "status" = $1, "updatedAt" = $2 WHERE "id" = $3`,
      [status, new Date(), objectId],
    );
  }

  /** 通知提交人审批结果（fire-and-forget，不阻塞审批流程） */
  private notify(flow: ApprovalFlow, approved: boolean, comment?: string): void {
    if (!flow.submittedBy) return;
    this.notificationsService.create({
      type: 'approval',
      title: `${OBJECT_LABELS[flow.objectType] || '单据'}审批${approved ? '通过' : '被拒绝'}`,
      content: comment || (approved ? '您的申请已审核通过' : '您的申请被拒绝，请查看备注'),
      recipientId: flow.submittedBy,
      linkUrl: `/approvals`,
    }).catch(() => {});
  }

  async approveById(
    id: string,
    reviewedBy?: string,
    comment?: string,
  ): Promise<ApprovalFlow> {
    const flow = await this.approvalRepository.findOne({ where: { id } });
    if (!flow) throw new Error('审批记录不存在');
    if (flow.status !== 'pending') throw new Error('该审批已处理，请勿重复操作');
    flow.status = 'approved';
    flow.reviewedBy = reviewedBy;
    flow.comment = comment;
    const saved = await this.approvalRepository.save(flow);
    // 审批中心与业务页面必须一致：审批记录更新的同时回写单据状态
    await this.syncObjectStatus(flow.objectType, flow.objectId, 'approved');
    this.notify(saved, true, comment);
    this.fireApproved(flow.objectType, flow.objectId, reviewedBy);
    return saved;
  }

  /** 批量通过：逐条处理，单条失败不影响其它；返回成功/跳过数 */
  async approveMany(ids: string[], reviewedBy?: string, comment?: string): Promise<{ approved: number; skipped: number }> {
    let approved = 0;
    let skipped = 0;
    for (const id of [...new Set(ids)].slice(0, 500)) {
      try {
        await this.approveById(id, reviewedBy, comment);
        approved++;
      } catch {
        skipped++;
      }
    }
    return { approved, skipped };
  }

  async rejectById(
    id: string,
    reviewedBy?: string,
    comment?: string,
  ): Promise<ApprovalFlow> {
    const flow = await this.approvalRepository.findOne({ where: { id } });
    if (!flow) throw new Error('审批记录不存在');
    if (flow.status !== 'pending') throw new Error('该审批已处理，请勿重复操作');
    flow.status = 'rejected';
    flow.reviewedBy = reviewedBy;
    flow.comment = comment;
    const saved = await this.approvalRepository.save(flow);
    await this.syncObjectStatus(flow.objectType, flow.objectId, 'rejected');
    this.notify(saved, false, comment);
    return saved;
  }

  async getPendingCount(): Promise<number> {
    return this.approvalRepository.count({ where: { status: 'pending' } });
  }
}
