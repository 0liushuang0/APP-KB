import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { buildProjectDraft } from './project-draft';
import { evaluateHealth } from './project-health';
import { BusinessTrashService } from '../recycle-bin/business-trash.service';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Like } from 'typeorm';
import { Project, ProjectStage, ProjectRisk } from './entities/project.entity';
import { ProjectTimeline } from './entities/project-timeline.entity';
import { DocumentLink } from './entities/document-link.entity';
import { ProjectMember } from './entities/project-member.entity';
import { ProjectTask } from './entities/project.entity';
import { Requirement } from '../requirements/entities/requirement.entity';
import { User } from '../users/entities/user.entity';
import { Proposal } from '../proposals/entities/proposal.entity';
import { Quotation, QuotationItem } from '../quotations/entities/quotation.entity';
import { Contract } from '../contracts/entities/contract.entity';
import { ContractPayment } from '../contracts/entities/contract-payment.entity';
import { Customer } from '../customers/entities/customer.entity';
import { CreateProjectDto, UpdateProjectDto, QueryProjectDto } from './dto/project.dto';
import { CreateProjectTaskDto, UpdateProjectTaskDto } from './dto/task.dto';
import { AddProjectMemberDto, UpdateProjectMemberDto } from './dto/project-member.dto';
import { NotificationsService } from '../notifications/notifications.service';
import { TransactionService } from '../../common/services/transaction.service';
import { CurrentUser, PermissionService } from '../../common/services/permission.service';
import { SharedFieldsService } from '../../common/services/shared-fields.service';
import { PermissionQueryService } from '../../common/services/permission-query.service';
import { paginate, PaginatedResult } from '../../common/dto/pagination.dto';
import { KnowledgeSyncService } from '../../common/services/knowledge-sync.service';
import { NumberingService } from '../../common/services/numbering.service';
import { ApprovalsService } from '../approvals/approvals.service';

@Injectable()
export class ProjectsService {
  constructor(
    @InjectRepository(Project)
    private projectRepository: Repository<Project>,
    @InjectRepository(ProjectStage)
    private stageRepository: Repository<ProjectStage>,
    @InjectRepository(ProjectRisk)
    private riskRepository: Repository<ProjectRisk>,
    @InjectRepository(ProjectTask)
    private taskRepository: Repository<ProjectTask>,
    @InjectRepository(ProjectTimeline)
    private timelineRepository: Repository<ProjectTimeline>,
    @InjectRepository(DocumentLink)
    private documentLinkRepository: Repository<DocumentLink>,
    @InjectRepository(Requirement)
    private requirementRepository: Repository<Requirement>,
    @InjectRepository(ProjectMember)
    private memberRepository: Repository<ProjectMember>,
    @InjectRepository(User)
    private userRepository: Repository<User>,
    private notificationsService: NotificationsService,
    private permissionService: PermissionService,
    private knowledgeSyncService: KnowledgeSyncService,
    private approvalsService: ApprovalsService,
    private readonly tx: TransactionService,
    private permissionQuery: PermissionQueryService,
    private sharedFields: SharedFieldsService,
    private readonly numbering: NumberingService,
    private readonly trash: BusinessTrashService,
  ) {}

  /**
   * 项目编号继承所关联需求/报价的流水号：
   * REQ-2026-007 → PRJ-2026-007，和方案/报价的继承逻辑一致。
   * 无上游则走独立流水号。
   */
  private async nextNo(dto: CreateProjectDto): Promise<string> {
    let sourceNo: string | null = null;
    // 立项以签约为前提：优先继承合同编号（CON-2026-007 → PRJ-2026-007）
    if (dto.contractId) {
      const con = await this.projectRepository.manager
        .createQueryBuilder()
        .select('c.contractNo', 'no')
        .from('contracts', 'c')
        .where('c.id = :id', { id: dto.contractId })
        .getRawOne<{ no: string }>();
      sourceNo = con?.no || null;
    }
    if (!sourceNo && dto.requirementId) {
      const r = await this.requirementRepository.findOne({
        where: { id: dto.requirementId },
        select: ['requirementNo'],
      });
      sourceNo = r?.requirementNo || null;
    }
    if (!sourceNo && dto.quotationId) {
      // 报价不直接在 projects.service 注入，但编号可从 quotation 表查
      const q = await this.projectRepository.manager
        .createQueryBuilder()
        .select('q.quotationNo', 'no')
        .from('quotations', 'q')
        .where('q.id = :id', { id: dto.quotationId })
        .getRawOne<{ no: string }>();
      sourceNo = q?.no || null;
    }
    return this.numbering.derive('project', sourceNo);
  }

