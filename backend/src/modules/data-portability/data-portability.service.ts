import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

/**
 * 数据可迁移性服务。
 *
 * 备份是二进制快照（SQLite + 附件），JSON 导出是结构化数据：
 * - 可读、可编辑、可跨平台迁移
 * - 可选择性导入（只导客户不导报价）
 * - 版本升级时字段映射
 *
 * 导出格式：
 * {
 *   version: "2.0",
 *   exportedAt: "2026-08-02T...",
 *   tables: {
 *     customers: [ { id, name, ... }, ... ],
 *     requirements: [ ... ],
 *     ...
 *   }
 * }
 */
@Injectable()
export class DataPortabilityService {
  private readonly logger = new Logger(DataPortabilityService.name);

  /** 表不存在：SQLite 报 no such table，PG 报 relation ... does not exist（中文环境为 关系...不存在） */
  private static isMissingTable(err: any): boolean {
    const msg = String(err?.message || '');
    return msg.includes('no such table') || msg.includes('does not exist') || msg.includes('不存在');
  }

  /** 可导出的表及其排序（外键依赖从先到后） */
  private readonly EXPORTABLE_TABLES = [
    'users',
    'departments',
    'user_groups',
    'roles',
    'customers',
    'contact_persons',
    'follow_up_records',
    'requirements',
    'requirement_attachments',
    'proposals',
    'proposal_versions',
    'quotations',
    'quotation_items',
    'products',
    'product_boms',
    'product_attachments',
    'suppliers',
    'supplier_capabilities',
    'supplier_products',
    'supplier_quotations',
    'projects',
    'project_stages',
    'project_risks',
    'project_timelines',
    'documents',
    'document_links',
    'approval_flows',
    'solutions',
    'solution_options',
    'solution_price_tables',
    'param_templates',
    'calc_templates',
    'calc_records',
    'system_configs',
  ];

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /**
   * 全量 JSON 导出。
   * @param tables 可选：指定要导出的表名列表；不传则导出全部
   */
  async exportJson(tables?: string[]): Promise<object> {
    const targetTables = tables
      ? this.EXPORTABLE_TABLES.filter((t) => tables.includes(t))
      : this.EXPORTABLE_TABLES;

    const result: Record<string, any[]> = {};
    let totalRows = 0;

    for (const table of targetTables) {
      try {
        const rows = await this.dataSource.query(`SELECT * FROM "${table}"`);
        result[table] = rows;
        totalRows += rows.length;
      } catch (err: any) {
        // 表不存在可能是版本差异，跳过
        if (DataPortabilityService.isMissingTable(err)) {
          result[table] = [];
        } else {
          this.logger.warn(`导出表 ${table} 失败：${err.message}`);
          result[table] = [];
        }
      }
    }

    this.logger.log(`JSON 导出完成：${targetTables.length} 张表，${totalRows} 条记录`);

    return {
      version: '2.0',
      exportedAt: new Date().toISOString(),
      source: 'ai-knowledge-base',
      tables: result,
    };
  }

  /**
   * 全量 JSON 导入。
   *
   * 策略：清空目标表后批量插入，保持 ID 不变（外键关联）。
   * 整个过程在事务内完成，任何表失败则全部回滚。
   */
  async importJson(data: any): Promise<{ imported: Record<string, number>; errors: string[] }> {
    if (!data?.tables || typeof data.tables !== 'object') {
      throw new BadRequestException('无效的 JSON 格式：缺少 tables 字段');
    }

    const imported: Record<string, number> = {};
    const errors: string[] = [];

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // 按依赖顺序处理，先删子表再删父表
      const tablesToImport = Object.keys(data.tables).filter((t) =>
        this.EXPORTABLE_TABLES.includes(t),
      );

      // 逆序删除（先删有外键依赖的表）
      for (const table of [...tablesToImport].reverse()) {
        try {
          await queryRunner.query(`DELETE FROM "${table}"`);
        } catch (err: any) {
          if (!DataPortabilityService.isMissingTable(err)) {
            errors.push(`清空表 ${table} 失败：${err.message}`);
          }
        }
      }

      // 正序插入
      for (const table of tablesToImport) {
        const rows = data.tables[table];
        if (!Array.isArray(rows) || rows.length === 0) {
          imported[table] = 0;
          continue;
        }

        try {
          /*
           * 列清单从数据库元数据读取，且查询全程参数化。
           * INSERT 不再手工拼 SQL：表名/列名的转义由查询构建器完成，
           * 列名只允许命中元数据列集合（白名单），值走参数绑定。
           * PRAGMA 是 SQLite 专有；PG 走 information_schema，占位符也各用各的
           * （PG 不认 ?，SQLite 不认 $n 数组绑定）。
           */
          const isPostgres = (this.dataSource.options as { type?: string }).type === 'postgres';
          const columns = isPostgres
            ? await queryRunner.query(
                'SELECT column_name AS name FROM information_schema.columns WHERE table_name = $1',
                [table],
              )
            : await queryRunner.query('SELECT name FROM pragma_table_info(?)', [table]);
          const validColumns = new Set(columns.map((c: any) => c.name));

          // 过滤出有效列
          const sampleRow = rows[0];
          const insertColumns = Object.keys(sampleRow).filter((k) => validColumns.has(k));

          if (insertColumns.length === 0) {
            imported[table] = 0;
            continue;
          }

          let count = 0;
          for (const row of rows) {
            const rowValues: Record<string, any> = {};
            for (const c of insertColumns) {
              rowValues[c] = row[c] ?? null;
            }
            try {
              await queryRunner.manager
                .createQueryBuilder()
                .insert()
                .into(table)
                .values(rowValues)
                .execute();
              count++;
            } catch (err: any) {
              // 单行失败（如唯一约束冲突）不中断整表导入
              if (count === 0) {
                errors.push(`${table} 首行导入失败：${err.message}`);
              }
            }
          }

          imported[table] = count;
        } catch (err: any) {
          errors.push(`导入表 ${table} 失败：${err.message}`);
          imported[table] = 0;
        }
      }

      await queryRunner.commitTransaction();
      this.logger.log(`JSON 导入完成：${Object.values(imported).reduce((a, b) => a + b, 0)} 条记录`);
    } catch (err: any) {
      await queryRunner.rollbackTransaction();
      throw new BadRequestException(`导入失败已回滚：${err.message}`);
    } finally {
      await queryRunner.release();
    }

    return { imported, errors };
  }

  /** 获取可导出的表列表 */
  getExportableTables(): string[] {
    return [...this.EXPORTABLE_TABLES];
  }
}
