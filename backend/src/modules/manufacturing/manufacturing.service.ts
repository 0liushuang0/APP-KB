import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Customer } from '../customers/entities/customer.entity';
import { Requirement } from '../requirements/entities/requirement.entity';
import { Project } from '../projects/entities/project.entity';
import { Quotation } from '../quotations/entities/quotation.entity';
import { Contract } from '../contracts/entities/contract.entity';
import { User } from '../users/entities/user.entity';
import { Department } from '../departments/entities/department.entity';
import { CurrentUser, PermissionService } from '../../common/services/permission.service';
import {
  ManufacturingCase, CustomerEquipment, TechnicalCompliance, ManufacturingReview,
  EngineeringChange, DeliveryMilestone, BusinessType,
} from './entities/manufacturing.entity';
import {
  CreateManufacturingCaseDto, UpdateManufacturingCaseDto, AddEquipmentDto,
  AddComplianceDto, RecordReviewDto, CreateEngineeringChangeDto,
  CreateDeliveryMilestoneDto, UpdateDeliveryMilestoneDto, LoseManufacturingCaseDto,
} from './dto/manufacturing.dto';

const reviewDepartments: Record<BusinessType, string[]> = {
  equipment: ['sales', 'engineering', 'production', 'procurement', 'quality', 'finance'],
  repeat_part: ['sales', 'production', 'finance'],
  service_retrofit: ['sales', 'engineering', 'service', 'finance'],
  development: ['sales', 'engineering', 'production', 'quality', 'finance'],
};

const stages: Record<BusinessType, string[]> = {
  equipment: ['qualification', 'technical', 'review', 'quoted', 'contracted', 'delivery', 'closed'],
  repeat_part: ['qualification', 'review', 'quoted', 'contracted', 'delivery', 'closed'],
  service_retrofit: ['qualification', 'diagnosis', 'review', 'quoted', 'contracted', 'delivery', 'closed'],
  development: ['qualification', 'feasibility', 'prototype', 'review', 'quoted', 'contracted', 'delivery', 'closed'],
};

@Injectable()
export class ManufacturingService {
  constructor(
    @InjectRepository(ManufacturingCase) private cases: Repository<ManufacturingCase>,
    @InjectRepository(CustomerEquipment) private equipment: Repository<CustomerEquipment>,
    @InjectRepository(TechnicalCompliance) private compliance: Repository<TechnicalCompliance>,
    @InjectRepository(ManufacturingReview) private reviews: Repository<ManufacturingReview>,
    @InjectRepository(EngineeringChange) private changes: Repository<EngineeringChange>,
    @InjectRepository(DeliveryMilestone) private milestones: Repository<DeliveryMilestone>,
    @InjectRepository(Customer) private customers: Repository<Customer>,
    @InjectRepository(Requirement) private requirements: Repository<Requirement>,
    @InjectRepository(Quotation) private quotations: Repository<Quotation>,
    @InjectRepository(Project) private projects: Repository<Project>,
    @InjectRepository(Contract) private contracts: Repository<Contract>,
    @InjectRepository(User) private users: Repository<User>,
    @InjectRepository(Department) private departments: Repository<Department>,
    private permissions: PermissionService,
  ) {}

  getDefinitions() { return { stages, reviewDepartments }; }

  private canView(row: ManufacturingCase, user: CurrentUser) {
    return this.permissions.isSingleMode() || user?.isSystemAdmin ||
      row.ownerId === user?.userId || row.technicalOwnerId === user?.userId ||
      (row.participantIds || []).includes(user?.userId);
  }

  private canEdit(row: ManufacturingCase, user: CurrentUser) {
    return this.permissions.isSingleMode() || user?.isSystemAdmin ||
      row.ownerId === user?.userId || row.technicalOwnerId === user?.userId;
  }

  private async updateCaseAtomically(row: ManufacturingCase, changes: Partial<ManufacturingCase>) {
    const version = row.version;
    const result = await this.cases.update(
      { id: row.id, version, stage: row.stage, status: row.status },
      { ...changes, version: version + 1 },
    );
    if (result.affected !== 1) throw new ConflictException('项目已被其他人修改，请刷新后重试');
    return { ...row, ...changes, version: version + 1 };
  }

  async getCase(id: string, user: CurrentUser) {
    const row = await this.cases.findOne({ where: { id } });
    if (!row) throw new NotFoundException('售前项目不存在');
    if (!this.canView(row, user)) throw new ForbiddenException('无权查看该售前项目');
    return row;
  }

