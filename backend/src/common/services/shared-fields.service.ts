import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { KnowledgeSyncService } from './knowledge-sync.service';

/** 从哪种单据出发，往上找到持有主数据的需求 */
export type OriginEntity = 'requirement' | 'proposal' | 'quotation' | 'project';

export interface SharedFieldPatch {
  /** 项目名称 */
  projectName?: string;
  /** 关联客户 */
  customerId?: string;
}

/**
 * 客户与项目名称的共享写回。
 *
 * 这两个值**只存一份**，存在需求上（requirements.customerId / requirements.title）。
 * 方案、报价、项目跟踪都顺着链路读它：
 *
 *     需求 ←── 方案 ←── 报价
 *       ↖────── 项目跟踪
 *
 * 读是单向的，所以四个模块看到的永远一致。
 * 但用户不该被迫"什么都回客户需求里改" —— 在方案、报价、项目跟踪里改同样要生效，
 * 于是写的时候反过来找到那条需求、改它，其余模块下次读就跟着变了。
 *
 * 代价要说清楚：同一需求下的所有方案/报价共享这一份值，
 * 在方案里改项目名称，同需求下的其他单据一起变 —— 这正是"改一处处处改"的应有之义，
 * 界面上会提示影响范围。
 */
@Injectable()
export class SharedFieldsService {
  private readonly logger = new Logger(SharedFieldsService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly knowledgeSyncService: KnowledgeSyncService,
  ) {}

  /**
   * 由任意单据 id 定位到持有主数据的需求 id。
   * 找不到（例如方案没关联需求）时返回 null，调用方应跳过写回而不是报错。
   */
  async resolveRequirementId(
    origin: OriginEntity,
    id: string,
    manager?: EntityManager,
  ): Promise<string | null> {
    const m = manager || this.dataSource.manager;
    if (origin === 'requirement') return id;

    if (origin === 'proposal') {
      const row = await m
        .createQueryBuilder()
        .select('p.requirementId', 'rid')
        .from('proposals', 'p')
        .where('p.id = :id', { id })
        .getRawOne<{ rid: string }>();
      return row?.rid || null;
    }

    if (origin === 'quotation') {
      const row = await m
        .createQueryBuilder()
        .select('p.requirementId', 'rid')
        .from('quotations', 'q')
        .leftJoin('proposals', 'p', 'p.id = q.proposalId')
        .where('q.id = :id', { id })
        .getRawOne<{ rid: string }>();
      return row?.rid || null;
    }

    // 项目跟踪自身就挂着 requirementId
    const row = await m
      .createQueryBuilder()
      .select('pr.requirementId', 'rid')
      .from('projects', 'pr')
      .where('pr.id = :id', { id })
      .getRawOne<{ rid: string }>();
    return row?.rid || null;
  }

  /**
   * 把改动写回需求。
   *
   * @returns 实际写入的字段名；空数组表示没有可写回的内容或找不到需求
   */
  async writeBack(
    origin: OriginEntity,
    id: string,
    patch: SharedFieldPatch,
    manager?: EntityManager,
  ): Promise<string[]> {
    const changes: Record<string, any> = {};
    if (patch.projectName !== undefined && patch.projectName !== null && patch.projectName !== '') {
      changes.title = patch.projectName;
    }
    if (patch.customerId !== undefined && patch.customerId !== null && patch.customerId !== '') {
      changes.customerId = patch.customerId;
    }
    if (!Object.keys(changes).length) return [];

    const m = manager || this.dataSource.manager;
    const requirementId = await this.resolveRequirementId(origin, id, m);
    if (!requirementId) {
      // 没有关联需求的孤立单据：改动无处安放，不静默丢弃也不报错，记一笔即可
      this.logger.warn(`${origin} ${id} 未关联需求，项目名称/客户的修改未能写回`);
      return [];
    }

    await m
      .createQueryBuilder()
      .update('requirements')
      .set({ ...changes, updatedAt: new Date() })
      .where('id = :id', { id: requirementId })
      .execute();

    // 需求的 title/customerId 改了，向量库里的旧索引就过期了——
    // 按新名 RAG 搜索会搜不到。这里重新同步需求向量。
    // 向量同步是 HTTP 调用，不应阻塞写回事务，失败只记日志。
    this.resyncRequirement(requirementId).catch((err) =>
      this.logger.error(`resync requirement ${requirementId} after writeBack failed`, err?.message),
    );

    return Object.keys(changes);
  }

