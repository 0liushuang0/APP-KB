import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { AfterSalesTicket } from './entities/ticket.entity';
import { CreateTicketDto, UpdateTicketDto, QueryTicketDto } from './dto/ticket.dto';
import { TransactionService } from '../../common/services/transaction.service';
import { NumberingService } from '../../common/services/numbering.service';
import { KnowledgeSyncService } from '../../common/services/knowledge-sync.service';
import { PermissionService, CurrentUser } from '../../common/services/permission.service';
import { PermissionQueryService } from '../../common/services/permission-query.service';
import { paginate, PaginatedResult } from '../../common/dto/pagination.dto';

@Injectable()
export class AfterSalesService {
  private readonly logger = new Logger(AfterSalesService.name);

  constructor(
    @InjectRepository(AfterSalesTicket)
    private ticketRepository: Repository<AfterSalesTicket>,
    private numbering: NumberingService,
    private knowledgeSyncService: KnowledgeSyncService,
    private permissionService: PermissionService,
    private permissionQuery: PermissionQueryService,
    private readonly tx: TransactionService,
  ) {}

  async findAll(query: QueryTicketDto, user: CurrentUser): Promise<PaginatedResult<AfterSalesTicket>> {
    const qb = this.ticketRepository.createQueryBuilder('t');
    if (query.status) qb.andWhere('t.status = :status', { status: query.status });
    if (query.type) qb.andWhere('t.type = :type', { type: query.type });
    if (query.customerId) qb.andWhere('t.customerId = :cid', { cid: query.customerId });
    if (query.keyword) {
      qb.andWhere('(t.ticketNo LIKE :kw OR t.title LIKE :kw OR t.productModel LIKE :kw)', {
        kw: `%${query.keyword}%`,
      });
    }
    this.permissionQuery.apply(qb, 't', user);
    const result = await paginate(qb, 't', query, ['createdAt', 'ticketNo', 'status', 'priority']);
    return { ...result, list: await this.attachRelations(result.list) };
  }

  /** 贴上客户名/合同号 */
  private async attachRelations(rows: AfterSalesTicket[]): Promise<any[]> {
    if (!rows.length) return rows;
    const customerIds = [...new Set(rows.map((r) => r.customerId).filter(Boolean))];
    const contractIds = [...new Set(rows.map((r) => r.contractId).filter(Boolean))];

    const [customers, contracts] = await Promise.all([
      customerIds.length
        ? this.ticketRepository.manager
            .createQueryBuilder()
            .select(['c.id AS id', 'c.name AS name', 'c.code AS code'])
            .from('customers', 'c')
            .where('c.id IN (:...ids)', { ids: customerIds })
            .getRawMany<any>()
        : [],
      contractIds.length
        ? this.ticketRepository.manager
            .createQueryBuilder()
            .select(['con.id AS "id"', 'con.contractNo AS "contractNo"'])
            .from('contracts', 'con')
            .where('con.id IN (:...ids)', { ids: contractIds })
            .getRawMany<any>()
        : [],
    ]);
    const custMap = new Map(customers.map((c) => [c.id, c]));
    const conMap = new Map(contracts.map((c) => [c.id, c]));

    // 附件计数（source=输入 / deliverable=输出）：列表操作列回形针徽标用，与其他模块同一口径
    const ids = rows.map((t) => t.id);
    const counts = ids.length
      ? await this.ticketRepository.manager
          .createQueryBuilder()
          .select(['l."afterSaleId" AS "id"', 'l."linkRole" AS "role"', 'COUNT(*) AS "n"'])
          .from('document_links', 'l')
          .where('l."afterSaleId" IN (:...ids)', { ids })
          .groupBy('l."afterSaleId"')
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

    return rows.map((t) => {
      const c = t.customerId ? custMap.get(t.customerId) : null;
      const con = t.contractId ? conMap.get(t.contractId) : null;
      return {
        ...t,
        customerName: c?.name ?? null,
        customerShortName: c?.code || c?.name || null,
        contractNo: con?.contractNo,
        attachmentCounts: cmap.get(t.id) || { input: 0, output: 0 },
      };
    });
  }

  async findOne(id: string, user: CurrentUser): Promise<AfterSalesTicket> {
    const ticket = await this.ticketRepository.findOne({ where: { id } });
    if (!ticket) throw new NotFoundException('工单不存在');
    if (!this.permissionService.canAccess(user, this.toSubject(ticket))) {
      throw new BadRequestException('无权访问该工单');
    }
    return ticket;
  }

  async create(dto: CreateTicketDto, user: CurrentUser): Promise<AfterSalesTicket> {
    const ticketNo = await this.numbering.next('ticket');
    const ticket = this.ticketRepository.create({
      ...dto,
      ticketNo,
      ownerId: user?.userId,
      departmentId: user?.departmentId,
      status: dto.assignedTo ? 'assigned' : 'open',
    });
    const saved = await this.tx.run(
      async (manager) => manager.save(ticket),
      async (row) => { await this.sync(row); },
    );
    return saved;
  }