  private visibleCasesQuery(user: CurrentUser) {
    if (!user) throw new ForbiddenException('请先登录');
    if (this.permissions.isSingleMode() || user.isSystemAdmin) {
      return this.cases.createQueryBuilder('c').orderBy('c.updatedAt', 'DESC');
    }
    return this.cases.createQueryBuilder('c')
      .where('c.ownerId = :uid OR c.technicalOwnerId = :uid OR (\',\' || c.participantIds || \',\') LIKE :member',
        { uid: user.userId, member: `%,${user.userId},%` })
      .orderBy('c.updatedAt', 'DESC');
  }

  async listCases(user: CurrentUser) {
    return this.visibleCasesQuery(user).take(500).getMany();
  }

  async teamUsers(user: CurrentUser) {
    if (!user) throw new ForbiddenException('请先登录');
    const members = await this.users.find({ where: { isActive: true }, order: { username: 'ASC' } });
    return members.map(({ id, username, nickname, departmentId }) => ({ id, username, nickname, departmentId }));
  }

  private async checkParticipants(ids: string[] | undefined) {
    if (!ids?.length) return;
    if (ids.length > 30 || new Set(ids).size !== ids.length) throw new BadRequestException('参与人员无效');
    const count = await this.users.count({ where: { id: In(ids), isActive: true } });
    if (count !== ids.length) throw new BadRequestException('参与人员包含无效账号');
  }

  private async checkLinks(dto: Partial<CreateManufacturingCaseDto>, user: CurrentUser) {
    if (dto.customerId) {
      const customer = await this.customers.findOne({ where: { id: dto.customerId } });
      if (!customer) throw new BadRequestException('客户不存在');
      if (!this.permissions.canAccess(user, {
        visibility: customer.visibility, uploaderId: customer.ownerId,
        departmentId: customer.departmentId, groupIds: customer.groupIds, roleCodes: customer.roleCodes,
      })) throw new ForbiddenException('无权关联该客户');
    }
    if (dto.requirementId) {
      const requirement = await this.requirements.findOne({ where: { id: dto.requirementId } });
      if (!requirement || (dto.customerId && requirement.customerId !== dto.customerId)) {
        throw new BadRequestException('需求不存在或与客户不一致');
      }
      if (!this.permissions.canAccess(user, { visibility: requirement.visibility,
        uploaderId: requirement.ownerId, departmentId: requirement.departmentId,
        groupIds: requirement.groupIds, roleCodes: requirement.roleCodes })) {
        throw new ForbiddenException('无权关联该需求');
      }
    }
    if (dto.quotationId) {
      const quotation = await this.quotations.findOne({ where: { id: dto.quotationId } });
      if (!quotation || (dto.customerId && quotation.customerId !== dto.customerId)) {
        throw new BadRequestException('报价不存在或与客户不一致');
      }
      if (!this.permissions.canAccess(user, { visibility: quotation.visibility,
        uploaderId: quotation.ownerId, departmentId: quotation.departmentId,
        groupIds: quotation.groupIds, roleCodes: quotation.roleCodes })) {
        throw new ForbiddenException('无权关联该报价');
      }
    }
    if (dto.contractId) {
      const contract = await this.contracts.findOne({ where: { id: dto.contractId } });
      if (!contract || (dto.customerId && contract.customerId !== dto.customerId) ||
        (dto.quotationId && contract.quotationId !== dto.quotationId)) {
        throw new BadRequestException('合同与客户或报价不一致');
      }
      if (!this.permissions.canAccess(user, { visibility: contract.visibility,
        uploaderId: contract.ownerId, departmentId: contract.departmentId,
        groupIds: contract.groupIds, roleCodes: contract.roleCodes })) {
        throw new ForbiddenException('无权关联该合同');
      }
    }
    if (dto.projectId) {
      const project = await this.projects.findOne({ where: { id: dto.projectId } });
      if (!project || (dto.customerId && project.customerId !== dto.customerId)) {
        throw new BadRequestException('项目不存在或与客户不一致');
      }
      if (dto.contractId && project.contractId !== dto.contractId) {
        throw new BadRequestException('执行项目与合同不一致');
      }
      if (!this.permissions.canAccess(user, { visibility: project.visibility,
        uploaderId: project.managerId, departmentId: project.departmentId,
        groupIds: project.groupIds, roleCodes: project.roleCodes })) {
        throw new ForbiddenException('无权关联该项目');
      }
    }
  }

  async createCase(dto: CreateManufacturingCaseDto, user: CurrentUser) {
    await this.checkLinks(dto, user);
    await this.checkParticipants(dto.participantIds);
    if (!dto.title.trim()) throw new BadRequestException('请填写项目名称');
    return this.cases.save(this.cases.create({ ...dto, ownerId: user.userId }));
  }

