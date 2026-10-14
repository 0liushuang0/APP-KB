import { fixMulterEncoding } from '../../common/utils/safe-path.util';
import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Like } from 'typeorm';
import { Proposal, ProposalVersion } from './entities/proposal.entity';
import { DocumentLink } from '../projects/entities/document-link.entity';
import { Requirement } from '../requirements/entities/requirement.entity';
import { Customer } from '../customers/entities/customer.entity';
import { CreateProposalDto, UpdateProposalDto, GenerateProposalDto, QueryProposalDto } from './dto/proposal.dto';
import { CurrentUser, PermissionService } from '../../common/services/permission.service';
import { NumberingService } from '../../common/services/numbering.service';
import { SharedFieldsService } from '../../common/services/shared-fields.service';
import { PermissionQueryService } from '../../common/services/permission-query.service';
import { paginate, PaginatedResult } from '../../common/dto/pagination.dto';
import { KnowledgeSyncService } from '../../common/services/knowledge-sync.service';
import { TransactionService } from '../../common/services/transaction.service';
import { AiService } from '../../common/services/ai.service';
import { ApprovalsService } from '../approvals/approvals.service';
import { DocumentsService } from '../documents/documents.service';
import { DocumentLinksService } from '../documents/document-links.service';
import * as docx from 'docx';

/**
 * 按小节标题从方案正文里摘取「产品描述」和「技术要求」。
 *
 * 不用大模型：这两段的标题在博亚的方案模板里是固定的几种写法，
 * 正则命中率高、零成本、且不需要把整份方案发出去。
 * 命中不了就留空，由人工补 —— 好过让模型编一段看似合理的话。
 */
function pickSections(text: string): { productDescription?: string; requirements?: string } {
  /*
   * 一律用正则**字面量**，不要 new RegExp 拼字符串。
   * 拼字符串踩过坑：单引号串里的 \s 会被吃成 s，正则悄悄失效且不报错 ——
   * 表现是"解析成功但两个字段都是空的"，比直接报错更难查。
   */
  const PRODUCT = [
      /产品描述[：:\s]*([\s\S]*?)(?=\n[一二三四五六七八九十\d]+[、.]|$)/,
      /设备概述[：:\s]*([\s\S]*?)(?=\n[一二三四五六七八九十\d]+[、.]|$)/,
      /产品概述[：:\s]*([\s\S]*?)(?=\n[一二三四五六七八九十\d]+[、.]|$)/,
      /方案概述[：:\s]*([\s\S]*?)(?=\n[一二三四五六七八九十\d]+[、.]|$)/,
  ];
  const REQUIREMENT = [
      /技术要求[：:\s]*([\s\S]*?)(?=\n[一二三四五六七八九十\d]+[、.]|$)/,
      /技术规格[：:\s]*([\s\S]*?)(?=\n[一二三四五六七八九十\d]+[、.]|$)/,
      /技术参数[：:\s]*([\s\S]*?)(?=\n[一二三四五六七八九十\d]+[、.]|$)/,
      /主要参数[：:\s]*([\s\S]*?)(?=\n[一二三四五六七八九十\d]+[、.]|$)/,
  ];

  const grab = (list: RegExp[]): string | undefined => {
    for (const re of list) {
      const body = re.exec(text)?.[1]?.trim();
      if (body) return body.slice(0, 2000);
    }
    return undefined;
  };

  return { productDescription: grab(PRODUCT), requirements: grab(REQUIREMENT) };
}

@Injectable()
export class ProposalsService {
  private readonly logger = new Logger(ProposalsService.name);

