import { Controller, Get, Post, Delete, Param, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RecycleBinService } from './recycle-bin.service';
import { BusinessTrashService } from './business-trash.service';

@ApiTags('回收站')
@Controller('recycle-bin')
export class RecycleBinController {
  constructor(
    private readonly recycleBinService: RecycleBinService,
    private readonly businessTrash: BusinessTrashService,
  ) {}

  @Get()
  findAll(@Query('entityType') entityType?: string) {
    return this.recycleBinService.findAll(entityType);
  }

  /** 业务记录（客户/需求/方案/报价/合同/项目/售后/产品）回收站 */
  @Get('business')
  listBusiness() {
    return this.businessTrash.list();
  }

  @Post('business/:id/restore')
  restoreBusiness(@Param('id') id: string) {
    return this.businessTrash.restore(id);
  }

  @Delete('business/:id')
  purgeBusiness(@Param('id') id: string) {
    return this.businessTrash.purge(id);
  }

  /** 删除前的影响提示：被哪些单据引用 */
  @Get('impact/:type/:id')
  impact(@Param('type') type: string, @Param('id') id: string) {
    return this.businessTrash.impact(type, id);
  }

  /**
   * 通用还原。原实现只删掉回收记录、并不把数据写回 —— 点"还原"反而把数据彻底丢了。
   * 现在业务记录走真正的还原；资料仍由资料回收站（documents/recycled）负责，这里会明确拒绝。
   */
  @Post(':id/restore')
  restore(@Param('id') id: string) {
    return this.businessTrash.restore(id);
  }

  @Delete(':id')
  permanentDelete(@Param('id') id: string) {
    return this.recycleBinService.permanentDelete(id);
  }
}
