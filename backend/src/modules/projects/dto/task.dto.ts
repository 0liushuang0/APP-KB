import { IsString, IsOptional, IsInt, IsEnum, Max, Min } from 'class-validator';

/**
 * 项目任务的字段白名单与取值校验。
 *
 * 之前任务接口的 Body 是 any：字段名打错不报错、status 传任意字符串也照单全收，
 * 还能把 projectId 改成别的项目。多人使用后这类静默脏数据无法追责，
 * 所以任务与其它业务单据一样走 DTO 白名单（全局 forbidNonWhitelisted）。
 */
export class CreateProjectTaskDto {
  @IsString()
  title: string;

  @IsOptional()
  @IsString()
  description?: string;

  /** 负责人展示名（兼容历史自由文本；新数据优先用 assignedUserId） */
  @IsOptional()
  @IsString()
  assignedTo?: string;

  /** 负责人账号 ID：服务端校验必须是真实用户 */
  @IsOptional()
  @IsString()
  assignedUserId?: string;

  @IsOptional()
  @IsString()
  collaborators?: string;

  @IsOptional()
  @IsString()
  stageId?: string;

  @IsOptional()
  @IsString()
  startDate?: string;

  @IsOptional()
  @IsString()
  endDate?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  progress?: number;

  @IsOptional()
  @IsEnum(['high', 'medium', 'low'] as const)
  priority?: 'high' | 'medium' | 'low';

  @IsOptional()
  @IsEnum(['pending', 'in_progress', 'done', 'completed', 'cancelled'] as const)
  status?: 'pending' | 'in_progress' | 'done' | 'completed' | 'cancelled';
}

export class UpdateProjectTaskDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  assignedTo?: string;

  @IsOptional()
  @IsString()
  assignedUserId?: string;

  @IsOptional()
  @IsString()
  collaborators?: string;

  @IsOptional()
  @IsString()
  stageId?: string;

  @IsOptional()
  @IsString()
  startDate?: string;

  @IsOptional()
  @IsString()
  endDate?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  progress?: number;

  @IsOptional()
  @IsEnum(['high', 'medium', 'low'] as const)
  priority?: 'high' | 'medium' | 'low';

  @IsOptional()
  @IsEnum(['pending', 'in_progress', 'done', 'completed', 'cancelled'] as const)
  status?: 'pending' | 'in_progress' | 'done' | 'completed' | 'cancelled';
}
