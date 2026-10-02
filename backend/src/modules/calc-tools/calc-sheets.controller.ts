import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseInterceptors,
  UploadedFile,
  Res,
  StreamableFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { CalcToolsService } from './calc-tools.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CurrentUser as CurrentUserType } from '../../common/services/permission.service';

@ApiTags('计算表')
@Controller('calc-sheets')
export class CalcSheetsController {
  constructor(private readonly service: CalcToolsService) {}

  /**
   * 列表查询
   */
  @Get()
  list(
    @Query('templateCode') templateCode?: string,
    @Query('relatedRequirementId') relatedRequirementId?: string,
    @Query('relatedProposalId') relatedProposalId?: string,
    @Query('customerId') customerId?: string,
  ) {
    return this.service.listSheets({
      templateCode,
      relatedRequirementId,
      relatedProposalId,
      customerId,
    });
  }

  /**
   * 获取单个计算表（含Luckysheet数据）
   */
  @Get(':id')
  get(@Param('id') id: string) {
    return this.service.getSheet(id);
  }

  /**
   * 上传Excel文件并解析为Luckysheet格式
   */
  @Post('upload')
  @UseInterceptors(FileInterceptor('file'))
  upload(
    @UploadedFile() file: Express.Multer.File,
    @Body()
    dto: {
      name?: string;
      templateCode?: string;
      relatedRequirementId?: string;
      relatedProposalId?: string;
      customerId?: string;
    },
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.service.uploadSheet(file, dto, user);
  }

  /**
   * 更新Luckysheet数据（编辑后保存）
   */
  @Patch(':id/data')
  updateData(
    @Param('id') id: string,
    @Body() body: { sheetData: any },
  ) {
    return this.service.updateSheetData(id, body.sheetData);
  }

  /**
   * 更新基本信息（名称、描述）
   */
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: { name?: string; description?: string },
  ) {
    return this.service.updateSheet(id, dto);
  }

  /**
   * 删除计算表
   */
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.service.removeSheet(id);
  }

  /**
   * 下载原始Excel文件
   */
  @Get(':id/download')
  async download(
    @Param('id') id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    return this.service.downloadSheet(id, res);
  }
}
