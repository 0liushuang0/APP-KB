import { buildCustomerContent } from '../../common/services/index-content.builder';
import { BusinessTrashService } from '../recycle-bin/business-trash.service';
import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Like, In } from 'typeorm';
import { Customer, ContactPerson, FollowUpRecord } from './entities/customer.entity';
import { CreateCustomerDto, UpdateCustomerDto, CreateContactPersonDto, UpdateContactPersonDto, CreateFollowUpDto, QueryCustomerDto } from './dto/customer.dto';
import { CurrentUser, PermissionService } from '../../common/services/permission.service';
import { PermissionQueryService } from '../../common/services/permission-query.service';
import { paginate, PaginatedResult } from '../../common/dto/pagination.dto';
import { KnowledgeSyncService } from '../../common/services/knowledge-sync.service';
import { TransactionService } from '../../common/services/transaction.service';
import { ApprovalsService } from '../approvals/approvals.service';
import { NumberingService } from '../../common/services/numbering.service';
import { Project } from '../projects/entities/project.entity';
import { DocumentLink } from '../projects/entities/document-link.entity';
import { Document } from '../documents/entities/document.entity';
import { Requirement } from '../requirements/entities/requirement.entity';
import { Proposal } from '../proposals/entities/proposal.entity';
import { Quotation, QuotationItem } from '../quotations/entities/quotation.entity';
import { Contract } from '../contracts/entities/contract.entity';
import { AfterSalesTicket } from '../after-sales/entities/ticket.entity';
import { AiService } from '../../common/services/ai.service';
import { toCny } from '../../common/utils/currency.util';
import { buildTimeline, parseFollowUpText, FollowUpDraft, TimelineEvent } from './customer-timeline';
import {
  DEFAULT_REGION_DICT, REGION_DICT_KEY, RegionDict, loadRegionDict, normalizeRegion, parseRegionDict,
} from '../../common/utils/region.util';

@Injectable()
export class CustomersService {
  constructor(
    @InjectRepository(Customer)
    private customerRepository: Repository<Customer>,
    @InjectRepository(ContactPerson)
    private contactRepository: Repository<ContactPerson>,
    @InjectRepository(FollowUpRecord)
    private followUpRepository: Repository<FollowUpRecord>,
    @InjectRepository(Project)
    private projectRepository: Repository<Project>,
    @InjectRepository(DocumentLink)
    private documentLinkRepository: Repository<DocumentLink>,
    @InjectRepository(Document)
    private documentRepository: Repository<Document>,
    @InjectRepository(Requirement)
    private requirementRepository: Repository<Requirement>,
    @InjectRepository(Proposal)
    private proposalRepository: Repository<Proposal>,
    @InjectRepository(Quotation)
    private quotationRepository: Repository<Quotation>,
    @InjectRepository(QuotationItem)
    private quotationItemRepository: Repository<QuotationItem>,
    @InjectRepository(Contract)
    private contractRepository: Repository<Contract>,
    @InjectRepository(AfterSalesTicket)
    private ticketRepository: Repository<AfterSalesTicket>,
    private permissionService: PermissionService,
    private knowledgeSyncService: KnowledgeSyncService,
    private transactionService: TransactionService,
    private approvalsService: ApprovalsService,
    private permissionQuery: PermissionQueryService,
    private numbering: NumberingService,
    private aiService: AiService,
    private readonly trash: BusinessTrashService,
  ) {}

  /** 列表（服务端分页，权限已下沉到 SQL） */
  async findAll(query: QueryCustomerDto, user: CurrentUser): Promise<PaginatedResult<Customer>> {
    const qb = this.customerRepository.createQueryBuilder('c');

    if (query.status) qb.andWhere('c.status = :status', { status: query.status });
    if (query.level) qb.andWhere('c.level = :level', { level: query.level });
    if (query.businessStatus) qb.andWhere('c.businessStatus = :bs', { bs: query.businessStatus });
    if (query.industry) qb.andWhere('c.industry = :industry', { industry: query.industry });
    if (query.region) {
      // 按标准值筛时把它的别名一起带上：历史值还没归并时也筛得全
      const dict = await loadRegionDict(this.customerRepository.manager);
      const hit = dict.regions.find((r) => r.value === query.region);
      const values = [query.region, ...(hit?.aliases || []), ...(hit?.value === '海外' ? Object.keys(dict.overseas) : [])];
      qb.andWhere('c.region IN (:...regions)', { regions: values });
    }
    if (query.customerType) qb.andWhere('c.customerType = :ct', { ct: query.customerType });
    if (query.keyword) {
      // 名称/简称/代号/行业/地区 + 联系人姓名/电话/邮箱 一起搜：
      // 不少客户是凭联系人或地区找的，之前 keyword 不含这些就搜不到。
      qb.andWhere(
        `(c.name LIKE :kw OR c.code LIKE :kw OR c.customerCode LIKE :kw
          OR c.industry LIKE :kw OR c.region LIKE :kw OR c.email LIKE :kw OR c.phone LIKE :kw
          OR EXISTS (
            SELECT 1 FROM contact_persons cp
            WHERE cp."customerId" = c.id
              AND (cp.name LIKE :kw OR cp.phone LIKE :kw OR cp.email LIKE :kw OR cp.wechat LIKE :kw)
          ))`,
        { kw: `%${query.keyword}%` },
      );
    }
    qb.leftJoinAndSelect('c.department', 'department');

    this.permissionQuery.apply(qb, 'c', user);

    const result = await paginate(qb, 'c', query, ['createdAt', 'name', 'status', 'code', 'customerCode', 'industry'], { field: 'customerCode', order: 'ASC' });

    /*
     * 附件计数：客户附件没有输入/输出语义，显示单个数字。
     * 口径 = 客户自己上传的附件（linkRole=reference 直接挂 customerId，
     * 即编辑弹窗/客户资料页传的公司介绍等）。方案/报价等业务环节同步
     * 进来的资料（source/deliverable）不算在内 —— 那些挂在对应单据上，
     * 各自列表的徽标里数。
     */
    const ids = result.list.map((c) => c.id);
    const counts = ids.length
      ? await this.documentLinkRepository.manager
          .createQueryBuilder()
          .select('l."customerId"', 'id')
          .addSelect('COUNT(*)', 'n')
          .from('document_links', 'l')
          // 条件分开写：where 字符串里混引号字面量会干扰 TypeORM 的 :...ids 参数替换
          .where('l."customerId" IN (:...ids)', { ids })
          .andWhere("l.\"linkRole\" = 'reference'")
          .groupBy('l."customerId"')
          .getRawMany<{ id: string; n: string }>()
      : [];
    const cmap = new Map(counts.map((c) => [c.id, Number(c.n)]));

    return {
      ...result,
      list: result.list.map((c) => ({ ...c, attachmentTotal: cmap.get(c.id) || 0 })),
    };
  }

