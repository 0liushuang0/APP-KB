import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Contract } from './entities/contract.entity';
import { ContractPayment } from './entities/contract-payment.entity';
import { CreateContractDto, UpdateContractDto, QueryContractDto } from './dto/contract.dto';
import { CreateContractPaymentDto, UpdateContractPaymentDto } from './dto/payment.dto';
import { TransactionService } from '../../common/services/transaction.service';
import { NumberingService } from '../../common/services/numbering.service';
import { KnowledgeSyncService } from '../../common/services/knowledge-sync.service';
import { PermissionService, CurrentUser } from '../../common/services/permission.service';
import { PermissionQueryService } from '../../common/services/permission-query.service';
import { ApprovalsService } from '../approvals/approvals.service';
import { paginate, PaginatedResult } from '../../common/dto/pagination.dto';

@Injectable()
export class ContractsService {
  constructor(
    @InjectRepository(Contract)
    private contractRepository: Repository<Contract>,
    @InjectRepository(ContractPayment)
    private paymentRepository: Repository<ContractPayment>,
    private numbering: NumberingService,
    private knowledgeSyncService: KnowledgeSyncService,
    private permissionService: PermissionService,
    private permissionQuery: PermissionQueryService,
    private approvalsService: ApprovalsService,
    private readonly tx: TransactionService,
  ) {}

  /** 合同编号继承报价的流水号 */
  private async nextNo(quotationId?: string): Promise<string> {
    if (!quotationId) return this.numbering.next('contract');
    const row = await this.contractRepository.manager
      .createQueryBuilder()
      .select('q.quotationNo', 'no')
      .from('quotations', 'q')
      .where('q.id = :id', { id: quotationId })
      .getRawOne<{ no: string }>();
    return this.numbering.derive('contract', row?.no);
  }

  /** 客户跟随报价 → 需求 */
  private async inheritCustomerId(quotationId?: string, fallback?: string): Promise<string | null> {
    if (!quotationId) return fallback ?? null;
    const row = await this.contractRepository.manager
      .createQueryBuilder()
      .select('r.customerId', 'customerId')
      .from('quotations', 'q')
      .leftJoin('proposals', 'p', 'p.id = q.proposalId')
      .leftJoin('requirements', 'r', 'r.id = p.requirementId')
      .where('q.id = :id', { id: quotationId })
      .getRawOne<{ customerId: string }>();
    return row?.customerId ?? fallback ?? null;
  }

  /** 列表（分页 + 权限下沉 SQL） */
  async findAll(query: QueryContractDto, user: CurrentUser): Promise<PaginatedResult<Contract>> {
    const qb = this.contractRepository.createQueryBuilder('c');
    if (query.status) qb.andWhere('c.status = :status', { status: query.status });
    if (query.customerId) qb.andWhere('c.customerId = :cid', { cid: query.customerId });
    if (query.keyword) {
      // 合同号/标题 + 客户名 一起搜
      qb.andWhere(
        `(c.contractNo LIKE :kw OR c.title LIKE :kw
          OR EXISTS (SELECT 1 FROM customers cc WHERE cc.id = c.customerId AND cc.name LIKE :kw))`,
        { kw: `%${query.keyword}%` },
      );
    }
    this.permissionQuery.apply(qb, 'c', user);
    const result = await paginate(qb, 'c', query, ['createdAt', 'contractNo', 'amount', 'status']);
    return { ...result, list: await this.attachRelations(result.list) };
  }

  /** 贴上客户名 / 项目名（报价编号），与 quotations attachRelations 一致 */
  private async attachRelations(rows: Contract[]): Promise<any[]> {
    if (!rows.length) return rows;
    const quotationIds = [...new Set(rows.map((r) => r.quotationId).filter(Boolean))];
    const chain = quotationIds.length
      ? await this.contractRepository.manager
          .createQueryBuilder()
          .select([
            'q.id AS quotationId',
            'q.quotationNo AS quotationNo',
            'r.title AS projectName',
            'c.name AS customerName',
            'c.code AS customerShortName',
          ])
          .from('quotations', 'q')
          .leftJoin('proposals', 'p', 'p.id = q.proposalId')
          .leftJoin('requirements', 'r', 'r.id = p.requirementId')
          .leftJoin('customers', 'c', 'c.id = r.customerId')
          .where('q.id IN (:...ids)', { ids: quotationIds })
          .getRawMany<any>()
      : [];
    const map = new Map(chain.map((x) => [x.quotationId, x]));
    return rows.map((c) => {
      const link = c.quotationId ? map.get(c.quotationId) : undefined;
      return {
        ...c,
        customerName: link?.customerName,
        customerShortName: link?.customerShortName || link?.customerName,
        projectName: link?.projectName,
        quotationNo: link?.quotationNo,
      };
    });
  }