  /**
   * 客户跟随上游：项目 → 需求（或报价 → 方案 → 需求）。
   * 之前直接用 dto.customerId，列可空还会被留 null。
   */
  private async inheritCustomerId(dto: CreateProjectDto): Promise<string | null> {
    // 合同的客户本身就是从报价→方案→需求继承来的，直接取即可
    if (dto.contractId) {
      const con = await this.projectRepository.manager
        .createQueryBuilder()
        .select('c.customerId', 'customerId')
        .from('contracts', 'c')
        .where('c.id = :id', { id: dto.contractId })
        .getRawOne<{ customerId: string }>();
      if (con?.customerId) return con.customerId;
    }
    if (dto.requirementId) {
      const r = await this.requirementRepository.findOne({
        where: { id: dto.requirementId },
        select: ['customerId'],
      });
      if (r?.customerId) return r.customerId;
    }
    if (dto.quotationId) {
      const row = await this.projectRepository.manager
        .createQueryBuilder()
        .select('r."customerId"', 'customerId')
        .from('quotations', 'q')
        .leftJoin('proposals', 'p', 'p.id = q."proposalId"')
        .leftJoin('requirements', 'r', 'r.id = p."requirementId"')
        .where('q.id = :id', { id: dto.quotationId })
        .getRawOne<{ customerId: string }>();
      if (row?.customerId) return row.customerId;
    }
    return dto.customerId ?? null;
  }

  /** 列表（服务端分页，权限已下沉到 SQL） */
  async findAll(query: QueryProjectDto, user: CurrentUser): Promise<PaginatedResult<Project>> {
    const qb = this.projectRepository.createQueryBuilder('p');

    if (query.status) qb.andWhere('p.status = :status', { status: query.status });
    if ((query as any).owner === 'me' && user?.userId) qb.andWhere('p.managerId = :ownerMe', { ownerMe: user.userId });
    if ((query as any).focus === 'risk') qb.andWhere("p.health IN ('red','yellow')");
    if (query.dealStage) qb.andWhere('p.dealStage = :ds', { ds: query.dealStage });
    // 'none' 是前端"未关联客户"筛选项
    if (query.customerId === 'none') qb.andWhere('p.customerId IS NULL');
    else if (query.customerId) qb.andWhere('p.customerId = :cid', { cid: query.customerId });
    if (query.keyword) {
      qb.andWhere('(p.name LIKE :kw OR p.projectNo LIKE :kw)', { kw: `%${query.keyword}%` });
    }

    // projects 的归属列叫 managerId（不是默认的 ownerId），需显式覆盖，
    // 否则 private/department 分支会引用不存在的 p.ownerId 列导致查询失败。
    this.permissionQuery.apply(qb, 'p', user, { owner: 'managerId' });

    const result = await paginate(qb, 'p', query, ['createdAt', 'name', 'status', 'dealStage', 'projectNo'], { field: 'projectNo', order: 'ASC' });
    return { ...result, list: await this.attachRelations(result.list) };
  }



  /**
   * 贴上客户简称与项目名称。
   *
   * 项目跟踪自己的 name 是历史遗留 —— 项目名称的主数据在关联需求上，
   * 两边措辞常年对不上（「…采购」vs「…项目」）。这里统一以需求为准，
   * 原 name 仍保留在库里供备查。
   */
  private async attachRelations(rows: any[]): Promise<any[]> {
    if (!rows.length) return rows;
    const manager = this.projectRepository.manager;
    const reqIds = [...new Set(rows.map((r) => r.requirementId).filter(Boolean))];

    const chain = reqIds.length
      ? await manager
          .createQueryBuilder()
          .select([
            'r.id AS "requirementId"',
            'r.title AS "projectName"',
            'c.name AS "customerName"',
            'c.code AS "customerShortName"',
          ])
          .from('requirements', 'r')
          .leftJoin('customers', 'c', 'c.id = r."customerId"')
          .where('r.id IN (:...ids)', { ids: reqIds })
          .getRawMany<any>()
      : [];

    const map = new Map(chain.map((x) => [x.requirementId, x]));

    /*
     * 交货期：沿 项目→报价→合同 取合同约定的 deliveryDate，
     * 单一数据源（合同），项目列表实时同步显示，不另存一份防漂移。
     */
    const quoIds = [...new Set(rows.map((r) => r.quotationId).filter(Boolean))];
    const deliveries = quoIds.length
      ? await manager
          .createQueryBuilder()
          .select(['ct."quotationId" AS "quotationId"', 'to_char(MAX(ct."deliveryDate"), \'YYYY-MM-DD\') AS "deliveryDate"'])
          .from('contracts', 'ct')
          .where('ct."quotationId" IN (:...ids)', { ids: quoIds })
          .groupBy('ct."quotationId"')
          .getRawMany<{ quotationId: string; deliveryDate: string | null }>()
      : [];
    const dmap = new Map(deliveries.map((d) => [d.quotationId, d.deliveryDate]));

    /*
     * 直接从合同立项的项目可能没回填 requirementId（立项时链路查询失败、
     * 或导入数据本就没挂需求），但项目自身存着 customerId ——
     * 链取不到客户时按它回退，别让客户列整片变空。
     */
    const broken = rows.filter((p) => {
      const link = p.requirementId ? map.get(p.requirementId) : undefined;
      return !link?.customerName && !link?.customerShortName && !!p.customerId;
    });
    const fallbackIds = [...new Set(broken.map((p) => p.customerId!))];
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
    const ids = rows.map((p) => p.id);
    const counts = ids.length
      ? await manager
          .createQueryBuilder()
          .select(['l."projectId" AS "id"', 'l."linkRole" AS "role"', 'COUNT(*) AS "n"'])
          .from('document_links', 'l')
          .where('l."projectId" IN (:...ids)', { ids })
          .groupBy('l."projectId"')
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

    return rows.map((p) => {
      const link = p.requirementId ? map.get(p.requirementId) : undefined;
      const fb = link?.customerName || link?.customerShortName ? null : fmap.get(p.customerId || '');
      return {
        ...p,
        customerName: link?.customerName || fb?.customerName || null,
        customerShortName: link?.customerShortName || link?.customerName || fb?.customerShortName || fb?.customerName || null,
        // 没关联需求时退回项目自己的名称，至少不是空白
        projectName: link?.projectName || p.name,
        legacyName: p.name,
        // 交货期：合同约定的 deliveryDate（经报价链取），列表提醒排产
        deliveryDate: (p.quotationId ? dmap.get(p.quotationId) : undefined) ?? null,
        attachmentCounts: cmap.get(p.id) || { input: 0, output: 0 },
      };
    });
  }

