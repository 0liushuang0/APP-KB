import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Like, In, Brackets, SelectQueryBuilder, EntityManager } from 'typeorm';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { ConfigService } from '@nestjs/config';
import { Document } from './entities/document.entity';
import { DocumentVersion } from './entities/document-version.entity';
import { DocumentLink } from '../projects/entities/document-link.entity';
import {
  CreateDocumentDto,
  UpdateDocumentDto,
  QueryDocumentDto,
} from './dto/document.dto';
import { CurrentUser } from '../../common/services/permission.service';
import { AiService } from '../../common/services/ai.service';
import { PermissionService } from '../../common/services/permission.service';
import { PermissionQueryService } from '../../common/services/permission-query.service';
import { paginate, PaginatedResult } from '../../common/dto/pagination.dto';
import { ApprovalsService } from '../approvals/approvals.service';
import {
  FileArchiveService,
  ArchiveType,
} from '../../common/services/file-archive.service';
import { TransactionService } from '../../common/services/transaction.service';
import axios from 'axios';
import {
  safeUploadTarget,
  safeReadPath,
  resolveDocumentFilePath,
  sanitizeFileName,
} from '../../common/utils/safe-path.util';
import { RecycleBinService } from '../recycle-bin/recycle-bin.service';

@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);
  private uploadDir: string;
  private knowledgeDir: string;
  private publicUrl: string;

  /** 知识分类 key → 中文磁盘目录名（补齐 FAQ/技术知识/常用提交资料三大类） */
  private static readonly KNOWLEDGE_DIR_MAP: Record<string, string> = {
    // ── FAQ常见问题 ──
    faq_selection: 'FAQ-选型',
    faq_tech_params: 'FAQ-技术参数',
    faq_process: 'FAQ-工艺',
    faq_price: 'FAQ-价格商务',
    faq_delivery: 'FAQ-交期物流',
    faq_warranty: 'FAQ-售后质保',
    // ── 技术知识 ──
    tech_principle: '技术原理',
    tech_process: '工艺知识',
    tech_material: '材料知识',
    tech_structure: '设备结构',
    tech_electrical: '电气控制',
    tech_hydraulic: '液压润滑',
    tech_trend: '行业动态',
    // ── 标准规范 ──
    national_standard: '国家标准',
    industry_standard: '行业标准',
    enterprise_standard: '企业标准',
    intl_standard: '国际标准',
    customer_special_std: '客户特殊规范',
    // ── 模板表格 ──
    tech_agreement: '技术协议模板',
    acceptance_template: '验收标准模板',
    test_report_template: '测试报告模板',
    site_survey_template: '现场勘测表',
    calc_template: '计算表格',
    param_comparison: '参数对照表',
    // ── 培训资料 ──
    product_manual: '产品手册',
    training_material: '培训资料',
    operation_manual: '操作手册',
    maintenance_manual: '维护手册',
    safety_manual: '安全规程',
    // ── 常用提交资料 ──
    product_spec_doc: '产品说明书',
    certificate_template: '合格证',
    packing_list: '装箱单',
    factory_inspection: '出厂检验',
    random_docs: '随机文件',
    // ── 故障排除（售后转FAQ）──
    troubleshooting: '故障排除',
    // ── 其他 ──
    other: '其他',
  };

  constructor(
    @InjectRepository(Document)
    private documentRepository: Repository<Document>,
    @InjectRepository(DocumentVersion)
    private versionRepository: Repository<DocumentVersion>,
    @InjectRepository(DocumentLink)
    private documentLinkRepository: Repository<DocumentLink>,
    private configService: ConfigService,
    private aiService: AiService,
    private permissionService: PermissionService,
    private approvalsService: ApprovalsService,
    private fileArchiveService: FileArchiveService,
    private permissionQuery: PermissionQueryService,
    private readonly tx: TransactionService,
    private readonly recycleBin: RecycleBinService,
  ) {
    this.uploadDir = path.resolve(process.cwd(), 'data', 'uploads', 'documents');
    this.knowledgeDir = path.resolve(process.cwd(), 'data', 'uploads', 'knowledge');
    this.publicUrl =
      process.env.PUBLIC_URL ||
      `http://localhost:${process.env.PORT || 3000}`;
    this.ensureUploadDir();
  }

  private ensureUploadDir() {
    if (!fs.existsSync(this.uploadDir)) {
      fs.mkdirSync(this.uploadDir, { recursive: true });
    }
    if (!fs.existsSync(this.knowledgeDir)) {
      fs.mkdirSync(this.knowledgeDir, { recursive: true });
    }
  }

  /**
   * fileKey → 物理路径。规则见 resolveDocumentFilePath ——
   * 下载/预览接口（FilesController）用的是同一个函数，两边不会再解析出不同的路径。
   */
  getFilePath(fileKey: string): string {
    return resolveDocumentFilePath(path.resolve(process.cwd(), 'data', 'uploads'), fileKey);
  }

  /** 文件格式分组 → 扩展名，用于资料中心按格式筛选 */
  private static readonly FILE_TYPE_EXT: Record<string, string[]> = {
    pdf: ['.pdf'],
    word: ['.doc', '.docx'],
    excel: ['.xls', '.xlsx', '.csv'],
    ppt: ['.ppt', '.pptx'],
    cad: ['.dwg', '.dxf'],
    image: ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp'],
    text: ['.txt', '.md'],
  };

  /**
   * 资料列表（服务端分页）。
   *
   * 权限、筛选、排序、分页全部在 SQL 里完成 —— 此前是取回整表再用 JS 过滤，
   * 数据上万后每次打开资料中心都要传输整张表。
   */
  async findAll(
    query: QueryDocumentDto,
    user: CurrentUser,
  ): Promise<PaginatedResult<Document>> {
    const qb = this.documentRepository.createQueryBuilder('d');

    if (query.status) qb.andWhere('d.status = :status', { status: query.status });
    if (query.customerId) qb.andWhere('d.customerId = :customerId', { customerId: query.customerId });
    if (query.uploaderId) qb.andWhere('d.uploaderId = :uploaderId', { uploaderId: query.uploaderId });
    if (query.keyword) {
      qb.andWhere('(d.title LIKE :kw OR d.fileName LIKE :kw)', { kw: `%${query.keyword}%` });
    }

    // category 支持逗号分隔多选
    const categories = query.category?.split(',').map((c) => c.trim()).filter(Boolean);
    if (categories?.length) {
      qb.andWhere('d.category IN (:...categories)', { categories });
    }

    if (query.dateFrom) {
      qb.andWhere('d.createdAt >= :dateFrom', { dateFrom: new Date(query.dateFrom) });
    }
    if (query.dateTo) {
      // 截止日当天也要算在内，所以取到次日 00:00
      const to = new Date(query.dateTo);
      to.setDate(to.getDate() + 1);
      qb.andWhere('d.createdAt < :dateTo', { dateTo: to });
    }

    /*
     * 文件格式筛选：扩展名映射是展示层概念，库里没有对应列。
     * 用 fileName 的后缀做 LIKE 匹配，仍然留在 SQL 里，
     * 这样才不会破坏分页的正确性。
     */
    const fileTypes = query.fileType?.split(',').map((t) => t.trim()).filter(Boolean);
    if (fileTypes?.length) {
      const known = Object.values(DocumentsService.FILE_TYPE_EXT).flat();
      const wanted = fileTypes.flatMap((t) => DocumentsService.FILE_TYPE_EXT[t] || []);
      const includeOther = fileTypes.includes('other');

      qb.andWhere(
        new Brackets((w) => {
          wanted.forEach((ext, i) => {
            const key = `ext${i}`;
            const cond = `LOWER(d.fileName) LIKE :${key}`;
            i === 0 ? w.where(cond, { [key]: `%${ext}` }) : w.orWhere(cond, { [key]: `%${ext}` });
          });
          if (includeOther) {
            // "其他" = 不属于任何已知分组的后缀
            const notKnown = known.map((ext, i) => `LOWER(d.fileName) NOT LIKE :nk${i}`).join(' AND ');
            const params = Object.fromEntries(known.map((ext, i) => [`nk${i}`, `%${ext}`]));
            wanted.length ? w.orWhere(`(${notKnown})`, params) : w.where(`(${notKnown})`, params);
          }
        }),
      );
    }

    /*
     * 资料归属过滤：把资料库拆成「客户资料」和「业务资料」两个视图。
     * 客户资料 = 有 document_links 关联到客户/需求/方案/报价/合同/项目的文档；
     * 业务资料 = 没有任何关联、且非知识库分类的独立对外资料（宣传/案例/资质等）。
     * 知识库文档（category=knowledge/*）也没有 links，但它属于「知识库」这个桶，
     * 不能漏进业务资料，所以业务资料额外排除 knowledge 分类。
     * 用子查询实现，不破坏分页。
     */
    if (query.scope === 'customer') {
      this.applyScopeFilter(qb, 'customer');
    } else if (query.scope === 'business') {
      this.applyScopeFilter(qb, 'business');
    }

    this.permissionQuery.apply(qb, 'd', user, { owner: 'uploaderId' });

    const result = await paginate(qb, 'd', query, ['createdAt', 'title', 'fileSize', 'status']);
    return { ...result, list: await this.attachOwnership(result.list) };
  }

  /**
   * 按分类统计资料条数 —— 业务/客户资料页左侧导航的计数用。
   * scope 口径与 findAll 完全一致：客户资料 = 有链路关联的文档，
   * 业务资料 = 无关联且非知识库分类的独立文档。
   */
  async categoryCounts(scope: string | undefined, user: CurrentUser): Promise<Record<string, number>> {
    const qb = this.documentRepository.createQueryBuilder('d');
    this.applyScopeFilter(qb, scope);
    this.permissionQuery.apply(qb, 'd', user, { owner: 'uploaderId' });
    const rows = await qb
      .select('d.category', 'category')
      .addSelect('COUNT(*)', 'count')
      .groupBy('d.category')
      .getRawMany<{ category: string | null; count: string | number }>();
    const counts: Record<string, number> = {};
    for (const r of rows) counts[r.category || ''] = Number(r.count);
    return counts;
  }

  /** scope 过滤：列表与计数共用同一套口径，避免两边数字对不上 */
  private applyScopeFilter(qb: SelectQueryBuilder<Document>, scope?: string) {
    if (scope === 'customer') {
      qb.andWhere(
        `d.id IN (SELECT dl."documentId" FROM document_links dl WHERE dl."documentId" = d.id)`,
      );
    } else if (scope === 'business') {
      qb.andWhere(
        `d.id NOT IN (SELECT dl."documentId" FROM document_links dl WHERE dl."documentId" = d.id)`,
      );
      qb.andWhere(`(d.category IS NULL OR d.category NOT LIKE 'knowledge%')`);
    }
  }

  /**
   * 贴上「资料所属」。
   *
   * category 说的是资料**类型**（技术协议/图纸/报价单），
   * 但用户还要知道这份文件是**从哪来的** —— 是客户需求阶段收到的，
   * 还是我们出方案时产生的。这个信息本来就在 document_links 里
   * （挂在 requirementId 还是 proposalId），只是从没在列表里露过面。
   */
  private async attachOwnership(rows: Document[]): Promise<any[]> {
    if (!rows.length) return rows;
    const ids = rows.map((r) => r.id);

    const links = await this.documentRepository.manager
      .createQueryBuilder()
      .select([
        'l.documentId AS documentId',
        'l.requirementId AS requirementId',
        'l.proposalId AS proposalId',
        'l.quotationId AS quotationId',
        'l.projectId AS projectId',
        'l.customerId AS customerId',
      ])
      .from('document_links', 'l')
      .where('l.documentId IN (:...ids)', { ids })
      .getRawMany<any>();

    const map = new Map<string, string>();
    for (const l of links) {
      // 一份资料可能挂多处，取最靠近业务源头的那个作为归属
      const owner = l.requirementId
        ? '客户需求'
        : l.proposalId
          ? '技术方案'
          : l.quotationId
            ? '报价管理'
            : l.projectId
              ? '项目跟踪'
              : l.customerId
                ? '客户中心'
                : '';
      if (owner && !map.has(l.documentId)) map.set(l.documentId, owner);
    }

    return rows.map((d) => ({ ...d, ownerModule: map.get(d.id) || null }));
  }

  async findOne(id: string, user: CurrentUser): Promise<Document> {
    const doc = await this.documentRepository.findOne({ where: { id } });
    if (!doc) throw new NotFoundException('文档不存在');
    if (!this.permissionService.canAccess(user, this.toSubject(doc))) {
      throw new BadRequestException('无权访问该文档');
    }
    return doc;
  }

  /*
   * 扩展名白名单只有一份，在 safe-path.util 的 ALLOWED_EXTENSIONS.document ——
   * 所有上传入口都经 safeUploadTarget(..., 'document') 校验。
   *
   * 这里原本还有一份私有的 allowedExtensions + validateFileExtension，
   * 但它从未被调用过（死代码）。两份名单并存的代价是实打实的：
   * 有人为了放开图片上传去改这份，改完发现还是传不上去 ——
   * 真正拦人的是另一份。所以删掉，不留第二个看似正确的编辑入口。
   */

  async create(
    dto: CreateDocumentDto,
    file: Express.Multer.File,
    user: CurrentUser,
  ): Promise<Document> {
    const { displayName, fileName, filePath } = safeUploadTarget(
      this.uploadDir,
      file.originalname,
      'document',
    );
    const fileKey = `documents/${fileName}`;

    fs.writeFileSync(filePath, file.buffer);

    const publicUrl = `${this.publicUrl}/uploads/documents/${encodeURIComponent(fileName)}`;

    const doc = this.documentRepository.create({
      ...dto,
      fileName: displayName,
      fileKey,
      fileUrl: publicUrl,
      fileSize: file.size,
      mimeType: file.mimetype,
      uploaderId: user?.userId,
      departmentId: user?.departmentId,
      status: this.permissionService.skipApproval() ? 'approved' : 'pending',
    });

    /*
     * 文档主行与审批记录同一事务。
     *
     * 这里原来连事务都没有：先 save 文档、再单独建审批记录。后者失败的话，
     * 文档就带着 status='pending' 留在库里而审批中心看不到它，既审不了也退不掉。
     * 与 requirements / projects / products 等模块统一到同一套写法。
     *
     * 解析入索引仍在事务外异步跑：它耗时且允许失败重来，不该拖住上传响应。
     */
    const skipApproval = this.permissionService.skipApproval();
    const saved = await this.tx.run(async (manager) => {
      const row = await manager.save(doc);
      if (!skipApproval) {
        await this.approvalsService.create({
          objectType: 'document',
          objectId: row.id,
          submittedBy: user?.userId,
          status: 'pending',
        }, manager);
      }
      return row;
    });

    this.processDocument(saved, file.buffer).catch((err) =>
      this.logger.error('Process document failed', err),
    );

    return saved;
  }

  async update(
    id: string,
    dto: UpdateDocumentDto,
    user: CurrentUser,
  ): Promise<Document> {
    const doc = await this.findOne(id, user);
    if (!this.permissionService.canManage(user, this.toSubject(doc))) {
      throw new BadRequestException('无权修改该文档');
    }
    Object.assign(doc, dto);
    return this.documentRepository.save(doc);
  }

  /** Workflow imports always enter human review, including in personal mode. */
  async createWorkflowDraft(
    input: { title: string; content: string },
    owner: CurrentUser,
    recordImport: (saved: Document, manager: EntityManager) => Promise<void>,
  ): Promise<Document> {
    const targetDir = path.join(this.knowledgeDir, '工作流导入');
    fs.mkdirSync(targetDir, { recursive: true });
    const displayName = sanitizeFileName(`${input.title}.md`);
    const target = safeUploadTarget(targetDir, `${randomUUID()}_${displayName}`, 'document');
    const fileKey = `knowledge/工作流导入/${target.fileName}`;
    const buffer = Buffer.from(input.content, 'utf8');
    fs.writeFileSync(target.filePath, buffer, { flag: 'wx' });
    try {
      return await this.tx.run(async (manager) => {
        const row = await manager.getRepository(Document).save(manager.getRepository(Document).create({
          title: input.title, fileName: displayName, fileKey, fileSize: buffer.length,
          mimeType: 'text/markdown; charset=utf-8', category: 'knowledge/workflow_import',
          status: 'pending', visibility: 'role', roleCodes: ['admin', 'approver'],
          uploaderId: owner.userId, departmentId: owner.departmentId,
          parsedText: JSON.stringify({ workflowDraft: true, indexed: false, requiresApproval: true }),
        }));
        row.fileUrl = `/api/files/documents/${row.id}`;
        await manager.getRepository(Document).save(row);
        await this.approvalsService.create({
          objectType: 'document', objectId: row.id, submittedBy: owner.userId,
          status: 'pending',
        }, manager);
        await recordImport(row, manager);
        return row;
      });
    } catch (error) {
      fs.unlinkSync(target.filePath);
      throw error;
    }
  }

  /**
   * 删除文档：版本行、文档链接、主行一起删（事务保护）；
   * 主文件、各版本文件、向量清理放事务外（文件 IO / HTTP 不进 DB 事务）。
   * 知识库文档向量按 source_type='knowledge' 删，业务文档按 'document' 删——
   * 之前只删 'document'，知识库文档的向量会永久残留。
   */
  /** 回收站里暂存文件的目录 */
  private get trashDir(): string {
    return path.resolve(process.cwd(), 'data', 'uploads', '.trash');
  }

  /**
   * 删除资料 —— 软删除，进回收站。
   *
   * 改动前是**彻底抹掉**：数据库硬删 + fs.unlinkSync 主文件与全部历史版本，
   * 不进系统回收站，误删只能指望恰好有过一次备份。资料库是这个产品的核心资产，
   * 「点一下就永久没了」的风险太高。
   *
   * 现在：
   *   · 整条记录（含版本、关联）快照进 recycle_bin，默认保留 30 天
   *   · 文件移动到 uploads/.trash/<回收记录id>/ 而不是删除
   *   · 向量索引仍然立刻清除 —— 已删的东西不该还能被 AI 检索到；
   *     还原时会重新索引
   */
  async remove(id: string, user: CurrentUser): Promise<void> {
    const doc = await this.findOne(id, user);
    if (!this.permissionService.canManage(user, this.toSubject(doc))) {
      throw new BadRequestException('无权删除该文档');
    }
    const versions = await this.versionRepository.find({ where: { documentId: id } });
    const links = await this.documentLinkRepository.find({ where: { documentId: id } });
    const isKnowledge = (doc.category || '').startsWith('knowledge');
    const sourceType = isKnowledge ? 'knowledge' : 'document';

    // 先建回收记录，拿到 id 作为文件暂存目录名
    const recycled = await this.recycleBin.softDelete('document', id, user?.userId, {
      document: { ...doc },
      versions: versions.map((v) => ({ ...v })),
      links: links.map((l) => ({ ...l })),
      sourceType,
      // 记下文件原始路径，还原时原样放回，过期清理时按此删除
      files: [] as { from: string; to: string }[],
    });

    const bucket = path.join(this.trashDir, recycled.id);
    const moved: { from: string; to: string }[] = [];
    const moveToTrash = (fileKey: string, absPath: string) => {
      try {
        if (!fs.existsSync(absPath)) return;
        fs.mkdirSync(bucket, { recursive: true });
        const to = path.join(bucket, path.basename(absPath));
        fs.renameSync(absPath, to);
        moved.push({ from: absPath, to });
      } catch (err) {
        // 移动失败不阻断删除：记录下来，最坏情况是留个孤儿文件，
        // 总好过"数据库删了、文件还在原地被当成有效资料"
        this.logger.error(`Move to trash failed: ${fileKey} - ${(err as Error)?.message}`);
      }
    };

    await this.tx.run(
      async (manager) => {
        await manager.getRepository(DocumentVersion).delete({ documentId: id });
        await manager.getRepository(DocumentLink).delete({ documentId: id });
        await manager.getRepository(Document).delete(id);
      },
      async () => {
        moveToTrash(doc.fileKey, this.getFilePath(doc.fileKey));
        for (const v of versions) {
          moveToTrash(v.fileKey, path.resolve(process.cwd(), 'data', 'uploads', v.fileKey));
        }
        // 记回移动结果，供还原/过期清理使用
        await this.recycleBin.patchData(recycled.id, { files: moved });
        // 向量立刻清掉：删掉的资料不该还能被 AI 检索到
        await this.aiService.deleteChunks(sourceType, id);
      },
    );
  }

  /** 回收站列表（只看资料类） */
  async listRecycled() {
    const items = await this.recycleBin.findAll('document');
    return items.map((it) => {
      const d = (it.entityData as any)?.document || {};
      return {
        id: it.id,
        documentId: it.entityId,
        title: d.title,
        fileName: d.fileName,
        category: d.category,
        fileSize: d.fileSize,
        deletedAt: it.deletedAt,
        deletedBy: it.deletedBy,
        expiresAt: it.expiresAt,
      };
    });
  }

  /**
   * 从回收站还原。
   *
   * 顺序很关键：先把文件放回原位，再恢复数据库记录 ——
   * 反过来的话，中途失败会留下"库里有记录、磁盘没文件"的坏数据，
   * 比"文件还在、记录没了"更难排查。
   */
  async restoreRecycled(recycleId: string, user: CurrentUser): Promise<Document> {
    const item = await this.recycleBin.findOne(recycleId);
    if (item.entityType !== 'document') {
      throw new BadRequestException('该回收记录不是资料类型');
    }
    const data = item.entityData as any;
    const doc: Document = data.document;

    const exists = await this.documentRepository.findOne({ where: { id: doc.id } });
    if (exists) throw new BadRequestException('该资料已存在，无需还原');

    for (const f of (data.files || []) as { from: string; to: string }[]) {
      try {
        if (!fs.existsSync(f.to)) continue;
        fs.mkdirSync(path.dirname(f.from), { recursive: true });
        fs.renameSync(f.to, f.from);
      } catch (err) {
        throw new BadRequestException(
          `还原文件失败：${path.basename(f.from)}（${(err as Error)?.message}）`,
        );
      }
    }

    const saved = await this.tx.run(async (manager) => {
      const restored = await manager.getRepository(Document).save(doc);
      if (data.versions?.length) {
        await manager.getRepository(DocumentVersion).save(data.versions);
      }
      if (data.links?.length) {
        await manager.getRepository(DocumentLink).save(data.links);
      }
      return restored;
    });

    // 重新索引：删除时向量已清，不重建的话还原回来也搜不到
    this.indexDocument(saved.id, user).catch((err) =>
      this.logger.warn(`Re-index after restore failed for ${saved.id}: ${err?.message}`),
    );

    await this.recycleBin.permanentDelete(recycleId);
    try {
      fs.rmSync(path.join(this.trashDir, recycleId), { recursive: true, force: true });
    } catch {
      // 空目录残留无害
    }
    return saved;
  }

  /** 彻底删除某条回收记录（含暂存文件），不可恢复 */
  async purgeRecycled(recycleId: string): Promise<void> {
    const item = await this.recycleBin.findOne(recycleId);
    for (const f of ((item.entityData as any)?.files || []) as { to: string }[]) {
      try {
        if (fs.existsSync(f.to)) fs.unlinkSync(f.to);
      } catch (err) {
        this.logger.error(`Purge trashed file failed: ${(err as Error)?.message}`);
      }
    }
    try {
      fs.rmSync(path.join(this.trashDir, recycleId), { recursive: true, force: true });
    } catch {
      /* 目录不存在无所谓 */
    }
    await this.recycleBin.permanentDelete(recycleId);
  }

  async approve(id: string, user: CurrentUser): Promise<Document> {
    if (!this.permissionService.canApprove(user)) {
      throw new BadRequestException('无权审核');
    }
    const doc = await this.documentRepository.findOne({ where: { id } });
    if (!doc) throw new NotFoundException('文档不存在');
    doc.status = 'approved';
    doc.approvedBy = user?.userId;
    doc.approvedAt = new Date();
    return this.tx.run(
      async (manager) => {
        const saved = await manager.save(doc);
        await this.approvalsService.approve('document', id, user?.userId, '审核通过', manager);
        return saved;
      },
    );
  }

  async reject(id: string, user: CurrentUser, comment?: string): Promise<Document> {
    if (!this.permissionService.canApprove(user)) {
      throw new BadRequestException('无权审核');
    }
    const doc = await this.documentRepository.findOne({ where: { id } });
    if (!doc) throw new NotFoundException('文档不存在');
    doc.status = 'rejected';
    const saved = await this.documentRepository.save(doc);
    await this.approvalsService.reject('document', id, user?.userId, comment);
    return saved;
  }

  /** 图片格式不参与AI解析，直接标记跳过 */
  private static readonly IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp'];

  /**
   * 送 AI 解析的单文件上限，与 AI 服务的 max_file_size_mb 对齐。
   *
   * 提到类常量：原先它是 reindexKnowledge 里的函数内局部量，只护住了批量重建
   * 那一条路径，上传后自动索引完全没检查。收口到 indexDocument 之后两边共用。
   */
  private static readonly MAX_PARSE_SIZE = 10 * 1024 * 1024;

  /**
   * 是否解析出了真正的正文。
   *
   * 判据与 ReindexService.hasRealText 一致：解析失败时后端会回退成一句
   * 占位文案（`[xxx.dwg] 文件已上传，等待解析。`），长度也就二三十字。
   * 用长度阈值 + 占位话术双重判断，避免把提示语当正文索引。
   */
  private static hasRealParsedText(parsedText?: string): boolean {
    const t = (parsedText || '').trim();
    if (t.length <= 50) return false;
    return !/等待解析|文件已上传/.test(t.slice(0, 80));
  }

  private isImageFile(fileName: string): boolean {
    const ext = fileName.toLowerCase().slice(fileName.lastIndexOf('.'));
    return DocumentsService.IMAGE_EXTENSIONS.includes(ext);
  }

  private async processDocument(doc: Document, buffer: Buffer): Promise<void> {
    // 图片不参与AI解析，只存文件、不做向量索引
    if (this.isImageFile(doc.fileName)) {
      this.logger.log(`图片文件「${doc.fileName}」跳过AI解析`);
      doc.parsedText = JSON.stringify({ indexed: false, chunks: 0, reason: 'image_file', note: '图片不参与AI智能问答' });
      await this.documentRepository.save(doc);
      return;
    }
    try {
      const parsed = await this.parseDocument(doc.fileName, buffer);

      /*
       * 解析没拿到正文时不要走索引。
       *
       * parseDocument 失败会回退成占位文案「[xxx.dwg] 文件已上传，等待解析。」，
       * 原来这段话会被当正文分块入库 —— 它中文密度高，看着像正文，
       * 于是检索里凭空多出一批"等待解析"的噪声块，问什么都可能命中，
       * 而它们不含任何业务信息。CAD 图纸这类进了白名单但解析不了的格式最容易踩到。
       *
       * 这里与图片走同一套处理：存文件、记状态、不建索引。
       */
      if (!DocumentsService.hasRealParsedText(parsed)) {
        this.logger.log(`「${doc.fileName}」未解析出正文，跳过向量索引`);
        doc.parsedText = JSON.stringify({
          indexed: false,
          chunks: 0,
          reason: 'no_text',
          note: '该文件未能提取出可读正文，不参与 AI 问答',
        });
        await this.documentRepository.save(doc);
        return;
      }

      doc.parsedText = parsed;
      await this.documentRepository.save(doc);

      const chunks = this.chunkText(parsed, 500, 100).map((content, idx) => ({
        source_type: 'document',
        source_id: doc.id,
        document_id: doc.id,
        content: `${doc.title}\n${content}`,
        permission_snapshot: {
          visibility: doc.visibility,
          uploader_id: doc.uploaderId,
          department_id: doc.departmentId,
          group_ids: doc.groupIds,
          role_codes: doc.roleCodes,
        },
      }));

      await this.aiService.addChunks(chunks);
    } catch (err) {
      this.logger.error('Process document error', err?.message);
    }
  }

  /**
   * 归档文档到客户文件夹
   * @param documentId 文档ID
   * @param customerId 客户ID
   * @param archiveType 归档类型
   */
  async archiveToCustomer(
    documentId: string,
    customerId: string,
    archiveType: ArchiveType = ArchiveType.RAW,
    user: CurrentUser,
  ): Promise<{ archivePath: string }> {
    const doc = await this.findOne(documentId, user);

    // 读取原始文件
    const filePath = this.getFilePath(doc.fileKey);
    if (!fs.existsSync(filePath)) {
      throw new NotFoundException('原始文件不存在');
    }

    const fileBuffer = fs.readFileSync(filePath);

    // 归档到客户文件夹
    const archivePath = await this.fileArchiveService.archiveFile(
      customerId,
      doc.fileName,
      fileBuffer,
      archiveType,
    );

    // 更新文档记录，关联客户
    doc.customerId = customerId;
    doc.archivePath = archivePath;
    doc.archiveType = archiveType;
    await this.documentRepository.save(doc);

    this.logger.log(
      `Document ${documentId} archived to customer ${customerId} as ${archiveType}`,
    );

    return { archivePath };
  }

  /**
   * 获取客户的归档文档列表
   */
  async getCustomerArchives(
    customerId: string,
    archiveType?: ArchiveType,
  ) {
    return this.fileArchiveService.getCustomerFiles(customerId, archiveType);
  }

  /**
   * 从客户文件夹移除文档
   */
  async removeFromCustomerArchive(
    documentId: string,
    customerId: string,
    user: CurrentUser,
  ): Promise<void> {
    const doc = await this.findOne(documentId, user);

    if (doc.archivePath) {
      this.fileArchiveService.deleteArchiveFile(customerId, doc.archivePath);
      doc.customerId = null;
      doc.archivePath = null;
      doc.archiveType = null;
      await this.documentRepository.save(doc);
    }
  }

  private async parseDocument(filename: string, buffer: Buffer): Promise<string> {
    try {
      const res = await axios.post(
        `${this.configService.get('app.aiServiceUrl')}/embeddings/parse`,
        {
          filename,
          content: buffer.toString('base64'),
        },
        { timeout: 60000 },
      );
      return res.data.text || '';
    } catch {
      return this.fallbackParse(filename, buffer);
    }
  }

  private fallbackParse(filename: string, buffer: Buffer): string {
    const lower = filename.toLowerCase();
    if (lower.endsWith('.txt') || lower.endsWith('.md')) {
      return buffer.toString('utf-8', 0, Math.min(buffer.length, 100000));
    }
    return `[${filename}] 文件已上传，等待解析。`;
  }

  private chunkText(text: string, chunkSize: number, overlap: number): string[] {
    if (!text) return [];
    const chunks: string[] = [];
    let start = 0;
    while (start < text.length) {
      const end = Math.min(start + chunkSize, text.length);
      chunks.push(text.slice(start, end).trim());
      start += chunkSize - overlap;
      if (end === text.length) break;
    }
    return chunks.filter((c) => c);
  }

  // ============================================================
  // 知识资料（知识库）
  // ============================================================

  /**
   * 知识库文档列表。
   * 之前直接 find() 无权限过滤，团队模式下任何人都能读全部知识库文档。
   * 改用 createQueryBuilder + apply() 把可见性条件下沉到 SQL。
   */
  async findKnowledge(user: CurrentUser): Promise<Document[]> {
    const qb = this.documentRepository
      .createQueryBuilder('d')
      .where('d.category LIKE :kw', { kw: 'knowledge%' })
      .orderBy('d.createdAt', 'DESC');
    this.permissionQuery.apply(qb, 'd', user, { owner: 'uploaderId' });
    return qb.getMany();
  }

  /**
   * 知识分类改名：把所有 category = knowledge/from 的资料改为 knowledge/to。
   * 只改逻辑分类，fileKey 指向的物理文件不动（上传时目录名已定死）。
   */
  async renameKnowledgeCategory(from: string, to: string): Promise<{ updated: number }> {
    const oldName = (from || '').trim();
    const newName = (to || '').trim();
    if (!oldName || !newName) {
      throw new BadRequestException('分类名不能为空');
    }
    if (oldName === newName) {
      return { updated: 0 };
    }
    if (newName.includes('/')) {
      throw new BadRequestException('分类名不能包含 /');
    }
    const result = await this.documentRepository
      .createQueryBuilder()
      .update(Document)
      .set({ category: `knowledge/${newName}` })
      .where('category = :old', { old: `knowledge/${oldName}` })
      .execute();
    this.logger.log(`Knowledge category renamed: ${oldName} -> ${newName}, ${result.affected || 0} docs updated`);
    return { updated: result.affected || 0 };
  }

  async createKnowledge(
    dto: { title: string; subcategory?: string },
    file: Express.Multer.File,
    user: CurrentUser,
  ): Promise<Document> {
    const sub = dto.subcategory || 'other';
    const rawDir = DocumentsService.KNOWLEDGE_DIR_MAP[sub] || sub || '其他';
    // P0 安全修复：清洗目录名，阻断路径穿越（../, ..\\, 绝对路径等）
    const dirName = rawDir.replace(/[\\/]/g, '').replace(/\.\./g, '').trim() || '其他';
    // 再验证：最终路径必须仍在 knowledgeDir 内
    const targetDir = path.resolve(this.knowledgeDir, dirName);
    if (!targetDir.startsWith(path.resolve(this.knowledgeDir))) {
      throw new BadRequestException('非法的分类目录');
    }
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }
    const { displayName: fixedName, fileName, filePath } = safeUploadTarget(
      targetDir,
      file.originalname,
      'document',
    );

    // 重名拦截：重复上传会重复入库、重复向量索引，问答命中重复内容
    const dup = await this.documentRepository.findOne({
      where: { fileName: fixedName, category: Like('knowledge%') },
      select: ['id'],
    });
    if (dup) {
      throw new ConflictException(`库中已存在同名资料「${fixedName}」，如需更新请先删除旧文件`);
    }

    fs.writeFileSync(filePath, file.buffer);

    const doc = this.documentRepository.create({
      title: dto.title || fixedName,
      fileName: fixedName,
      fileKey: `knowledge/${dirName}/${fileName}`,
      fileUrl: `${this.publicUrl}/uploads/knowledge/${encodeURIComponent(dirName)}/${encodeURIComponent(fileName)}`,
      fileSize: file.size,
      mimeType: file.mimetype,
      category: `knowledge/${sub}`,
      status: 'approved' as any,
      uploaderId: user.userId,
      visibility: 'public',
    });
    const saved = await this.documentRepository.save(doc);

    // 自动AI索引
    this.indexDocument(saved.id, user).catch((err) =>
      this.logger.warn(`Auto-index failed for ${saved.id}: ${err?.message}`),
    );

    return saved;
  }

  async indexDocument(id: string, _user: CurrentUser): Promise<{ success: boolean; chunks: number; message: string }> {
    const doc = await this.documentRepository.findOne({ where: { id } });
    if (!doc) throw new NotFoundException('文档不存在');

    let workflowDraft = doc.category === 'knowledge/workflow_import';
    try { workflowDraft = workflowDraft || !!JSON.parse(doc.parsedText || '{}').workflowDraft; } catch { /* existing parsed text */ }
    if (workflowDraft && doc.status !== 'approved') {
      return { success: false, chunks: 0, message: '工作流导入资料尚未通过人工审核，不进行 AI 索引' };
    }

    const filePath = this.getFilePath(doc.fileKey);
    if (!fs.existsSync(filePath)) {
      throw new BadRequestException('文件不存在于服务器');
    }

    /*
     * 大小护栏必须放在这里 —— 这是所有索引路径的唯一收口。
     *
     * 原先只有 reindexKnowledge 里有一个同名的函数内局部常量，上传后自动索引
     * （createKnowledge → indexDocument）完全没有检查。而下面这两行才是危险动作：
     * 整份文件读进内存，再 toString('base64') 又胀 33% —— 一份几百 MB 的文件
     * 就能把 Node 堆撑爆（reindexKnowledge 的注释里写着"实测把后端进程拖崩过两次"）。
     * AI 服务侧虽然也校验 10MB 并拒绝，但那时候后端早已经 OOM 了，拦不住。
     */
    const size = Number(doc.fileSize || 0) || fs.statSync(filePath).size;
    if (size > DocumentsService.MAX_PARSE_SIZE) {
      const mb = (DocumentsService.MAX_PARSE_SIZE / 1024 / 1024).toFixed(0);
      return {
        success: false,
        chunks: 0,
        message: `文件超过 ${mb}MB，已跳过 AI 索引（这类文件多为扫描件，本来也提不出文字）`,
      };
    }

    // 读取文件 → base64
    const fileBuffer = fs.readFileSync(filePath);
    const base64Content = fileBuffer.toString('base64');

    // 发送给AI服务解析
    const parsed = await this.aiService.parseFileDetailed(doc.fileName, base64Content);
    const text = parsed.text;
    const trimmed = (text || '').trim();

    if (trimmed.length < 10) {
      // 解析不出正文时也要清掉旧向量：否则上一次索引留下的分块会一直被检索命中，
      // 而这份文件其实已经没有可用内容了。
      await this.aiService.deleteChunks('knowledge', doc.id);
      /*
       * 原来无论什么原因都写死成"扫描件或图片型PDF"。但解析失败的原因不止一种：
       * 旧版 .doc 格式、根本不支持的类型（.dwg/.zip）、加密文档、真扫描件 ——
       * 处理方式各不相同（转存 .docx / 换个文件 / 去掉密码 / 上传文字版）。
       * AI 服务已经把具体原因带回来了，照实说，别让用户按错误的提示白折腾。
       */
      const note = parsed.error || '该文件为扫描件或图片型PDF，无法自动提取文字内容';
      const reason = parsed.error ? 'unparsable' : 'scanned_pdf';
      doc.parsedText = JSON.stringify({ indexed: false, chunks: 0, reason, note, indexedAt: new Date().toISOString() });
      await this.documentRepository.save(doc);
      return { success: false, chunks: 0, message: note };
    }

    // 先删除旧的索引（如果有）
    await this.aiService.deleteChunks('knowledge', doc.id);

    // 分块
    const chunkTexts = this.chunkText(text, 500, 100);

    // 向量索引
    // 写入文档的真实权限快照（而非空对象）。当前知识库文档默认 public 所以不影响行为，
    // 但一旦未来支持非 public 可见性，这里不会静默 fail-open。
    const chunks = chunkTexts.map((content) => ({
      source_type: 'knowledge',
      source_id: doc.id,
      document_id: doc.id,
      content,
      permission_snapshot: {
        visibility: doc.visibility,
        uploader_id: doc.uploaderId,
        department_id: doc.departmentId,
        group_ids: doc.groupIds,
        role_codes: doc.roleCodes,
      },
    }));

    // 分批提交：AI 服务的 ChunkRequest 单次上限 100 条，整份大 PDF 一次性发会被 422 挡下
    const BATCH = 100;
    let indexed = 0;
    let skipped = 0;
    for (let i = 0; i < chunks.length; i += BATCH) {
      const r = await this.aiService.addChunks(chunks.slice(i, i + BATCH));
      indexed += r.indexed;
      skipped += r.skipped;
    }

    // 报实际入库数，不是提交数 —— AI 侧会挡掉解析失败的分块（见 addChunks 注释）。
    // 一份 PDF 里夹着几十页字体表残渣是常事，提交 655 块进库 495 块很正常。
    doc.parsedText = JSON.stringify({
      indexed: true,
      chunks: indexed,
      submitted: chunks.length,
      skipped,
      indexedAt: new Date().toISOString(),
    });
    await this.documentRepository.save(doc);

    this.logger.log(
      `Knowledge document ${doc.id} indexed: ${indexed}/${chunks.length} chunks` +
        (skipped ? ` (跳过 ${skipped} 块无法识别的内容)` : ''),
    );
    return {
      success: indexed > 0,
      chunks: indexed,
      message: skipped
        ? `成功索引 ${indexed} 个文本块，跳过 ${skipped} 块无法识别的内容`
        : `成功索引 ${indexed} 个文本块`,
    };
  }

  /**
   * 批量重建知识资料索引。
   *
   * 知识资料的正文不落库（parsedText 存的是索引状态标记），所以它无法像其它业务对象
   * 那样"从数据库重建"，只能重新读文件解析一遍。扫描件会被识别出来并跳过。
   */
  async reindexKnowledge(
    user: CurrentUser,
    opts: { limit?: number; force?: boolean; offset?: number } = {},
  ): Promise<{
    total: number;
    processed: number;
    indexed: number;
    chunks: number;
    skipped: number;
    failed: number;
    remaining: number;
  }> {
    const all = await this.documentRepository
      .createQueryBuilder('d')
      .where("d.category LIKE 'knowledge%'")
      .getMany();

    /*
     * 分批 + 可续跑。
     *
     * 一次请求里连着解析三十份 PDF 会把后端进程拖崩（解析要整份读进内存再转 base64）。
     * 改成每次只处理 limit 份，并默认跳过"已经成功索引过"的，调用方循环调到
     * remaining 为 0 即可 —— 中途挂了也能接着跑，不必从头再来。
     */
    const isDone = (d: Document) => {
      try {
        const m = JSON.parse(d.parsedText || '{}');
        // 扫描件标记为 indexed:false，重跑也是同样结果，一并视为已处理
        return m?.indexedAt ? true : false;
      } catch {
        return false;
      }
    };

    /*
     * force 模式（全部重跑）不能靠"是否已处理"筛选 —— 每份跑完都会写上新标记，
     * 下一批又会把它算成已完成，永远停在原地。所以 force 走 offset 游标，
     * 调用方按 offset 递增循环；非 force 模式则天然是"只补没跑过的"。
     */
    const pending = opts.force ? all : all.filter((d) => !isDone(d));
    const offset = opts.force ? Math.max(0, opts.offset || 0) : 0;
    const docs = opts.limit
      ? pending.slice(offset, offset + opts.limit)
      : pending.slice(offset);

    let indexed = 0;
    let chunks = 0;
    let skipped = 0;
    let failed = 0;

    /*
     * 逐份处理，单份失败不中断整批。
     *
     * 大文件要跳过：解析要把整份读进内存再转 base64，再由 AI 服务做 OCR。
     * AI 服务自己的 max_file_size_mb 就是 10MB，超过它解析必然失败（实测直接
     * 把后端进程拖崩过两次），所以这里对齐同一条线，超限的直接标记跳过。
     * 这些超大件基本都是扫描件，本来也提不出文字 —— 真要处理得走 P2 的 OCR 方案。
     */
    const MAX_PARSE_SIZE = DocumentsService.MAX_PARSE_SIZE;

    for (const doc of docs) {
      try {
        // indexDocument 里也有同样的护栏（那才是唯一收口）；这里提前拦一道，
        // 省掉一次没必要的单条查询
        if (Number(doc.fileSize || 0) > MAX_PARSE_SIZE) {
          skipped++;
          this.logger.log(`知识资料跳过（超过 ${MAX_PARSE_SIZE / 1024 / 1024}MB）：${doc.fileName}`);
          continue;
        }
        const res = await this.indexDocument(doc.id, user);
        if (res.success) {
          indexed++;
          chunks += res.chunks;
        } else {
          skipped++;
        }
      } catch (err) {
        failed++;
        this.logger.warn(`知识资料重建失败 ${doc.fileName}: ${(err as Error)?.message}`);
      }
    }

    this.logger.log(
      `知识资料索引重建：本批 ${docs.length}，成功 ${indexed}（${chunks} 分块），跳过 ${skipped}，失败 ${failed}`,
    );
    return {
      total: all.length,
      processed: docs.length,
      indexed,
      chunks,
      skipped,
      failed,
      remaining: Math.max(0, pending.length - offset - docs.length),
    };
  }

  // ============================================================
  // 文档版本管理
  // ============================================================

  async createVersion(
    documentId: string,
    file: Express.Multer.File,
    changeSummary: string,
    userId: string,
  ): Promise<DocumentVersion> {
    const doc = await this.documentRepository.findOne({ where: { id: documentId } });
    if (!doc) throw new NotFoundException('文档不存在');
    // P0 安全修复：版本操作必须有管理权限（与 update/remove 一致）
    if (!this.permissionService.canManage({ userId, roles: [] } as CurrentUser, this.toSubject(doc))) {
      throw new BadRequestException('无权管理该文档');
    }

    const { displayName, fileName, filePath } = safeUploadTarget(
      this.uploadDir,
      file.originalname,
      'document',
    );
    fs.writeFileSync(filePath, file.buffer);

    const latestVersion = await this.versionRepository.findOne({
      where: { documentId },
      order: { version: 'DESC' },
    });
    const nextVersion = latestVersion ? latestVersion.version + 1 : 1;

    const version = this.versionRepository.create({
      documentId,
      version: nextVersion,
      fileName: displayName,
      fileKey: `versions/${fileName}`,
      fileSize: file.size,
      changeSummary,
      createdBy: userId,
    });
    return this.versionRepository.save(version);
  }

  async getVersions(documentId: string): Promise<DocumentVersion[]> {
    return this.versionRepository.find({
      where: { documentId },
      order: { version: 'DESC' },
    });
  }

  async restoreVersion(documentId: string, versionId: string, userId?: string): Promise<Document> {
    const doc = await this.documentRepository.findOne({ where: { id: documentId } });
    if (!doc) throw new NotFoundException('文档不存在');
    if (userId && !this.permissionService.canManage({ userId, roles: [] } as CurrentUser, this.toSubject(doc))) {
      throw new BadRequestException('无权管理该文档');
    }

    const version = await this.versionRepository.findOne({ where: { id: versionId, documentId } });
    if (!version) throw new NotFoundException('版本不存在');

    const versionFilePath = path.resolve(process.cwd(), 'data', 'uploads', version.fileKey);
    if (!fs.existsSync(versionFilePath)) throw new NotFoundException('版本文件不存在');

    const currentFileKey = doc.fileKey.startsWith('documents/') ? doc.fileKey : `documents/${doc.fileName}`;
    const currentFilePath = safeReadPath(this.uploadDir, doc.fileName, 'documents/');

    if (fs.existsSync(currentFilePath)) {
      const backupResult = safeUploadTarget(this.uploadDir, doc.fileName, 'document');
      fs.copyFileSync(currentFilePath, backupResult.filePath);
    }

    const fileBuffer = fs.readFileSync(versionFilePath);
    const { displayName, fileName, filePath } = safeUploadTarget(
      this.uploadDir,
      version.fileName,
      'document',
    );
    fs.writeFileSync(filePath, fileBuffer);

    doc.fileName = displayName;
    doc.fileKey = `documents/${fileName}`;
    doc.fileSize = version.fileSize;
    return this.documentRepository.save(doc);
  }

  private toSubject(doc: Document) {
    return {
      visibility: doc.visibility,
      uploaderId: doc.uploaderId,
      departmentId: doc.departmentId,
      groupIds: doc.groupIds,
      roleCodes: doc.roleCodes,
    };
  }
}
