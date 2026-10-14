import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CurrentUser as CurrentUserType } from '../../common/services/permission.service';
import { ProductCompletenessService } from './product-completeness.service';

/** 路径单独起一段，避免与 products/:id 动态路由抢匹配 */
@ApiTags('产品管理')
@Controller('product-quality')
export class ProductCompletenessController {
  constructor(private readonly service: ProductCompletenessService) {}

  /** 产品主数据完整度（各字段填写率 + 最不完整的产品清单） */
  @Get('completeness')
  completeness(@CurrentUser() user: CurrentUserType) {
    return this.service.report(user);
  }
}