  async update(id: string, dto: UpdateTicketDto, user: CurrentUser): Promise<AfterSalesTicket> {
    const ticket = await this.findOne(id, user);
    if (!this.permissionService.canManage(user, this.toSubject(ticket))) {
      throw new BadRequestException('无权修改该工单');
    }
    // 状态变更自动补充时间戳
    if (dto.status === 'resolved' && !ticket.resolvedAt) {
      dto.resolvedAt = new Date().toISOString() as any;
    }
    Object.assign(ticket, dto);
    const saved = await this.tx.run(
      async (manager) => manager.save(ticket),
      async (row) => { await this.sync(row); },
    );
    return saved;
  }

  async remove(id: string, user: CurrentUser): Promise<void> {
    const ticket = await this.findOne(id, user);
    if (!this.permissionService.canManage(user, this.toSubject(ticket))) {
      throw new BadRequestException('无权删除该工单');
    }
    await this.tx.run(
      async (manager) => manager.getRepository(AfterSalesTicket).delete(id),
      async () => { await this.knowledgeSyncService.deleteObject('ticket', id); },
    );
  }

  /**
   * 备件需求转需求管理 —— 数据回流闭环的关键一步。
   * 维修中发现的备件需求一键转为新需求(REQ-2026-xxx)，开启新一轮业务。
   */
  async convertToRequirement(id: string, user: CurrentUser): Promise<{ requirementNo: string; requirementId: string }> {
    const ticket = await this.findOne(id, user);
    if (ticket.status === 'converted') throw new BadRequestException('该工单已转需求');
    if (!ticket.customerId) throw new BadRequestException('该工单未关联客户，无法转需求');

    // 直接用 manager 创建需求（不走 RequirementsService 避免循环依赖）
    const reqNo = await this.numbering.next('requirement');
    const skipApproval = this.permissionService.skipApproval();
    const reqData = {
      requirementNo: reqNo,
      title: `[售后备件] ${ticket.title}`,
      customerId: ticket.customerId,
      category: 'spare_part',
      description: `来源工单：${ticket.ticketNo}\n\n设备型号：${ticket.productModel || '未填写'}\n使用备件：${ticket.spareParts || '未填写'}\n处理过程：${ticket.resolution || '未填写'}`,
      priority: ticket.priority === 'urgent' ? 'high' : ticket.priority,
      ownerId: user?.userId,
      departmentId: user?.departmentId,
      status: skipApproval ? 'approved' : 'pending',
      visibility: 'public',
      isCurrent: true,
    };

    const result = await this.tx.run(async (manager) => {
      // 创建需求
      // id/时间在 JS 侧生成：randomblob/datetime('now') 是 SQLite 专有函数，
      // 占位符也统一用 PG 的 $n（? 在 PostgreSQL 驱动里不是参数占位符）
      const now = new Date();
      const reqRow = await manager.query(
        `INSERT INTO requirements ("id", "requirementNo", "title", "customerId", "category", "description", "priority", "ownerId", "departmentId", "status", "visibility", "isCurrent", "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 1, 1, $12, $13)`,
        [randomUUID(), reqData.requirementNo, reqData.title, reqData.customerId, reqData.category, reqData.description, reqData.priority, reqData.ownerId, reqData.departmentId, reqData.status, reqData.visibility, now, now],
      );
      // 更新工单状态
      ticket.status = 'converted';
      await manager.save(ticket);
      return { requirementNo: reqNo };
    });

    // 同步到知识库
    this.knowledgeSyncService.syncObject({
      id: ticket.id, objectType: 'ticket', title: ticket.ticketNo,
      content: `${ticket.title} ${ticket.description || ''} ${ticket.resolution || ''}`,
      visibility: ticket.visibility, uploaderId: ticket.ownerId,
    }).catch(() => {});

    // 查回需求 id
    const reqRow = await this.ticketRepository.manager
      .createQueryBuilder()
      .select('r.id', 'id')
      .from('requirements', 'r')
      .where('r."requirementNo" = :no', { no: reqNo })
      .getRawOne<{ id: string }>();

    return { requirementNo: reqNo, requirementId: reqRow?.id || '' };
  }

