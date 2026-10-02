import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AfterSalesTicket } from './entities/ticket.entity';
import { AfterSalesService } from './after-sales.service';
import { AfterSalesController } from './after-sales.controller';
import { WarrantySchedulerService } from './warranty-scheduler.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { PermissionQueryService } from '../../common/services/permission-query.service';
import { TransactionService } from '../../common/services/transaction.service';
import { PermissionService } from '../../common/services/permission.service';
import { KnowledgeSyncService } from '../../common/services/knowledge-sync.service';
import { AiService } from '../../common/services/ai.service';

@Module({
  imports: [TypeOrmModule.forFeature([AfterSalesTicket]), NotificationsModule],
  controllers: [AfterSalesController],
  providers: [
    AfterSalesService,
    WarrantySchedulerService,
    PermissionQueryService,
    TransactionService,
    PermissionService,
    KnowledgeSyncService,
    AiService,
  ],
  exports: [AfterSalesService],
})
export class AfterSalesModule {}
