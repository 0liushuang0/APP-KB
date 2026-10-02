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

  skipApproval(): boolean {
    return this.isSingleMode();
  }
}
