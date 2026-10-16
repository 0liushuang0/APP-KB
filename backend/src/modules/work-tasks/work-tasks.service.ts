import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WorkTask } from './entities/work-task.entity';
import { CreateWorkTaskDto, UpdateWorkTaskDto, QueryWorkTaskDto } from './dto/work-task.dto';
import { CurrentUser } from '../../common/services/permission.service';
import { PermissionQueryService } from '../../common/services/permission-query.service';
import { PermissionService } from '../../common/services/permission.service';
import { NumberingService } from '../../common/services/numbering.service';
import { paginate, PaginatedResult } from '../../common/dto/pagination.dto';
import { toLocalDate } from '../../common/utils/date-format.util';

/**
 * 工作任务：业务流程之外的日常工作记录。
 *
 * 与业务单据的区别：没有客户/审批/派生链路，核心是
 * "哪天、做了什么、花了多久、谁交办、交给谁、留下了哪些输入/输出文件"。
 */
@Injectable()
export class WorkTasksService {
  constructor(
    @InjectRepository(WorkTask)
    private readonly taskRepository: Repository<WorkTask>,
    private readonly permissionQuery: PermissionQueryService,
    private readonly permissionService: PermissionService,
    private readonly numbering: NumberingService,
  ) {}

  /** 列表（服务端分页，权限已下沉到 SQL） */
  async findAll(query: QueryWorkTaskDto, user: CurrentUser): Promise<PaginatedResult<WorkTask>> {
    const qb = this.taskRepository.createQueryBuilder('t');

    if (query.category) qb.andWhere('t.category = :category', { category: query.category });
    if (query.status) qb.andWhere('t.status = :status', { status: query.status });
    // 'none' 是前端"未关联客户"筛选项（与业务单据同一约定）
    if (query.customerId === 'none') qb.andWhere('t.customerId IS NULL');
    else if (query.customerId) qb.andWhere('t.customerId = :cid', { cid: query.customerId });
    // 按工作日期过滤：周报/月报场景要能圈一段时间
    if (query.dateFrom) qb.andWhere('t.workDate >= :dateFrom', { dateFrom: query.dateFrom });
    if (query.dateTo) qb.andWhere('t.workDate <= :dateTo', { dateTo: query.dateTo });
    if (query.keyword) {
      qb.andWhere('(t.title LIKE :kw OR t.taskNo LIKE :kw OR t.content LIKE :kw OR t.sourcePerson LIKE :kw OR t.deliverTo LIKE :kw)', {
        kw: `%${query.keyword}%`,
      });
    }

    this.permissionQuery.apply(qb, 't', user);

    const result = await paginate(qb, 't', query, ['createdAt', 'workDate', 'startDate', 'dueDate', 'title', 'status', 'priority', 'taskNo'], { field: 'taskNo', order: 'ASC' });
    const withNames = await this.attachNames(result.list);
    // date 列统一转本地 YYYY-MM-DD（防时区截取差一天）
    const withDates = withNames.map((t: any) => ({
      ...t,
      workDate: toLocalDate(t.workDate),
      startDate: toLocalDate(t.startDate),
      dueDate: toLocalDate(t.dueDate),
    }));
    return { ...result, list: await this.attachAttachmentCounts(withDates) };
  }

  /**
   * 列表行回填可读名：客户名 + 项目名（手写名优先显示用户输入，
   * 关联上项目的用项目库里的正式名补齐）。
   */
  private async attachNames<T extends { customerId?: string | null; projectId?: string | null; projectName?: string | null }>(
    rows: T[],
  ): Promise<(T & { customerName?: string | null; projectDisplayName?: string | null })[]> {
    const mgr = this.taskRepository.manager;
    const customerIds = [...new Set(rows.map((r) => r.customerId).filter(Boolean))] as string[];
    const projectIds = [...new Set(rows.map((r) => r.projectId).filter(Boolean))] as string[];

    const customers = customerIds.length
      ? await mgr.createQueryBuilder()
          .select(['c.id AS id', 'c.name AS name'])
          .from('customers', 'c')
          .where('c.id IN (:...ids)', { ids: customerIds })
          .getRawMany<{ id: string; name: string }>()
      : [];
    const projects = projectIds.length
      ? await mgr.createQueryBuilder()
          .select(['p.id AS id', 'p.name AS name'])
          .from('projects', 'p')
          .where('p.id IN (:...ids)', { ids: projectIds })
          .getRawMany<{ id: string; name: string }>()
      : [];

    const cMap = new Map(customers.map((c) => [c.id, c.name]));
    const pMap = new Map(projects.map((p) => [p.id, p.name]));
    return rows.map((r) => ({
      ...r,
      customerName: r.customerId ? cMap.get(r.customerId) ?? null : null,
      projectDisplayName: r.projectName || (r.projectId ? pMap.get(r.projectId) ?? null : null),
    }));
  }