  /**
   * 客户资料总览：「客户资料」页左侧「公司 → 阶段」导航的数据源。
   *
   * 一次请求拿一页客户（默认前 10 家，支持翻页与顶栏关键词搜索）及每家
   * 各阶段的资料条数 —— 不然前端得对每家公司各打一次 /360 才能画出阶段计数。
   * 阶段分桶展示由前端完成（库里的 stage 有历史中文值与项目 dealStage 值）。
   */
  async docOverview(query: { keyword?: string; limit?: number; page?: number }, user: CurrentUser) {
    const limit = Math.min(50, Math.max(1, Number(query.limit) || 10));
    const pageNo = Math.max(1, Number(query.page) || 1);
    const page = await this.findAll({ keyword: query.keyword, page: pageNo, pageSize: limit } as QueryCustomerDto, user);
    const customers = page.list;
    if (!customers.length) return { customers: [], total: page.total };

    const ids = customers.map((c) => c.id);
    const rows = await this.documentLinkRepository
      .createQueryBuilder('l')
      .select('l.customerId', 'customerId')
      .addSelect('l.stage', 'stage')
      .addSelect('COUNT(*)', 'count')
      .where('l.customerId IN (:...ids)', { ids })
      .groupBy('l.customerId')
      .addGroupBy('l.stage')
      .getRawMany<{ customerId: string; stage: string; count: string | number }>();

    const byCustomer = new Map<string, Record<string, number>>();
    for (const row of rows) {
      const stages = byCustomer.get(row.customerId) || {};
      stages[row.stage] = Number(row.count);
      byCustomer.set(row.customerId, stages);
    }

    return {
      total: page.total,
      customers: customers.map((c) => {
        const stages = byCustomer.get(c.id) || {};
        return {
          id: c.id,
          name: c.name,
          code: c.customerCode || c.code,
          industry: c.industry,
          region: c.region,
          stages,
          docTotal: Object.values(stages).reduce((a, b) => a + b, 0),
        };
      }),
    };
  }


  async findOne(id: string, user: CurrentUser): Promise<Customer> {
    const customer = await this.customerRepository.findOne({
      where: { id },
      relations: ['contacts', 'followUps', 'department'],
    });
    if (!customer) throw new NotFoundException('客户不存在');
    if (!this.permissionService.canAccess(user, this.toSubject(customer))) {
      throw new BadRequestException('无权访问该客户');
    }
    return customer;
  }

  /** 日期列收到空串会让 PostgreSQL 报「无效的类型 date」(500): 空串一律当作未填 */
  private blankDates<T extends Record<string, any>>(dto: T): T {
    const out: Record<string, any> = { ...dto };
    for (const k of ['firstCooperationDate', 'lastDealDate']) {
      if (typeof out[k] === 'string' && !out[k].trim()) out[k] = null;
    }
    return out as T;
  }

  /**
   * 手填客户编号查重（忽略大小写），重号直接 400 并指明占用方。
   * 客户编号是业务上对外用的标识，库里曾出现两条 CUST-26-001 静默共存。
   * 留空不拦——新建走自动生成，编辑清空是另一码事。
   */
  private async assertCodeAvailable(code: string | undefined, excludeId?: string): Promise<void> {
    const wanted = (code || '').trim();
    if (!wanted) return;
    const qb = this.customerRepository
      .createQueryBuilder('c')
      .where('LOWER(c.customerCode) = LOWER(:code)', { code: wanted });
    if (excludeId) qb.andWhere('c.id != :id', { id: excludeId });
    const dup = await qb.getOne();
    if (dup) {
      throw new BadRequestException(`客户编号 ${wanted} 已被「${dup.name}」占用，请更换编号或留空自动生成`);
    }
  }

  /** 区域按字典归并成标准写法；海外客户顺带补国家（只补空的） */
  private async applyRegion<T extends { region?: string | null; country?: string | null; address?: string | null }>(dto: T): Promise<T> {
    if (dto.region === undefined) return dto;
    const n = normalizeRegion(dto.region, await loadRegionDict(this.customerRepository.manager), dto.address);
    const out: any = { ...dto, region: n.region };
    if (n.country && !dto.country) out.country = n.country;
    return out;
  }

