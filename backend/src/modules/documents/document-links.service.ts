import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { recordAutomation } from '../../common/utils/automation-log';
import { domainEvents } from '../../common/services/domain-events';
import { InjectRepository } from '@nestjs/typeorm';
import { IsOptional, IsString } from 'class-validator';
import { In, Repository } from 'typeorm';
import {
  DocumentLink,
  DocStage,
  DocCategory,
  LinkRole,
  DOC_STAGE_LABELS,
} from '../projects/entities/document-link.entity';
import { Document } from './entities/document.entity';
import { Customer } from '../customers/entities/customer.entity';
import { Requirement } from '../requirements/entities/requirement.entity';
import { Proposal } from '../proposals/entities/proposal.entity';
import { Quotation } from '../quotations/entities/quotation.entity';
import { Project } from '../projects/entities/project.entity';
import { CurrentUser, PermissionService } from '../../common/services/permission.service';

export type LinkEntityType =
  | 'customer'
  | 'requirement'
  | 'proposal'
  | 'solution'
  | 'quotation'
  | 'contract'
  | 'project'
  | 'afterSale'
  | 'workTask';

/** 业务对象 → document_links 上的列名 */
const ENTITY_COLUMN: Record<LinkEntityType, keyof DocumentLink> = {
  customer: 'customerId',
  requirement: 'requirementId',
  proposal: 'proposalId',
  solution: 'solutionId',
  quotation: 'quotationId',
  contract: 'contractId',
  project: 'projectId',
  afterSale: 'afterSaleId',
  workTask: 'workTaskId',
};

/** 按业务对象推断默认阶段，减少人工选择 */
const DEFAULT_STAGE: Record<LinkEntityType, DocStage> = {
  customer: 'raw',
  requirement: 'requirement',
  proposal: 'solution',
  solution: 'solution',
  quotation: 'quotation',
  contract: 'contract',
  project: 'raw',
  afterSale: 'raw',
  workTask: 'raw',
};

/**
 * 关联资料到业务对象。
 *
 * 注意：这些字段必须带 class-validator 装饰器 —— 全局 ValidationPipe 开了
 * whitelist + forbidNonWhitelisted，无装饰器的类会被判定为"所有字段都非法"，
 * 导致 POST /documents/:id/links 一律 400，资料关联建不起来
 * （表现：需求上传的资料没关联、落进"业务资料"、需求列表为空）。
 */
export class CreateLinkDto {
  /** 由控制器从 URL 参数注入，请求体不含它，故可选 */
  @IsOptional()
  @IsString()
  documentId?: string;

  @IsString()
  entityType: LinkEntityType;

  @IsString()
  entityId: string;

  @IsOptional()
  @IsString()
  stage?: DocStage;

  @IsOptional()
  @IsString()
  category?: DocCategory;

  @IsOptional()
  @IsString()
  linkRole?: LinkRole;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  customerId?: string;

  @IsOptional()
  @IsString()
  requirementId?: string;

  @IsOptional()
  @IsString()
  proposalId?: string;

  @IsOptional()
  @IsString()
  solutionId?: string;

  @IsOptional()
  @IsString()
  quotationId?: string;

  @IsOptional()
  @IsString()
  contractId?: string;

  @IsOptional()
  @IsString()
  projectId?: string;

  @IsOptional()
  @IsString()
  afterSaleId?: string;
}

/** 链路上的一个节点及其资料 */
export interface ChainNode {
  stage: DocStage;
  stageLabel: string;
  entityType: LinkEntityType | null;
  entityId: string | null;
  entityTitle: string | null;
  documents: Array<Document & { link: DocumentLink }>;
}

@Injectable()
export class DocumentLinksService {
  constructor(
    @InjectRepository(DocumentLink) private links: Repository<DocumentLink>,
    @InjectRepository(Document) private documents: Repository<Document>,
    @InjectRepository(Customer) private customers: Repository<Customer>,
    @InjectRepository(Requirement) private requirements: Repository<Requirement>,
    @InjectRepository(Proposal) private proposals: Repository<Proposal>,
    @InjectRepository(Quotation) private quotations: Repository<Quotation>,
    @InjectRepository(Project) private projects: Repository<Project>,
    private permission: PermissionService,
  ) {}

