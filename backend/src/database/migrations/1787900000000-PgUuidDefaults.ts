import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 收尾迁移：PostgreSQL 下给所有 varchar 类型的 id 主键补 DEFAULT gen_random_uuid()。
 *
 * 背景：实体用 @PrimaryGeneratedColumn('uuid')，历史迁移在 SQLite 里建的是
 * "id" varchar（无默认值，SQLite 驱动在客户端生成 uuid 再写入，所以一直没暴露）。
 * PG 驱动对这种列在 INSERT 时发送 DEFAULT 指望数据库生成主键 ——
 * 而列上没有任何默认值，启动种子数据（默认配置、系统角色）全部
 * "null value in column id violates not-null constraint"，应用起不来。
 *
 * gen_random_uuid() 在 PG 13+ 内置，本迁移只对 postgres 生效。
 */
export class PgUuidDefaults1787900000000 implements MigrationInterface {
  name = 'PgUuidDefaults1787900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if ((queryRunner.connection.options as { type?: string }).type !== 'postgres') {
      return;
    }
    await queryRunner.query(`
      DO $$ DECLARE r record; BEGIN
        FOR r IN
          SELECT DISTINCT table_name
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND column_name = 'id'
            AND data_type = 'character varying'
            AND table_name NOT LIKE 'typeorm_%'
        LOOP
          EXECUTE format(
            'ALTER TABLE %I ALTER COLUMN "id" SET DEFAULT gen_random_uuid()',
            r.table_name
          );
        END LOOP;
      END $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if ((queryRunner.connection.options as { type?: string }).type !== 'postgres') {
      return;
    }
    await queryRunner.query(`
      DO $$ DECLARE r record; BEGIN
        FOR r IN
          SELECT DISTINCT table_name
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND column_name = 'id'
            AND column_default LIKE '%gen_random_uuid%'
        LOOP
          EXECUTE format(
            'ALTER TABLE %I ALTER COLUMN "id" DROP DEFAULT',
            r.table_name
          );
        END LOOP;
      END $$;
    `);
  }
}
