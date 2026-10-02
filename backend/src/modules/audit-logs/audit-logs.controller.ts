import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { Roles } from '../../common/decorators/roles.decorator';
import { AuditLogsService, AuditLogQuery } from './audit-logs.service';

@ApiTags('操作日志')
@ApiBearerAuth()
@Controller('audit-logs')
export class AuditLogsController {
  constructor(private readonly auditLogsService: AuditLogsService) {}

  @Get()
  @Roles('admin')
  findAll(@Query() query: AuditLogQuery) {
    return this.auditLogsService.findAll(query);
  }
}
