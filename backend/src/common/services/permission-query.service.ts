import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Brackets, SelectQueryBuilder } from 'typeorm';
import { CurrentUser } from './permission.service';

/** 每个实体上"归属人"的列名不统一：文档叫 uploaderId，其余多叫 ownerId */
export interface PermissionColumns {
  visibility?: string;
  owner?: string;
  department?: string;
  groupIds?: string;
  roleCodes?: string;
}

const DEFAULTS: Required<PermissionColumns> = {
  visibility: 'visibility',
  owner: 'ownerId',
  department: 'departmentId',
  groupIds: 'groupIds',
  roleCodes: 'roleCodes',
};

/**
 * 把可见性规则翻译成 SQL 条件。
 *
 * 为什么必须下沉到 SQL：原先的做法是 `repository.find()` 取回整表、
 * 再用 PermissionService.canAccess 在 JS 里过滤。这样无法分页 ——
 * 加 take/skip 会先截断再过滤，导致每页数量不足甚至整页为空。
 * 结果就是 8 个列表接口全部返回整张表，一万条资料每次传一万行。
 *
 * 规则与 PermissionService.canAccess 保持一一对应，两处必须同步修改。
 */
@Injectable()
export class PermissionQueryService {
  constructor(private readonly configService: ConfigService) {}

  private isSingleMode(): boolean {
    return this.configService.get<'single' | 'team'>('app.appMode') === 'single';
  }

  /**
   * simple-array 在 SQLite/PG 里都存成逗号分隔文本。
   * 判断成员归属时给两端补上分隔符，避免 'g1' 命中 'g11'。
   */
  private arrayContains(column: string, paramName: string): string {
    return `(',' || COALESCE(${column}, '') || ',') LIKE :${paramName}`;
  }

  /**
   * 给查询构建器追加可见性条件。
   *
   * @param qb    查询构建器
   * @param alias 主表别名
   * @param user  当前用户；未登录按仅 public 处理
   * @param cols  列名覆盖（如 documents 的归属列是 uploaderId）
   */
  apply<T extends object>(
    qb: SelectQueryBuilder<T>,
    alias: string,
    user: CurrentUser | undefined,
    cols: PermissionColumns = {},
  ): SelectQueryBuilder<T> {
    // 单机个人版只有一个用户，不做行级过滤
    if (this.isSingleMode()) return qb;
    if (user?.isSystemAdmin) return qb;

    const c = { ...DEFAULTS, ...cols };
    const V = `${alias}.${c.visibility}`;

    if (!user) {
      return qb.andWhere(`${V} = :pqPublic`, { pqPublic: 'public' });
    }

    const params: Record<string, unknown> = { pqPublic: 'public', pqUserId: user.userId };

    qb.andWhere(
      new Brackets((w) => {
        // 公开
        w.where(`${V} = :pqPublic`);

        // 私有：仅归属人
        w.orWhere(
          new Brackets((p) =>
            p.where(`${V} = 'private'`).andWhere(`${alias}.${c.owner} = :pqUserId`),
          ),
        );

        // 部门：同部门
        if (user.departmentId) {
          params.pqDeptId = user.departmentId;
          w.orWhere(
            new Brackets((p) =>
              p.where(`${V} = 'department'`).andWhere(`${alias}.${c.department} = :pqDeptId`),
            ),
          );
        }

        // 用户组：交集非空
        const groupIds = user.groupIds || [];
        if (groupIds.length) {
          w.orWhere(
            new Brackets((p) => {
              p.where(`${V} = 'group'`);
              p.andWhere(
                new Brackets((g) => {
                  groupIds.forEach((gid, i) => {
                    const key = `pqGroup${i}`;
                    params[key] = `%,${gid},%`;
                    const cond = this.arrayContains(`${alias}.${c.groupIds}`, key);
                    i === 0 ? g.where(cond) : g.orWhere(cond);
                  });
                }),
              );
            }),
          );
        }

        // 角色：交集非空
        const roles = user.roles || [];
        if (roles.length) {
          w.orWhere(
            new Brackets((p) => {
              p.where(`${V} = 'role'`);
              p.andWhere(
                new Brackets((r) => {
                  roles.forEach((code, i) => {
                    const key = `pqRole${i}`;
                    params[key] = `%,${code},%`;
                    const cond = this.arrayContains(`${alias}.${c.roleCodes}`, key);
                    i === 0 ? r.where(cond) : r.orWhere(cond);
                  });
                }),
              );
            }),
          );
        }
      }),
    ).setParameters(params);

    return qb;
  }
}
