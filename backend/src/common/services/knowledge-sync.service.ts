import { Injectable } from '@nestjs/common';
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

@Injectable()
export class KnowledgeSyncService {
  constructor(private aiService: AiService) {}

  async syncObject(obj: SyncableObject): Promise<void> {
    if (!obj.content) return;
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

  async deleteObject(objectType: string, objectId: string): Promise<void> {
    await this.aiService.deleteChunks(objectType, objectId);
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