  async create(dtoIn: CreateCustomerDto, user: CurrentUser): Promise<Customer> {
    const dto = await this.applyRegion(this.blankDates(dtoIn));
    const skipApproval = this.permissionService.skipApproval();
    await this.assertCodeAvailable(dto.customerCode);
    // 自动生成客户编号
    const customerCode = dto.customerCode || await this.numbering.next('customer');
    const saved = await this.transactionService.run(
      async (manager) => {
        const customer = manager.create(Customer, {
          ...dto,
          customerCode,
          ownerId: user?.userId,
          departmentId: dto.departmentId || user?.departmentId,
          status: skipApproval ? 'approved' : 'pending',
        });
        const savedCustomer = await manager.save(customer);
        if (!skipApproval) {
          await this.approvalsService.create({
            objectType: 'customer',
            objectId: savedCustomer.id,
            submittedBy: user?.userId,
            status: 'pending',
          }, manager);
        }
        return savedCustomer;
      },
      async (result) => { await this.sync(result); },
    );
    return saved;
  }

  async update(id: string, dto: UpdateCustomerDto, user: CurrentUser): Promise<Customer> {
    const customer = await this.findOne(id, user);
    if (!this.permissionService.canManage(user, this.toSubject(customer))) {
      throw new BadRequestException('无权修改该客户');
    }
    const { roleIds, groupIds, ...rest } = await this.applyRegion({ address: customer.address, ...this.blankDates(dto as any) });
    await this.assertCodeAvailable(rest.customerCode, id);
    Object.assign(customer, rest);
    if (roleIds !== undefined) customer.roleCodes = roleIds;
    if (groupIds !== undefined) customer.groupIds = groupIds;
    const saved = await this.customerRepository.save(customer);
    await this.sync(saved);
    return saved;
  }

  /**
   * 删除预检：返回该客户名下将被级联删除的业务链计数，供前端弹窗提示。
   *
   * 删客户是硬删整条链（需求/方案/报价/合同/项目及全部资料），不可恢复。
   * 不预先告知，用户根本不知道连带删了多少业务数据。
   */
  async removePreview(id: string, user: CurrentUser) {
    const customer = await this.findOne(id, user);
    if (!this.permissionService.canManage(user, this.toSubject(customer))) {
      throw new BadRequestException('无权删除该客户');
    }
    const [requirementsCount, proposalsCount, quotationsCount, contractsCount, projectsCount, docsCount] =
      await Promise.all([
        this.requirementRepository.count({ where: { customerId: id } }),
        this.proposalRepository.count({ where: { customerId: id } }),
        this.quotationRepository.count({ where: { customerId: id } }),
        this.contractRepository.count({ where: { customerId: id } }),
        this.projectRepository.count({ where: { customerId: id } }),
        this.documentLinkRepository.count({ where: { customerId: id } }),
      ]);
    return {
      id,
      name: customer.name,
      requirementsCount,
      proposalsCount,
      quotationsCount,
      contractsCount,
      projectsCount,
      docsCount,
      hasImpact:
        requirementsCount + proposalsCount + quotationsCount + contractsCount + projectsCount + docsCount > 0,
    };
  }