  /** 重新同步需求向量（fire-and-forget，不阻塞写回） */
  private async resyncRequirement(requirementId: string): Promise<void> {
    const m = this.dataSource.manager;
    const r = await m
      .createQueryBuilder()
      .select(['r.id', 'r.requirementNo', 'r.title', 'r.description', 'r.aiAnalysis', 'r.structuredSpec', 'r.customerId'])
      .from('requirements', 'r')
      .where('r.id = :id', { id: requirementId })
      .getRawOne<any>();
    if (!r) return;
    const content = `${r.title || ''} ${r.requirementNo || ''} ${r.description || ''} ${r.aiAnalysis || ''} ${r.structuredSpec || ''}`;
    await this.knowledgeSyncService.syncObject({
      id: requirementId,
      objectType: 'requirement',
      title: r.title || r.requirementNo || '',
      content,
      visibility: 'public' as any,
    });
  }

  /**
   * 一条业务线上的全部单据。
   *
   * 需求 → 方案 → 报价 → 项目 是同一单生意的四个阶段，但界面上分散在四个页面。
   * 用户拿着一个报价编号想看它对应的需求，只能靠编号尾号猜、或者逐页去搜。
   * 这里一次性把整条链路的编号和 id 返回，详情页据此给出可点击的跳转。
   */
  async chain(origin: OriginEntity, id: string) {
    const requirementId = await this.resolveRequirementId(origin, id);
    if (!requirementId) return { requirement: null, proposals: [], quotations: [], projects: [] };

    const m = this.dataSource.manager;

    const requirement = await m
      .createQueryBuilder()
      .select(['r.id AS id', 'r.requirementNo AS no', 'r.title AS title'])
      .from('requirements', 'r')
      .where('r.id = :id', { id: requirementId })
      .getRawOne<any>();

    const proposals = await m
      .createQueryBuilder()
      .select(['p.id AS id', 'p.proposalNo AS no', 'p.status AS status'])
      .from('proposals', 'p')
      .where('p.requirementId = :id', { id: requirementId })
      .orderBy('p.proposalNo')
      .getRawMany<any>();

    const quotations = proposals.length
      ? await m
          .createQueryBuilder()
          .select(['q.id AS id', 'q.quotationNo AS no', 'q.status AS status'])
          .from('quotations', 'q')
          .where('q.proposalId IN (:...ids)', { ids: proposals.map((p) => p.id) })
          .orderBy('q.quotationNo')
          .getRawMany<any>()
      : [];

    const projects = await m
      .createQueryBuilder()
      .select(['pr.id AS id', 'pr.projectNo AS no', 'pr.dealStage AS dealStage'])
      .from('projects', 'pr')
      .where('pr.requirementId = :id', { id: requirementId })
      .orderBy('pr.projectNo')
      .getRawMany<any>();

    return { requirement, proposals, quotations, projects };
  }

  /**
   * 受影响单据数量，供界面提示"这次改动会影响几张单"。
   */
  async impactCount(requirementId: string): Promise<{ proposals: number; quotations: number }> {
    const m = this.dataSource.manager;
    const p = await m
      .createQueryBuilder()
      .select('COUNT(*)', 'c')
      .from('proposals', 'p')
      .where('p.requirementId = :id', { id: requirementId })
      .getRawOne<{ c: number }>();
    const q = await m
      .createQueryBuilder()
      .select('COUNT(*)', 'c')
      .from('quotations', 'q')
      .leftJoin('proposals', 'p', 'p.id = q.proposalId')
      .where('p.requirementId = :id', { id: requirementId })
      .getRawOne<{ c: number }>();
    return { proposals: Number(p?.c) || 0, quotations: Number(q?.c) || 0 };
  }
}