  async findOne(id: string, user: CurrentUser): Promise<Contract> {
    const contract = await this.contractRepository.findOne({ where: { id } });
    if (!contract) throw new NotFoundException('合同不存在');
    if (!this.permissionService.canAccess(user, this.toSubject(contract))) {
      throw new BadRequestException('无权访问该合同');
    }
    return contract;
  }

  async create(dto: CreateContractDto, user: CurrentUser): Promise<Contract> {
    const [contractNo, customerId] = await Promise.all([
      this.nextNo(dto.quotationId),
      this.inheritCustomerId(dto.quotationId, dto.customerId),
    ]);
    const skipApproval = this.permissionService.skipApproval();
    const contract = this.contractRepository.create({
      ...dto,
      contractNo,
      customerId,
      ownerId: user?.userId,
      departmentId: user?.departmentId,
      // 单机免审也只到"内部已批准"；"已签订"代表客户签约，必须由人工登记
      status: skipApproval ? 'approved' : 'draft',
    });
    // 计算质保到期日：签订日 + 质保月数（默认12个月）
    if (contract.signedDate) {
      const months = contract.warrantyMonths || 12;
      const d = new Date(contract.signedDate);
      d.setMonth(d.getMonth() + months);
      contract.warrantyExpiryDate = d;
    }
    const saved = await this.tx.run(
      async (manager) => {
        const row = await manager.save(contract);
        if (!skipApproval) {
          await this.approvalsService.create(
            { objectType: 'contract', objectId: row.id, submittedBy: user?.userId, status: 'pending' },
            manager,
          );
        }
        return row;
      },
      async (row) => { await this.sync(row); },
    );
    return saved;
  }

  async update(id: string, dto: UpdateContractDto, user: CurrentUser): Promise<Contract> {
    const contract = await this.findOne(id, user);
    if (!this.permissionService.canManage(user, this.toSubject(contract))) {
      throw new BadRequestException('无权修改该合同');
    }
    if (['approved', 'signed', 'executing', 'completed', 'terminated'].includes(contract.status)) {
      const fields = ['customerId', 'quotationId', 'amount', 'paymentTerms', 'deliveryTerms', 'effectiveDate', 'expiryDate'];
      if (fields.some(key => (dto as any)[key] !== undefined &&
        String((dto as any)[key]) !== String((contract as any)[key] ?? ''))) {
        throw new BadRequestException('已审批合同的商务条款已冻结，请创建变更或补充协议');
      }
    }
    if (dto.status) {
      const next: Record<string, string[]> = {
        approved: ['signed', 'terminated'],
        signed: ['executing', 'terminated'],
        executing: ['completed', 'terminated'],
      };
      if (!next[contract.status]?.includes(dto.status)) {
        throw new BadRequestException('合同状态必须按审批、签订、执行、完成顺序流转');
      }
      if (dto.status === 'signed' && !(dto.signedDate || contract.signedDate)) {
        throw new BadRequestException('标记已签订前须登记签订日期');
      }
    }
    Object.assign(contract, dto);
    if (dto.signedDate && contract.status === 'approved') contract.status = 'signed';
    if (dto.signedDate) {
      const d = new Date(dto.signedDate);
      d.setMonth(d.getMonth() + (contract.warrantyMonths || 12));
      contract.warrantyExpiryDate = d;
    }
    const saved = await this.tx.run(
      async (manager) => manager.save(contract),
      async (row) => { await this.sync(row); },
    );
    return saved;
  }

  async remove(id: string, user: CurrentUser): Promise<void> {
    const contract = await this.findOne(id, user);
    if (!this.permissionService.canManage(user, this.toSubject(contract))) {
      throw new BadRequestException('无权删除该合同');
    }
    await this.tx.run(
      async (manager) => {
        await manager.getRepository(Contract).delete(id);
      },
      async () => {
        await this.knowledgeSyncService.deleteObject('contract', id);
      },
    );
  }