  constructor(
    @InjectRepository(Proposal)
    private proposalRepository: Repository<Proposal>,
    @InjectRepository(ProposalVersion)
    private versionRepository: Repository<ProposalVersion>,
    @InjectRepository(Requirement)
    private requirementRepository: Repository<Requirement>,
    @InjectRepository(Customer)
    private customerRepository: Repository<Customer>,
    private permissionService: PermissionService,
    private knowledgeSyncService: KnowledgeSyncService,
    private transactionService: TransactionService,
    private aiService: AiService,
    private approvalsService: ApprovalsService,
    private permissionQuery: PermissionQueryService,
    private numbering: NumberingService,
    private sharedFields: SharedFieldsService,
    private documentsService: DocumentsService,
    private documentLinks: DocumentLinksService,
  ) {}

  /** 列表（服务端分页，权限已下沉到 SQL） */
  async findAll(query: QueryProposalDto, user: CurrentUser): Promise<PaginatedResult<Proposal>> {
    const qb = this.proposalRepository.createQueryBuilder('p');

    if (query.status) qb.andWhere('p.status = :status', { status: query.status });
    if (query.customerId) qb.andWhere('p.customerId = :customerId', { customerId: query.customerId });
    if (query.requirementId) qb.andWhere('p.requirementId = :reqId', { reqId: query.requirementId });
    if (query.keyword) {
      // 项目名称已改由需求提供，关键词覆盖 需求标题 + 客户名
      // 子查询里的 rq/cc 是裸别名，驼峰列名不会被 TypeORM 替换，必须手工加引号
      qb.andWhere(
        `(p.proposalNo LIKE :kw OR EXISTS(
            SELECT 1 FROM requirements rq
            LEFT JOIN customers cc ON cc.id = rq."customerId"
            WHERE rq.id = p."requirementId" AND (rq.title LIKE :kw OR cc.name LIKE :kw)
         ))`,
        { kw: `%${query.keyword}%` },
      );
    }

    this.permissionQuery.apply(qb, 'p', user);

    const result = await paginate(qb, 'p', query, ['createdAt', 'status', 'proposalNo', 'version']);
    return { ...result, list: await this.attachRelations(result.list) };
  }

