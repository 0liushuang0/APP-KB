import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Project, ProjectStage, ProjectRisk, ProjectTask } from './entities/project.entity';
import { ProjectTimeline } from './entities/project-timeline.entity';
import { DocumentLink } from './entities/document-link.entity';
import { ProjectMember } from './entities/project-member.entity';
import { ProjectsService } from './projects.service';
import { ProjectWorkflowService } from './project-workflow.service';
import { ProjectsController } from './projects.controller';
import { AiService } from '../../common/services/ai.service';
import { TransactionService } from '../../common/services/transaction.service';
import { PermissionService } from '../../common/services/permission.service';
import { PermissionQueryService } from '../../common/services/permission-query.service';
import { KnowledgeSyncService } from '../../common/services/knowledge-sync.service';
import { NumberingService } from '../../common/services/numbering.service';
import { ApprovalsModule } from '../approvals/approvals.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { Document } from '../documents/entities/document.entity';
import { Requirement } from '../requirements/entities/requirement.entity';
import { Proposal } from '../proposals/entities/proposal.entity';
import { Quotation } from '../quotations/entities/quotation.entity';
import { User } from '../users/entities/user.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Project,
      ProjectStage,
      ProjectRisk,
      ProjectTask,
      ProjectTimeline,
      DocumentLink,
      ProjectMember,
      User,
      Document,
      Requirement,
      Proposal,
      Quotation,
    ]),
    ApprovalsModule,
    NotificationsModule,
  ],
  controllers: [ProjectsController],
  providers: [PermissionQueryService, TransactionService, ProjectsService, ProjectWorkflowService, AiService, PermissionService, KnowledgeSyncService, NumberingService],
  exports: [ProjectsService, ProjectWorkflowService],
})
export class ProjectsModule {}
