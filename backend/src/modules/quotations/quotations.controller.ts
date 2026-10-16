import { Controller, Get, Post, Patch, Delete, Body, Param, Query, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { QuotationsService } from './quotations.service';
import { QuotationPrintService } from './quotation-print.service';
import { CreateQuotationDto, UpdateQuotationDto, SuggestQuotationDto, QueryQuotationDto } from './dto/quotation.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CurrentUser as CurrentUserType } from '../../common/services/permission.service';

@ApiTags('报价管理')
@Controller('quotations')
export class QuotationsController {
  constructor(
    private readonly quotationsService: QuotationsService,
    private readonly quotationPrintService: QuotationPrintService,
  ) {}

  @Get()
  findAll(@Query() query: QueryQuotationDto, @CurrentUser() user: CurrentUserType) {
    return this.quotationsService.findAll(query, user);
  }

  /**
   * 可打印的报价单。返回 HTML 由浏览器「打印为 PDF」——
   * 见 QuotationPrintService 注释：不为一张表引入无头浏览器。
   */
  /** 方案 → 报价：项目名称、按需求产品类型带出的明细（含匹配理由）、商务条款默认值 */
  @Get('draft-from-proposal/:proposalId')
  draftFromProposal(@Param('proposalId') proposalId: string, @CurrentUser() user: CurrentUserType) {
    return this.quotationsService.draftFromProposal(proposalId, user);
  }

  /** 选了产品（和型号）后的成本提示：型号价格表成本价 → 映射的供应商采购价 → BOM（无成本权限时不返回数值） */
  @Get('cost-hint')
  costHint(
    @Query('productId') productId: string,
    @Query('model') model: string | undefined,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.quotationsService.costHint(productId, model, user);
  }

  /** ?lang=en / zh：临时切换语言预览（不改报价单本身的语言） */
  @Get(':id/print')
  async print(@Param('id') id: string, @Query('lang') lang: string | undefined, @Res() res: Response) {
    const html = await this.quotationPrintService.renderHtml(id, lang);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: CurrentUserType) {
    return this.quotationsService.findOne(id, user);
  }

  /** 历史版本：每次修改自动存档，供审计与客户对账回放 */
  @Get(':id/versions')
  listVersions(@Param('id') id: string, @CurrentUser() user: CurrentUserType) {
    return this.quotationsService.listVersions(id, user);
  }

  @Post()
  create(@Body() dto: CreateQuotationDto, @CurrentUser() user: CurrentUserType) {
    return this.quotationsService.create(dto, user);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateQuotationDto, @CurrentUser() user: CurrentUserType) {
    return this.quotationsService.update(id, dto, user);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: CurrentUserType) {
    return this.quotationsService.remove(id, user);
  }

  @Post(':id/approve')
  approve(@Param('id') id: string, @CurrentUser() user: CurrentUserType) {
    return this.quotationsService.approve(id, user);
  }

  @Post('suggest')
  suggest(@Body() dto: SuggestQuotationDto) {
    return this.quotationsService.suggest(dto);
  }
}
