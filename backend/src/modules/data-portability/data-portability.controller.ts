import {
  Controller,
  Get,
  Post,
  Body,
  Res,
  Query,
  StreamableFile,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { Roles } from '../../common/decorators/roles.decorator';
import { DataPortabilityService } from './data-portability.service';

@ApiTags('数据迁移')
@Controller('data-portability')
@Roles('admin')
export class DataPortabilityController {
  constructor(private readonly portabilityService: DataPortabilityService) {}

  @Get('tables')
  getExportableTables() {
    return { tables: this.portabilityService.getExportableTables() };
  }

  @Get('export')
  async exportJson(
    @Query('tables') tables: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const tableList = tables ? tables.split(',').map((t) => t.trim()) : undefined;
    const data = await this.portabilityService.exportJson(tableList);

    const json = JSON.stringify(data, null, 2);
    const fileName = `aikb-export-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.json`;

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName)}"`);
    return new StreamableFile(Buffer.from(json, 'utf-8'));
  }

  @Post('import')
  async importJson(@Body() body: any) {
    return this.portabilityService.importJson(body);
  }
}
