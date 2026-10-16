import { Module } from '@nestjs/common';
import { RecycleBinModule } from '../recycle-bin/recycle-bin.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Contract } from './entities/contract.entity';
import { ContractPayment } from './entities/contract-payment.entity';
import { ContractsService } from './contracts.service';
import { ContractsController } from './contracts.controller';
import { ApprovalsModule } from '../approvals/approvals.module';
import { PermissionQueryService } from '../../common/services/permission-query.service';
import { TransactionService } from '../../common/services/transaction.service';
import { PermissionService } from '../../common/services/permission.service';
import { KnowledgeSyncService } from '../../common/services/knowledge-sync.service';
import { AiService } from '../../common/services/ai.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { PaymentDueScheduler } from './payment-due.scheduler';

@Module({
  imports: [TypeOrmModule.forFeature([Contract, ContractPayment]), ApprovalsModule, RecycleBinModule, NotificationsModule],
  controllers: [ContractsController],
  providers: [ContractsService, PermissionQueryService, TransactionService, PermissionService, KnowledgeSyncService, AiService, PaymentDueScheduler],
  exports: [ContractsService],
})
export class ContractsModule {}