  async findOne(id: string, user: CurrentUser): Promise<Project> {
    const project = await this.projectRepository.findOne({ where: { id } });
    if (!project) throw new NotFoundException('项目不存在');
    if (
      !this.permissionService.canAccess(user, this.toSubject(project)) &&
      !(await this.getMemberRole(id, user?.userId))
    ) {
      throw new BadRequestException('无权访问该项目');
    }
    const [stages, risks] = await Promise.all([
      this.stageRepository.find({ where: { projectId: id } }),
      this.riskRepository.find({ where: { projectId: id } }),
    ]);
    (project as any).stages = stages;
    (project as any).risks = risks;
    return project;
  }

  /**
   * 从合同回溯整条上游链。
   *
   * 项目跟踪的关联单据（RelatedChain）、共享字段写回都以 projects.requirementId
   * 为锚点。从合同立项时若只存 contractId，项目就挂不进业务线，
   * 所以这里顺着 合同 → 报价 → 方案 → 需求 把中间几个 id 一并补齐。
   * 仅回填 dto 未显式提供的字段。
   */
  private async resolveUpstreamLinks(dto: CreateProjectDto): Promise<{
    requirementId?: string;
    proposalId?: string;
    quotationId?: string;
  }> {
    if (!dto.contractId) return {};
    const row = await this.projectRepository.manager
      .createQueryBuilder()
      .select([
        'q.id AS "quotationId"',
        'p.id AS "proposalId"',
        'r.id AS "requirementId"',
      ])
      .from('contracts', 'con')
      .leftJoin('quotations', 'q', 'q.id = con."quotationId"')
      .leftJoin('proposals', 'p', 'p.id = q."proposalId"')
      .leftJoin('requirements', 'r', 'r.id = p."requirementId"')
      .where('con.id = :id', { id: dto.contractId })
      .getRawOne<{ quotationId?: string; proposalId?: string; requirementId?: string }>();
    return {
      requirementId: dto.requirementId || row?.requirementId || undefined,
      proposalId: dto.proposalId || row?.proposalId || undefined,
      quotationId: dto.quotationId || row?.quotationId || undefined,
    };
  }

  async create(dto: CreateProjectDto, user: CurrentUser): Promise<Project> {
    const { stages, risks, ...data } = dto;
    // 编号继承上游（合同/需求/报价），客户跟随上游——与方案/报价的继承契约一致。
    const [projectNo, customerId, upstream] = await Promise.all([
      this.nextNo(dto),
      this.inheritCustomerId(dto),
      this.resolveUpstreamLinks(dto),
    ]);
    const project = this.projectRepository.create({
      ...data,
      ...upstream,
      projectNo,
      customerId,
      ...(dto.contractId && !(data as any).dealStage ? { dealStage: 'contract_signed' } : {}),
      managerId: user?.userId,
      departmentId: data.departmentId || user?.departmentId,
      status: this.permissionService.skipApproval() ? 'approved' : 'pending',
    } as any);

    /*
     * 主行 + 阶段 + 风险 + 审批记录必须在同一事务内：之前逐步落盘，中途失败会
     * 留下「有项目无阶段/风险」的脏数据。
     *
     * 审批原来在事务外，理由写的是"审批是独立关切"。但主行已带着
     * status='pending' 提交，审批记录建失败就成了"卡在待审、审批中心里却没有
     * 这一条"的死局。requirements / customers / proposals / quotations /
     * contracts 五个模块都放在事务内，这里对齐它们。
     *
     * sync 仍在事务外：它本就设计为提交后异步。
     */
    const skipApproval = this.permissionService.skipApproval();
    const savedProject = await this.tx.run(
      async (manager) => {
        const saved = await manager.getRepository(Project).save(project);
        const row = Array.isArray(saved) ? saved[0] : saved;
        if (stages?.length) {
          const stageRepo = manager.getRepository(ProjectStage);
          const entities = stages.map((s) => stageRepo.create({ ...s, projectId: row.id }));
          await stageRepo.save(entities);
        }
        if (risks?.length) {
          const riskRepo = manager.getRepository(ProjectRisk);
          const entities = risks.map((r) => riskRepo.create({ ...r, projectId: row.id }));
          await riskRepo.save(entities);
        }
        if (!skipApproval) {
          await this.approvalsService.create({
            objectType: 'project',
            objectId: row.id,
            submittedBy: user?.userId,
            status: 'pending',
          }, manager);
        }
        return row;
      },
    );

    await this.sync(savedProject);
    return savedProject;
  }

