import { Controller, Get, Post, Patch, Delete, Body, Param, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CustomersService } from './customers.service';
import { CreateCustomerDto, UpdateCustomerDto, CreateContactPersonDto, UpdateContactPersonDto, CreateFollowUpDto, QueryCustomerDto } from './dto/customer.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CurrentUser as CurrentUserType } from '../../common/services/permission.service';

@ApiTags('客户管理')
@Controller('customers')
export class CustomersController {
  constructor(private readonly customersService: CustomersService) {}

  @Get()
  findAll(@Query() query: QueryCustomerDto, @CurrentUser() user: CurrentUserType) {
    return this.customersService.findAll(query, user);
  }

  /** 客户资料总览（左侧导航用，支持翻页）；必须声明在 :id 之前，否则被动态路由吞掉 */
  @Get('doc-overview')
  docOverview(
    @Query('keyword') keyword: string | undefined,
    @Query('limit') limit: string | undefined,
    @Query('page') page: string | undefined,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.customersService.docOverview(
      { keyword, limit: limit ? Number(limit) : undefined, page: page ? Number(page) : undefined },
      user,
    );
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: CurrentUserType) {
    return this.customersService.findOne(id, user);
  }

  @Get(':id/360')
  get360View(@Param('id') id: string, @CurrentUser() user: CurrentUserType) {
    return this.customersService.getCustomer360(id, user);
  }

  @Post(':id/similar')
  findSimilarCustomers(@Param('id') id: string, @CurrentUser() user: CurrentUserType) {
    return this.customersService.findSimilarCustomers(id, user);
  }

  @Post(':id/cross-sell')
  crossSell(@Param('id') id: string, @CurrentUser() user: CurrentUserType) {
    return this.customersService.crossSell(id, user);
  }

  @Post()
  create(@Body() dto: CreateCustomerDto, @CurrentUser() user: CurrentUserType) {
    return this.customersService.create(dto, user);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateCustomerDto, @CurrentUser() user: CurrentUserType) {
    return this.customersService.update(id, dto, user);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: CurrentUserType) {
    return this.customersService.remove(id, user);
  }

  /** 删除预检：返回该客户名下将级联删除的业务链，前端据此弹告警 */
  @Get(':id/remove-preview')
  removePreview(@Param('id') id: string, @CurrentUser() user: CurrentUserType) {
    return this.customersService.removePreview(id, user);
  }

  @Post(':id/approve')
  approve(@Param('id') id: string, @CurrentUser() user: CurrentUserType) {
    return this.customersService.approve(id, user);
  }

  /*
   * 联系人的增 / 改 / 删。
   *
   * 这三条都是两段路径（contacts/...），不会和上面单段的 @Patch(':id')
   * @Delete(':id') 抢匹配，放在一起便于对照。
   */
  @Post('contacts')
  addContact(@Body() dto: CreateContactPersonDto, @CurrentUser() user: CurrentUserType) {
    return this.customersService.addContact(dto, user);
  }

  @Patch('contacts/:contactId')
  updateContact(
    @Param('contactId') contactId: string,
    @Body() dto: UpdateContactPersonDto,
    @CurrentUser() user: CurrentUserType,
  ) {
    return this.customersService.updateContact(contactId, dto, user);
  }

  @Delete('contacts/:contactId')
  removeContact(@Param('contactId') contactId: string, @CurrentUser() user: CurrentUserType) {
    return this.customersService.removeContact(contactId, user);
  }

  @Post('follow-ups')
  addFollowUp(@Body() dto: CreateFollowUpDto, @CurrentUser() user: CurrentUserType) {
    return this.customersService.addFollowUp(dto, user);
  }
}
