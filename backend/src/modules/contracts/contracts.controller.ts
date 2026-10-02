import { Controller, Get, Post, Patch, Delete, Body, Param, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ContractsService } from './contracts.service';
import { CreateContractDto, UpdateContractDto, QueryContractDto } from './dto/contract.dto';
import { CreateContractPaymentDto, UpdateContractPaymentDto } from './dto/payment.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CurrentUser as CurrentUserType } from '../../common/services/permission.service';

@ApiTags('合同管理')
@Controller('contracts')
export class ContractsController {
  constructor(private readonly contractsService: ContractsService) {}

  @Get()
  findAll(@Query() query: QueryContractDto, @CurrentUser() user: CurrentUserType) {
    return this.contractsService.findAll(query, user);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: CurrentUserType) {
    return this.contractsService.findOne(id, user);
  }

  @Post()
  create(@Body() dto: CreateContractDto, @CurrentUser() user: CurrentUserType) {
    return this.contractsService.create(dto, user);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateContractDto, @CurrentUser() user: CurrentUserType) {
    return this.contractsService.update(id, dto, user);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: CurrentUserType) {
    return this.contractsService.remove(id, user);
  }

  @Post(':id/approve')
  approve(@Param('id') id: string, @CurrentUser() user: CurrentUserType) {
    return this.contractsService.approve(id, user);
  }

  // ── 回款台账：应收节点 / 实收登记 / 发票 ──

  @Get(':id/payments')
  listPayments(@Param('id') id: string, @CurrentUser() user: CurrentUserType) {
    return this.contractsService.listPayments(id, user);
  }

  @Post(':id/payments')
  addPayment(
    @Param('id') id: string,
    @Body() dto: CreateContractPaymentDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.contractsService.addPayment(id, dto, user);
  }

  @Patch(':id/payments/:paymentId')
  updatePayment(
    @Param('id') id: string,
    @Param('paymentId') paymentId: string,
    @Body() dto: UpdateContractPaymentDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.contractsService.updatePayment(id, paymentId, dto, user);
  }

  @Delete(':id/payments/:paymentId')
  removePayment(
    @Param('id') id: string,
    @Param('paymentId') paymentId: string,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.contractsService.removePayment(id, paymentId, user);
  }
}