  async update(id: string, dto: UpdateProjectDto, user: CurrentUser): Promise<Project> {
    const project = await this.findOne(id, user);
    if (
      !this.permissionService.canManage(user, this.toSubject(project)) &&
      (await this.getMemberRole(id, user?.userId)) !== 'manager'
    ) {
      throw new BadRequestException('无权修改该项目');
    }

    /*
     * 写回必须在权限校验**之后** —— 否则无权修改这个项目的人也能顺着它
     * 改掉关联需求的项目名称，绕过整条权限链。
     */
    /*
     * 只认显式传来的 projectName，不再回落到 dto.name。
     * projects.name 存的是项目跟踪自己那套旧命名（「…项目」而需求叫「…采购」），
     * 拿它兜底意味着**每次保存项目都会把旧名字盖回需求** ——
     * 用户在报价页刚改好的名称，随手保存一下项目就被打回去了。
     */
    await this.sharedFields.writeBack('project', id, {
      projectName: (dto as any).projectName,
      customerId: (dto as any).customerId,
    });
    const { stages, risks, ...data } = dto;
    Object.assign(project, data);

    // 阶段与风险都是先删后插，且是两组 —— 中途失败会丢掉整个项目的过程记录
    const saved = await this.tx.run(
      async (manager) => {
        const row = await manager.getRepository(Project).save(project);

        if (stages?.length) {
          const stageRepo = manager.getRepository(ProjectStage);
          await stageRepo.delete({ projectId: id });
          await stageRepo.save(stages.map((s) => stageRepo.create({ ...s, projectId: row.id })));
        }

        if (risks?.length) {
          const riskRepo = manager.getRepository(ProjectRisk);
          await riskRepo.delete({ projectId: id });
          await riskRepo.save(risks.map((r) => riskRepo.create({ ...r, projectId: row.id })));
        }

        return row;
      },
      async (row) => {
        await this.sync(row);
        // 阶段被整组替换后进度已失真，重算（recalcProgress 会同时刷新健康度）
        if (stages?.length) await this.recalcProgress(id);
      },
    );
    return saved;
  }

  /**
   * 删除项目：阶段、风险、时间线、文档链接与主行一起删（事务保护），向量清理放事务外。
   * Requirement.projectId 反向引用不级联置空——项目取消不等于需求作废。
   */
  async draftFromContract(contractId: string) {
    const m = this.projectRepository.manager;
    const c: any = await m
      .createQueryBuilder()
      .select(['c.title AS title', 'c."customerId" AS "customerId"', 'c."signedDate" AS "signedDate"', 'c."effectiveDate" AS "effectiveDate"',
        'c."deliveryDate" AS "deliveryDate"', 'c."quotationId" AS "quotationId"'])
      .from('contracts', 'c')
      .where('CAST(c.id AS TEXT) = :id', { id: contractId })
      .getRawOne();
    if (!c) throw new NotFoundException('合同不存在');
    // 沿 合同 → 报价 → 方案 → 需求 取交货期天数与需求类型
    let deliveryDays: number | null = null;
    let requirementType: string | null = null;
    if (c.quotationId) {
      const q: any = await m
        .createQueryBuilder()
        .select(['q."deliveryDays" AS "deliveryDays"', 'r."requirementType" AS "requirementType"'])
        .from('quotations', 'q')
        .leftJoin('proposals', 'p', 'CAST(p.id AS TEXT) = q."proposalId"')
        .leftJoin('requirements', 'r', 'CAST(r.id AS TEXT) = p."requirementId"')
        .where('CAST(q.id AS TEXT) = :id', { id: c.quotationId })
        .getRawOne();
      deliveryDays = q?.deliveryDays != null ? Number(q.deliveryDays) : null;
      requirementType = q?.requirementType || null;
    }
    const tpl: any = await m
      .createQueryBuilder()
      .select('s.value', 'value')
      .from('system_configs', 's')
      .where('s.key = :k', { k: 'project_stage_template' })
      .getRawOne();
    const title = String(c.title || '').replace(/\s*(采购)?合同$/, '');
    return buildProjectDraft({ ...c, title, deliveryDays, requirementType, template: tpl?.value });
  }

