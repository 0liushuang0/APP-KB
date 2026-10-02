import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { createHash } from 'crypto';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { ZhDocumentImport } from './entities/zh-document-import.entity';
import { Document } from './entities/document.entity';
import { User } from '../users/entities/user.entity';
import { CurrentUser, PermissionService } from '../../common/services/permission.service';
import { DocumentsService } from './documents.service';
import { ZhDocumentItemDto } from './zh-document.dto';

interface ImportResult { id: string; local_id?: string; action: string; detail?: string; error?: string }

@Injectable()
export class ZhDocumentsService {
  private queue: Promise<void> = Promise.resolve();

  constructor(
    @InjectRepository(ZhDocumentImport) private readonly imports: Repository<ZhDocumentImport>,
    @InjectRepository(Document) private readonly documentRows: Repository<Document>,
    @InjectRepository(User) private readonly users: Repository<User>,
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
    const hash = createHash('sha256').update(JSON.stringify([item.title, item.content, item.project_ref || ''])).digest('hex');
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
    return { id: item.id, local_id: row.id, action: latest ? 'updated' : 'created',
      detail: latest ? 'pending_source_revision_created' : 'pending_review_created' };
  }
}