  /** 把资料关联到某个业务对象 */
  async create(dto: CreateLinkDto, user: CurrentUser): Promise<DocumentLink> {
    const column = ENTITY_COLUMN[dto.entityType];
    if (!column) throw new BadRequestException(`不支持的关联类型：${dto.entityType}`);

    const doc = await this.documents.findOne({ where: { id: dto.documentId } });
    if (!doc) throw new NotFoundException('资料不存在');

    // 同一份资料对同一个对象只留一条关联，重复点击不会产生脏数据
    const existing = await this.links.findOne({
      where: { documentId: dto.documentId, [column]: dto.entityId } as any,
    });
    if (existing) return existing;

    // 业务对象关联必须有实体 id：此前允许 entityId 为空并降级挂客户，
    // 结果需求页上传的资料丢了 requirementId，删需求时清不掉、永远留在客户档案里
    if (!dto.entityId) throw new BadRequestException('关联的业务对象不存在，请先保存后再上传资料');

    /*
     * 版本号：同一业务对象下、同名文件（客户重复发来的修订版）算作新版本。
     * 物理文件靠时间戳前缀本就不会覆盖，这里只是给展示层一个 v1/v2/v3 的标识，
     * 让"招标文件.pdf"发来第二版时一眼能分辨，而不是两条一模一样的记录。
     * column 取自固定映射表、非用户输入，拼进 SQL 安全。
     */
    const sameNameCount = await this.links
      .createQueryBuilder('l')
      .innerJoin(Document, 'd', 'd.id = l.documentId')
      .where(`l.${String(column)} = :eid`, { eid: dto.entityId })
      .andWhere('d.fileName = :fn', { fn: doc.fileName })
      .getCount();

    // 显式设置每个关联列，避免动态键在 TypeORM create() 中丢失
    const linkData: Partial<DocumentLink> = {
      documentId: dto.documentId,
      customerId: dto.customerId || doc.customerId || undefined,
      stage: dto.stage || DEFAULT_STAGE[dto.entityType],
      category: dto.category || (doc.category as DocCategory) || 'other',
      linkRole: dto.linkRole || 'source',
      version: sameNameCount + 1,
      description: dto.description,
      uploadedBy: user?.userId,
      uploadedByName: user?.username,
    };

    // 按 entityType 显式设置对应的关联列
    switch (dto.entityType) {
      case 'customer': linkData.customerId = dto.entityId; break;
      case 'requirement': linkData.requirementId = dto.entityId; break;
      case 'proposal': linkData.proposalId = dto.entityId; break;
      case 'solution': linkData.solutionId = dto.entityId; break;
      case 'quotation': linkData.quotationId = dto.entityId; break;
      case 'contract': linkData.contractId = dto.entityId; break;
      case 'project': linkData.projectId = dto.entityId; break;
      case 'afterSale': linkData.afterSaleId = dto.entityId; break;
      case 'workTask': linkData.workTaskId = dto.entityId; break;
    }

    /*
     * 写入护栏：stage 必须与实际关联的对象一致。
     *
     * stage 指向某业务阶段时必须有对应 *Id（业务对象保存后 entityId 必有值，
     * 正常不会触发；只对绕过前端的历史调用兼容），否则降级为 'raw'。
     */
    const STAGE_REQUIRES: Record<string, (keyof DocumentLink)[]> = {
      requirement: ['requirementId'],
      // solution 阶段既可能挂方案(proposalId)也可能挂标准方案(solutionId)，任一非空即可
      solution: ['proposalId', 'solutionId'],
      quotation: ['quotationId'],
      contract: ['contractId'],
    };
    const requiredCols = STAGE_REQUIRES[linkData.stage as string];
    if (requiredCols && !requiredCols.some((c) => linkData[c])) {
      linkData.stage = 'raw';
    }

    const link: DocumentLink = this.links.create(linkData as DocumentLink);
    const saved = await this.links.save(link);

    // 资料随单据归属客户（只补空）：单据的客户是确定的，用户不必再手选一遍
    try {
      const cid = saved.customerId || (await this.customerOfEntity(dto.entityType, dto.entityId));
      if (cid && !doc.customerId) {
        await this.documents.update(doc.id, { customerId: cid } as any);
        await recordAutomation(this.documents.manager, 'doc_customer_linked', 1, doc.id);
      }
    } catch {
      /* 归属失败不影响关联本身 */
    }
    domainEvents.emitEvent('document.linked', { documentId: doc.id, requirementId: saved.requirementId || null });
    return saved;
  }

  /** 单据的客户（表名来自固定映射，非用户输入） */
  private async customerOfEntity(entityType: string, entityId: string): Promise<string | null> {
    const table: Record<string, string> = {
      requirement: 'requirements', proposal: 'proposals', quotation: 'quotations',
      contract: 'contracts', project: 'projects', afterSale: 'after_sales_tickets', customer: 'customers',
    };
    const t = table[entityType];
    if (!t) return null;
    if (entityType === 'customer') return entityId;
    const row = await this.links.manager
      .createQueryBuilder()
      .select('x."customerId"', 'cid')
      .from(t, 'x')
      .where('CAST(x.id AS TEXT) = :id', { id: entityId })
      .getRawOne<{ cid: string }>();
    return row?.cid || null;
  }

  async remove(id: string): Promise<{ success: boolean }> {
    const link = await this.links.findOne({ where: { id } });
    if (!link) throw new NotFoundException('关联不存在');
    await this.links.delete(id);
    return { success: true };
  }