  /**
   * 删除客户：级联清理整条客户链（需求→方案→报价→项目及其子表），
   * 全程事务保护，向量和文件清理放事务外。
   * 之前只删客户主行，下游所有记录的 customerId 全部悬空成脏数据。
   */
  async remove(id: string, user: CurrentUser): Promise<void> {
    const customer = await this.findOne(id, user);
    if (!this.permissionService.canManage(user, this.toSubject(customer))) {
      throw new BadRequestException('无权删除该客户');
    }

    // 先收集要删的 id（事务外查，避免长事务里多次往返）
    const [requirements, proposals, quotations, contracts, projects] = await Promise.all([
      this.requirementRepository.find({ where: { customerId: id }, select: ['id'] }),
      this.proposalRepository.find({ where: { customerId: id }, select: ['id'] }),
      this.quotationRepository.find({ where: { customerId: id }, select: ['id'] }),
      this.contractRepository.find({ where: { customerId: id }, select: ['id'] }),
      this.projectRepository.find({ where: { customerId: id }, select: ['id'] }),
    ]);
    const reqIds = requirements.map((r) => r.id);
    const propIds = proposals.map((p) => p.id);
    const quoIds = quotations.map((q) => q.id);
    const conIds = contracts.map((c) => c.id);
    const prjIds = projects.map((p) => p.id);

    await this.transactionService.run(
      async (manager) => {
        // 从叶子往根删，用 createQueryBuilder 跨数据库兼容（SQLite ?/PG $N 由 TypeORM 处理）。
        // 列名必须加引号：raw where 片段不经列名替换，PG 会把 camelCase 折叠成小写导致删不掉
        const delByCol = async (table: string, col: string, ids: string[]) => {
          if (!ids.length) return;
          await manager.createQueryBuilder().delete().from(table).where(`"${col}" IN (:...ids)`, { ids }).execute();
        };
        // 先整套快照进回收站（主表在前，还原时按此顺序写回）
        const tickets = await manager.getRepository(AfterSalesTicket).find({ where: { customerId: id }, select: ['id'] });
        await this.trash.capture(manager, 'customer', id, customer.name || id, [
          { table: 'customers', column: 'id', ids: [id] },
          { table: 'contact_persons', column: 'customerId', ids: [id] },
          { table: 'follow_up_records', column: 'customerId', ids: [id] },
          { table: 'requirements', column: 'id', ids: reqIds },
          { table: 'proposals', column: 'id', ids: propIds },
          { table: 'quotations', column: 'id', ids: quoIds },
          { table: 'contracts', column: 'id', ids: conIds },
          { table: 'projects', column: 'id', ids: prjIds },
          { table: 'after_sales_tickets', column: 'id', ids: tickets.map((t) => t.id) },
          { table: 'requirement_attachments', column: 'requirementId', ids: reqIds },
          { table: 'proposal_versions', column: 'proposalId', ids: propIds },
          { table: 'quotation_items', column: 'quotationId', ids: quoIds },
          { table: 'project_stages', column: 'projectId', ids: prjIds },
          { table: 'project_risks', column: 'projectId', ids: prjIds },
          { table: 'project_timeline', column: 'projectId', ids: prjIds },
          { table: 'document_links', column: 'customerId', ids: [id] },
          { table: 'document_links', column: 'requirementId', ids: reqIds },
          { table: 'document_links', column: 'proposalId', ids: propIds },
          { table: 'document_links', column: 'quotationId', ids: quoIds },
          { table: 'document_links', column: 'contractId', ids: conIds },
          { table: 'document_links', column: 'projectId', ids: prjIds },
        ], user?.userId);
        await delByCol('quotation_items', 'quotationId', quoIds);
        await delByCol('proposal_versions', 'proposalId', propIds);
        await delByCol('project_stages', 'projectId', prjIds);
        await delByCol('project_risks', 'projectId', prjIds);
        await delByCol('project_timeline', 'projectId', prjIds);
        await delByCol('requirement_attachments', 'requirementId', reqIds);

        // document_links 按各实体 id 清理
        await manager.getRepository(DocumentLink).delete({ customerId: id });
        await delByCol('document_links', 'requirementId', reqIds);
        await delByCol('document_links', 'proposalId', propIds);
        await delByCol('document_links', 'quotationId', quoIds);
        await delByCol('document_links', 'contractId', conIds);
        await delByCol('document_links', 'projectId', prjIds);

        // 主链六张表
        await manager.getRepository(Quotation).delete({ customerId: id });
        await manager.getRepository(Contract).delete({ customerId: id });
        await manager.getRepository(AfterSalesTicket).delete({ customerId: id });
        await manager.getRepository(Proposal).delete({ customerId: id });
        await manager.getRepository(Project).delete({ customerId: id });
        await manager.getRepository(Requirement).delete({ customerId: id });

        // 客户自己的子表
        await manager.getRepository(FollowUpRecord).delete({ customerId: id });
        await manager.getRepository(ContactPerson).delete({ customerId: id });
        await manager.getRepository(Customer).delete(id);
      },
      async () => {
        // 向量清理（HTTP，事务外）
        await this.knowledgeSyncService.deleteObject('customer', id);
        await Promise.all(reqIds.map((rid) => this.knowledgeSyncService.deleteObject('requirement', rid)));
        await Promise.all(propIds.map((pid) => this.knowledgeSyncService.deleteObject('proposal', pid)));
        await Promise.all(quoIds.map((qid) => this.knowledgeSyncService.deleteObject('quotation', qid)));
        await Promise.all(conIds.map((cid) => this.knowledgeSyncService.deleteObject('contract', cid)));
        await Promise.all(prjIds.map((pid) => this.knowledgeSyncService.deleteObject('project', pid)));
      },
    );
  }

  async approve(id: string, user: CurrentUser): Promise<Customer> {
    if (!this.permissionService.canApprove(user)) throw new BadRequestException('无权审核');
    const customer = await this.customerRepository.findOne({ where: { id } });
    if (!customer) throw new NotFoundException('客户不存在');
    customer.status = 'approved';
    const saved = await this.transactionService.run(
      async (manager) => {
        const updated = await manager.save(customer);
        await this.approvalsService.approve('customer', id, user?.userId, '审核通过', manager);
        return updated;
      },
    );
    return saved;
  }

  async addContact(dto: CreateContactPersonDto, user: CurrentUser): Promise<ContactPerson> {
    await this.assertCustomerAccessible(dto.customerId, user);
    const contact = this.contactRepository.create(dto);
    return this.contactRepository.save(contact);
  }

  /**
   * 修改联系人。
   *
   * 补这个接口之前，前端"编辑客户"保存时是把所有联系人重新 addContact 一遍 ——
   * contact_persons 表上没有唯一约束，于是每保存一次联系人就翻一倍。
   * 有了按 id 更新，前端才能做到"老的改、新的加、删的删"。
   */
  async updateContact(
    id: string,
    dto: UpdateContactPersonDto,
    user: CurrentUser,
  ): Promise<ContactPerson> {
    const contact = await this.contactRepository.findOne({ where: { id } });
    if (!contact) throw new NotFoundException('联系人不存在');
    await this.assertCustomerAccessible(contact.customerId, user);
    Object.assign(contact, dto);
    return this.contactRepository.save(contact);
  }

  async removeContact(id: string, user: CurrentUser): Promise<void> {
    const contact = await this.contactRepository.findOne({ where: { id } });
    if (!contact) throw new NotFoundException('联系人不存在');
    await this.assertCustomerAccessible(contact.customerId, user);
    await this.contactRepository.delete(id);
  }