  async remove(id: string, user: CurrentUser): Promise<void> {
    const project = await this.findOne(id, user);
    if (!this.permissionService.canManage(user, this.toSubject(project))) {
      throw new BadRequestException('无权删除该项目');
    }
    await this.tx.run(
      async (manager) => {
        await this.trash.capture(manager, 'project', id, `${project.projectNo || ''} ${project.name || ''}`.trim(), [
          { table: 'projects', column: 'id', ids: [id] },
          { table: 'project_stages', column: 'projectId', ids: [id] },
          { table: 'project_risks', column: 'projectId', ids: [id] },
          { table: 'project_timeline', column: 'projectId', ids: [id] },
          { table: 'document_links', column: 'projectId', ids: [id] },
        ], user?.userId);
        await manager.getRepository(ProjectStage).delete({ projectId: id });
        await manager.getRepository(ProjectRisk).delete({ projectId: id });
        await manager.getRepository(ProjectTimeline).delete({ projectId: id });
        await manager.getRepository(DocumentLink).delete({ projectId: id });
        await manager.getRepository(Project).delete(id);
      },
      async () => {
        await this.knowledgeSyncService.deleteObject('project', id);
      },
    );
  }

  async approve(id: string, user: CurrentUser): Promise<Project> {
    if (!this.permissionService.canApprove(user)) throw new BadRequestException('无权审核');
    const project = await this.projectRepository.findOne({ where: { id } });
    if (!project) throw new NotFoundException('项目不存在');
    project.status = 'approved';
    return this.tx.run(
      async (manager) => {
        const saved = await manager.save(project);
        await this.approvalsService.approve('project', id, user?.userId, '审核通过', manager);
        return saved;
      },
    );
  }

  private async sync(project: Project): Promise<void> {
    const content = `${project.projectNo} ${project.name} ${project.description || ''}`;
    await this.knowledgeSyncService.syncObject({
      id: project.id,
      objectType: 'project',
      title: project.name,
      content,
      visibility: project.visibility,
      uploaderId: project.managerId,
      departmentId: project.departmentId,
      groupIds: project.groupIds,
      roleCodes: project.roleCodes,
    });
  }

  private toSubject(project: Project) {
    return {
      visibility: project.visibility,
      uploaderId: project.managerId,
      departmentId: project.departmentId,
      groupIds: project.groupIds,
      roleCodes: project.roleCodes,
    };
  }

  // ── 成员与任务管理 ──

  /** 项目成员角色：不在成员表返回 null（可见性仍走 visibility 通用权限） */
  private async getMemberRole(projectId: string, userId?: string): Promise<string | null> {
    if (!userId) return null;
    const m = await this.memberRepository.findOne({ where: { projectId, userId } });
    return m?.role ?? null;
  }

  /**
   * 任务读写的权限主体是所属项目：
   * 看任务 = 通用可见权限（canAccess）或是项目成员；
   * 改任务 = 通用管理权限（canManage）或成员角色为 manager / member。
   * （viewer 成员只读——能看不能改，评估报告里"看得到却不能参与"与
   * "不该改的反而能改"两个相反的问题由这一个判定同时收口。）
   */
  private async getProjectForTask(
    projectId: string,
    user: CurrentUser,
    manage: boolean,
  ): Promise<Project> {
    const project = await this.projectRepository.findOne({ where: { id: projectId } });
    if (!project) throw new NotFoundException('项目不存在');
    const memberRole = await this.getMemberRole(projectId, user?.userId);
    const ok = manage
      ? (this.permissionService.canManage(user, this.toSubject(project))
        || memberRole === 'manager' || memberRole === 'member')
      : (this.permissionService.canAccess(user, this.toSubject(project)) || memberRole !== null);
    if (!ok) {
      throw new BadRequestException(manage ? '无权修改该项目的任务' : '无权访问该项目');
    }
    return project;
  }

  /** 校验阶段确实属于该项目，防止任务挂到别的项目的阶段上 */
  private async assertStageInProject(stageId: string, projectId: string): Promise<void> {
    const stage = await this.stageRepository.findOne({ where: { id: stageId, projectId } });
    if (!stage) throw new BadRequestException('任务所属阶段不属于该项目');
  }

