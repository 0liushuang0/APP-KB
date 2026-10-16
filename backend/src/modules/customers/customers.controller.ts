import { Controller, Get, Post, Patch, Delete, Body, Param, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CustomersService } from './customers.service';
import { CreateCustomerDto, UpdateCustomerDto, CreateContactPersonDto, UpdateContactPersonDto, CreateFollowUpDto, QueryCustomerDto } from './dto/customer.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CurrentUser as CurrentUserType } from '../../common/services/permission.service';
import { Roles } from '../../common/decorators/roles.decorator';

@ApiTags('客户管理')
@Controller('customers')
export class CustomersController {
  constructor(private readonly customersService: CustomersService) {}

  @Get()
  findAll(@Query() query: QueryCustomerDto, @CurrentUser() user: CurrentUserType) {
    return this.customersService.findAll(query, user);
  }

  /** 区域字典 + 现有写法的归并预览（声明在 :id 之前） */
  @Get('region-dict')
  regionDict() {
    return this.customersService.regionDictView();
  }

  @Roles('admin')
  @Post('region-dict')
  saveRegionDict(@Body() body: any) {
    return this.customersService.saveRegionDict(body);
  }

  /** 按字典归并历史区域写法；dryRun=true 只看将要改什么 */
  @Roles('admin')
  @Post('region-dict/apply')
  applyRegionDict(@Body() body: { dryRun?: boolean }) {
    return this.customersService.applyRegionDict(body?.dryRun !== false);
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

  /** 统一时间线：沟通、需求记录、工作任务、单据、资料、修改，按时间倒序 */
  @Get(':id/timeline')
  timeline(@Param('id') id: string, @CurrentUser() user: CurrentUserType) {
    return this.customersService.getTimeline(id, user);
  }

  /** 粘贴邮件 / 聊天记录 → 沟通记录草稿（不保存，给人核对） */
  @Post(':id/follow-ups/parse')
  parseFollowUp(@Param('id') id: string, @Body() body: { text: string }, @CurrentUser() user: CurrentUserType) {
    return this.customersService.parseFollowUp(id, body?.text, user);
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

  @Delete('follow-ups/:followUpId')
  removeFollowUp(@Param('followUpId') followUpId: string, @CurrentUser() user: CurrentUserType) {
    return this.customersService.removeFollowUp(followUpId, user);
  }
}
