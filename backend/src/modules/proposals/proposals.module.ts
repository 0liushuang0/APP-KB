import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Proposal, ProposalVersion } from './entities/proposal.entity';
import { Requirement } from '../requirements/entities/requirement.entity';
import { Customer } from '../customers/entities/customer.entity';
import { ProposalsService } from './proposals.service';
import { ProposalsController } from './proposals.controller';
import { AiService } from '../../common/services/ai.service';
import { PermissionService } from '../../common/services/permission.service';
import { PermissionQueryService } from '../../common/services/permission-query.service';
import { KnowledgeSyncService } from '../../common/services/knowledge-sync.service';
import { TransactionService } from '../../common/services/transaction.service';
import { DocumentsModule } from '../documents/documents.module';
import { ApprovalsModule } from '../approvals/approvals.module';

@Module({
  imports: [TypeOrmModule.forFeature([Proposal, ProposalVersion, Requirement, Customer]), ApprovalsModule, DocumentsModule],
  controllers: [ProposalsController],
  providers: [PermissionQueryService, ProposalsService, AiService, PermissionService, KnowledgeSyncService, TransactionService],
  exports: [ProposalsService],
})
export class ProposalsModule {}
