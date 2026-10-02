import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Project, DealStage } from './entities/project.entity';
import { ProjectTimeline, TimelineStage, TimelineAction } from './entities/project-timeline.entity';
import { DocumentLink, DocStage, DocCategory } from './entities/document-link.entity';
import { Document } from '../documents/entities/document.entity';
import { Requirement } from '../requirements/entities/requirement.entity';
import { Proposal } from '../proposals/entities/proposal.entity';
import { Quotation } from '../quotations/entities/quotation.entity';
import { CurrentUser, PermissionService } from '../../common/services/permission.service';

@Injectable()
export class ProjectWorkflowService {
  constructor(
    @InjectRepository(Project)
    private projectRepository: Repository<Project>,
    @InjectRepository(ProjectTimeline)
    private timelineRepository: Repository<ProjectTimeline>,
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
    private permissionService: PermissionService,
  ) {}

  async getProjectDetail(id: string, user: CurrentUser) {
    const project = await this.projectRepository.findOne({ where: { id } });
    if (!project) throw new NotFoundException('项目不存在');

    const [timeline, docLinks, requirement, proposals, quotations] = await Promise.all([
      this.timelineRepository.find({ where: { projectId: id }, order: { createdAt: 'DESC' } }),
      this.documentLinkRepository.find({ where: { projectId: id }, order: { createdAt: 'DESC' } }),
      project.requirementId
        ? this.requirementRepository.findOne({ where: { id: project.requirementId } })
        : null,
      this.proposalRepository.find({ where: { customerId: project.customerId }, order: { createdAt: 'DESC' } }),
      this.quotationsRepository(project.customerId),
    ]);

    const docIds = docLinks.map((d) => d.documentId);
    const documents = docIds.length
      ? await this.documentRepository.findByIds(docIds)
      : [];

    const docMap = new Map(documents.map((d) => [d.id, d]));
    const groupedDocs = docLinks.map((link) => ({
      ...link,
      document: docMap.get(link.documentId),
    }));

    return {
      ...project,
      timeline,
      requirement,
      proposals,
      quotations,
      documents: groupedDocs,
    };
  }

  private async quotationsRepository(customerId: string) {
    if (!customerId) return [];
    return this.quotationRepository.find({ where: { customerId }, order: { createdAt: 'DESC' } });
  }

  async updateDealStage(id: string, stage: DealStage, user: CurrentUser) {
    const project = await this.projectRepository.findOne({ where: { id } });
    if (!project) throw new NotFoundException('项目不存在');

    const oldStage = project.dealStage;
    project.dealStage = stage;
    await this.projectRepository.save(project);

    await this.addTimelineEvent(id, {
      stage: this.stageFromDealStage(stage),
      action: 'edit',
      actorId: user?.userId,
      actorName: user?.username,
      description: `阶段变更: ${oldStage} → ${stage}`,
    });

    return project;
  }

  async addTimelineEvent(projectId: string, event: {
    stage: TimelineStage;
    action: TimelineAction;
    actorId?: string;
    actorName?: string;
    documentId?: string;
    description?: string;
    metadata?: string;
  }) {
    const entry = this.timelineRepository.create({
      projectId,
      ...event,
    });
    return this.timelineRepository.save(entry);
  }

  async getTimeline(projectId: string) {
    return this.timelineRepository.find({
      where: { projectId },
      order: { createdAt: 'DESC' },
    });
  }

  async linkDocument(dto: {
    documentId: string;
    projectId?: string;
    customerId?: string;
    requirementId?: string;
    stage: DocStage;
    category: DocCategory;
    description?: string;
  }, user: CurrentUser) {
    const existing = await this.documentLinkRepository.findOne({
      where: { documentId: dto.documentId, projectId: dto.projectId || '' },
    });
    if (existing) {
      Object.assign(existing, dto);
      return this.documentLinkRepository.save(existing);
    }

    const version = await this.getNextVersion(dto.projectId, dto.category);

    const link = this.documentLinkRepository.create({
      ...dto,
      version,
      uploadedBy: user?.userId,
      uploadedByName: user?.username,
    });

    const saved = await this.documentLinkRepository.save(link);

    if (dto.projectId) {
      await this.addTimelineEvent(dto.projectId, {
        stage: this.stageFromDocStage(dto.stage),
        action: 'upload',
        actorId: user?.userId,
        actorName: user?.username,
        documentId: dto.documentId,
        description: dto.description || `上传文档 (${dto.category})`,
      });
    }

    return saved;
  }

  private async getNextVersion(projectId: string | undefined, category: DocCategory) {
    if (!projectId) return 1;
    const count = await this.documentLinkRepository.count({
      where: { projectId, category },
    });
    return count + 1;
  }

  /**
   * 项目文档列表。
   * documentLink 本身无可见性，过滤看挂的 document：之前不过滤，
   * 能进项目的人就能看到该项目所有 private 文档。现在按 document 可见性收口。
   */
  async getProjectDocuments(projectId: string, user: CurrentUser) {
    const links = await this.documentLinkRepository.find({
      where: { projectId },
      order: { createdAt: 'DESC' },
    });
    const docIds = links.map((l) => l.documentId);
    const documents = docIds.length ? await this.documentRepository.findByIds(docIds) : [];
    const docMap = new Map(documents.map((d) => [d.id, d]));
    return this.filterVisibleLinks(links, docMap, user);
  }

  async getCustomerDocuments(customerId: string, user: CurrentUser, stage?: DocStage) {
    const where: any = { customerId };
    if (stage) where.stage = stage;
    const links = await this.documentLinkRepository.find({
      where,
      order: { createdAt: 'DESC' },
    });
    const docIds = links.map((l) => l.documentId);
    const documents = docIds.length ? await this.documentRepository.findByIds(docIds) : [];
    const docMap = new Map(documents.map((d) => [d.id, d]));
    return this.filterVisibleLinks(links, docMap, user);
  }

  /** 按 document 可见性过滤链接，只返回当前用户有权访问的 */
  private filterVisibleLinks(
    links: DocumentLink[],
    docMap: Map<string, Document>,
    user: CurrentUser,
  ) {
    return links
      .filter((link) => {
        const doc = docMap.get(link.documentId);
        if (!doc) return false;
        return this.permissionService.canAccess(user, {
          visibility: doc.visibility,
          uploaderId: (doc as any).uploaderId,
          departmentId: (doc as any).departmentId,
          groupIds: (doc as any).groupIds,
          roleCodes: (doc as any).roleCodes,
        });
      })
      .map((link) => ({ ...link, document: docMap.get(link.documentId) }));
  }

  async unlinkDocument(linkId: string) {
    const link = await this.documentLinkRepository.findOne({ where: { id: linkId } });
    if (!link) throw new NotFoundException('文档关联不存在');
    await this.documentLinkRepository.delete(linkId);
    return { success: true };
  }

  private stageFromDealStage(stage: DealStage): TimelineStage {
    const map: Record<DealStage, TimelineStage> = {
      requirement_registered: 'requirement',
      requirement_analyzed: 'analysis',
      solution_drafting: 'solution',
      quotation_drafting: 'quotation',
      quotation_reviewed: 'review',
      submitted: 'submit',
      contract_signed: 'submit',
      won: 'submit',
      lost: 'submit',
    };
    return map[stage];
  }

  private stageFromDocStage(stage: DocStage): TimelineStage {
    const map: Record<DocStage, TimelineStage> = {
      raw: 'requirement',
      requirement: 'requirement',
      analysis: 'analysis',
      solution: 'solution',
      quotation: 'quotation',
      contract: 'submit',
    };
    return map[stage];
  }
}