  /** 联系人的增删改都要按其所属客户判权，抽出来避免三处写法漂移 */
  private async assertCustomerAccessible(customerId: string, user: CurrentUser): Promise<void> {
    const customer = await this.customerRepository.findOne({ where: { id: customerId } });
    if (!customer) throw new NotFoundException('客户不存在');
    if (!this.permissionService.canAccess(user, this.toSubject(customer))) {
      throw new BadRequestException('无权访问该客户');
    }
  }

  async addFollowUp(dto: CreateFollowUpDto, user: CurrentUser): Promise<FollowUpRecord> {
    const customer = await this.customerRepository.findOne({ where: { id: dto.customerId } });
    if (!customer) throw new NotFoundException('客户不存在');
    if (!this.permissionService.canAccess(user, this.toSubject(customer))) {
      throw new BadRequestException('无权访问该客户');
    }
    const record = this.followUpRepository.create({
      ...dto,
      createdBy: user?.userId,
    });
    return this.followUpRepository.save(record);
  }

  /**
   * 区域字典 + 现有区域写法的归并预览：每个现有写法有多少家、会归到哪里。
   */
  async regionDictView() {
    const m = this.customerRepository.manager;
    const dict = await loadRegionDict(m);
    const rows: Array<{ id: string; region: string | null; country: string | null; address: string | null }> = await m
      .createQueryBuilder()
      .select(['c.id AS id', 'c.region AS region', 'c.country AS country', 'c.address AS address'])
      .from('customers', 'c')
      .getRawMany();
    const usage = new Map<string, { value: string; count: number; to: string | null; status: string; countries: Record<string, number> }>();
    let changes = 0;
    for (const r of rows) {
      const key = r.region || '';
      const n = normalizeRegion(r.region, dict, r.address);
      const u = usage.get(key) || { value: key, count: 0, to: n.region, status: n.status, countries: {} };
      u.count++;
      const country = r.country || n.country;
      if (country) u.countries[country] = (u.countries[country] || 0) + 1;
      usage.set(key, u);
      if ((n.region || null) !== (r.region || null) || (!r.country && n.country)) changes++;
    }
    return {
      dict,
      isDefault: JSON.stringify(dict) === JSON.stringify(DEFAULT_REGION_DICT),
      usage: [...usage.values()].sort((a, b) => b.count - a.count),
      changes,
    };
  }

  async saveRegionDict(dict: RegionDict): Promise<RegionDict> {
    const clean = parseRegionDict(JSON.stringify(dict || {}));
    const repo = this.customerRepository.manager.getRepository('SystemConfig');
    const row: any = await repo.findOne({ where: { key: REGION_DICT_KEY } });
    if (row) {
      row.value = JSON.stringify(clean);
      await repo.save(row);
    } else {
      await repo.save(repo.create({ key: REGION_DICT_KEY, value: JSON.stringify(clean), category: 'customer', description: '客户区域字典（标准值、别名、境外国家/片区）' }));
    }
    return clean;
  }

  /**
   * 按字典把历史区域写法一次性归并（dryRun=true 只返回将要改的清单）。
   * 只改区域与空着的国家，其它字段不动；认不出的写法原样保留。
   */
  async applyRegionDict(dryRun = true) {
    const m = this.customerRepository.manager;
    const dict = await loadRegionDict(m);
    const rows: Array<{ id: string; name: string; region: string | null; country: string | null; address: string | null }> = await m
      .createQueryBuilder()
      .select(['c.id AS id', 'c.name AS name', 'c.region AS region', 'c.country AS country', 'c.address AS address'])
      .from('customers', 'c')
      .getRawMany();
    const changes: Array<{ id: string; name: string; from: string | null; to: string | null; country?: string | null }> = [];
    for (const r of rows) {
      const n = normalizeRegion(r.region, dict, r.address);
      const regionChanged = (n.region || null) !== (r.region || null);
      const countryFilled = !r.country && !!n.country;
      if (!regionChanged && !countryFilled) continue;
      changes.push({ id: r.id, name: r.name, from: r.region, to: n.region, country: countryFilled ? n.country : r.country });
      if (!dryRun) {
        await this.customerRepository.update(r.id, {
          region: n.region as any,
          ...(countryFilled ? { country: n.country as any } : {}),
        });
      }
    }
    return { dryRun, total: rows.length, changed: changes.length, changes };
  }

  /** 删除一条沟通记录（录错了要能改） */
  async removeFollowUp(id: string, user: CurrentUser): Promise<void> {
    const record = await this.followUpRepository.findOne({ where: { id } });
    if (!record) throw new NotFoundException('沟通记录不存在');
    await this.assertCustomerAccessible(record.customerId, user);
    await this.followUpRepository.delete(id);
  }

