import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CurrentUser as CurrentUserType } from '../../common/services/permission.service';
import { OpsHealthService } from './ops-health.service';

@ApiTags('系统健康')
@Controller('ops-health')
export class OpsHealthController {
  constructor(private readonly service: OpsHealthService) {}

  /** 工作台「系统健康」: AI 检索覆盖、产品报价就绪、待审批、解析成功率、备份 */
  @Get('overview')
  overview(@CurrentUser() user: CurrentUserType) {
    return this.service.overview(user);
  }
}