  /**
   * 任务负责人账号校验与展示名回填：
   * 传了 assignedUserId 必须是真实用户；未提供展示名时用账号昵称补齐，
   * 保证列表上仍然显示人名（历史自由文本 assignedTo 原样兼容）。
   */
  private async resolveAssignee(
    dto: { assignedTo?: string; assignedUserId?: string },
    task?: ProjectTask,
  ): Promise<{ assignedTo?: string; assignedUserId?: string }> {
    const newId = dto.assignedUserId !== undefined ? dto.assignedUserId : task?.assignedUserId;
    if (!newId) {
      return { assignedTo: dto.assignedTo ?? task?.assignedTo, assignedUserId: null };
    }
    // PostgreSQL 会把非法 uuid 直接按语法错误抛 500，先做格式把关给出 400
    if (!/^[0-9a-fA-F-]{36}$/.test(newId)) {
      throw new BadRequestException('任务负责人不存在（assignedUserId 需为有效账号）');
    }
    const u = await this.userRepository.findOne({ where: { id: newId } });
    if (!u) throw new BadRequestException('任务负责人不存在（assignedUserId 需为有效账号）');
    const displayName = dto.assignedTo ?? u.nickname ?? u.username;
    return { assignedTo: displayName, assignedUserId: newId };
  }

  /** 任务分配/改派通知（fire-and-forget，不阻塞任务保存） */
  private notifyAssignee(
    task: ProjectTask,
    project: Project,
    changedByUserId: string | undefined,
    isNew: boolean,
  ): void {
    if (!task.assignedUserId || task.assignedUserId === changedByUserId) return;
    this.notificationsService.create({
      type: 'task',
      title: isNew ? `新任务分配：${task.title}` : `任务改派给你：${task.title}`,
      content: `项目 ${project.name}（${project.projectNo}）` +
        (task.endDate ? `，截止 ${new Date(task.endDate).toLocaleDateString('zh-CN')}` : ''),
      recipientId: task.assignedUserId,
      linkUrl: '/projects',
    }).catch(() => {});
  }

  async findTasks(projectId: string, user: CurrentUser): Promise<ProjectTask[]> {
    await this.getProjectForTask(projectId, user, false);
    return this.taskRepository.find({
      where: { projectId },
      order: { createdAt: 'ASC' },
    });
  }

  async createTask(
    projectId: string,
    dto: CreateProjectTaskDto,
    user: CurrentUser,
  ): Promise<ProjectTask> {
    const project = await this.getProjectForTask(projectId, user, true);
    if (dto.stageId) await this.assertStageInProject(dto.stageId, projectId);
    const assignee = await this.resolveAssignee(dto);
    const task = this.taskRepository.create({ ...dto, ...assignee, projectId });
    const saved = await this.taskRepository.save(task);
    this.notifyAssignee(saved, project, user?.userId, true);
    await this.recalcProgress(projectId);
    return saved;
  }

  async updateTask(
    projectId: string,
    id: string,
    dto: UpdateProjectTaskDto,
    user: CurrentUser,
  ): Promise<ProjectTask> {
    const task = await this.taskRepository.findOne({ where: { id } });
    if (!task) throw new NotFoundException('任务不存在');
    // URL 里的项目 ID 必须与任务实际归属一致：防止拿 A 项目的路径改 B 项目的任务
    if (task.projectId !== projectId) throw new BadRequestException('任务不属于该项目');
    const project = await this.getProjectForTask(task.projectId, user, true);
    if (dto.stageId) await this.assertStageInProject(dto.stageId, task.projectId);
    const assignee = await this.resolveAssignee(dto, task);
    const reassigned = assignee.assignedUserId !== task.assignedUserId;
    Object.assign(task, dto, assignee);
    const saved = await this.taskRepository.save(task);
    if (reassigned) this.notifyAssignee(saved, project, user?.userId, false);
    await this.recalcProgress(task.projectId);
    return saved;
  }

  async removeTask(projectId: string, id: string, user: CurrentUser): Promise<void> {
    const task = await this.taskRepository.findOne({ where: { id } });
    if (!task) throw new NotFoundException('任务不存在');
    if (task.projectId !== projectId) throw new BadRequestException('任务不属于该项目');
    await this.getProjectForTask(task.projectId, user, true);
    await this.taskRepository.delete(id);
    await this.recalcProgress(task.projectId);
  }

  // ── 项目成员管理 ──

  /** 成员列表（附带账号资料，供前端展示人名而不是裸 ID） */
  async listMembers(projectId: string, user: CurrentUser): Promise<any[]> {
    await this.getProjectForTask(projectId, user, false);
    const rows = await this.memberRepository
      .createQueryBuilder('m')
      .leftJoinAndMapOne(
        'm.user',
        User,
        'u',
        'u.id = m.userId',
      )
      .where('m.projectId = :projectId', { projectId })
      .getMany();
    return rows.map((m: any) => ({
      id: m.id,
      projectId: m.projectId,
      userId: m.userId,
      role: m.role,
      nickname: m.user?.nickname ?? m.user?.username ?? m.userId,
      username: m.user?.username,
    }));
  }

