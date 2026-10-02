import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ApprovalFlow } from './entities/approval-flow.entity';
import { ApprovalsService } from './approvals.service';
import { ApprovalsController } from './approvals.controller';
import { PermissionService } from '../../common/services/permission.service';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [TypeOrmModule.forFeature([ApprovalFlow]), NotificationsModule],
  controllers: [ApprovalsController],
  providers: [ApprovalsService, PermissionService],
  exports: [ApprovalsService],
})
export class ApprovalsModule {}
