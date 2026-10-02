import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 收尾迁移：补回 PG 上被 CASCADE 带走的 departments 自引用外键。
 *
 * 背景：InitialSchema 的"临时表重建"模式里，temporary_departments 带着
 * parent_id → departments 的外键，紧随其后的 DROP TABLE "departments"
 * 在 PostgreSQL 下必须 CASCADE 才能执行，而 CASCADE 会把这个自引用外键
 * 一并删掉。SQLite 路径不受影响（外键本就保留），因此本迁移只对 PG 生效。
 */
export class PgRestoreDepartmentSelfFk1787800000000 implements MigrationInterface {
  name = 'PgRestoreDepartmentSelfFk1787800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if ((queryRunner.connection.options as { type?: string }).type !== 'postgres') {
      return;
    }
    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'FK_departments_parent'
            AND conrelid = 'departments'::regclass
        ) THEN
          ALTER TABLE "departments"
            ADD CONSTRAINT "FK_departments_parent"
            FOREIGN KEY ("parent_id") REFERENCES "departments" ("id")
            ON DELETE NO ACTION ON UPDATE NO ACTION;
        END IF;
      END $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if ((queryRunner.connection.options as { type?: string }).type !== 'postgres') {
      return;
    }
    await queryRunner.query(`ALTER TABLE "departments" DROP CONSTRAINT IF EXISTS "FK_departments_parent"`);
  }
}