  /**
   * 手写的项目名若与项目跟踪里的项目重名，自动挂上 projectId ——
   * "可关联也可手写"两条路在数据层收敛为同一条关联。
   */
  private async resolveProjectId(projectName?: string | null, projectId?: string | null): Promise<string | null> {
    if (projectId) return projectId;
    if (!projectName?.trim()) return null;
    const row = await this.taskRepository.manager
      .createQueryBuilder()
      .select('p.id AS id')
      .from('projects', 'p')
      .where('p.name = :name', { name: projectName.trim() })
      .getRawOne<{ id: string }>();
    return row?.id ?? null;
  }

  /**
   * 附件计数（source=输入 / deliverable=输出），列表操作列的回形针徽标显示用，
   * 与需求/方案/报价等业务单据同一口径。
   */
  private async attachAttachmentCounts<T extends { id: string }>(rows: T[]) {
    if (!rows.length) return rows.map((r) => ({ ...r, attachmentCounts: { input: 0, output: 0 } }));
    const counts = await this.taskRepository.manager
      .createQueryBuilder()
      .select('dl."workTaskId" AS id')
      .addSelect('dl."linkRole" AS role')
      .addSelect('COUNT(*) AS n')
      .from('document_links', 'dl')
      .where('dl."workTaskId" IN (:...ids)', { ids: rows.map((r) => r.id) })
      .groupBy('dl."workTaskId", dl."linkRole"')
      .getRawMany<{ id: string; role: string; n: number }>();

    const map = new Map(rows.map((r) => [r.id, { input: 0, output: 0 }]));
    for (const c of counts) {
      const cur = map.get(c.id) || { input: 0, output: 0 };
      if (c.role === 'source') cur.input = Number(c.n);
      if (c.role === 'deliverable') cur.output = Number(c.n);
      map.set(c.id, cur);
    }
    return rows.map((r) => ({ ...r, attachmentCounts: map.get(r.id) || { input: 0, output: 0 } }));
  }

  async findOne(id: string, user: CurrentUser): Promise<WorkTask> {
    const task = await this.taskRepository.findOne({ where: { id } });
    if (!task) throw new NotFoundException('工作任务不存在');
    const ok = this.permissionService.canAccess(user, {
      uploaderId: task.ownerId,
      visibility: task.visibility,
      departmentId: task.departmentId,
      groupIds: task.groupIds,
      roleCodes: task.roleCodes,
    });
    if (!ok) throw new NotFoundException('工作任务不存在');
    return task;
  }

  async create(dto: CreateWorkTaskDto, user: CurrentUser): Promise<WorkTask> {
    const taskNo = await this.numbering.next('workTask');
    const task = this.taskRepository.create({
      ...dto,
      taskNo,
      workDate: dto.workDate ?? null,
      startDate: dto.startDate ?? null,
      dueDate: dto.dueDate ?? null,
      projectId: await this.resolveProjectId(dto.projectName, dto.projectId),
      projectName: dto.projectName?.trim() || null,
      customerId: dto.customerId || null,
      ownerId: user?.userId ?? null,
      departmentId: user?.departmentId ?? null,
    });
    return this.taskRepository.save(task);
  }

  async update(id: string, dto: UpdateWorkTaskDto, user: CurrentUser): Promise<WorkTask> {
    await this.findOne(id, user);
    const patch: Partial<WorkTask> = { ...dto };
    if (dto.projectName !== undefined || dto.projectId !== undefined) {
      patch.projectId = await this.resolveProjectId(
        dto.projectName ?? undefined,
        dto.projectId ?? undefined,
      );
      if (dto.projectName !== undefined) patch.projectName = dto.projectName?.trim() || null;
    }
    await this.taskRepository.update(id, patch);
    return this.findOne(id, user);
  }

  async remove(id: string, user: CurrentUser): Promise<void> {
    await this.findOne(id, user);
    await this.taskRepository.delete(id);
    // document_links 级联由 DB 外键 ON DELETE SET NULL 处理（与 afterSaleId 同款）
  }

  /** 工作台用：我的未完成工作任务数（今日及过期） */
  async myOpenCount(user: CurrentUser): Promise<{ open: number; today: number }> {
    const qb = this.taskRepository
      .createQueryBuilder('t')
      .select('COUNT(*) AS n')
      .where('t.status != :done', { done: 'done' });
    this.permissionQuery.apply(qb, 't', user);
    const row = await qb.getRawOne<{ n: number }>();
    const today = new Date().toISOString().slice(0, 10);
    const tqb = this.taskRepository
      .createQueryBuilder('t')
      .select('COUNT(*) AS n')
      .where('t.status != :done AND t.workDate = :today', { done: 'done', today });
    this.permissionQuery.apply(tqb, 't', user);
    const trow = await tqb.getRawOne<{ n: number }>();
    return { open: Number(row?.n || 0), today: Number(trow?.n || 0) };
  }
}
