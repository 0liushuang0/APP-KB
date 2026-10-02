import { Controller, Get, Post, Delete, Param, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RecycleBinService } from './recycle-bin.service';

@ApiTags('回收站')
@Controller('recycle-bin')
export class RecycleBinController {
  constructor(private readonly recycleBinService: RecycleBinService) {}

  @Get()
  findAll(@Query('entityType') entityType?: string) {
    return this.recycleBinService.findAll(entityType);
  }

  @Post(':id/restore')
  restore(@Param('id') id: string) {
    return this.recycleBinService.restore(id);
  }

  @Delete(':id')
  permanentDelete(@Param('id') id: string) {
    return this.recycleBinService.permanentDelete(id);
  }
}
