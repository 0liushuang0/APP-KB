import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Document } from './entities/document.entity';
import { DocumentVersion } from './entities/document-version.entity';
import { DocumentsService } from './documents.service';
import { DocumentsController } from './documents.controller';
import { DocumentLinksService } from './document-links.service';
import { AiService } from '../../common/services/ai.service';
import { PermissionService } from '../../common/services/permission.service';
import { PermissionQueryService } from '../../common/services/permission-query.service';
import { ApprovalsModule } from '../approvals/approvals.module';
import { FileArchiveModule } from '../../common/services/file-archive.module';
import { TransactionService } from '../../common/services/transaction.service';
import { DocumentLink } from '../projects/entities/document-link.entity';
import { Customer } from '../customers/entities/customer.entity';
import { Requirement } from '../requirements/entities/requirement.entity';
import { Proposal } from '../proposals/entities/proposal.entity';
import { Quotation } from '../quotations/entities/quotation.entity';
import { Project } from '../projects/entities/project.entity';
import { RecycleBinModule } from '../recycle-bin/recycle-bin.module';
import { RecycleCleanupService } from './recycle-cleanup.service';
import { ZhDocumentImport } from './entities/zh-document-import.entity';
import { ApprovalFlow } from '../approvals/entities/approval-flow.entity';
import { User } from '../users/entities/user.entity';
import { ZhDocumentsService } from './zh-documents.service';
import { ZhDocumentsController, ZhKnowledgeHealthController, ZhServiceTokenGuard } from './zh-documents.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Document,
      DocumentVersion,
      ZhDocumentImport,
      ApprovalFlow,
      User,
      DocumentLink,
      Customer,
      Requirement,
      Proposal,
      Quotation,
      Project,
    ]),
    ApprovalsModule,
    FileArchiveModule,
    // 删除资料改为软删（快照进回收站、文件移到回收目录），不再直接抹掉
    RecycleBinModule,
  ],
  controllers: [DocumentsController, ZhDocumentsController, ZhKnowledgeHealthController],
  providers: [PermissionQueryService, DocumentsService, DocumentLinksService, AiService, PermissionService, TransactionService, RecycleCleanupService, ZhDocumentsService, ZhServiceTokenGuard],
  exports: [DocumentsService, DocumentLinksService],
})
export class DocumentsModule {}
