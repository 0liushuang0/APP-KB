import { Injectable, Logger } from '@nestjs/common';
import { AiService, Chunk } from './ai.service';

export interface SyncableObject {
  id: string;
  objectType: string;
  title: string;
  content: string;
  visibility?: 'public' | 'department' | 'group' | 'role' | 'private';
  uploaderId?: string;
  departmentId?: string;
  groupIds?: string[];
  roleCodes?: string[];
}

/**
 * 业务对象 → 向量库同步。
 *
 * 在后台按对象排队执行, 调用方(保存/删除接口)不等待: 向量化要调嵌入模型, 两次请求各自最长 60 秒,
 * 原先保存产品、客户、合同等都要等它跑完才返回, 前端 30 秒超时就报「timeout of 30000ms exceeded」
 * (数据其实已提交)。同一对象的任务串行(先删旧块再写新块, 连续两次保存不会交错);
 * 失败只记日志 —— 与原先一样不影响已保存的数据, 可在知识库里重建索引补齐。
 */
@Injectable()
export class KnowledgeSyncService {
  private readonly logger = new Logger(KnowledgeSyncService.name);
  private readonly queue = new Map<string, Promise<void>>();

  constructor(private aiService: AiService) {}

  /** 排队同步, 立即返回 */
  syncObject(obj: SyncableObject): Promise<void> {
    if (!obj.content) return Promise.resolve();
    this.schedule(`${obj.objectType}:${obj.id}`, () => this.doSync(obj));
    return Promise.resolve();
  }

  /** 排队删除该对象的向量, 立即返回 */
  deleteObject(objectType: string, objectId: string): Promise<void> {
    this.schedule(`${objectType}:${objectId}`, () => this.aiService.deleteChunks(objectType, objectId));
    return Promise.resolve();
  }

  /** 等待当前排队的同步全部完成(测试、批量重建后核对用) */
  async flush(): Promise<void> {
    while (this.queue.size) {
      await Promise.all([...this.queue.values()]);
    }
  }

  private schedule(key: string, job: () => Promise<unknown>): void {
    const prev = this.queue.get(key) ?? Promise.resolve();
    const next: Promise<void> = prev
      .then(() => job())
      .then(
        () => undefined,
        (err) => this.logger.error(`向量同步失败 ${key}：${err?.message}`),
      )
      .finally(() => {
        if (this.queue.get(key) === next) this.queue.delete(key);
      });
    this.queue.set(key, next);
  }

  private async doSync(obj: SyncableObject): Promise<void> {
    await this.aiService.deleteChunks(obj.objectType, obj.id);

    const chunks = this.chunkText(obj.content, 500, 100).map((text) => ({
      source_type: obj.objectType,
      source_id: obj.id,
      document_id: obj.id,
      content: `${obj.title}\n${text}`,
      permission_snapshot: {
        visibility: obj.visibility || 'public',
        uploader_id: obj.uploaderId,
        department_id: obj.departmentId,
        group_ids: obj.groupIds || [],
        role_codes: obj.roleCodes || [],
      },
    }));

    await this.aiService.addChunks(chunks);
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
}