  async updateCase(id: string, dto: UpdateManufacturingCaseDto, user: CurrentUser) {
    const row = await this.getCase(id, user);
    if (!this.canEdit(row, user)) throw new ForbiddenException('无权修改');
    if (row.status !== 'open') throw new BadRequestException('已结案项目不能修改');
    if (row.version !== dto.version) throw new ConflictException('项目已被其他人修改，请刷新后重试');
    await this.checkParticipants(dto.participantIds);
    if (dto.businessType && dto.businessType !== row.businessType && row.stage !== 'qualification') {
      throw new BadRequestException('流程启动后不能更改业务类型');
    }
    if (['contracted', 'delivery'].includes(row.stage)) {
      for (const key of ['customerId', 'requirementId', 'quotationId', 'contractId'] as const) {
        if (dto[key] !== undefined && (dto[key] || null) !== (row[key] || null)) {
          throw new BadRequestException('签约后不能更换客户、需求、报价或合同');
        }
      }
    }
    if (row.stage === 'delivery' && dto.projectId !== undefined &&
      (dto.projectId || null) !== (row.projectId || null)) {
      throw new BadRequestException('交付开始后不能更换执行项目');
    }
    const nextCustomer = dto.customerId || row.customerId;
    await this.checkLinks({ customerId: nextCustomer,
      requirementId: dto.requirementId ?? row.requirementId,
      quotationId: dto.quotationId ?? row.quotationId,
      contractId: dto.contractId ?? row.contractId,
      projectId: dto.projectId ?? row.projectId }, user);
    const { version: _, ...data } = dto;
    return this.updateCaseAtomically(row, data);
  }

  async advanceCase(id: string, user: CurrentUser) {
    const row = await this.getCase(id, user);
    if (!this.canEdit(row, user)) throw new ForbiddenException('无权推进');
    if (row.status !== 'open') throw new BadRequestException('已结案项目不能推进');
    const route = stages[row.businessType];
    const index = route.indexOf(row.stage);
    if (index < 0 || index === route.length - 1) throw new BadRequestException('当前阶段不能继续推进');
    const next = route[index + 1];
    if (row.stage === 'review') {
      if (row.businessType !== 'repeat_part' && !(await this.compliance.count({ where: { caseId: id } }))) {
        throw new BadRequestException('请先建立技术符合性清单');
      }
      const records = await this.reviews.find({ where: { caseId: id } });
      const missing = reviewDepartments[row.businessType].filter(
        d => !records.some(r => r.department === d && r.verdict === 'approved'),
      );
      if (missing.length) throw new BadRequestException(`尚未通过评审：${missing.join('、')}`);
      const unresolved = await this.compliance.count({ where: { caseId: id, verdict: In(['unconfirmed', 'deviation']) } });
      if (unresolved) throw new BadRequestException('技术符合性仍有未确认或未接受的偏差');
    }
    if (next === 'contracted') {
      if (!row.quotationId || !row.contractId) throw new BadRequestException('请先关联报价和合同');
      const [quotation, contract] = await Promise.all([
        this.quotations.findOne({ where: { id: row.quotationId } }),
        this.contracts.findOne({ where: { id: row.contractId } }),
      ]);
      if (quotation?.status !== 'approved') throw new BadRequestException('报价尚未审批通过');
      if (!contract || !contract.signedDate || !['approved', 'signed', 'executing', 'completed'].includes(contract.status) ||
        contract.quotationId !== row.quotationId) throw new BadRequestException('合同尚未签署或与报价不一致');
    }
    if (next === 'delivery') {
      if (!row.projectId) throw new BadRequestException('请先关联合同派生的执行项目');
      const project = await this.projects.findOne({ where: { id: row.projectId } });
      if (!project || project.contractId !== row.contractId) {
        throw new BadRequestException('执行项目与已签合同不一致');
      }
    }
    if (next === 'closed') {
      if (!row.projectId) throw new BadRequestException('缺少执行项目');
      const open = await this.milestones.count({ where: { projectId: row.projectId, status: In(['pending', 'in_progress', 'blocked']) } });
      if (open) throw new BadRequestException('仍有未完成交付里程碑');
      const acceptance = await this.milestones.findOne({ where: { projectId: row.projectId, kind: 'acceptance', status: 'done' } });
      if (!acceptance?.evidenceRef) throw new BadRequestException('请完成客户验收节点并填写验收凭据');
      const pendingChanges = await this.changes.count({ where: { caseId: id, status: 'draft' } });
      if (pendingChanges) throw new BadRequestException('仍有未处理工程变更');
    }
    return this.updateCaseAtomically(row, {
      stage: next,
      ...(next === 'closed' ? { status: 'closed' } : {}),
    });
  }