  /**
   * 贴上客户简称与项目名称。
   *
   * 项目名称不再存在 proposals.title 里 —— 它由关联需求提供，
   * 改需求就跟着变，两边不会各说各话。这里一次性查出来，避免前端逐行请求。
   */
  private async attachRelations(rows: Proposal[]): Promise<any[]> {
    const reqIds = [...new Set(rows.map((r) => r.requirementId).filter(Boolean))];
    const manager = this.proposalRepository.manager;

    /*
     * 客户从**关联需求**取，而不是方案自己的 customerId。
     *
     * 方案表里那一列多数是历史遗留的悬空引用（10 条里 9 条指向已不存在的客户），
     * 照着它查只会得到一片空白。而客户的主数据本来就在需求上 ——
     * 顺着需求取，既拿得到值，也和"客户跟着上游走"的设定一致。
     */
    const chain = reqIds.length
      ? await manager
          .createQueryBuilder()
          .select([
            'r.id AS "id"',
            'r.title AS "title"',
            'r.requirementNo AS "requirementNo"',
            'c.name AS "customerName"',
            'c.code AS "customerShortName"',
          ])
          .from('requirements', 'r')
          .leftJoin('customers', 'c', 'c.id = r."customerId"')
          .where('r.id IN (:...ids)', { ids: reqIds })
          .getRawMany<any>()
      : [];

    const rmap = new Map(chain.map((r) => [r.id, r]));

    /*
     * 附件计数（输入/输出）：列表操作列直接显示「2/2」，不用逐行点进编辑弹窗数。
     * source=客户提交的输入资料，deliverable=我方提交的输出资料（与 EntityFileUpload 的口径一致）。
     */
    const ids = rows.map((p) => p.id);
    const counts = ids.length
      ? await manager
          .createQueryBuilder()
          .select(['l."proposalId" AS "id"', 'l."linkRole" AS "role"', 'COUNT(*) AS "n"'])
          .from('document_links', 'l')
          .where('l."proposalId" IN (:...ids)', { ids })
          .groupBy('l."proposalId"')
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
      const r = p.requirementId ? rmap.get(p.requirementId) : undefined;
      return {
        ...p,
        customerName: r?.customerName ?? null,
        customerShortName: r?.customerShortName || r?.customerName || null,
        // 没有关联需求就没有项目名称，界面上照实显示，别用旧标题糊过去
        projectName: r?.title,
        requirementNo: r?.requirementNo,
        attachmentCounts: cmap.get(p.id) || { input: 0, output: 0 },
      };
    });
  }


  async findOne(id: string, user: CurrentUser): Promise<Proposal> {
    const proposal = await this.proposalRepository.findOne({ where: { id } });
    if (!proposal) throw new NotFoundException('方案不存在');
    if (!this.permissionService.canAccess(user, this.toSubject(proposal))) {
      throw new BadRequestException('无权访问该方案');
    }
    return proposal;
  }

  /** 方案编号：优先继承所关联需求的流水号，便于一眼看出是同一单 */
  private async nextNo(requirementId?: string): Promise<string> {
    if (!requirementId) return this.numbering.next('proposal');
    const req = await this.requirementRepository.findOne({
      where: { id: requirementId },
      select: ['requirementNo'],
    });
    return this.numbering.derive('proposal', req?.requirementNo);
  }

  /**
   * 客户跟随关联需求。
   *
   * 客户这一份值只存在需求上，方案不再单独选 —— 否则就会出现
   * 「方案的项目名称是甲客户的，客户栏却写着乙客户」这种自相矛盾的记录。
   */
  private async inheritCustomerId(dto: { requirementId?: string; customerId?: string }) {
    if (!dto.requirementId) return dto.customerId;
    const req = await this.requirementRepository.findOne({
      where: { id: dto.requirementId },
      select: ['customerId'],
    });
    return req?.customerId ?? dto.customerId;
  }

  async create(dto: CreateProposalDto, user: CurrentUser): Promise<Proposal> {
    const skipApproval = this.permissionService.skipApproval();
    const saved = await this.transactionService.run(
      async (manager) => {
        const proposal = manager.create(Proposal, {
          ...dto,
          // 编号继承关联需求的流水号：REQ-2026-007 → PROP-2026-007，
          // 同一需求下的第二个方案自动变成 PROP-2026-007-A
          proposalNo: dto.proposalNo || (await this.nextNo(dto.requirementId)),
          customerId: await this.inheritCustomerId(dto),
          ownerId: user?.userId,
          departmentId: dto.departmentId || user?.departmentId,
          status: skipApproval ? 'approved' : 'pending',
        });
        const savedProposal = await manager.save(proposal);
        if (!skipApproval) {
          await this.approvalsService.create({
            objectType: 'proposal',
            objectId: savedProposal.id,
            submittedBy: user?.userId,
            status: 'pending',
          }, manager);
        }
        return savedProposal;
      },
      async (result) => { await this.sync(result); },
    );
    return saved;
  }

  /**
   * 从上传的 Word 里抽取方案要点。
   *
   * 售前实际的工作方式是：先在 Word 里把方案写好（有模板、有排版、要发客户），
   * 系统里再补录一遍纯属重复劳动。所以这里让用户直接传 Word ——
   * 文件进资料中心并与方案关联（可下载原件），同时把正文抽出来存进 content
   * 供检索和 AI 引用，产品描述/技术要求则从正文里按小节标题摘取。
   *
   * 解析在**本机**完成（AI 服务用 python-docx，见 parser.py），
   * 文件本身不出内网；只有抽出来的文本才可能随问答上云。
   */
  async extractFromDocument(
    id: string,
    file: { originalname: string; buffer: Buffer },
    user: CurrentUser,
  ): Promise<Proposal> {
    const proposal = await this.findOne(id, user);
    if (!this.permissionService.canManage(user, this.toSubject(proposal))) {
      throw new BadRequestException('无权修改该方案');
    }

    // multer 会把 UTF-8 文件名按 Latin1 读成乱码(「…roll）2026」→「…rollï¼2026」), 先还原
    file.originalname = fixMulterEncoding(file.originalname);
    const { text, error: parseError } = await this.aiService.parseFileDetailed(
      file.originalname,
      file.buffer.toString('base64'),
    );
    if (!text?.trim()) {
      // AI 服务带回的是用户能照着做的原因（旧版 .doc、扫描件、文本都在图片里等），
      // 别再吞掉换成笼统的「请确认是 Word/PDF」—— 用户导的明明就是 Word。
      throw new BadRequestException(
        parseError || '未能从该文件中解析出文字，请确认是文字版 Word/PDF 且不是扫描件',
      );
    }

    const picked = pickSections(text);
    proposal.content = text;
    if (picked.productDescription) proposal.productDescription = picked.productDescription;
    if (picked.requirements) proposal.requirements = picked.requirements;

    const saved = await this.proposalRepository.save(proposal);

    /*
     * 原件也要留下。
     * 抽出来的文本供检索和 AI 引用，但发给客户的是那份带排版的 Word ——
     * 只存文本等于把交付物弄丢了。文件进资料中心并挂到本方案下，
     * 详情页据此提供下载。
     */
    try {
      const doc = await this.documentsService.create(
        {
          title: `${proposal.proposalNo} ${file.originalname}`,
          category: '方案文件',
        } as any,
        file as any,
        user,
      );
      await this.documentLinks.create(
        {
          documentId: doc.id,
          entityType: 'proposal',
          entityId: proposal.id,
          linkRole: 'deliverable',
          proposalId: proposal.id,
          description: '方案原件',
        } as any,
        user,
      );
    } catch (err: any) {
      // 存档失败不该让整次导入白做 —— 正文已经抽出来了
      this.logger.warn(`方案原件归档失败：${err.message}`);
    }

    await this.sync(saved);
    return saved;
  }

  async update(id: string, dto: UpdateProposalDto, user: CurrentUser): Promise<Proposal> {
    const proposal = await this.findOne(id, user);
    if (!this.permissionService.canManage(user, this.toSubject(proposal))) {
      throw new BadRequestException('无权修改该方案');
    }
    const saved = await this.transactionService.run(
      async (manager) => {
        /*
         * 项目名称与客户只存在需求上。在方案里改，就改那条需求 ——
         * 这样"在哪个模块改都行"，而值仍然只有一份。
         */
        await this.sharedFields.writeBack(
          'proposal',
          id,
          { projectName: (dto as any).projectName, customerId: dto.customerId },
          manager,
        );
        await manager.save(ProposalVersion, {
          proposalId: id,
          version: proposal.version,
          content: proposal.content,
          createdBy: user?.userId,
        });
        proposal.version += 1;
        /*
         * projectName / title 不写进方案表：项目名称的主数据在需求上，
         * 上面的 writeBack 已经存过去了。这里再往 proposals.title 里写一份，
         * 就又回到了"两处各存一份、迟早对不上"的老问题。
         */
        const { projectName: _pn, title: _t, proposalNo, ...rest } = dto as any;
        Object.assign(proposal, rest);
        // 方案编号可编辑：手改的直接用（查重见下）；清空 = 重新按规则生成（继承需求尾号）
        if (proposalNo !== undefined) {
          const wanted = String(proposalNo).trim();
          if (wanted) {
            if (wanted !== proposal.proposalNo) {
              const dup = await manager
                .createQueryBuilder()
                .select('p2.id', 'id')
                .from('proposals', 'p2')
                .where('p2."proposalNo" = :no AND p2.id != :id', { no: wanted, id })
                .getRawOne<{ id: string }>();
              if (dup) throw new BadRequestException(`方案编号 ${wanted} 已被其他方案占用`);
            }
            proposal.proposalNo = wanted;
          } else {
            proposal.proposalNo = await this.nextNo(proposal.requirementId);
          }
        }
        return manager.save(proposal);
      },
      async (result) => { await this.sync(result); },
    );
    return saved;
  }

  /**
   * 删除方案：版本表、文档链接与主行一起删（事务保护），向量清理放事务外。
   * Quotation.proposalId / Project.proposalId 这类反向引用不级联置空——
   * 方案被删不等于报价/项目作废，保留旧 id 让展示层 join 时自然降级即可。
   */
  async remove(id: string, user: CurrentUser): Promise<void> {
    const proposal = await this.findOne(id, user);
    if (!this.permissionService.canManage(user, this.toSubject(proposal))) {
      throw new BadRequestException('无权删除该方案');
    }
    /*
     * 删除前先看有没有报价还挂着它。
     *
     * 悬空引用的代价：报价/合同的客户与项目名称全部顺着链取，
     * 链断在已删除的方案上，列表与弹窗会整片变空（2026-10-14 实际发生过：
     * 删了 PRO-26-001-A 又重建，QUO-26-001 的 proposalId 还指着旧 id）。
     * 与客户删除的 removePreview 同一思路：宁可拦下来让用户先处理下游。
     */
    const downstream = await this.proposalRepository.manager
      .createQueryBuilder()
      .select('q."quotationNo"', 'no')
      .from('quotations', 'q')
      .where('q."proposalId" = :id', { id })
      .getRawMany<{ no: string }>();
    if (downstream.length) {
      throw new BadRequestException(
        `该方案下还有 ${downstream.length} 份报价（${downstream.map((d) => d.no).join('、')}），请先删除或改挂报价后再删除方案`,
      );
    }
    await this.transactionService.run(
      async (manager) => {
        await manager.getRepository(ProposalVersion).delete({ proposalId: id });
        await manager.getRepository(DocumentLink).delete({ proposalId: id });
        await manager.getRepository(Proposal).delete(id);
      },
      async () => {
        await this.knowledgeSyncService.deleteObject('proposal', id);
      },
    );
  }

  async approve(id: string, user: CurrentUser): Promise<Proposal> {
    if (!this.permissionService.canApprove(user)) throw new BadRequestException('无权审核');
    const proposal = await this.proposalRepository.findOne({ where: { id } });
    if (!proposal) throw new NotFoundException('方案不存在');
    proposal.status = 'approved';
    return this.transactionService.run(
      async (manager) => {
        const saved = await manager.save(proposal);
        await this.approvalsService.approve('proposal', id, user?.userId, '审核通过', manager);
        return saved;
      },
    );
  }

  async generate(dto: GenerateProposalDto, user: CurrentUser): Promise<Proposal> {
    const [customer, requirement, references] = await Promise.all([
      this.customerRepository.findOne({ where: { id: dto.customerId } }),
      dto.requirementId
        ? this.requirementRepository.findOne({ where: { id: dto.requirementId } })
        : Promise.resolve(null),
      this.aiService.searchRag(
        dto.requirements,
        ['product', 'product_attachment', 'solution', 'proposal', 'quotation', 'document', 'supplier', 'requirement', 'customer', 'project', 'knowledge'],
        15,
      ),
    ]);
    const context = [
      customer
        ? `客户：${customer.name}；行业：${customer.industry || '未填写'}；规模：${customer.scale || '未填写'}；背景：${customer.description || '未填写'}`
        : '',
      requirement
        ? `关联需求：${requirement.title}\n${requirement.description || ''}\n${requirement.aiAnalysis || ''}\n${requirement.structuredSpec || ''}`
        : '',
      ...references.map(
        (item, index) =>
          `[${index + 1}] [${item.source_type}:${item.source_id}] ${item.content.slice(0, 600)}`,
      ),
    ]
      .filter(Boolean)
      .join('\n\n');
    const content = await this.aiService.generateProposal(dto.requirements, context);

    return this.create(
      {
        customerId: dto.customerId,
        requirementId: dto.requirementId,
        title: dto.title,
        requirements: dto.requirements,
        content,
        aiGenerated: true,
      },
      user,
    );
  }

  async recommend(requirementId: string, user: CurrentUser) {
    const requirement = await this.requirementRepository.findOne({ where: { id: requirementId } });
    if (!requirement) throw new NotFoundException('需求不存在');

    const queryText = `${requirement.title} ${requirement.description || ''} ${requirement.aiAnalysis || ''}`;

    const results = await this.aiService.searchRag(
      queryText,
      ['product', 'product_attachment', 'solution', 'quotation', 'document', 'supplier', 'requirement', 'customer', 'project', 'knowledge'],
      20,
    );

    const products = results.filter((r) => r.source_type === 'product');
    const productAttachments = results.filter((r) => r.source_type === 'product_attachment');
    const quotations = results.filter((r) => r.source_type === 'quotation');
    const documents = results.filter((r) => r.source_type === 'document');
    const suppliers = results.filter((r) => r.source_type === 'supplier');

    const ragContext = results
      .map((r) => `[${r.source_type}] ${r.content.slice(0, 200)}`)
      .join('\n');

    const draftMessages = [
      {
        role: 'system',
        content:
          '你是一名售前方案专家。请根据客户需求以下知识库匹配结果，生成一份方案推荐摘要（Markdown 格式），包括：1. 推荐产品及理由 2. 参考报价 3. 技术协议/文件建议。控制在800字以内。',
      },
      {
        role: 'user',
        content: `客户需求：${queryText}\n\n知识库匹配结果：\n${ragContext}`,
      },
    ];
    const draftProposal = await this.aiService.chat(draftMessages, 'recommend');

    return {
      requirement: {
        id: requirement.id,
        title: requirement.title,
        requirementNo: requirement.requirementNo,
        customerId: requirement.customerId,
        aiAnalysis: requirement.aiAnalysis,
      },
      analysis: requirement.aiAnalysis || '',
      recommendations: {
        products: products.map((r) => ({ sourceId: r.source_id, content: r.content.slice(0, 300), score: r.score })),
        productAttachments: productAttachments.map((r) => ({ sourceId: r.source_id, content: r.content.slice(0, 300), score: r.score })),
        quotations: quotations.map((r) => ({ sourceId: r.source_id, content: r.content.slice(0, 300), score: r.score })),
        documents: documents.map((r) => ({ sourceId: r.source_id, content: r.content.slice(0, 300), score: r.score })),
        suppliers: suppliers.map((r) => ({ sourceId: r.source_id, content: r.content.slice(0, 300), score: r.score })),
      },
      draftProposal,
    };
  }

  async exportDocx(id: string, user: CurrentUser): Promise<Buffer> {
    const proposal = await this.findOne(id, user);
    const doc = new docx.Document({
      sections: [
        {
          properties: {},
          children: [
            new docx.Paragraph({
              text: proposal.title,
              heading: docx.HeadingLevel.HEADING_1,
            }),
            new docx.Paragraph({ text: `方案编号：${proposal.proposalNo}` }),
            new docx.Paragraph({ text: proposal.content || '暂无内容' }),
          ],
        },
      ],
    });
    return docx.Packer.toBuffer(doc);
  }

  private async sync(proposal: Proposal): Promise<void> {
    const content = `${proposal.title} ${proposal.proposalType || ''} ${proposal.productDescription || ''} ${proposal.requirements || ''} ${proposal.content || ''}`;
    await this.knowledgeSyncService.syncObject({
      id: proposal.id,
      objectType: 'proposal',
      title: proposal.title,
      content,
      visibility: proposal.visibility,
      uploaderId: proposal.ownerId,
      departmentId: proposal.departmentId,
      groupIds: proposal.groupIds,
      roleCodes: proposal.roleCodes,
    });
  }

  private toSubject(proposal: Proposal) {
    return {
      visibility: proposal.visibility,
      uploaderId: proposal.ownerId,
      departmentId: proposal.departmentId,
      groupIds: proposal.groupIds,
      roleCodes: proposal.roleCodes,
    };
  }
}
