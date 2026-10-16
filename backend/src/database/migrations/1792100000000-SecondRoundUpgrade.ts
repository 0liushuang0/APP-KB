import { MigrationInterface, QueryRunner } from 'typeorm';
import { compat } from './_shared/sql-compat';

/**
 * 第二轮差距清单的表结构（《爱用度与成熟系统差距分析-2026-10-16-第二轮》P1/P2）：
 *
 *  · job_locks            定时任务分布式锁 —— 多台服务器共用数据库时同一任务只跑一份
 *  · supplier_products.productId   供应商产品 → 我方产品 的映射，报价明细据此自动带出成本
 *  · quotations           币种 / 汇率 / 单据语言（中文、英文报价单）/ 报价日期（业务周期指标用真实日期）
 *  · quotation_items      英文品名、英文规格、成本来源说明
 *  · contracts            币种 / 汇率（从外币报价生成的合同金额不能当人民币汇总）
 *  · customers.country    国家/地区（区域字典归并后「俄罗斯 / 南亚区域」落到 海外 + 国家）
 *  · saved_views          列表「保存的视图」（个人 / 团队共享）
 *  · weekly_reports       每周一自动生成的个人 / 全公司周报
 *
 * 全部幂等：重复执行不报错；时间戳列沿用历史迁移的 SQLite 写法，由 compat 翻译成 PG。
 */
export class SecondRoundUpgrade1792100000000 implements MigrationInterface {
  name = 'SecondRoundUpgrade1792100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const isPg = (queryRunner.connection.options as { type?: string }).type === 'postgres';
    const addColumn = async (table: string, column: string, ddl: string) => {
      if (!(await queryRunner.hasColumn(table, column))) {
        await queryRunner.query(compat(queryRunner, `ALTER TABLE "${table}" ADD COLUMN "${column}" ${ddl}`));
      }
    };

    // ── 任务锁：时间一律存毫秒整数，两种库的比较语义一致 ──
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "job_locks" (
        "name" varchar(120) PRIMARY KEY NOT NULL,
        "holder" varchar(200),
        "lockedUntil" bigint,
        "lastStartedAt" bigint,
        "lastFinishedAt" bigint,
        "lastResult" text,
        "lastError" text
      )
    `);

    // ── 供应商产品 → 我方产品 ──
    await addColumn('supplier_products', 'productId', 'varchar NULL');
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_supplier_products_productId" ON "supplier_products" ("productId")`);

    // ── 报价：币种 / 汇率 / 语言 / 报价日期 ──
    await addColumn('quotations', 'currency', `varchar NOT NULL DEFAULT 'CNY'`);
    await addColumn('quotations', 'exchangeRate', 'numeric(14,6) NULL');
    await addColumn('quotations', 'language', `varchar NOT NULL DEFAULT 'zh'`);
    await addColumn('quotations', 'quotedAt', 'date NULL');
    await addColumn('quotation_items', 'nameEn', 'varchar NULL');
    await addColumn('quotation_items', 'specificationEn', 'text NULL');
    await addColumn('quotation_items', 'costSource', 'varchar NULL');

    // ── 合同：币种 / 汇率 ──
    await addColumn('contracts', 'currency', `varchar NOT NULL DEFAULT 'CNY'`);
    await addColumn('contracts', 'exchangeRate', 'numeric(14,6) NULL');

    // ── 客户：国家/地区 ──
    await addColumn('customers', 'country', 'varchar NULL');

    // ── 保存的视图 ──
    await queryRunner.query(compat(queryRunner, `
      CREATE TABLE IF NOT EXISTS "saved_views" (
        "id" varchar PRIMARY KEY NOT NULL,
        "page" varchar NOT NULL,
        "name" varchar NOT NULL,
        "ownerId" varchar,
        "shared" boolean NOT NULL DEFAULT (0),
        "isDefault" boolean NOT NULL DEFAULT (0),
        "state" text NOT NULL,
        "createdAt" datetime NOT NULL DEFAULT (datetime('now')),
        "updatedAt" datetime NOT NULL DEFAULT (datetime('now'))
      )
    `));
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_saved_views_page_owner" ON "saved_views" ("page", "ownerId")`);

    // ── 周报 ──
    await queryRunner.query(compat(queryRunner, `
      CREATE TABLE IF NOT EXISTS "weekly_reports" (
        "id" varchar PRIMARY KEY NOT NULL,
        "weekKey" varchar NOT NULL,
        "scope" varchar NOT NULL DEFAULT 'personal',
        "recipientId" varchar,
        "title" varchar NOT NULL,
        "content" text NOT NULL,
        "createdAt" datetime NOT NULL DEFAULT (datetime('now'))
      )
    `));
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_weekly_reports_week" ON "weekly_reports" ("weekKey")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_weekly_reports_recipient" ON "weekly_reports" ("recipientId")`);

    // PG：uuid 主键靠数据库生成（SQLite 走应用侧生成）
    if (isPg) {
      await queryRunner.query(`ALTER TABLE "saved_views" ALTER COLUMN "id" SET DEFAULT gen_random_uuid()`);
      await queryRunner.query(`ALTER TABLE "weekly_reports" ALTER COLUMN "id" SET DEFAULT gen_random_uuid()`);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "weekly_reports"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "saved_views"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "job_locks"`);
    const drops: Array<[string, string]> = [
      ['customers', 'country'],
      ['contracts', 'exchangeRate'],
      ['contracts', 'currency'],
      ['quotation_items', 'costSource'],
      ['quotation_items', 'specificationEn'],
      ['quotation_items', 'nameEn'],
      ['quotations', 'quotedAt'],
      ['quotations', 'language'],
      ['quotations', 'exchangeRate'],
      ['quotations', 'currency'],
      ['supplier_products', 'productId'],
    ];
    for (const [t, c] of drops) {
      if (await queryRunner.hasColumn(t, c)) await queryRunner.query(`ALTER TABLE "${t}" DROP COLUMN "${c}"`);
    }
  }
}
