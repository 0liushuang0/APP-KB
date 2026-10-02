import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ApprovalsService } from './approvals.service';
import { QueryApprovalDto } from './dto/approval.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PermissionService, CurrentUser as CurrentUserType } from '../../common/services/permission.service';

@ApiTags('审批流')
@Controller('approvals')
export class ApprovalsController {
  constructor(
    private readonly approvalsService: ApprovalsService,
    private readonly permissionService: PermissionService,
  ) {}

  @Get()
  findAll(@Query() query: QueryApprovalDto) {
    return this.approvalsService.findAll(query);
  }

  @Get('pending-count')
  getPendingCount() {
    return this.approvalsService.getPendingCount();
  }

  @Post(':id/approve')
  approve(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserType,
    @Body('comment') comment?: string,
  ) {
    if (!this.permissionService.canApprove(user)) {
      throw new Error('无权审核');
    }
    return this.approvalsService.approveById(id, user?.userId, comment);
  }

  @Post(':id/reject')
  reject(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserType,
    @Body('comment') comment?: string,
  ) {
    if (!this.permissionService.canApprove(user)) {
      throw new Error('无权审核');
    }
    return this.approvalsService.rejectById(id, user?.userId, comment);
  }
}