  async approve(id: string, user: CurrentUser): Promise<Contract> {
    if (!this.permissionService.canApprove(user)) throw new BadRequestException('无权审核');
    const contract = await this.contractRepository.findOne({ where: { id } });
    if (!contract) throw new NotFoundException('合同不存在');
    if (!['draft', 'pending'].includes(contract.status)) throw new BadRequestException('只有待审批合同可以审批');
    // 内部审批通过 ≠ 客户已签约：approved 表示公司内部放行，
    // signed 保留给客户实际签回（由经办人登记签订日期时流转）
    contract.status = 'approved';
    return this.tx.run(
      async (manager) => {
        const saved = await manager.save(contract);
        await this.approvalsService.approve('contract', id, user?.userId, '审核通过', manager);
        return saved;
      },
    );
  }

  // ── 回款台账：这份合同执行到哪、款收了多少、还差多少 ──

  /** 节点列表 + 合同级汇总（应收/已收/未收/回款进度） */
  async listPayments(contractId: string, user: CurrentUser): Promise<any> {
    const contract = await this.findOne(contractId, user); // 复用访问权限校验
    const rows = await this.paymentRepository.find({
      where: { contractId },
      order: { dueDate: 'ASC', createdAt: 'ASC' },
    });
    const round2 = (n: any) => Math.round(Number(n || 0) * 100) / 100;
    const totalDue = round2(rows.reduce((s, r) => s + Number(r.dueAmount || 0), 0));
    const totalReceived = round2(rows.reduce((s, r) => s + Number(r.receivedAmount || 0), 0));
    const contractAmount = round2(contract.amount);
    return {
      list: rows,
      summary: {
        contractAmount,
        totalDue,
        totalReceived,
        outstanding: round2(Math.max(totalDue - totalReceived, 0)),
        // 台账未覆盖合同金额的部分也是"未收"，一并在缺口里体现
        uncovered: round2(Math.max(contractAmount - totalDue, 0)),
        receivedRatio: totalDue > 0 ? Math.round((totalReceived / totalDue) * 100) : 0,
      },
    };
  }

  async addPayment(
    contractId: string,
    dto: CreateContractPaymentDto,
    user: CurrentUser,
  ): Promise<ContractPayment> {
    const contract = await this.findOne(contractId, user);
    if (!this.permissionService.canManage(user, this.toSubject(contract))) {
      throw new BadRequestException('无权登记该合同的回款');
    }
    const payment = this.paymentRepository.create({
      ...dto,
      contractId,
      createdBy: user?.userId,
    });
    return this.paymentRepository.save(payment);
  }

  async updatePayment(
    contractId: string,
    paymentId: string,
    dto: UpdateContractPaymentDto,
    user: CurrentUser,
  ): Promise<ContractPayment> {
    const payment = await this.paymentRepository.findOne({ where: { id: paymentId } });
    if (!payment) throw new NotFoundException('回款节点不存在');
    // URL 合同 ID 必须与节点归属一致：防止拿 A 合同的路径改 B 合同的台账
    if (payment.contractId !== contractId) throw new BadRequestException('回款节点不属于该合同');
    const contract = await this.findOne(contractId, user);
    if (!this.permissionService.canManage(user, this.toSubject(contract))) {
      throw new BadRequestException('无权修改该合同的回款');
    }
    Object.assign(payment, dto);
    return this.paymentRepository.save(payment);
  }

  async removePayment(contractId: string, paymentId: string, user: CurrentUser): Promise<void> {
    const payment = await this.paymentRepository.findOne({ where: { id: paymentId } });
    if (!payment) throw new NotFoundException('回款节点不存在');
    if (payment.contractId !== contractId) throw new BadRequestException('回款节点不属于该合同');
    const contract = await this.findOne(contractId, user);
    if (!this.permissionService.canManage(user, this.toSubject(contract))) {
      throw new BadRequestException('无权删除该合同的回款');
    }
    await this.paymentRepository.delete(paymentId);
  }

  /** 知识同步 */
  private async sync(contract: Contract): Promise<void> {
    const content = `${contract.contractNo} ${contract.title || ''} 金额:${contract.amount} ${contract.paymentTerms || ''} ${contract.deliveryTerms || ''}`;
    await this.knowledgeSyncService.syncObject({
      id: contract.id,
      objectType: 'contract',
      title: contract.contractNo,
      content,
      visibility: contract.visibility,
      uploaderId: contract.ownerId,
      departmentId: contract.departmentId,
      groupIds: contract.groupIds,
      roleCodes: contract.roleCodes,
    });
  }

  private toSubject(contract: Contract) {
    return {
      visibility: contract.visibility,
      uploaderId: contract.ownerId,
      departmentId: contract.departmentId,
      groupIds: contract.groupIds,
      roleCodes: contract.roleCodes,
    };
  }
}
