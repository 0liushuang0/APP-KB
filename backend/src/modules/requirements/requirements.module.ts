import { Module } from '@nestjs/common';
import { RecycleBinModule } from '../recycle-bin/recycle-bin.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Requirement, RequirementAttachment, RequirementLog } from './entities/requirement.entity';
import { RequirementPdfService } from './requirement-pdf.service';
import { RequirementsService } from './requirements.service';
import { RequirementsController } from './requirements.controller';
import { AiService } from '../../common/services/ai.service';
import { PermissionService } from '../../common/services/permission.service';
import { PermissionQueryService } from '../../common/services/permission-query.service';
import { KnowledgeSyncService } from '../../common/services/knowledge-sync.service';
import { TransactionService } from '../../common/services/transaction.service';
import { Customer } from '../customers/entities/customer.entity';
import { Proposal } from '../proposals/entities/proposal.entity';
import { Solution } from '../solutions/entities/solution.entity';
import { Project } from '../projects/entities/project.entity';
import { DocumentLink } from '../projects/entities/document-link.entity';
import { ApprovalsModule } from '../approvals/approvals.module';
import { DocumentsModule } from '../documents/documents.module';

@Module({
  imports: [TypeOrmModule.forFeature([Requirement, RequirementAttachment, RequirementLog, Customer, Proposal, Solution, Project, DocumentLink]), ApprovalsModule, DocumentsModule, RecycleBinModule],
  controllers: [RequirementsController],
  providers: [RequirementPdfService, PermissionQueryService, RequirementsService, AiService, PermissionService, KnowledgeSyncService, TransactionService],
  exports: [RequirementsService],
})
export class RequirementsModule {}
