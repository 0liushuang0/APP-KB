import { MigrationInterface, QueryRunner } from 'typeorm';
import { compat } from './_shared/sql-compat';

/**
 * 用户双因素认证字段（TOTP，RFC 6238）。
 *
 * 商用评估框架一票否决项"必须支持 MFA"的最小落地：
 * totpSecret 存 Base32 密钥（绑定时生成，未启用前不参与登录），
 * totpEnabled 启用后登录需额外提交 6 位动态码。
 */
export class AddUserTotp1788600000000 implements MigrationInterface {
  name = 'AddUserTotp1788600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('users');
    if (table && !table.findColumnByName('totpSecret')) {
      await queryRunner.query(compat(queryRunner,
        `ALTER TABLE "users" ADD COLUMN "totpSecret" varchar`));
    }
    if (table && !table.findColumnByName('totpEnabled')) {
      await queryRunner.query(compat(queryRunner,
        `ALTER TABLE "users" ADD COLUMN "totpEnabled" boolean NOT NULL DEFAULT false`));
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('users');
    for (const col of ['totpSecret', 'totpEnabled']) {
      if (table && table.findColumnByName(col)) {
        await queryRunner.query(compat(queryRunner,
          `ALTER TABLE "users" DROP COLUMN "${col}"`));
      }
    }
  }
}
