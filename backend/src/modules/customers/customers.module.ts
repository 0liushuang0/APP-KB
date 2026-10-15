import { Module } from '@nestjs/common';
import { RecycleBinModule } from '../recycle-bin/recycle-bin.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Customer, ContactPerson, FollowUpRecord } from './entities/customer.entity';
import { CustomersService } from './customers.service';
import { CustomersController } from './customers.controller';
import { AiService } from '../../common/services/ai.service';
import { PermissionService } from '../../common/services/permission.service';
import { PermissionQueryService } from '../../common/services/permission-query.service';
import { KnowledgeSyncService } from '../../common/services/knowledge-sync.service';
import { TransactionService } from '../../common/services/transaction.service';
import { NumberingService } from '../../common/services/numbering.service';
import { ApprovalsModule } from '../approvals/approvals.module';
import { Project } from '../projects/entities/project.entity';
import { DocumentLink } from '../projects/entities/document-link.entity';
import { Document } from '../documents/entities/document.entity';
import { Requirement } from '../requirements/entities/requirement.entity';
import { Proposal } from '../proposals/entities/proposal.entity';
import { Quotation, QuotationItem } from '../quotations/entities/quotation.entity';
import { Contract } from '../contracts/entities/contract.entity';
import { AfterSalesTicket } from '../after-sales/entities/ticket.entity';

@Module({
  imports: [
    RecycleBinModule,
    TypeOrmModule.forFeature([
      Customer,
      ContactPerson,
      FollowUpRecord,
      Project,
      DocumentLink,
      Document,
      Requirement,
      Proposal,
      Quotation,
      QuotationItem,
      Contract,
      AfterSalesTicket,
    ]),
    ApprovalsModule,
  ],
  controllers: [CustomersController],
  providers: [PermissionQueryService, CustomersService, AiService, PermissionService, KnowledgeSyncService, TransactionService, NumberingService],
  exports: [CustomersService],
})
export class CustomersModule {}