  async addMember(
    projectId: string,
    dto: AddProjectMemberDto,
    user: CurrentUser,
  ): Promise<ProjectMember> {
    await this.getProjectForTask(projectId, user, true);
    const u = await this.userRepository.findOne({ where: { id: dto.userId } });
    if (!u) throw new BadRequestException('用户不存在');
    const existing = await this.memberRepository.findOne({
      where: { projectId, userId: dto.userId },
    });
    if (existing) {
      existing.role = dto.role || 'member';
      return this.memberRepository.save(existing);
    }
    const member = this.memberRepository.create({
      projectId,
      userId: dto.userId,
      role: dto.role || 'member',
    });
    const saved = await this.memberRepository.save(member);
    this.notificationsService.create({
      type: 'project',
      title: '你被加入项目',
      content: `你已作为成员加入项目，可查看并参与该项目。`,
      recipientId: dto.userId,
      linkUrl: '/projects',
    }).catch(() => {});
    return saved;
  }

  async updateMemberRole(
    projectId: string,
    userId: string,
    dto: UpdateProjectMemberDto,
    user: CurrentUser,
  ): Promise<ProjectMember> {
    await this.getProjectForTask(projectId, user, true);
    const member = await this.memberRepository.findOne({ where: { projectId, userId } });
    if (!member) throw new NotFoundException('该用户不是项目成员');
    member.role = dto.role;
    return this.memberRepository.save(member);
  }

  async removeMember(projectId: string, userId: string, user: CurrentUser): Promise<void> {
    await this.getProjectForTask(projectId, user, true);
    await this.memberRepository.delete({ projectId, userId });
  }

  /**
   * 自动计算项目进度和健康度。
   * 进度优先按任务算（任务是最细粒度的执行单元），无任务时回退到阶段完成率；
   * 健康度 = 有延期阶段或高风险 → red；有中风险或接近截止 → yellow；否则 green。
   *
   * 之前这个方法只有定义没有任何调用，"任务全部完成、项目进度仍是 0%"。
   * 现在任务增删改和项目阶段更新后都会触发重算。
   */
  async recalcProgress(projectId: string): Promise<void> {
    const [stages, risks, tasks, project] = await Promise.all([
      this.stageRepository.find({ where: { projectId } }),
      this.riskRepository.find({ where: { projectId, status: 'open' } }),
      this.taskRepository.find({ where: { projectId } }),
      this.projectRepository.findOne({ where: { id: projectId } }),
    ]);
    if (!project) return;

    const isDone = (s: { status: string }) => s.status === 'done' || s.status === 'completed';
    if (tasks.length > 0) {
      project.progress = Math.round((tasks.filter(isDone).length / tasks.length) * 100);
    } else {
      const total = stages.length || 1;
      project.progress = Math.round((stages.filter(isDone).length / total) * 100);
    }

    // 健康度：与每日定时重算共用同一规则（见 project-health.ts）
    project.health = evaluateHealth({
      status: project.status,
      progress: project.progress,
      endDate: project.endDate,
      stages,
      risks,
    }).health;

    // 业务状态
    if (project.progress === 100) project.businessStatus = '已完成';
    else if (project.progress > 0) project.businessStatus = '进行中';
    else project.businessStatus = '未启动';

    await this.projectRepository.save(project);
  }

  // ── 项目结项报告 ──

