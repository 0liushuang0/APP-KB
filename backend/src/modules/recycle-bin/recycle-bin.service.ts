import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan } from 'typeorm';
import { RecycleBinItem } from './recycle-bin.entity';

@Injectable()
export class RecycleBinService {
  private readonly logger = new Logger(RecycleBinService.name);

  constructor(
    @InjectRepository(RecycleBinItem)
    private recycleRepository: Repository<RecycleBinItem>,
  ) {}

  async softDelete(
    entityType: string,
    entityId: string,
    userId: string,
    entityData: Record<string, any>,
  ): Promise<RecycleBinItem> {
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);

    const item = this.recycleRepository.create({
      entityType,
      entityId,
      entityData,
      deletedBy: userId,
      expiresAt,
    });
    return this.recycleRepository.save(item);
  }

  async findAll(entityType?: string): Promise<RecycleBinItem[]> {
    const where = entityType ? { entityType } : {};
    return this.recycleRepository.find({
      where,
      order: { deletedAt: 'DESC' },
    });
  }

  async findOne(id: string): Promise<RecycleBinItem> {
    const item = await this.recycleRepository.findOne({ where: { id } });
    if (!item) throw new NotFoundException('回收站项目不存在');
    return item;
  }

  /**
   * 往已有回收记录的 entityData 里补字段。
   *
   * 用于"先建记录拿到 id、再按 id 建文件暂存目录、最后把移动结果写回"这个顺序 ——
   * 文件放哪儿必须记在记录里，否则还原和过期清理都找不到它们。
   */
  async patchData(id: string, patch: Record<string, any>): Promise<void> {
    const item = await this.findOne(id);
    item.entityData = { ...(item.entityData || {}), ...patch };
    await this.recycleRepository.save(item);
  }

  /**
   * 取出回收记录并删除它，返回快照数据。
   *
   * 注意它**只负责回收记录本身**，不会把实体写回业务表 ——
   * 各业务的还原逻辑（重建记录、把文件搬回原位、重建索引）差别太大，
   * 由各自的 Service 负责，见 DocumentsService.restoreRecycled。
   */
  async restore(id: string): Promise<RecycleBinItem> {
    const item = await this.findOne(id);
    await this.recycleRepository.delete(id);
    return item;
  }

  /** 到期待清理的记录（含 entityData，调用方据此删除暂存文件） */
  async findExpired(): Promise<RecycleBinItem[]> {
    return this.recycleRepository.find({ where: { expiresAt: LessThan(new Date()) } });
  }

  async permanentDelete(id: string): Promise<void> {
    await this.findOne(id);
    await this.recycleRepository.delete(id);
  }

  async cleanup(): Promise<number> {
    const result = await this.recycleRepository.delete({
      expiresAt: LessThan(new Date()),
    });
    const count = result.affected || 0;
    if (count > 0) {
      this.logger.log(`Cleaned up ${count} expired recycle bin items`);
    }
    return count;
  }
}
