import { Injectable, Logger, OnApplicationBootstrap, ServiceUnavailableException } from '@nestjs/common';
import { recordAutomation } from '../../common/utils/automation-log';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { createHash } from 'crypto';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { ZhDocumentImport } from './entities/zh-document-import.entity';
import { ApprovalFlow } from '../approvals/entities/approval-flow.entity';
import { Document } from './entities/document.entity';
import { User } from '../users/entities/user.entity';
import { CurrentUser, PermissionService } from '../../common/services/permission.service';
import { DocumentsService } from './documents.service';
import { ZhDocumentItemDto } from './zh-document.dto';

interface ImportResult { id: string; local_id?: string; action: string; detail?: string; error?: string }

/**
 * 判重用的内容: 去掉「生成时间/更新时间：yyyy-mm-dd hh:mm」这类每次导出都会变的时间戳。
 * 需求分析的导出曾写入「现在」, 内容每 5 分钟就不同 —— 7 份源文档累计生成 537 个「源更新」版本、690 份待审批。
 */
export function normalizeForHash(content: string): string {
  return (content || '').replace(
    /((?:文档)?(?:生成|更新|导出)时间)[：:]\s*\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2})?)?/g,
    '$1：-',
  );
}

@Injectable()
export class ZhDocumentsService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ZhDocumentsService.name);
  private queue: Promise<void> = Promise.resolve();

  constructor(
    @InjectRepository(ZhDocumentImport) private readonly imports: Repository<ZhDocumentImport>,
    @InjectRepository(Document) private readonly documentRows: Repository<Document>,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(ApprovalFlow) private readonly flows: Repository<ApprovalFlow>,
    private readonly documents: DocumentsService,
    private readonly permissions: PermissionService,
  ) {}

  async importItems(items: ZhDocumentItemDto[]) {
    const results: ImportResult[] = [];
    for (const raw of items) {
      try {
        const item = plainToInstance(ZhDocumentItemDto, raw);
        const errors = validateSync(item, { whitelist: true, forbidNonWhitelisted: true });
        if (errors.length) throw new Error(errors.map((error) => Object.values(error.constraints || {}).join(', ')).join('; '));
        if (![item.id, item.source, item.title].every((value) => value.trim())) throw new Error('id、source 与 title 不能为空');
        results.push(await this.serialize(() => this.importOne(item)));
      } catch (error) {
        results.push({ id: typeof raw?.id === 'string' ? raw.id : '', action: 'error', error: error instanceof Error ? error.message : '导入失败' });
      }
    }
    return { results };
  }

  private async serialize<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.queue;
    let release: () => void;
    this.queue = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try { return await operation(); } finally { release(); }
  }

  private async owner(): Promise<CurrentUser> {
    const configured = process.env.ZH_KB_IMPORT_OWNER;
    const row = await this.users.findOne({
      where: configured ? { username: configured, isActive: true } : { isSystemAdmin: true, isActive: true },
      relations: ['roles', 'groups'], order: { createdAt: 'ASC' },
    });
    if (!row) throw new ServiceUnavailableException('请设置 ZH_KB_IMPORT_OWNER 为现有活跃知识库管理员');
    const current: CurrentUser = {
      userId: row.id, username: row.username, roles: (row.roles || []).map((role) => role.code),
      groupIds: (row.groups || []).map((group) => group.id), departmentId: row.departmentId,
      isSystemAdmin: row.isSystemAdmin,
    };
    if (!row.isSystemAdmin && !current.roles.some((role) => ['admin', 'approver'].includes(role))) {
      throw new ServiceUnavailableException('知识库导入责任人必须具有真实管理员或审批角色');
    }
    if (!this.permissions.canApprove(current)) throw new ServiceUnavailableException('导入责任人没有文档审批权限');
    return current;
  }

  private async importOne(item: ZhDocumentItemDto): Promise<ImportResult> {
    const updatedAt = new Date(item.updated_at).toISOString();
    const hash = createHash('sha256').update(JSON.stringify([item.title, normalizeForHash(item.content), item.project_ref || ''])).digest('hex');
    const latest = await this.imports.findOne({ where: { source: item.source, externalId: item.id }, order: { revision: 'DESC' } });
    if (latest && new Date(item.updated_at).getTime() < new Date(latest.sourceUpdatedAt).getTime()) {
      return { id: item.id, local_id: latest.documentId, action: 'skipped', detail: 'stale_source_version' };
    }
    const same = latest?.contentHash === hash ? latest : await this.imports.findOne({
      where: { source: item.source, externalId: item.id, contentHash: hash, sourceUpdatedAt: updatedAt },
    });
    if (same) {
      if (!(await this.documentRows.findOne({ where: { id: same.documentId }, select: ['id'] }))) {
        throw new Error('该源文档已由人工删除，请在知识库确认后重新导入');
      }
      if (same === latest && new Date(updatedAt).getTime() > new Date(same.sourceUpdatedAt).getTime()) {
        await this.imports.update(same.id, { sourceUpdatedAt: updatedAt });
      }
      return { id: item.id, local_id: same.documentId, action: 'skipped', detail: 'unchanged' };
    }
    const owner = await this.owner();
    const revision = (latest?.revision || 0) + 1;
    const title = revision > 1 ? `${item.title.slice(0, 220)}（源更新 v${revision}）` : item.title;
    const row = await this.documents.createWorkflowDraft({ title, content: item.content }, owner, async (document, manager) => {
      await manager.getRepository(ZhDocumentImport).save(manager.getRepository(ZhDocumentImport).create({
        source: item.source, externalId: item.id, contentHash: hash, documentId: document.id,
        revision, sourceUpdatedAt: updatedAt, projectRef: item.project_ref || null,
      }));
    });
    if (latest) await this.supersedePending(item.source, item.id, revision, owner);
    return { id: item.id, local_id: row.id, action: latest ? 'updated' : 'created',
      detail: latest ? 'pending_source_revision_created' : 'pending_review_created' };
  }

  /**
   * 同一源文档只保留最新的待审版本: 旧版本若还没审, 审批流标为「已被新版本取代」并移入回收站(30 天内可还原)。
   * 已审批通过的旧版本不动。直接改审批状态、不逐条发通知(一次可能关几百条)。
   */
  private async supersedePending(source: string, externalId: string, keepRevision: number, owner: CurrentUser): Promise<number> {
    const older = await this.imports.find({ where: { source, externalId }, order: { revision: 'ASC' } });
    let closed = 0;
    for (const imp of older) {
      if (imp.revision >= keepRevision) continue;
      const doc = await this.documentRows.findOne({ where: { id: imp.documentId }, select: ['id', 'status'] });
      if (!doc || doc.status !== 'pending') continue;
      await this.flows.update(
        { objectType: 'document', objectId: doc.id, status: 'pending' },
        { status: 'rejected', reviewedBy: owner.userId, comment: `已被更新版本 v${keepRevision} 取代（自动关闭）` },
      );
      try {
        await this.documents.remove(doc.id, owner);
        closed++;
      } catch (error) {
        this.logger.warn(`关闭旧版本失败 ${doc.id}: ${error instanceof Error ? error.message : error}`);
      }
    }
    await recordAutomation(this.documentRows.manager, 'approvals_collapsed', closed);
    return closed;
  }

  /**
   * 一次性收拢历史积压: 每个源文档保留最新版本, 更早的待审版本按上面的规则关闭。可重复执行(没有积压时什么也不做)。
   * 启动 1 分钟后在后台做, 不拖慢启动; ZH_KB_COLLAPSE_REVISIONS=false 可关闭。
   */
  onApplicationBootstrap(): void {
    if ((process.env.ZH_KB_COLLAPSE_REVISIONS ?? 'true') === 'false') return;
    const t = setTimeout(() => {
      void this.serialize(() => this.collapseBacklog()).catch((error) =>
        this.logger.warn(`收拢历史待审版本失败：${error instanceof Error ? error.message : error}`),
      );
    }, 60_000);
    t.unref?.();
  }

  async collapseBacklog(): Promise<number> {
    const latest: Array<{ source: string; externalId: string; revision: number }> = await this.imports
      .createQueryBuilder('i')
      .select('i.source', 'source')
      .addSelect('i.externalId', 'externalId')
      .addSelect('MAX(i.revision)', 'revision')
      .groupBy('i.source')
      .addGroupBy('i.externalId')
      .having('COUNT(*) > 1')
      .getRawMany();
    if (!latest.length) return 0;
    const owner = await this.owner();
    let closed = 0;
    for (const g of latest) closed += await this.supersedePending(g.source, g.externalId, Number(g.revision), owner);
    if (closed) this.logger.log(`已收拢重复导入：关闭 ${closed} 个被取代的待审版本（已移入回收站，可还原）`);
    return closed;
  }
}
