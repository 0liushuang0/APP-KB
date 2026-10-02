import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PermissionService, CurrentUser } from '../../common/services/permission.service';
import { SearchResult } from './search.service';

@Injectable()
export class SearchPermissionService {
  constructor(private permissionService: PermissionService) {}

  canAccessResult(result: SearchResult, user: CurrentUser): boolean {
    if (this.permissionService.isSingleMode()) return true;
    if (!user) return false;
    if (user.isSystemAdmin) return true;

    const snapshot = result.permission_snapshot;
    // In team mode, missing ACL metadata is not evidence that a record is
    // public. Single-user mode is intentionally allowed above.
    if (!snapshot?.visibility) return false;
    const visibility = snapshot.visibility;

    if (visibility === 'public') return true;

    if (visibility === 'private') {
      return snapshot.uploader_id === user.userId;
    }

    if (visibility === 'department') {
      return !!snapshot.department_id && snapshot.department_id === user.departmentId;
    }

    if (visibility === 'group') {
      const subjectGroupIds = snapshot.group_ids || [];
      const userGroupIds = user.groupIds || [];
      return subjectGroupIds.some((id: string) => userGroupIds.includes(id));
    }

    if (visibility === 'role') {
      const subjectRoles = snapshot.role_codes || [];
      const userRoles = user.roles || [];
      return subjectRoles.some((role: string) => userRoles.includes(role));
    }

    return false;
  }
}