  /**
   * 统一时间线：沟通、需求记录、工作任务、单据（需求/方案/报价/合同/项目/售后/回款）、资料上传、单据修改，
   * 按时间倒序排成一条线。权限沿用客户 360：每类子记录按各自可见性过滤后再合并。
   */
  async getTimeline(id: string, user: CurrentUser, limit = 300): Promise<{ events: TimelineEvent[]; counts: Record<string, number> }> {
    const c360: any = await this.getCustomer360(id, user);
    const m = this.customerRepository.manager;
    const reqIds: string[] = c360.requirements.map((r: any) => String(r.id));
    const contractIds: string[] = c360.contracts.map((c: any) => String(c.id));

    const [logs, taskRows, payments, userRows] = await Promise.all([
      reqIds.length
        ? m.createQueryBuilder()
            .select(['l.id AS id', 'l."requirementId" AS "requirementId"', 'l.type AS type', 'l.content AS content',
              'l."actorId" AS "actorId"', 'l."actorName" AS "actorName"', 'l."createdAt" AS "createdAt"'])
            .from('requirement_logs', 'l')
            .where('l."requirementId" IN (:...ids)', { ids: reqIds })
            .getRawMany()
        : Promise.resolve([]),
      m.createQueryBuilder()
        .select(['t.id AS id', 't."taskNo" AS "taskNo"', 't.title AS title', 't.content AS content', 't.status AS status',
          't."workDate" AS "workDate"', 't."createdAt" AS "createdAt"', 't."ownerId" AS "ownerId"', 't.visibility AS visibility',
          't."departmentId" AS "departmentId"', 't."groupIds" AS "groupIds"', 't."roleCodes" AS "roleCodes"'])
        .from('work_tasks', 't')
        .where('t."customerId" = :cid', { cid: id })
        .getRawMany(),
      contractIds.length
        ? m.createQueryBuilder()
            .select(['p.id AS id', 'p."contractId" AS "contractId"', 'p."nodeName" AS "nodeName"', 'p."receivedDate" AS "receivedDate"',
              'p."receivedAmount" AS "receivedAmount"', 'p."dueAmount" AS "dueAmount"'])
            .from('contract_payments', 'p')
            .where('p."contractId" IN (:...ids)', { ids: contractIds })
            .andWhere('p."receivedDate" IS NOT NULL')
            .getRawMany()
        : Promise.resolve([]),
      m.createQueryBuilder().select(['u.id AS id', 'u.nickname AS nickname', 'u.username AS username']).from('users', 'u').getRawMany(),
    ]);
    const split = (v: any) => (Array.isArray(v) ? v : String(v || '').split(',').filter(Boolean));
    const tasks = taskRows.filter((t: any) =>
      this.permissionService.canAccess(user, {
        visibility: t.visibility || 'private', uploaderId: t.ownerId, departmentId: t.departmentId,
        groupIds: split(t.groupIds), roleCodes: split(t.roleCodes),
      }),
    );

    // 单据修改记录：只取当前用户看得到的那些单据
    const refNo = new Map<string, string>();
    for (const r of c360.requirements) refNo.set(String(r.id), r.requirementNo);
    for (const p of c360.proposals) refNo.set(String(p.id), p.proposalNo);
    for (const q of c360.quotations) refNo.set(String(q.id), q.quotationNo);
    for (const c of c360.contracts) refNo.set(String(c.id), c.contractNo);
    for (const p of c360.projects) refNo.set(String(p.id), p.projectNo);
    for (const t of c360.tickets || []) refNo.set(String(t.id), t.ticketNo);
    const objectIds = [...refNo.keys(), String(id)];
    const changes = await m
      .createQueryBuilder()
      .select(['a.id AS id', 'a."objectType" AS "objectType"', 'a."objectId" AS "objectId"', 'a.detail AS detail',
        'a."userId" AS "userId"', 'a."createdAt" AS "createdAt"'])
      .from('audit_logs', 'a')
      .where('a."objectId" IN (:...ids)', { ids: objectIds })
      .andWhere("a.action = 'update'")
      .orderBy('a."createdAt"', 'DESC')
      .limit(400)
      .getRawMany();

    const contractNo = new Map(c360.contracts.map((c: any) => [String(c.id), c]));
    const reqNo = new Map(c360.requirements.map((r: any) => [String(r.id), r.requirementNo]));
    const events = buildTimeline(
      {
        followUps: c360.followUps,
        requirements: c360.requirements,
        proposals: c360.proposals,
        quotations: c360.quotations,
        contracts: c360.contracts,
        projects: c360.projects,
        tickets: c360.tickets,
        documents: c360.documents,
        logs: logs.map((l: any) => ({ ...l, requirementNo: reqNo.get(String(l.requirementId)) })),
        tasks,
        payments: payments.map((p: any) => {
          const c: any = contractNo.get(String(p.contractId));
          return { ...p, contractNo: c?.contractNo, currency: c?.currency };
        }),
        changes: changes.map((ch: any) => ({ ...ch, refNo: refNo.get(String(ch.objectId)) })),
        users: new Map(userRows.map((u: any) => [String(u.id), u.nickname || u.username])),
      },
      limit,
    );
    const counts: Record<string, number> = {};
    for (const e of events) counts[e.group] = (counts[e.group] || 0) + 1;
    return { events, counts };
  }

