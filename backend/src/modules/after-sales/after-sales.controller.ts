import { Controller, Get, Post, Patch, Delete, Body, Param, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AfterSalesService } from './after-sales.service';
import { CreateTicketDto, UpdateTicketDto, QueryTicketDto } from './dto/ticket.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CurrentUser as CurrentUserType } from '../../common/services/permission.service';

@ApiTags('售后管理')
@Controller('after-sales')
export class AfterSalesController {
  constructor(private readonly afterSalesService: AfterSalesService) {}

  @Get()
  findAll(@Query() query: QueryTicketDto, @CurrentUser() user: CurrentUserType) {
    return this.afterSalesService.findAll(query, user);
  }

  @Get('stats')
  getStats(@CurrentUser() user: CurrentUserType) {
    return this.afterSalesService.getStats(user);
  }

  /** 项目所供设备的型号（报价明细），新建工单时下拉选择，不必手敲 */
  @Get('models-for-project/:projectId')
  modelsForProject(@Param('projectId') projectId: string) {
    return this.afterSalesService.modelsForProject(projectId);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: CurrentUserType) {
    return this.afterSalesService.findOne(id, user);
  }

  @Post()
  create(@Body() dto: CreateTicketDto, @CurrentUser() user: CurrentUserType) {
    return this.afterSalesService.create(dto, user);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateTicketDto, @CurrentUser() user: CurrentUserType) {
    return this.afterSalesService.update(id, dto, user);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: CurrentUserType) {
    return this.afterSalesService.remove(id, user);
  }

  /** 备件需求转需求管理（数据回流闭环） */
  @Post(':id/convert-to-requirement')
  convertToRequirement(@Param('id') id: string, @CurrentUser() user: CurrentUserType) {
    return this.afterSalesService.convertToRequirement(id, user);
  }

  /** 故障转知识库 FAQ（知识回流） */
  @Post(':id/convert-to-faq')
  convertToFaq(@Param('id') id: string, @CurrentUser() user: CurrentUserType) {
    return this.afterSalesService.convertToFaq(id, user);
  }
}
