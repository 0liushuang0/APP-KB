import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { RecycleBinItem } from './recycle-bin.entity';

/**
 * 业务记录的回收站（客户、需求、方案、报价、合同、项目、售后、产品）。
 *
 * 原来这些对象删了就是物理删除：没有回收站、不检查被谁引用。
 * 实测报价被删后，11 个项目里 10 个指向已不存在的报价，工作台「本月成交额」因此算成 0。
 *
 * 做法：各模块 remove() 在**同一事务里、删除之前**调用 capture()，把要删的行原样拍快照
 * （主表 + 随之删除的子表）存进 recycle_bin；还原时按原 id 写回 —— 下游单据里的引用 id
 * 没变，关联随之恢复。快照保留 30 天，与资料回收站一致。
 */
export interface TrashTable {
  /** 表名（来自固定映射，非用户输入） */
  table: string;
  /** 按哪一列取行 */
  column: string;
  ids: string[];
}

export const BUSINESS_TYPES: Record<string, string> = {
  customer: '客户',
  requirement: '需求',
  proposal: '方案',
  quotation: '报价',
  contract: '合同',
  project: '项目',
  afterSale: '售后工单',
  product: '产品',
};

/** 谁引用了我：删除前提示「该报价已被 N 个项目引用」 */
const REFERENCES: Record<string, Array<{ table: string; column: string; label: string }>> = {
  requirement: [
    { table: 'proposals', column: 'requirementId', label: '方案' },
    { table: 'projects', column: 'requirementId', label: '项目' },
  ],
  proposal: [
    { table: 'quotations', column: 'proposalId', label: '报价' },
    { table: 'projects', column: 'proposalId', label: '项目' },
  ],
  quotation: [
    { table: 'contracts', column: 'quotationId', label: '合同' },
    { table: 'projects', column: 'quotationId', label: '项目' },
  ],
  contract: [
    { table: 'projects', column: 'contractId', label: '项目' },
    { table: 'after_sales_tickets', column: 'contractId', label: '售后工单' },
  ],
  project: [{ table: 'after_sales_tickets', column: 'projectId', label: '售后工单' }],
  product: [{ table: 'quotation_items', column: 'productId', label: '报价明细' }],
  customer: [
    { table: 'requirements', column: 'customerId', label: '需求' },
    { table: 'quotations', column: 'customerId', label: '报价' },
    { table: 'contracts', column: 'customerId', label: '合同' },
    { table: 'projects', column: 'customerId', label: '项目' },
  ],
};

const TABLE_NAME = /^[a-z_]+$/;
const COLUMN_NAME = /^[A-Za-z_]+$/;

function ph(manager: EntityManager, i: number): string {
  return manager.connection.driver.options.type === 'postgres' ? `$${i}` : '?';
}

@Injectable()
export class BusinessTrashService {
  private readonly logger = new Logger(BusinessTrashService.name);

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /**
   * 在删除之前拍快照。必须在调用方的删除事务里调用（传入同一个 manager），
   * 快照与删除同生同灭：删除回滚，快照也回滚。
   */
  async capture(
    manager: EntityManager,
    entityType: string,
    entityId: string,
    title: string,
    tables: TrashTable[],
    deletedBy?: string,
    /** 删除时被置空的下游引用（如删需求时方案的 requirementId），还原时接回去 */
    relinks: TrashTable[] = [],
  ): Promise<void> {
    const snapshot: Array<{ table: string; rows: any[] }> = [];
    for (const t of tables) {
      if (!t.ids.length) continue;
      if (!TABLE_NAME.test(t.table) || !COLUMN_NAME.test(t.column)) throw new Error(`非法表名 ${t.table}.${t.column}`);
      const marks = t.ids.map((_, i) => ph(manager, i + 1)).join(', ');
      const rows = await manager.query(`SELECT * FROM "${t.table}" WHERE "${t.column}" IN (${marks})`, t.ids);
      if (rows.length) snapshot.push({ table: t.table, rows });
    }
    const expiresAt = new Date(Date.now() + 30 * 86400000);
    await manager.getRepository(RecycleBinItem).save(
      manager.getRepository(RecycleBinItem).create({
        entityType,
        entityId,
        deletedBy: deletedBy || null,
        expiresAt,
        entityData: { kind: 'business', title, tables: snapshot, relinks: relinks.filter((r) => r.ids.length) },
      } as any),
    );
  }