  /**
   * 粘贴的邮件 / 微信聊天 → 沟通记录草稿（不直接保存，给人核对后再存）。
   * 先用规则抽（邮件头、聊天格式、下一步句子），大模型可用时再让它整理成摘要与字段；大模型失败就用规则结果。
   */
  async parseFollowUp(customerId: string, text: string, user: CurrentUser): Promise<FollowUpDraft & { aiUsed: boolean }> {
    await this.assertCustomerAccessible(customerId, user);
    const raw = String(text || '').trim();
    if (!raw) throw new BadRequestException('请粘贴邮件或聊天内容');
    const rule = parseFollowUpText(raw);
    try {
      const reply = await this.aiService.chat(
        [
          {
            role: 'system',
            content:
              '你是销售助理。把用户粘贴的客户邮件或聊天记录整理成一条沟通记录，只输出 JSON，不要解释。字段：' +
              'method(邮件/微信/电话/拜访/会议/展会 之一), followUpAt(沟通日期 YYYY-MM-DD，原文没有就空串), ' +
              'participants(我方参与人), customerParticipants(客户方参与人), content(200 字内中文摘要：客户说了什么、我方答复了什么), ' +
              'focusPoints(客户关注点，一句话), nextAction(下一步行动，一句话), deadline(下一步截止日期 YYYY-MM-DD，没有就空串)。' +
              '只依据原文，不要编造；英文原文也用中文写摘要。',
          },
          { role: 'user', content: raw.slice(0, 8000) },
        ],
        'requirement',
      );
      const m = reply.match(/\{[\s\S]*\}/);
      if (!m) return { ...rule, aiUsed: false };
      const ai = JSON.parse(m[0]);
      const date = (v: any) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? new Date(`${v.slice(0, 10)}T12:00:00`).toISOString() : null);
      const methods = ['邮件', '微信', '电话', '拜访', '会议', '展会'];
      return {
        method: methods.includes(ai.method) ? ai.method : rule.method,
        followUpAt: date(ai.followUpAt) || rule.followUpAt,
        participants: String(ai.participants || rule.participants || ''),
        customerParticipants: String(ai.customerParticipants || rule.customerParticipants || ''),
        // 摘要放前面、原文附后：摘要方便扫读，原文留作依据
        content: ai.content ? `${String(ai.content).trim()}

—— 原文 ——
${rule.content}`.slice(0, 6000) : rule.content,
        focusPoints: String(ai.focusPoints || rule.focusPoints || ''),
        nextAction: String(ai.nextAction || rule.nextAction || ''),
        deadline: date(ai.deadline),
        aiUsed: true,
      };
    } catch {
      return { ...rule, aiUsed: false };
    }
  }

  /**
   * 客户 360 视图。
   * 入口有客户级 canAccess 校验，但子记录（需求/方案/报价/项目/文档）可能比客户更严格——
   * 之前一次性 find 全部返回，能看客户的人就能看到该客户所有 private 子记录。
   * 现在对每类子记录按各自的 visibility 做 canAccess 过滤。
   */
  async getCustomer360(id: string, user: CurrentUser) {
    const customer = await this.findOne(id, user);

    const [projects, requirements, proposals, quotations, contracts, docLinks, followUps, tickets] = await Promise.all([
      this.projectRepository.find({ where: { customerId: id }, order: { createdAt: 'DESC' } }),
      this.requirementRepository.find({ where: { customerId: id }, order: { createdAt: 'DESC' } }),
      this.proposalRepository.find({ where: { customerId: id }, order: { createdAt: 'DESC' } }),
      this.quotationRepository.find({ where: { customerId: id }, order: { createdAt: 'DESC' } }),
      this.contractRepository.find({ where: { customerId: id }, order: { createdAt: 'DESC' } }),
      this.documentLinkRepository.find({ where: { customerId: id }, order: { createdAt: 'DESC' } }),
      this.followUpRepository.find({ where: { customerId: id }, order: { followUpAt: 'DESC' } }),
      this.ticketRepository.find({ where: { customerId: id }, order: { createdAt: 'DESC' } }),
    ]);

    // 逐行权限过滤：只返回当前用户有权访问的子记录
    const filterByAccess = <T extends object>(rows: T[], toSubject: (r: T) => any) =>
      rows.filter((r) => this.permissionService.canAccess(user, toSubject(r)));

    const visibleProjects = filterByAccess(projects, (p: any) => ({
      visibility: p.visibility, uploaderId: p.managerId, departmentId: p.departmentId,
      groupIds: p.groupIds, roleCodes: p.roleCodes,
    }));
    const visibleRequirements = filterByAccess(requirements, (r: any) => this.reqSubject(r));
    const visibleProposals = filterByAccess(proposals, (p: any) => this.propSubject(p));
    const visibleQuotations = filterByAccess(quotations, (q: any) => this.quoSubject(q));
    const visibleContracts = filterByAccess(contracts, (c: any) => this.conSubject(c));

    // 文档按其可见性过滤（documentLink 本身无 visibility，看挂的 document）
    const docIds = docLinks.map((d) => d.documentId);
    const documents = docIds.length ? await this.documentRepository.findByIds(docIds) : [];
    const docMap = new Map(documents.map((d) => [d.id, d]));
    const visibleDocLinks = docLinks.filter((link) => {
      const doc = docMap.get(link.documentId);
      if (!doc) return false;
      return this.permissionService.canAccess(user, {
        visibility: doc.visibility, uploaderId: doc.uploaderId, departmentId: doc.departmentId,
        groupIds: doc.groupIds, roleCodes: doc.roleCodes,
      });
    });

    const documentsByStage = {
      raw: visibleDocLinks.filter((d) => d.stage === 'raw'),
      requirement: visibleDocLinks.filter((d) => d.stage === 'requirement'),
      analysis: visibleDocLinks.filter((d) => d.stage === 'analysis'),
      solution: visibleDocLinks.filter((d) => d.stage === 'solution'),
      quotation: visibleDocLinks.filter((d) => d.stage === 'quotation'),
      contract: visibleDocLinks.filter((d) => d.stage === 'contract'),
    };

    const wonProjects = visibleProjects.filter((p: any) => p.dealStage === 'won');
    const totalQuotationAmount = visibleQuotations.reduce(
      (sum, q: any) => sum + toCny(q.amount, q.currency, q.exchangeRate),
      0,
    );
    const totalContractAmount = visibleContracts.reduce(
      (sum, c: any) => sum + toCny(c.amount, c.currency, c.exchangeRate),
      0,
    );

    const projectsWithDocs = visibleProjects.map((p: any) => ({
      ...p,
      documentCount: visibleDocLinks.filter((d) => d.projectId === p.id).length,
    }));

    return {
      customer,
      stats: {
        totalProjects: visibleProjects.length,
        wonProjects: wonProjects.length,
        totalRequirements: visibleRequirements.length,
        totalProposals: visibleProposals.length,
        totalQuotations: visibleQuotations.length,
        totalContracts: visibleContracts.length,
        totalContractAmount,
        totalDocuments: visibleDocLinks.length,
        totalQuotationAmount,
      },
      projects: projectsWithDocs,
      requirements: visibleRequirements,
      proposals: visibleProposals,
      quotations: visibleQuotations,
      contracts: visibleContracts,
      followUps,
      tickets,
      documents: visibleDocLinks.map((link) => ({ ...link, document: docMap.get(link.documentId) })),
      documentsByStage,
    };
  }

  /**
   * 构建客户画像素材：产品需求（报价明细品名）、历史需求（需求标题）、
   * 采购历史（已签合同 + 产品），供相似匹配/交叉销售使用。
   */
  private async buildCustomerProfile(id: string) {
    const [requirements, quotations, contracts] = await Promise.all([
      this.requirementRepository.find({ where: { customerId: id }, order: { createdAt: 'DESC' }, take: 30 }),
      this.quotationRepository.find({ where: { customerId: id }, order: { createdAt: 'DESC' }, take: 30 }),
      this.contractRepository.find({ where: { customerId: id }, order: { createdAt: 'DESC' }, take: 30 }),
    ]);
    const quotationIds = quotations.map((q) => q.id);
    const items = quotationIds.length
      ? await this.quotationItemRepository.find({ where: { quotationId: In(quotationIds) } })
      : [];
    const products = [...new Set(items.map((i) => i.name).filter(Boolean))].slice(0, 20);
    const purchaseHistory = [
      ...contracts.filter((c) => c.status !== 'draft').map((c) => c.title || c.contractNo),
      ...products,
    ].slice(0, 30);
    return {
      products,
      requirements: requirements.map((r) => r.title).filter(Boolean),
      purchaseHistory,
    };
  }

  /**
   * 相似客户匹配：基于客户画像在已索引的客户知识库中检索相似客户，
   * 返回相似度、匹配原因与交叉销售机会（AI 服务 /customers/similar）。
   */
  async findSimilarCustomers(id: string, user: CurrentUser, topK = 5) {
    const customer = await this.findOne(id, user);
    const profile = await this.buildCustomerProfile(id);
    return this.aiService.findSimilarCustomers({
      customer_id: customer.id,
      name: customer.name,
      industry: customer.industry || '',
      scale: customer.scale || '',
      products: profile.products,
      requirements: profile.requirements,
      purchase_history: profile.purchaseHistory,
      top_k: topK,
    });
  }

  /**
   * 交叉销售分析：基于采购历史推荐配套产品（AI 服务 /customers/cross-sell）。
   * 无采购历史时直接返回空结果，避免 AI 服务 422。
   */
  async crossSell(id: string, user: CurrentUser) {
    const customer = await this.findOne(id, user);
    const profile = await this.buildCustomerProfile(id);
    if (!profile.purchaseHistory.length) {
      return {
        customer_id: customer.id,
        recommendations: [],
        total_opportunities: 0,
        message: '该客户暂无采购历史，无法进行交叉销售分析',
      };
    }
    return this.aiService.analyzeCrossSell(customer.id, profile.purchaseHistory);
  }

  /** 需求/方案/报价的权限快照提取（与各模块 toSubject 保持一致） */
  private reqSubject(r: any) {
    return { visibility: r.visibility, uploaderId: r.ownerId, departmentId: r.departmentId, groupIds: r.groupIds, roleCodes: r.roleCodes };
  }
  private propSubject(p: any) {
    return { visibility: p.visibility, uploaderId: p.ownerId, departmentId: p.departmentId, groupIds: p.groupIds, roleCodes: p.roleCodes };
  }
  private quoSubject(q: any) {
    return { visibility: q.visibility, uploaderId: q.ownerId, departmentId: q.departmentId, groupIds: q.groupIds, roleCodes: q.roleCodes };
  }
  private conSubject(c: any) {
    return { visibility: c.visibility, uploaderId: c.ownerId, departmentId: c.departmentId, groupIds: c.groupIds, roleCodes: c.roleCodes };
  }

  private async sync(customer: Customer): Promise<void> {
    // 与全量重建同一套内容(含等级、区域、联系方式、联系人): 日常保存后的索引不能比重建后的更差
    const content = buildCustomerContent({ customer, contacts: (customer as any).contacts });
    await this.knowledgeSyncService.syncObject({
      id: customer.id,
      objectType: 'customer',
      title: customer.name,
      content,
      visibility: customer.visibility,
      uploaderId: customer.ownerId,
      departmentId: customer.departmentId,
      groupIds: customer.groupIds,
      roleCodes: customer.roleCodes,
    });
  }

  private toSubject(customer: Customer) {
    return {
      visibility: customer.visibility,
      uploaderId: customer.ownerId,
      departmentId: customer.departmentId,
      groupIds: customer.groupIds,
      roleCodes: customer.roleCodes,
    };
  }
}