  async loseCase(id: string, dto: LoseManufacturingCaseDto, user: CurrentUser) {
    const row = await this.getCase(id, user);
    if (!this.canEdit(row, user)) throw new ForbiddenException('无权结案');
    if (row.version !== dto.version) throw new ConflictException('项目已被其他人修改，请刷新后重试');
    if (row.status !== 'open' || ['contracted', 'delivery', 'closed'].includes(row.stage)) {
      throw new BadRequestException('已签约或已结案项目不能标记为失单');
    }
    if (!dto.reason.trim()) throw new BadRequestException('须填写失单原因');
    return this.updateCaseAtomically(row, { status: 'lost', lossReason: dto.reason.trim() });
  }

  async addEquipment(dto: AddEquipmentDto, user: CurrentUser) {
    await this.checkLinks({ customerId: dto.customerId, projectId: dto.projectId }, user);
    if (dto.serialNo && await this.equipment.findOne({ where: { serialNo: dto.serialNo } })) {
      throw new ConflictException('设备序列号已登记');
    }
    return this.equipment.save(this.equipment.create({ ...dto, ownerId: user.userId }));
  }

  async listEquipment(customerId: string, user: CurrentUser) {
    const customer = await this.customers.findOne({ where: { id: customerId } });
    if (!customer) throw new NotFoundException('客户不存在');
    if (!this.permissions.canAccess(user, { visibility: customer.visibility,
      uploaderId: customer.ownerId, departmentId: customer.departmentId,
      groupIds: customer.groupIds, roleCodes: customer.roleCodes })) {
      throw new ForbiddenException('无权查看设备档案');
    }
    return this.equipment.find({ where: { customerId }, order: { createdAt: 'DESC' } });
  }

  async addCompliance(caseId: string, dto: AddComplianceDto, user: CurrentUser) {
    const row = await this.getCase(caseId, user);
    if (!this.canEdit(row, user)) throw new ForbiddenException('无权修改技术要求');
    if (row.status !== 'open') throw new BadRequestException('已结案项目不能修改');
    if (dto.verdict === 'deviation' && !dto.deviation?.trim()) throw new BadRequestException('偏差须填写说明');
    if (dto.verdict === 'customer_accepted' && !dto.sourceRef?.trim()) throw new BadRequestException('请填写客户接受偏差的证据来源');
    return this.compliance.save(this.compliance.create({ ...dto, caseId,
      confirmedBy: dto.verdict === 'customer_accepted' ? user.userId : null,
      confirmedAt: dto.verdict === 'customer_accepted' ? new Date().toISOString() : null }));
  }

  async review(caseId: string, dto: RecordReviewDto, user: CurrentUser) {
    const row = await this.cases.findOne({ where: { id: caseId } });
    if (!row) throw new NotFoundException('售前项目不存在');
    if (!this.permissions.canApprove(user)) throw new ForbiddenException('无权评审');
    if (!this.canView(row, user)) throw new ForbiddenException('请先加入项目成员再评审');
    if (row.status !== 'open') throw new BadRequestException('已结案项目不能评审');
    if (row.stage !== 'review') throw new BadRequestException('仅在评审阶段可提交评审意见');
    if (!reviewDepartments[row.businessType].includes(dto.department)) throw new BadRequestException('该业务类型不需要此部门评审');
    if (dto.verdict === 'conditional' && !dto.conditionText?.trim()) throw new BadRequestException('有条件通过须填写条件');
    if (!this.permissions.isSingleMode() && !user.isSystemAdmin) {
      const department = user.departmentId
        ? await this.departments.findOne({ where: { id: user.departmentId } }) : null;
      if (department?.code !== dto.department) {
        throw new ForbiddenException('只能代表本人所属部门评审；请管理员先配置标准部门代码');
      }
      const other = await this.reviews.find({ where: { caseId } });
      if (other.some(r => r.department !== dto.department && r.reviewedBy === user.userId)) {
        throw new ForbiddenException('同一人不能代表多个部门评审');
      }
    }
    let review = await this.reviews.findOne({ where: { caseId, department: dto.department } });
    if (!review) review = this.reviews.create({ caseId, department: dto.department });
    Object.assign(review, dto, { reviewedBy: user.userId, reviewedAt: new Date().toISOString() });
    return this.reviews.save(review);
  }