  /**
   * 故障转知识库 FAQ —— 知识回流。
   * 将故障描述+处理过程生成 Markdown 文件，写入知识库 troubleshooting 分类。
   */
  async convertToFaq(id: string, user: CurrentUser): Promise<{ fileName: string }> {
    const ticket = await this.findOne(id, user);
    if (!ticket.resolution) throw new BadRequestException('请先填写处理过程再转FAQ');

    const md = [
      `# ${ticket.title}`,
      '',
      `> 来源工单：${ticket.ticketNo}　设备型号：${ticket.productModel || '未指定'}`,
      '',
      '## 故障描述',
      ticket.description || '（无）',
      '',
      '## 处理过程',
      ticket.resolution,
      '',
      '## 使用备件',
      ticket.spareParts || '（无）',
      '',
      '---',
      `*由售后工单自动生成 · ${new Date().toLocaleDateString('zh-CN')}*`,
    ].join('\n');

    // 写入知识库目录
    const knowledgeDir = path.resolve(process.cwd(), 'data', 'uploads', 'knowledge', '故障排除');
    if (!fs.existsSync(knowledgeDir)) fs.mkdirSync(knowledgeDir, { recursive: true });
    const fileName = `${ticket.ticketNo}_${ticket.title.slice(0, 20).replace(/[\\/:*?"<>|]/g, '_')}.md`;
    const filePath = path.join(knowledgeDir, fileName);
    fs.writeFileSync(filePath, md, 'utf-8');

    // 插入 documents 表（id/时间 JS 侧生成，$n 占位符 —— 同 convertToRequirement 的说明）
    const fileKey = `knowledge/故障排除/${fileName}`;
    const now = new Date();
    await this.ticketRepository.manager.query(
      `INSERT INTO documents ("id", "title", "fileName", "fileKey", "fileSize", "mimeType", "category", "status", "visibility", "uploaderId", "parsedText", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, 'text/markdown', 'knowledge/troubleshooting', 'approved', 'public', $6, $7, $8, $9)`,
      [randomUUID(), ticket.title, fileName, fileKey, Buffer.byteLength(md), user?.userId, md, now, now],
    );

    return { fileName };
  }

  /** 售后数据分析 */
  async getStats(user: CurrentUser) {
    const all = await this.ticketRepository
      .createQueryBuilder('t')
      .where(this.permissionService.skipApproval() ? '1=1' : 't.ownerId = :uid', { uid: user.userId })
      .getMany();

    const byType: Record<string, number> = { fault: 0, maintenance: 0, spare_part: 0, visit: 0, material_request: 0, question_reply: 0, other: 0 };
    const productCount: Record<string, number> = {};
    let satisfactionSum = 0;
    let satisfactionCount = 0;
    let resolutionDaysSum = 0;
    let resolutionCount = 0;

    for (const t of all) {
      byType[t.type] = (byType[t.type] || 0) + 1;
      if (t.productModel) productCount[t.productModel] = (productCount[t.productModel] || 0) + 1;
      if (t.satisfactionScore) {
        satisfactionSum += t.satisfactionScore;
        satisfactionCount++;
      }
      if (t.resolvedAt && t.createdAt) {
        const days = Math.round((new Date(t.resolvedAt).getTime() - new Date(t.createdAt).getTime()) / 86400000);
        if (days >= 0) {
          resolutionDaysSum += days;
          resolutionCount++;
        }
      }
    }

    const topFaultProducts = Object.entries(productCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([model, count]) => ({ productModel: model, count }));

    // 30天内到期质保数（边界 JS 算好传参，SQLite 的 datetime('now') 在 PG 不存在）
    const nowTs = new Date();
    const in30Ts = new Date(Date.now() + 30 * 86400000);
    const warrantyResult = await this.ticketRepository.manager
      .createQueryBuilder()
      .select('COUNT(*)', 'count')
      .from('contracts', 'c')
      .where('c."warrantyExpiryDate" IS NOT NULL')
      .andWhere('c."warrantyExpiryDate" > :nowTs', { nowTs })
      .andWhere('c."warrantyExpiryDate" < :in30Ts', { in30Ts })
      .getRawOne<{ count: number }>();

    return {
      totalTickets: all.length,
      openTickets: all.filter((t) => ['open', 'assigned', 'in_progress'].includes(t.status)).length,
      resolvedTickets: all.filter((t) => ['resolved', 'closed'].includes(t.status)).length,
      byType,
      avgSatisfaction: satisfactionCount > 0 ? Math.round((satisfactionSum / satisfactionCount) * 10) / 10 : null,
      avgResolutionDays: resolutionCount > 0 ? Math.round((resolutionDaysSum / resolutionCount) * 10) / 10 : null,
      topFaultProducts,
      warrantyExpiring: Number(warrantyResult?.count) || 0,
    };
  }

  private async sync(ticket: AfterSalesTicket): Promise<void> {
    const content = `${ticket.ticketNo} ${ticket.title} ${ticket.type} ${ticket.productModel || ''} ${ticket.description || ''} ${ticket.resolution || ''} ${ticket.spareParts || ''}`;
    await this.knowledgeSyncService.syncObject({
      id: ticket.id,
      objectType: 'ticket',
      title: ticket.ticketNo,
      content,
      visibility: ticket.visibility,
      uploaderId: ticket.ownerId,
      departmentId: ticket.departmentId,
      groupIds: ticket.groupIds,
      roleCodes: ticket.roleCodes,
    });
  }

  private toSubject(ticket: AfterSalesTicket) {
    return {
      visibility: ticket.visibility,
      uploaderId: ticket.ownerId,
      departmentId: ticket.departmentId,
      groupIds: ticket.groupIds,
      roleCodes: ticket.roleCodes,
    };
  }
}
