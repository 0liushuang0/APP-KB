import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface PermissionSubject {
  visibility: 'public' | 'department' | 'group' | 'role' | 'private';
  uploaderId?: string;
  departmentId?: string;
  groupIds?: string[];
  roleCodes?: string[];
  status?: string;
}

export interface CurrentUser {
  userId: string;
  username: string;
  roles: string[];
  departmentId?: string;
  groupIds?: string[];
  isSystemAdmin: boolean;
}

/** 可以看成本价与毛利的角色 */
export const COST_VIEW_ROLES = ['admin', 'manager', 'sales_lead', 'purchase', 'approver', 'dept_admin'];

@Injectable()
export class PermissionService {
  constructor(private configService: ConfigService) {}

  isSingleMode(): boolean {
    return this.configService.get<'single' | 'team'>('app.appMode') === 'single';
  }

  canAccess(user: CurrentUser | undefined, subject: PermissionSubject): boolean {
    if (this.isSingleMode()) return true;
    if (!user) return subject.visibility === 'public';
    if (user.isSystemAdmin) return true;

    if (subject.visibility === 'public') return true;

    if (subject.visibility === 'private') {
      return subject.uploaderId === user.userId;
    }

    if (subject.visibility === 'department') {
      return (
        !!subject.departmentId &&
        !!user.departmentId &&
        subject.departmentId === user.departmentId
      );
    }

    if (subject.visibility === 'group') {
      const subjectGroupIds = subject.groupIds || [];
      const userGroupIds = user.groupIds || [];
      return subjectGroupIds.some((id) => userGroupIds.includes(id));
    }

    if (subject.visibility === 'role') {
      const subjectRoles = subject.roleCodes || [];
      const userRoles = user.roles || [];
      return subjectRoles.some((role) => userRoles.includes(role));
    }

    return false;
  }

  canManage(user: CurrentUser | undefined, subject: PermissionSubject): boolean {
    if (this.isSingleMode()) return true;
    if (!user) return false;
    if (user.isSystemAdmin) return true;
    return subject.uploaderId === user.userId;
  }

  canApprove(user: CurrentUser | undefined): boolean {
    if (this.isSingleMode()) return true;
    if (!user) return false;
    if (user.isSystemAdmin) return true;
    return user.roles.includes('admin') || user.roles.includes('approver');
  }

  /**
   * 成本价、毛利属于字段级敏感信息：单机版、系统管理员、管理层/销售主管/采购/审批人/部门管理员可见；
   * 其他角色看得到报价单本身，但看不到成本列与毛利（接口直接不返回，前端也不显示）。
   */
  canViewCost(user: CurrentUser | undefined): boolean {
    if (this.isSingleMode()) return true;
    if (!user) return false;
    if (user.isSystemAdmin) return true;
    return (user.roles || []).some((r) => COST_VIEW_ROLES.includes(r));
  }

  skipApproval(): boolean {
    return this.isSingleMode();
  }
}
