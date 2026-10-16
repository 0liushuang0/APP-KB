import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SystemService } from './system.service';
import { SystemController } from './system.controller';
import { SystemConfigModule } from '../system-config/system-config.module';
import { RolesModule } from '../roles/roles.module';
import { UsersModule } from '../users/users.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { Customer } from '../customers/entities/customer.entity';
import { Proposal } from '../proposals/entities/proposal.entity';
import { Quotation } from '../quotations/entities/quotation.entity';
import { ApprovalFlow } from '../approvals/entities/approval-flow.entity';
import { Product } from '../products/entities/product.entity';
import { Supplier } from '../suppliers/entities/supplier.entity';
import { Project } from '../projects/entities/project.entity';
import { Document } from '../documents/entities/document.entity';
import { Requirement } from '../requirements/entities/requirement.entity';
import { Contract } from '../contracts/entities/contract.entity';
import { AiCallLog } from '../ai/entities/ai-call-log.entity';
import { AuditLog } from '../audit-logs/entities/audit-log.entity';
import { WeeklyReport } from './weekly-report.entity';
import { WeeklyReportService } from './weekly-report.service';
import { ReportsController } from './reports.controller';
import { PermissionService } from '../../common/services/permission.service';

@Module({
  imports: [
    RolesModule,
    UsersModule,
    SystemConfigModule,
    NotificationsModule,
    TypeOrmModule.forFeature([
      Customer,
      Proposal,
      Quotation,
      ApprovalFlow,
      Product,
      Supplier,
      Project,
      Document,
      Requirement,
      Contract,
      AiCallLog,
      AuditLog,
      WeeklyReport,
    ]),
  ],
  controllers: [SystemController, ReportsController],
  providers: [SystemService, WeeklyReportService, PermissionService],
  exports: [SystemService],
})
export class SystemModule {}
