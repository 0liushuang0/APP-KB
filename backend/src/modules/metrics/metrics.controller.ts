import { Controller, Get, Header } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Roles } from '../../common/decorators/roles.decorator';
import { MetricsService } from './metrics.service';
import { JobLockService } from '../../common/services/job-lock.service';

/**
 * 指标与健康端点（仅管理员）：
 *   GET /api/metrics          Prometheus 文本格式（抓取端点）
 *   GET /api/metrics/summary  JSON 摘要（前端健康页）
 *   GET /api/metrics/jobs     定时任务锁状态（多台服务器时看哪台在跑、上次何时完成、有无报错）
 */
@ApiTags('运行指标')
@Roles('admin')
@Controller('metrics')
export class MetricsController {
  constructor(
    private readonly metricsService: MetricsService,
    private readonly jobLock: JobLockService,
  ) {}

  @Get()
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  prometheus(): Promise<string> {
    return this.metricsService.prometheus();
  }

  @Get('summary')
  summary(): Promise<any> {
    return this.metricsService.summary();
  }

  @Get('jobs')
  jobs() {
    return this.jobLock.list();
  }
}
