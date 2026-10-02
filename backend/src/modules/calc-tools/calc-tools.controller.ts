import { Controller, Get, Post, Delete, Body, Param, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CalcToolsService } from './calc-tools.service';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CurrentUser as CurrentUserType } from '../../common/services/permission.service';

@ApiTags('计算工具')
@Controller('calc-tools')
export class CalcToolsController {
  constructor(private readonly service: CalcToolsService) {}

  @Get()
  findAll(@Query('includeDisabled') includeDisabled?: string) {
    return this.service.findAll(includeDisabled === 'true' || includeDisabled === '1');
  }

  /**
   * 校验一份还没保存的 schema，返回逐项问题。
   *
   * 放在 :code 之前 —— 否则会被当成 code 为 "validate" 的模板去查。
   */
  @Post('validate')
  validate(@Body() body: { schema: any }) {
    return { problems: this.service.validateSchema(body?.schema) };
  }

  /** 用未保存的 schema 试算一次，模板编辑器的「试算」按钮走这里 */
  @Post('try')
  tryCalculate(@Body() body: { schema: any; inputs?: Record<string, any> }) {
    return this.service.tryCalculate(body?.schema, body?.inputs || {});
  }

  @Get(':code')
  findOne(@Param('code') code: string) {
    return this.service.findByCode(code);
  }

  /** 执行计算，不落库 */
  @Post(':code/calculate')
  calculate(@Param('code') code: string, @Body() body: { inputs: Record<string, any> }) {
    return this.service.calculate(code, body?.inputs || {});
  }

  /** 新增 / 更新模板（管理员） */
  @Post()
  @Roles('admin')
  upsert(@Body() dto: any) {
    return this.service.upsertTemplate(dto);
  }

  /** 删除模板；已有计算记录的改为停用 */
  @Delete(':code')
  @Roles('admin')
  remove(@Param('code') code: string) {
    return this.service.removeTemplate(code);
  }

  @Post(':code/enable')
  @Roles('admin')
  enable(@Param('code') code: string) {
    return this.service.enableTemplate(code);
  }
}

@ApiTags('计算记录')
@Controller('calc-records')
export class CalcRecordsController {
  constructor(private readonly service: CalcToolsService) {}

  @Get()
  list(
    @Query('templateCode') templateCode?: string,
    @Query('relatedSolutionId') relatedSolutionId?: string,
    @Query('relatedProposalId') relatedProposalId?: string,
    @Query('relatedRequirementId') relatedRequirementId?: string,
    @Query('customerId') customerId?: string,
  ) {
    return this.service.listRecords({
      templateCode,
      relatedSolutionId,
      relatedProposalId,
      relatedRequirementId,
      customerId,
    });
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.service.getRecord(id);
  }

  @Post()
  save(@Body() dto: any, @CurrentUser() user: CurrentUserType) {
    return this.service.saveRecord(dto, user);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.service.removeRecord(id);
  }
}
