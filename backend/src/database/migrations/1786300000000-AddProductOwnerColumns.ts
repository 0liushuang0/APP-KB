import { MigrationInterface, QueryRunner } from 'typeorm';
import { compat } from './_shared/sql-compat';

/**
 * products 表新增 ownerId / departmentId 列。
 *
 * 之前 Product 实体没有归属人和部门列，权限过滤器（PermissionQueryService）
 * 的 private/department 分支会引用不存在的 p.ownerId 导致 500。
 * 新增这两列后，产品的行级权限才能与客户/需求/方案/报价一致。
 *
 * 已有数据默认 NULL —— single 模式下 apply() 跳过行级过滤，不受影响；
 * team 模式下旧产品 visibility 默认 'public'，仍对所有人可见。
 */
export class AddProductOwnerColumns1786300000000 implements MigrationInterface {
  name = 'AddProductOwnerColumns1786300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // SQLite 的 ALTER TABLE ADD COLUMN 是幂等安全的：列不存在才加。
    // 用 try/catch 兼容已手动加过列的环境。
    await queryRunner.query(compat(queryRunner, `ALTER TABLE "products" ADD COLUMN "ownerId" varchar`)).catch(() => {});
    await queryRunner.query(compat(queryRunner, `ALTER TABLE "products" ADD COLUMN "departmentId" varchar`)).catch(() => {});
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // SQLite 不支持 DROP COLUMN（3.35+ 虽支持但 TypeORM 驱动版本不确定），留着即可
  }
}
