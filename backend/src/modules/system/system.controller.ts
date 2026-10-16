import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  Res,
  Param,
  UploadedFile,
  UseInterceptors,
  ParseFilePipe,
  MaxFileSizeValidator,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiConsumes, ApiBody } from '@nestjs/swagger';
import { MAX_UPLOAD_BYTES } from '../../common/constants/upload';
import { Response } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser as CurrentUserType } from '../../common/services/permission.service';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { NotificationsService } from '../notifications/notifications.service';
import { SystemService } from './system.service';

@ApiTags('系统')
@Controller('system')
export class SystemController {
  constructor(
    private readonly systemService: SystemService,
    private readonly notificationsService: NotificationsService,
  ) {}

  @Public()
  @Get('info')
  info() {
    return this.systemService.getSystemInfo();
  }

  @Public()
  @Get('version')
  version() {
    return this.systemService.getVersionInfo();
  }

  @Get('dashboard-stats')
  async dashboardStats(@CurrentUser() user: CurrentUserType, @Query('scope') scope?: string) {
    return this.systemService.getDashboardStats(user as any, scope === 'mine' ? 'mine' : 'all');
  }

  /** 业务结果指标：报价响应天数、需求→签约周期、赢单率、丢单原因、回款及时率；scope=mine 只算本人负责的 */
  @Get('cycle-metrics')
  async cycleMetrics(@CurrentUser() user: CurrentUserType, @Query('scope') scope?: string, @Query('days') days?: string) {
    const d = Math.max(0, Math.min(3650, Number(days) || 180));
    return this.systemService.getCycleMetrics(scope === 'mine' ? user?.userId : undefined, d);
  }

  /** 各业务列表页顶部统计卡片（客户/需求/方案/报价/合同/项目） */
  @Get('module-stats')
  async moduleStats() {
    return this.systemService.getModuleStats();
  }

  /** 数据一致性巡检：悬空引用/重号/脏值（设置页或巡检脚本调用） */
  @Get('consistency')
  async consistency() {
    return this.systemService.consistencyCheck();
  }

  @Get('recent-activities')
  async recentActivities() {
    return this.systemService.getRecentActivities();
  }

  @Get('performance-metrics')
  async performanceMetrics() {
    return this.systemService.getPerformanceMetrics();
  }

  @Get('todos')
  async todos() {
    return this.systemService.getTodos();
  }

  @Post('import')
  @Roles('admin')
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
        type: { type: 'string', description: 'customer | product | supplier | requirement' },
      },
    },
  })
  @UseInterceptors(FileInterceptor('file'))
  async import(
    @UploadedFile(
      new ParseFilePipe({
        validators: [new MaxFileSizeValidator({ maxSize: MAX_UPLOAD_BYTES })],
      }),
    )
    file: Express.Multer.File,
    @Body('type') type: string,
  ) {
    return this.systemService.importExcel(type, file.buffer);
  }

  /**
   * 导出 Excel：不传 type 为全量备份；传 type 则按模块导出，
   * 可携带列表页当前的 keyword/status 筛选。
   */
  @Get('export')
  @Roles('admin')
  async export(
    @Res() res: Response,
    @Query('type') type?: string,
    @Query('keyword') keyword?: string,
    @Query('status') status?: string,
  ) {
    const buffer = await this.systemService.exportExcel(type, keyword, status);
    const date = new Date().toISOString().slice(0, 10);
    const filename = type ? `aikb-${type}-${date}.xlsx` : 'aikb-export.xlsx';
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
    res.send(buffer);
  }

  // ── 异步导出（大数据量不阻塞请求线程） ──

  private static exportJobs = new Map<string, {
    status: 'processing' | 'done' | 'failed';
    buffer?: Buffer;
    filename?: string;
    error?: string;
    createdAt: number;
  }>();

  /**
   * 启动异步导出：立即返回 jobId，后台生成 Excel，
   * 完成后通过站内通知提醒用户下载。
   * 适用于全量导出（无 type 参数）或数据量较大的场景。
   */
  @Post('export/async')
  @Roles('admin')
  async startAsyncExport(
    @CurrentUser() user: any,
    @Body() dto: { type?: string; keyword?: string; status?: string },
  ) {
    const jobId = `exp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    SystemController.exportJobs.set(jobId, { status: 'processing', createdAt: Date.now() });

    // 后台生成，不阻塞本次 HTTP 响应
    setImmediate(async () => {
      try {
        const buffer = await this.systemService.exportExcel(dto.type, dto.keyword, dto.status);
        const date = new Date().toISOString().slice(0, 10);
        const filename = dto.type ? `aikb-${dto.type}-${date}.xlsx` : `aikb-full-${date}.xlsx`;
        SystemController.exportJobs.set(jobId, { status: 'done', buffer, filename, createdAt: Date.now() });
        // 通知用户下载就绪
        this.notificationsService.create({
          type: 'system',
          title: 'Excel 导出完成',
          content: `文件 ${filename} 已生成完毕，点击此处下载。`,
          recipientId: user.userId,
          linkUrl: `/api/system/export/async/${jobId}/download`,
        }).catch(() => {});
      } catch (err: any) {
        SystemController.exportJobs.set(jobId, { status: 'failed', error: err.message, createdAt: Date.now() });
        this.notificationsService.create({
          type: 'system',
          title: 'Excel 导出失败',
          content: `导出失败：${err.message}`,
          recipientId: user.userId,
        }).catch(() => {});
      }
    });

    return { jobId, status: 'processing', message: '导出已启动，完成后将通知您下载' };
  }

  /** 查询导出任务状态 */
  @Get('export/async/:jobId')
  @Roles('admin')
  checkExportStatus(@Param('jobId') jobId: string) {
    const job = SystemController.exportJobs.get(jobId);
    if (!job) throw new BadRequestException('导出任务不存在');
    return { jobId, status: job.status, filename: job.filename, error: job.error };
  }

  /** 下载已完成的导出文件 */
  @Get('export/async/:jobId/download')
  @Roles('admin')
  downloadExport(@Param('jobId') jobId: string, @Res() res: Response) {
    const job = SystemController.exportJobs.get(jobId);
    if (!job) throw new BadRequestException('导出任务不存在');
    if (job.status !== 'done' || !job.buffer) {
      throw new BadRequestException(`导出尚未完成（当前状态：${job.status}）`);
    }
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=${job.filename}`);
    res.send(job.buffer);
    // 下载后清理，避免内存积压（保留 5 分钟后自动清理）
    setTimeout(() => SystemController.exportJobs.delete(jobId), 5 * 60_000);
  }
}
