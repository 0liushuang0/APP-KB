import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
  ParseFilePipe,
  MaxFileSizeValidator,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiConsumes, ApiBody } from '@nestjs/swagger';
import { MAX_UPLOAD_BYTES } from '../../common/constants/upload';
import { Response } from 'express';
import { ProductsService } from './products.service';
import { CreateProductDto, UpdateProductDto, QueryProductDto } from './dto/product.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CurrentUser as CurrentUserType } from '../../common/services/permission.service';

@ApiTags('产品管理')
@Controller('products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Get()
  findAll(@Query() query: QueryProductDto, @CurrentUser() user: CurrentUserType) {
    return this.productsService.findAll(query, user);
  }
  /** 产品被引用情况：报过哪些价、价格区间 */
  @Get(':id/usage')
  usage(@Param('id') id: string, @CurrentUser() user: CurrentUserType) {
    return this.productsService.usage(id, user);
  }

  /** 型号价格表导出（Excel，列与导入模板一致） */
  @Get(':id/price-list/export')
  async exportPriceList(
    @Param('id') id: string,
    @Res() res: Response,
    @CurrentUser() user: CurrentUserType,
  ) {
    const buffer = await this.productsService.exportPriceList(id, user);
    const date = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=aikb-price-list-${date}.xlsx`);
    res.send(buffer);
  }

  /** 型号价格表导入：按型号规格匹配，已有型号更新、新型号追加 */
  @Post(':id/price-list/import')
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
      },
    },
  })
  @UseInterceptors(FileInterceptor('file'))
  importPriceList(
    @Param('id') id: string,
    @UploadedFile(
      new ParseFilePipe({
        validators: [new MaxFileSizeValidator({ maxSize: MAX_UPLOAD_BYTES })],
      }),
    )
    file: Express.Multer.File,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.productsService.importPriceList(id, file.buffer, user);
  }


  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: CurrentUserType) {
    return this.productsService.findOne(id, user);
  }

  @Post()
  create(@Body() dto: CreateProductDto, @CurrentUser() user: CurrentUserType) {
    return this.productsService.create(dto, user);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateProductDto, @CurrentUser() user: CurrentUserType) {
    return this.productsService.update(id, dto, user);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: CurrentUserType) {
    return this.productsService.remove(id, user);
  }

  @Post(':id/approve')
  approve(@Param('id') id: string, @CurrentUser() user: CurrentUserType) {
    return this.productsService.approve(id, user);
  }

  @Post(':id/upload')
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
        attachmentType: { type: 'string' },
      },
    },
  })
  @UseInterceptors(FileInterceptor('file'))
  uploadAttachment(
    @Param('id') id: string,
    @UploadedFile(
      new ParseFilePipe({
        validators: [new MaxFileSizeValidator({ maxSize: MAX_UPLOAD_BYTES })],
      }),
    )
    file: Express.Multer.File,
    @Body('attachmentType') attachmentType: string,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.productsService.uploadAttachment(id, file, attachmentType, user);
  }

  @Delete(':id/attachments/:aid')
  removeAttachment(
    @Param('id') id: string,
    @Param('aid') aid: string,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.productsService.removeAttachment(id, aid, user);
  }
}
