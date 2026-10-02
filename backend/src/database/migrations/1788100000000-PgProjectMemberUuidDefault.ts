import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 收尾迁移：project_members 的 id 主键补 DEFAULT gen_random_uuid()。
 *
 * PgUuidDefaults1787900000000 处理了当时的全部表，但 project_members
 * 是之后新建的（迁移里没写列默认值）——PG 驱动插入时发送 DEFAULT，
 * 没有默认值就会报 "null value in column id"。仅对 postgres 生效。
 * 以后新增表时，要么在 CREATE TABLE 里直接写 DEFAULT，要么跟进一个
 * 同样的收尾迁移。
 */
export class PgProjectMemberUuidDefault1788100000000 implements MigrationInterface {
  name = 'PgProjectMemberUuidDefault1788100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if ((queryRunner.connection.options as { type?: string }).type !== 'postgres') {
      return;
    }
    const table = await queryRunner.getTable('project_members');
    const idCol = table?.findColumnByName('id');
    if (table && idCol && !idCol.default) {
      await queryRunner.query(
        `ALTER TABLE "project_members" ALTER COLUMN "id" SET DEFAULT gen_random_uuid()`,
      );
    }
  }

  public async down(): Promise<void> {
    // 与 PgUuidDefaults1787900000000 保持一致：回滚不撤默认值（无害保留）
  }
}