  /** 反查：某个业务对象下挂了哪些资料 */
  async findByEntity(
    entityType: LinkEntityType,
    entityId: string,
    user: CurrentUser,
  ): Promise<Array<Document & { link: DocumentLink }>> {
    const column = ENTITY_COLUMN[entityType];
    if (!column) throw new BadRequestException(`不支持的关联类型：${entityType}`);

    const links = await this.links.find({
      where: { [column]: entityId } as any,
      order: { createdAt: 'DESC' },
    });
    return this.hydrate(links, user);
  }

  /**
   * 客户全链路资料，按业务阶段分组。
   *
   * 这是"任意环节可回查原始文件"目标的落地查询：给定客户，
   * 一次拿到从原始资料到合同的全部文件，并保留各自的链路归属。
   */
  async customerChain(customerId: string, user: CurrentUser): Promise<ChainNode[]> {
    const links = await this.links.find({
      where: { customerId },
      order: { createdAt: 'ASC' },
    });
    const docs = await this.hydrate(links, user);

    // 一次性取回链路上各节点的标题，避免 N+1
    const ids = {
      requirement: [...new Set(links.map((l) => l.requirementId).filter(Boolean))],
      proposal: [...new Set(links.map((l) => l.proposalId).filter(Boolean))],
      quotation: [...new Set(links.map((l) => l.quotationId).filter(Boolean))],
      project: [...new Set(links.map((l) => l.projectId).filter(Boolean))],
    };

    const [reqs, props, quots, projs] = await Promise.all([
      ids.requirement.length ? this.requirements.find({ where: { id: In(ids.requirement) } }) : [],
      ids.proposal.length ? this.proposals.find({ where: { id: In(ids.proposal) } }) : [],
      ids.quotation.length ? this.quotations.find({ where: { id: In(ids.quotation) } }) : [],
      ids.project.length ? this.projects.find({ where: { id: In(ids.project) } }) : [],
    ]);

    const titleOf = (link: DocumentLink): { type: LinkEntityType | null; id: string | null; title: string | null } => {
      if (link.requirementId) {
        const r = reqs.find((x) => x.id === link.requirementId);
        return { type: 'requirement', id: link.requirementId, title: r ? `${r.requirementNo} ${r.title}` : null };
      }
      if (link.proposalId) {
        const p = props.find((x) => x.id === link.proposalId);
        return { type: 'proposal', id: link.proposalId, title: p ? `${p.proposalNo} ${p.title}` : null };
      }
      if (link.quotationId) {
        const q = quots.find((x) => x.id === link.quotationId);
        return { type: 'quotation', id: link.quotationId, title: q?.quotationNo ?? null };
      }
      if (link.projectId) {
        const p = projs.find((x) => x.id === link.projectId);
        return { type: 'project', id: link.projectId, title: p ? `${p.projectNo} ${p.name}` : null };
      }
      return { type: 'customer', id: link.customerId, title: null };
    };

    const stages: DocStage[] = ['raw', 'requirement', 'analysis', 'solution', 'quotation', 'contract'];
    return stages
      .map((stage) => {
        const inStage = docs.filter((d) => d.link.stage === stage);
        if (!inStage.length) return null;
        const first = titleOf(inStage[0].link);
        return {
          stage,
          stageLabel: DOC_STAGE_LABELS[stage],
          entityType: first.type,
          entityId: first.id,
          entityTitle: first.title,
          documents: inStage,
        };
      })
      .filter((n): n is ChainNode => n !== null);
  }

  /** 某份资料被关联到了哪些地方（详情页展示"关联链路"芯片组） */
  async findByDocument(documentId: string): Promise<DocumentLink[]> {
    return this.links.find({ where: { documentId }, order: { createdAt: 'DESC' } });
  }

  /** 批量取回 link 对应的 document 实体，并做权限过滤 */
  private async hydrate(
    links: DocumentLink[],
    user: CurrentUser,
  ): Promise<Array<Document & { link: DocumentLink }>> {
    if (!links.length) return [];
    const docIds = [...new Set(links.map((l) => l.documentId))];
    const docs = await this.documents.find({ where: { id: In(docIds) } });
    const byId = new Map(docs.map((d) => [d.id, d]));

    return links
      .map((link) => {
        const doc = byId.get(link.documentId);
        if (!doc) return null;
        return { ...doc, link } as Document & { link: DocumentLink };
      })
      .filter((d): d is Document & { link: DocumentLink } => {
        if (!d) return false;
        return this.permission.canAccess(user, {
          visibility: d.visibility,
          uploaderId: d.uploaderId,
          departmentId: d.departmentId,
          groupIds: d.groupIds,
          roleCodes: d.roleCodes,
        });
      });
  }
}
