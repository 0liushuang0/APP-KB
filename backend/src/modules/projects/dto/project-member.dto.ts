import { IsString, IsOptional, IsEnum, IsUUID } from 'class-validator';

/** 添加项目成员 */
export class AddProjectMemberDto {
  @IsUUID()
  userId: string;

  /** manager 可编辑项目与任务；member 可编辑任务；viewer 只读 */
  @IsOptional()
  @IsEnum(['manager', 'member', 'viewer'] as const)
  role?: 'manager' | 'member' | 'viewer';
}

/** 更新成员角色 */
export class UpdateProjectMemberDto {
  @IsEnum(['manager', 'member', 'viewer'] as const)
  role: 'manager' | 'member' | 'viewer';
}

/** 成员视图（带用户资料） */
export class ProjectMemberViewDto {
  @IsOptional()
  @IsString()
  nickname?: string;

  @IsOptional()
  @IsString()
  username?: string;
}
