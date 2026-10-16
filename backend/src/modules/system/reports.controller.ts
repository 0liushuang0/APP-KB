import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CurrentUser as CurrentUserType } from '../../common/services/permission.service';
import { Roles } from '../../common/decorators/roles.decorator';
import { WeeklyReportService, reportWeek } from './weekly-report.service';

/**
 * 周报：每周一 8:30 自动生成并推送站内通知（见 WeeklyReportService）。
 *   GET  /reports/weekly            我的周报列表（个人 + 有权限时的全公司）
 *   GET  /reports/weekly/preview    预览本周至今（不保存、不推送）
 *   GET  /reports/weekly/:id        周报内容
 *   POST /reports/weekly/generate   管理员手动生成上周周报（可选是否推送）
 */
@ApiTags('周报')
@Controller('reports')
export class ReportsController {
  constructor(private readonly weekly: WeeklyReportService) {}

  @Get('weekly')
  list(@CurrentUser() user: CurrentUserType) {
    return this.weekly.list(user);
  }

  @Get('weekly/preview')
  preview(@CurrentUser() user: CurrentUserType, @Query('scope') scope?: string) {
    return this.weekly.preview(user, scope === 'company' ? 'company' : 'personal');
  }

  @Get('weekly/:id')
  get(@Param('id') id: string, @CurrentUser() user: CurrentUserType) {
    return this.weekly.get(id, user);
  }

  @Roles('admin')
  @Post('weekly/generate')
  async generate(@Body() body: { notify?: boolean }) {
    const week = reportWeek(new Date());
    const sent = await this.weekly.generate(week, { notify: !!body?.notify });
    return { weekKey: week.key, sent };
  }
}