  /**
   * 汇总项目全链路数据，生成结构化结项报告。
   *
   * 覆盖用户手册要求的九个板块：项目基本信息、目标与范围、计划与实际、
   * 交付成果、变更与问题、合同金额与回款、成本与利润（标注待核算）、
   * 遗留事项、售后安排。前端拿到 JSON 后渲染或导出 PDF。
   */
  async generateCompletionReport(id: string, user: CurrentUser): Promise<any> {
    const project = await this.projectRepository.findOne({ where: { id } });
    if (!project) throw new NotFoundException('项目不存在');
    if (!this.permissionService.canAccess(user, this.toSubject(project))) {
      throw new BadRequestException('无权访问该项目');
    }
    if (!this.permissionService.isSingleMode() && !user?.isSystemAdmin && project.managerId !== user?.userId) {
      const manager = await this.memberRepository.findOne({ where: { projectId: id, userId: user?.userId, role: 'manager' } });
      if (!manager) throw new ForbiddenException('仅项目负责人或管理员可查看含报价、回款的结项报告');
    }

    const [
      stages, risks, tasks, members, timelines,
      requirement, proposal, quotation, quotationItems,
      contract, payments, customer,
    ] = await Promise.all([
      this.stageRepository.find({ where: { projectId: id } }),
      this.riskRepository.find({ where: { projectId: id } }),
      this.taskRepository.find({ where: { projectId: id } }),
      this.memberRepository.find({ where: { projectId: id } }),
      this.timelineRepository.find({ where: { projectId: id }, order: { createdAt: 'DESC' }, take: 20 }),
      project.requirementId
        ? this.projectRepository.manager.findOne(Requirement, { where: { id: project.requirementId } })
        : null,
      project.proposalId
        ? this.projectRepository.manager.findOne(Proposal, { where: { id: project.proposalId } })
        : null,
      project.quotationId
        ? this.projectRepository.manager.findOne(Quotation, { where: { id: project.quotationId } })
        : null,
      project.quotationId
        ? this.projectRepository.manager.find(QuotationItem, { where: { quotationId: project.quotationId } })
        : [],
      project.contractId
        ? this.projectRepository.manager.findOne(Contract, { where: { id: project.contractId } })
        : null,
      project.contractId
        ? this.projectRepository.manager.find(ContractPayment, { where: { contractId: project.contractId } })
        : [],
      project.customerId
        ? this.projectRepository.manager.findOne(Customer, { where: { id: project.customerId } })
        : null,
    ]);

    // 回款汇总
    const round2 = (n: any) => Math.round(Number(n || 0) * 100) / 100;
    const totalDue = round2((payments as ContractPayment[]).reduce<number>((s, p) => s + Number(p.dueAmount || 0), 0));
    const totalReceived = round2((payments as ContractPayment[]).reduce<number>((s, p) => s + Number(p.receivedAmount || 0), 0));
    const contractAmount = round2(contract?.amount);
    const outstanding = round2(Math.max(totalDue - totalReceived, 0));

    // 任务完成统计
    const doneTasks = tasks.filter((t) => t.status === 'done' || t.status === 'completed');
    const undoneTasks = tasks.filter((t) => t.status !== 'done' && t.status !== 'completed' && t.status !== 'cancelled');

    // 阶段完成统计
    const doneStages = stages.filter((s) => s.status === 'done' || s.status === 'completed');

    // 报价毛利（标注为报价口径，非实际成本）
    const totalCost = round2((quotationItems as QuotationItem[]).reduce<number>((s, it) => s + Number(it.cost || 0) * Number(it.quantity || 1), 0));
    const quoteMargin = contractAmount > 0
      ? round2(((contractAmount - totalCost) / contractAmount) * 1000) / 10
      : null;

    return {
      generatedAt: new Date().toISOString(),
      project: {
        id: project.id,
        projectNo: project.projectNo,
        name: project.name,
        status: project.status,
        progress: project.progress,
        dealStage: project.dealStage,
        startDate: project.startDate,
        endDate: project.endDate,
        description: project.description,
      },
      customer: customer ? { id: customer.id, name: customer.name, code: customer.code } : null,
      team: {
        managerId: project.managerId,
        memberCount: members.length + (project.managerId ? 1 : 0),
        members: members.map((m) => ({ userId: m.userId, role: m.role })),
      },
      scope: {
        requirement: requirement ? {
          title: requirement.title,
          description: requirement.description?.slice(0, 500),
          confirmedAt: requirement.updatedAt,
        } : null,
        proposal: proposal ? { title: proposal.title, type: proposal.proposalType } : null,
        quotation: quotation ? {
          quotationNo: quotation.quotationNo,
          amount: quotation.amount,
          itemCount: quotationItems.length,
        } : null,
      },
      execution: {
        totalStages: stages.length,
        completedStages: doneStages.length,
        stages: stages.map((s) => ({ name: s.name, status: s.status, startDate: s.startDate, endDate: s.endDate })),
        totalTasks: tasks.length,
        completedTasks: doneTasks.length,
        taskCompletionRate: tasks.length > 0 ? Math.round((doneTasks.length / tasks.length) * 100) : 0,
        timelines: timelines.map((t) => ({ action: t.action, createdAt: t.createdAt })),
      },
      financials: {
        contract: contract ? {
          contractNo: contract.contractNo,
          amount: contractAmount,
          status: contract.status,
          signedDate: contract.signedDate,
          paymentTerms: contract.paymentTerms,
        } : null,
        payments: {
          nodes: payments.map((p) => ({
            nodeName: p.nodeName, dueAmount: p.dueAmount, dueDate: p.dueDate,
            receivedAmount: p.receivedAmount, receivedDate: p.receivedDate, invoiceNo: p.invoiceNo,
          })),
          summary: {
            totalDue, totalReceived, outstanding,
            uncovered: round2(Math.max(contractAmount - totalDue, 0)),
            receivedRatio: totalDue > 0 ? Math.round((totalReceived / totalDue) * 100) : 0,
          },
        },
        // 报价口径毛利（非实际成本利润——实际成本需财务确认后另行核算）
        estimatedMargin: {
          quotedAmount: contractAmount,
          estimatedCost: totalCost,
          estimatedGrossProfit: round2(contractAmount - totalCost),
          estimatedMarginPercent: quoteMargin,
          note: '基于报价明细中的成本字段估算，非财务确认的实际利润',
        },
      },
      risks: risks.map((r) => ({
        title: r.title, level: r.level, status: r.status,
        description: r.description, mitigation: (r as any).mitigation,
      })),
      pending: {
        incompleteTasks: undoneTasks.map((t) => ({ title: t.title, status: t.status, assignedTo: t.assignedTo })),
        outstandingPayments: outstanding > 0 ? `尚有 ${outstanding} 元未收回` : '回款已结清',
      },
      afterSales: {
        suggestion: '项目完成后请在售后模块创建质保工单，记录质保期巡检和故障处理。',
        warrantyExpiry: (contract as any)?.warrantyExpiryDate || null,
      },
    };
  }
}