  /** 被哪些单据引用（删除确认框里提示用） */
  async impact(entityType: string, entityId: string): Promise<Array<{ label: string; count: number }>> {
    const refs = REFERENCES[entityType] || [];
    const out: Array<{ label: string; count: number }> = [];
    for (const r of refs) {
      const rows = await this.dataSource.query(
        `SELECT COUNT(*) AS n FROM "${r.table}" WHERE "${r.column}" = ${ph(this.dataSource.manager, 1)}`,
        [entityId],
      );
      const n = Number(rows?.[0]?.n || 0);
      if (n > 0) out.push({ label: r.label, count: n });
    }
    return out;
  }

  async list(): Promise<any[]> {
    const items = await this.dataSource.getRepository(RecycleBinItem).find({ order: { deletedAt: 'DESC' } });
    return items
      .filter((it) => it.entityData?.kind === 'business')
      .map((it) => ({
        id: it.id,
        entityType: it.entityType,
        typeLabel: BUSINESS_TYPES[it.entityType] || it.entityType,
        entityId: it.entityId,
        title: it.entityData?.title || '',
        rows: (it.entityData?.tables || []).reduce((s: number, t: any) => s + (t.rows?.length || 0), 0),
        deletedAt: it.deletedAt,
        expiresAt: it.expiresAt,
      }));
  }

  /**
   * 还原：按快照顺序（主表在前）写回。已存在同 id 的行跳过 —— 允许重复点还原、
   * 也兼容"删了之后又手动建了同一条"的情况，不会因主键冲突整体失败。
   */
  async restore(recycleId: string): Promise<{ entityType: string; entityId: string; restoredRows: number }> {
    const repo = this.dataSource.getRepository(RecycleBinItem);
    const item = await repo.findOne({ where: { id: recycleId } });
    if (!item) throw new NotFoundException('回收站记录不存在');
    if (item.entityData?.kind !== 'business') throw new BadRequestException('资料请在「资料回收站」里还原');
    let restored = 0;
    await this.dataSource.transaction(async (manager) => {
      for (const t of item.entityData.tables || []) {
        if (!TABLE_NAME.test(t.table)) continue;
        for (const row of t.rows || []) {
          if (row.id) {
            const exists = await manager.query(`SELECT 1 FROM "${t.table}" WHERE id = ${ph(manager, 1)}`, [row.id]);
            if (exists.length) continue;
          }
          const cols = Object.keys(row).filter((c) => COLUMN_NAME.test(c));
          const marks = cols.map((_, i) => ph(manager, i + 1)).join(', ');
          await manager.query(
            `INSERT INTO "${t.table}" (${cols.map((c) => `"${c}"`).join(', ')}) VALUES (${marks})`,
            cols.map((c) => row[c]),
          );
          restored++;
        }
      }
      for (const r of item.entityData.relinks || []) {
        if (!TABLE_NAME.test(r.table) || !COLUMN_NAME.test(r.column) || !r.ids?.length) continue;
        const marks = r.ids.map((_: string, i: number) => ph(manager, i + 2)).join(', ');
        await manager.query(
          `UPDATE "${r.table}" SET "${r.column}" = ${ph(manager, 1)} WHERE "${r.column}" IS NULL AND id IN (${marks})`,
          [item.entityId, ...r.ids],
        );
      }
      await manager.getRepository(RecycleBinItem).delete(recycleId);
    });
    this.logger.log(`已还原 ${item.entityType} ${item.entityId}（${restored} 行）`);
    return { entityType: item.entityType, entityId: item.entityId, restoredRows: restored };
  }

  async purge(recycleId: string): Promise<void> {
    const repo = this.dataSource.getRepository(RecycleBinItem);
    const item = await repo.findOne({ where: { id: recycleId } });
    if (!item) throw new NotFoundException('回收站记录不存在');
    if (item.entityData?.kind !== 'business') throw new BadRequestException('资料请在「资料回收站」里处理');
    await repo.delete(recycleId);
  }
}