  async addChange(caseId: string, dto: CreateEngineeringChangeDto, user: CurrentUser) {
    const row = await this.getCase(caseId, user);
    if (!this.canEdit(row, user)) throw new ForbiddenException('无权提交变更');
    if (row.status !== 'open') throw new BadRequestException('已结案项目不能变更');
    if (dto.projectId && dto.projectId !== row.projectId) throw new BadRequestException('项目与售前记录不一致');
    return this.changes.save(this.changes.create({ ...dto, caseId, raisedBy: user.userId }));
  }

  async approveChange(caseId: string, changeId: string, user: CurrentUser) {
    const row = await this.getCase(caseId, user);
    if (row.status !== 'open') throw new BadRequestException('已结案项目不能审批变更');
    if (!this.permissions.canApprove(user)) throw new ForbiddenException('无权审批变更');
    const change = await this.changes.findOne({ where: { id: changeId, caseId } });
    if (!change) throw new NotFoundException('变更单不存在');
    if (change.status !== 'draft') throw new ConflictException('该变更已处理');
    if (!change.customerEvidenceRef) throw new BadRequestException('缺少客户确认依据');
    change.status = 'approved';
    change.approvedBy = user.userId;
    change.approvedAt = new Date().toISOString();
    return this.changes.save(change);
  }

  async addMilestone(caseId: string, dto: CreateDeliveryMilestoneDto, user: CurrentUser) {
    const row = await this.getCase(caseId, user);
    if (!this.canEdit(row, user)) throw new ForbiddenException('无权维护交付计划');
    if (row.status !== 'open') throw new BadRequestException('已结案项目不能修改里程碑');
    if (!row.projectId) throw new BadRequestException('请先关联执行项目');
    return this.milestones.save(this.milestones.create({ ...dto, projectId: row.projectId }));
  }

  async updateMilestone(caseId: string, milestoneId: string, dto: UpdateDeliveryMilestoneDto, user: CurrentUser) {
    const row = await this.getCase(caseId, user);
    if (!this.canEdit(row, user)) throw new ForbiddenException('无权维护交付计划');
    if (row.status !== 'open') throw new BadRequestException('已结案项目不能修改里程碑');
    const milestone = await this.milestones.findOne({ where: { id: milestoneId, projectId: row.projectId } });
    if (!milestone) throw new NotFoundException('里程碑不存在');
    if (dto.status === 'done' && !dto.evidenceRef && !milestone.evidenceRef) {
      throw new BadRequestException('完成里程碑须填写证据编号或资料链接');
    }
    Object.assign(milestone, dto);
    if (dto.status === 'done' && !milestone.actualAt) milestone.actualAt = new Date().toISOString().slice(0, 10);
    return this.milestones.save(milestone);
  }

  async detail(id: string, user: CurrentUser) {
    const row = await this.getCase(id, user);
    const [compliance, reviews, changes, milestones, equipment] = await Promise.all([
      this.compliance.find({ where: { caseId: id }, order: { createdAt: 'ASC' } }),
      this.reviews.find({ where: { caseId: id }, order: { department: 'ASC' } }),
      this.changes.find({ where: { caseId: id }, order: { createdAt: 'DESC' } }),
      row.projectId ? this.milestones.find({ where: { projectId: row.projectId }, order: { createdAt: 'ASC' } }) : [],
      this.equipment.find({ where: { customerId: row.customerId }, order: { createdAt: 'DESC' } }),
    ]);
    return { ...row, compliance, reviews, changes, milestones, equipment,
      requiredDepartments: reviewDepartments[row.businessType] };
  }

  async summary(user: CurrentUser) {
    const rows = await this.visibleCasesQuery(user).getMany();
    const byType = Object.fromEntries(Object.keys(stages).map(type => [type, rows.filter(r => r.businessType === type).length]));
    const overdue = rows.filter(r => r.nextActionDue && r.nextActionDue < new Date().toISOString().slice(0, 10) && r.status === 'open');
    return { total: rows.length, byType,
      won: rows.filter(r => r.stage === 'closed' && r.status === 'closed').length,
      lost: rows.filter(r => r.status === 'lost').length,
      overdue: overdue.map(r => ({ id: r.id, title: r.title,
      due: r.nextActionDue, ownerId: r.ownerId })),
      rows: rows.map(r => ({ id: r.id, title: r.title, businessType: r.businessType,
        stage: r.stage, status: r.status, customerId: r.customerId,
        expectedAmount: r.expectedAmount, nextActionDue: r.nextActionDue,
        lossReason: r.lossReason })) };
  }
}
