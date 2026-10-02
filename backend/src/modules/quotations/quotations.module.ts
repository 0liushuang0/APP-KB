import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Quotation, QuotationItem } from './entities/quotation.entity';
import { QuotationVersion } from './entities/quotation-version.entity';
import { QuotationsService } from './quotations.service';
import { QuotationPrintService } from './quotation-print.service';
import { QuotationsController } from './quotations.controller';
import { AiService } from '../../common/services/ai.service';
import { TransactionService } from '../../common/services/transaction.service';
import { PermissionService } from '../../common/services/permission.service';
import { PermissionQueryService } from '../../common/services/permission-query.service';
import { KnowledgeSyncService } from '../../common/services/knowledge-sync.service';
import { ApprovalsModule } from '../approvals/approvals.module';
import { Customer, ContactPerson } from '../customers/entities/customer.entity';
import { SystemConfig } from '../system-config/entities/system-config.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Quotation, QuotationItem, QuotationVersion, Customer, ContactPerson, SystemConfig]),
    ApprovalsModule,
  ],
  controllers: [QuotationsController],
  providers: [PermissionQueryService, TransactionService, 
    QuotationsService,
    QuotationPrintService,
    AiService,
    PermissionService,
    KnowledgeSyncService,
  ],
  exports: [QuotationsService],
})
export class QuotationsModule {}
