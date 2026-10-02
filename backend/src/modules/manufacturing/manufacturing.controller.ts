import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CurrentUser as User } from '../../common/services/permission.service';
import { ManufacturingService } from './manufacturing.service';
import {
  CreateManufacturingCaseDto, UpdateManufacturingCaseDto, AddEquipmentDto,
  AddComplianceDto, RecordReviewDto, CreateEngineeringChangeDto,
  CreateDeliveryMilestoneDto, UpdateDeliveryMilestoneDto, LoseManufacturingCaseDto,
} from './dto/manufacturing.dto';

@ApiTags('离散制造业务')
@Controller('manufacturing')
export class ManufacturingController {
  constructor(private readonly service: ManufacturingService) {}

  @Get('definitions') definitions() { return this.service.getDefinitions(); }
  @Get('team-users') teamUsers(@CurrentUser() user: User) { return this.service.teamUsers(user); }
  @Get('summary') summary(@CurrentUser() user: User) { return this.service.summary(user); }
  @Get('cases') listCases(@CurrentUser() user: User) { return this.service.listCases(user); }
  @Post('cases') createCase(@Body() dto: CreateManufacturingCaseDto, @CurrentUser() user: User) {
    return this.service.createCase(dto, user);
  }
  @Get('cases/:id') detail(@Param('id') id: string, @CurrentUser() user: User) {
    return this.service.detail(id, user);
  }
  @Patch('cases/:id') updateCase(@Param('id') id: string, @Body() dto: UpdateManufacturingCaseDto,
    @CurrentUser() user: User) { return this.service.updateCase(id, dto, user); }
  @Post('cases/:id/advance') advance(@Param('id') id: string, @CurrentUser() user: User) {
    return this.service.advanceCase(id, user);
  }
  @Post('cases/:id/lose') lose(@Param('id') id: string, @Body() dto: LoseManufacturingCaseDto,
    @CurrentUser() user: User) { return this.service.loseCase(id, dto, user); }
  @Post('cases/:id/compliance') compliance(@Param('id') id: string, @Body() dto: AddComplianceDto,
    @CurrentUser() user: User) { return this.service.addCompliance(id, dto, user); }
  @Post('cases/:id/reviews') review(@Param('id') id: string, @Body() dto: RecordReviewDto,
    @CurrentUser() user: User) { return this.service.review(id, dto, user); }
  @Post('cases/:id/changes') change(@Param('id') id: string, @Body() dto: CreateEngineeringChangeDto,
    @CurrentUser() user: User) { return this.service.addChange(id, dto, user); }
  @Post('cases/:id/changes/:changeId/approve') approveChange(@Param('id') id: string,
    @Param('changeId') changeId: string, @CurrentUser() user: User) {
    return this.service.approveChange(id, changeId, user);
  }
  @Post('cases/:id/milestones') milestone(@Param('id') id: string,
    @Body() dto: CreateDeliveryMilestoneDto, @CurrentUser() user: User) {
    return this.service.addMilestone(id, dto, user);
  }
  @Patch('cases/:id/milestones/:milestoneId') updateMilestone(@Param('id') id: string,
    @Param('milestoneId') milestoneId: string, @Body() dto: UpdateDeliveryMilestoneDto,
    @CurrentUser() user: User) { return this.service.updateMilestone(id, milestoneId, dto, user); }
  @Get('equipment') equipment(@Query('customerId') customerId: string, @CurrentUser() user: User) {
    return this.service.listEquipment(customerId, user);
  }
  @Post('equipment') addEquipment(@Body() dto: AddEquipmentDto, @CurrentUser() user: User) {
    return this.service.addEquipment(dto, user);
  }
}
